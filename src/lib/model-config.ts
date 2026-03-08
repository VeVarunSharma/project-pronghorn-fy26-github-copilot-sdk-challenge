let cachedCredential: {
  getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }>;
} | null = null;
let cachedToken: { token: string; expiresOn: number } | null = null;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const SUPPORTED_MODEL_PREFIXES = ["o3", "o4-mini", "gpt-5", "codex-mini"];

export function isModelSupported(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return SUPPORTED_MODEL_PREFIXES.some(
    (p) => lower === p || lower.startsWith(p + "-") || lower.startsWith(p + ".")
  );
}

export function enhanceModelError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Encrypted content is not supported")) {
    return new Error(
      `Model "${process.env.MODEL_NAME ?? "(unknown)"}" does not support encrypted content. ` +
        `Only o-series and gpt-5 family models work with the Copilot SDK. ` +
        `Change MODEL_NAME to a supported model (e.g., o4-mini).`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function getAzureBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresOn - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.token;
  }
  if (!cachedCredential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    cachedCredential = new DefaultAzureCredential();
  }
  const result = await cachedCredential.getToken(
    "https://cognitiveservices.azure.com/.default"
  );
  if (!result) {
    throw new Error("Failed to acquire Azure bearer token.");
  }
  cachedToken = { token: result.token, expiresOn: result.expiresOnTimestamp };
  return result.token;
}

export async function getSessionOptions(opts?: {
  streaming?: boolean;
}): Promise<Record<string, unknown>> {
  const provider = process.env.MODEL_PROVIDER;
  const modelName = process.env.MODEL_NAME;
  const streaming = opts?.streaming ?? false;

  if (provider === "azure") {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint || !modelName) {
      throw new Error(
        "AZURE_OPENAI_ENDPOINT and MODEL_NAME are required when MODEL_PROVIDER is 'azure'"
      );
    }
    const bearerToken = await getAzureBearerToken();
    return {
      model: modelName,
      streaming,
      provider: {
        type: "azure",
        baseUrl: endpoint.replace(/\/$/, ""),
        bearerToken,
        wireApi: "completions",
        azure: { apiVersion: "2025-04-01-preview" },
      },
    };
  }

  const effectiveModel = modelName || "claude-opus-4.6";

  return { model: effectiveModel, streaming };
}
