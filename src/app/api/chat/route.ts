import { NextRequest } from "next/server";
import { getClient } from "@/lib/copilot-client";
import { getSessionOptions, enhanceModelError } from "@/lib/model-config";

type SessionLike = {
  on(event: string, cb: (e: unknown) => void): () => void;
  send(msg: { prompt: string }): Promise<void>;
  destroy(): Promise<void>;
};

function waitForIdle(session: SessionLike, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubIdle();
      unsubError();
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for response`));
    }, timeoutMs);

    const unsubIdle = session.on("session.idle", () => {
      clearTimeout(timer);
      unsubIdle();
      unsubError();
      resolve();
    });

    const unsubError = session.on("session.error", (event: unknown) => {
      clearTimeout(timer);
      unsubIdle();
      unsubError();
      const msg =
        (event as { data?: { message?: string } })?.data?.message ??
        "Unknown session error";
      reject(new Error(`Session error: ${msg}`));
    });
  });
}

const PRONGHORN_CONTEXT = `You are Pronghorn 🦌, an enterprise application generator built for the Government of Alberta, optimized for Azure cloud deployment.

You help developers by:
1. Understanding their application requirements
2. Recommending Azure-first architectures (Azure Container Apps, Azure App Service, Azure Functions, Azure SQL, Azure Cosmos DB, Azure Key Vault, Azure Monitor, etc.)
3. Explaining security best practices, governance standards, and Azure compliance (SOC 2, FedRAMP, Canadian data residency)
4. Recommending appropriate Azure services for each requirement (e.g., Azure Service Bus for messaging, Azure Blob Storage for files, Azure AD/Entra ID for auth)
5. Guiding them to use the Generate feature when ready

AZURE-FIRST GUIDELINES:
- Always recommend Azure services over generic alternatives (e.g., Azure Cosmos DB over "a NoSQL database", Azure Key Vault over "a secrets manager")
- Suggest Azure Container Apps as the default compute platform for microservices
- Recommend Azure Monitor + Application Insights for observability
- Suggest Azure DevOps or GitHub Actions with Azure deployment targets for CI/CD
- Mention Azure Managed Identity / DefaultAzureCredential for service-to-service auth
- Reference Azure Well-Architected Framework principles where relevant
- For data residency requirements, recommend Canada Central or Canada East Azure regions

Be concise, professional, and focus on enterprise-grade Azure-native solutions. When the user has finalized their requirements, encourage them to use the "Generate Project" panel to create their application.

`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, history } = body as {
    message?: string;
    history?: { role: string; content: string }[];
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    return new Response(JSON.stringify({ error: "Missing 'message' field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const prompt =
    Array.isArray(history) && history.length > 0
      ? PRONGHORN_CONTEXT +
        [...history.map((h) => `${h.role}: ${h.content}`), `user: ${message}`].join(
          "\n"
        )
      : PRONGHORN_CONTEXT + message;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let session: SessionLike | null = null;
      let unsubDelta: (() => void) | null = null;

      try {
        const copilot = await getClient();
        const options = await getSessionOptions({ streaming: true });
        session = (await copilot.createSession(options)) as unknown as SessionLike;

        unsubDelta = session.on(
          "assistant.message_delta",
          (event: unknown) => {
            const delta =
              (event as { data?: { deltaContent?: string } })?.data
                ?.deltaContent ?? "";
            if (delta) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ content: delta })}\n\n`
                )
              );
            }
          }
        );

        await session.send({ prompt });
        await waitForIdle(session);

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        const enhanced = enhanceModelError(err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: enhanced.message })}\n\n`
          )
        );
        controller.close();
      } finally {
        unsubDelta?.();
        await session?.destroy();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
