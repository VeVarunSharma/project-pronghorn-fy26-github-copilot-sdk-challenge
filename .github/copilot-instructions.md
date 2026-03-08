# Copilot Instructions — Pronghorn 🦌

## Project Overview

Pronghorn is an AI-powered enterprise application generator built with the **GitHub Copilot SDK** for the **Government of Alberta**. It takes natural language requirements, generates production-ready code, provisions repositories in a sandboxed GitHub organization, and enforces security policies automatically.

- **Framework**: Next.js 16 (App Router) with React 19
- **UI**: shadcn/ui + Tailwind CSS 4
- **AI**: `@github/copilot-sdk` (v0.1.25)
- **GitHub API**: `@octokit/rest`
- **Deployment**: Azure Container Apps via Azure Developer CLI (`azd`)
- **IaC**: Azure Bicep
- **Package Manager**: pnpm (never use npm or yarn)

## Architecture

Pronghorn uses a **sandbox organization architecture** to isolate AI-generated repositories from production:

1. **Requirements Chat** (`/api/chat`) — Conversational agent powered by the Copilot SDK that helps developers articulate and refine application requirements with Azure-first recommendations
2. **Code Generation** (`/api/pronghorn/generate`) — 7-stage agentic pipeline that generates 38+ enterprise scaffold files, creates a GitHub repository, configures security, and creates GitHub Issues for Copilot agent assignment
3. **GitHub Service** (`src/lib/github-service.ts`) — Octokit wrapper for repo creation, code push via Git tree API, branch protection, Dependabot alerts, and issue management
4. **Sandbox Isolation** — All generated repos go to `PRONGHORN_SANDBOX_ORG`, never touching the production org (3,400+ repos)

## Key Technical Patterns

### Copilot SDK Usage
- **Singleton client** in `src/lib/copilot-client.ts` — `CopilotClient` initialized with `GITHUB_TOKEN`
- **Streaming sessions** — Use `session.on("assistant.message_delta", ...)` for SSE streaming and `waitForIdle()` for completion
- **Summarize sessions** — Use `session.sendAndWait()` for non-streaming responses (issue generation)
- **Three-path model config** in `src/lib/model-config.ts`:
  - GitHub default models (no config needed)
  - GitHub-specific model (`MODEL_NAME`)
  - Azure BYOM (`MODEL_PROVIDER=azure` + `AZURE_OPENAI_ENDPOINT` + `MODEL_NAME`)
- **Supported models**: o3, o4-mini, gpt-5 family, codex-mini (must support encrypted content)

### SSE Streaming Pattern
All streaming endpoints use this pattern:
```typescript
const stream = new ReadableStream({
  async start(controller) {
    const session = await copilot.createSession(options);
    session.on("assistant.message_delta", (event) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
    });
    await session.send({ prompt });
    await waitForIdle(session);
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  },
});
```

### GitHub API via Octokit
- Repository names are sanitized: lowercase, `[^a-z0-9-]` → `-`, max 100 chars
- Code push uses the Git tree API (createBlob → createTree → createCommit → updateRef)
- Security configuration: `enableVulnerabilityAlerts`, `enableAutomatedSecurityFixes`, `updateBranchProtection`
- Issues are created with labels: `copilot-agent`, `pronghorn-generated`, `feature`, `security`, `infrastructure`, `azure`, etc.

## File Conventions

- **File names**: kebab-case throughout (e.g., `copilot-client.ts`, `github-service.ts`, `generate-panel.tsx`)
- **API routes**: `src/app/api/<path>/route.ts` (Next.js 16 App Router convention)
- **Components**: `src/components/` for application components, `src/components/ui/` for shadcn primitives
- **Libraries**: `src/lib/` for shared utilities and services
- **Client components**: Must use `"use client"` directive at top of file
- **Server components/routes**: Default (no directive needed)

## Coding Standards

### TypeScript
- Strict mode enabled
- Use `interface` for object shapes, `type` for unions and intersections
- Prefer `async/await` over raw promises
- Use `import type` for type-only imports
- Export named functions (not default) for library modules

### React / Next.js
- Next.js 16 App Router — no Pages Router
- Use `"use client"` only for interactive components (chat, input, generation panel)
- API routes return `Response` or `NextResponse`
- Use `useCallback` for event handlers passed as props
- Use `useRef` for values that don't trigger re-renders (abort controllers, message buffers)

### Styling
- Tailwind CSS utility classes — no custom CSS except in `globals.css`
- shadcn/ui components for all UI primitives (Button, Card, Badge, Input, Textarea)
- Dark mode by default (`className="dark"` on html element)
- Use `cn()` from `src/lib/utils.ts` for conditional class merging

### Error Handling
- Use `enhanceModelError()` from `model-config.ts` for Copilot SDK errors
- Wrap Copilot SDK calls in try/catch with meaningful error messages
- SSE errors sent as `event: error\ndata: { error: "message" }\n\n`
- GitHub API errors are caught individually with graceful degradation (e.g., security config failures don't block generation)

## Environment & Dependencies

### Required Environment Variables
- `GITHUB_TOKEN` — Copilot SDK auth (needs `copilot` scope via `gh auth refresh --scopes copilot`)
- `PRONGHORN_SANDBOX_ORG` — Target GitHub org for generated repositories

### Optional Environment Variables
- `PRONGHORN_GITHUB_TOKEN` — Separate PAT for GitHub API (falls back to `GITHUB_TOKEN`)
- `MODEL_PROVIDER` — Set to `azure` for Azure BYOM
- `MODEL_NAME` — Specific model name (e.g., `o4-mini`)
- `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint (required with `MODEL_PROVIDER=azure`)

### Commands
```bash
pnpm install    # Install dependencies
pnpm dev        # Development server (http://localhost:3000)
pnpm build      # Production build
pnpm start      # Start production server
pnpm lint       # ESLint
azd up          # Deploy to Azure Container Apps
```

## Azure Infrastructure

- **Container App**: 0.5 CPU, 1 GB memory, auto-scales 1–10 replicas
- **Container Registry**: Basic SKU, admin enabled
- **Key Vault**: RBAC-based, managed identity gets Secrets User role
- **Log Analytics + Application Insights**: 30-day retention
- **Health probes**: Liveness every 30s, readiness every 10s on `/api/health`
- **Recommended regions**: Canada Central, Canada East (data residency)

## Copilot Agents

Eight specialized agents in `.github/agents/`:

| Agent | Focus Area |
|-------|-----------|
| `pronghorn-api` | RESTful API design, OpenAPI specs, Express middleware |
| `pronghorn-security` | FOIP compliance, OWASP, Entra ID, Key Vault, vulnerability management |
| `pronghorn-terraform` | Azure Bicep/Terraform, `azd` templates, Azure Well-Architected Framework |
| `pronghorn-ticketing` | GitHub Issues, project boards, sprint planning, cross-repo tracking |
| `pronghorn-sre` | Azure Monitor, App Insights, SLOs, incident response, capacity planning |
| `pronghorn-docs` | READMEs, ADRs, runbooks, API documentation, compliance docs |
| `pronghorn-data` | Data governance, FOIP compliance, Canadian data residency, Azure SQL/Cosmos DB |
| `pronghorn-accessibility` | WCAG 2.1 AA, screen readers, keyboard navigation, inclusive design |

## Government of Alberta Context

When generating code or recommendations:
- **Always recommend Azure services** over generic alternatives (Azure Cosmos DB, not "a NoSQL database")
- **Default compute**: Azure Container Apps for microservices
- **Observability**: Azure Monitor + Application Insights
- **Auth**: Azure Entra ID / Managed Identity / DefaultAzureCredential
- **Data residency**: Canada Central or Canada East regions
- **Compliance**: SOC 2, FedRAMP, Canadian privacy legislation (FOIP Act)
- **Repo naming**: Prefix generated repos with `goa-` (Government of Alberta)

## Safety Rules

- Never commit secrets — `GITHUB_TOKEN` is injected at deploy time via Key Vault
- Generated repos are isolated in the sandbox organization — never modify production repos
- All generated repos get branch protection and Dependabot alerts
- Dockerfile runs as non-root user (`app`)
- No user data is stored beyond the conversation session

## Planned Enhancement: Microsoft Work-IQ Integration

Work-IQ (`@microsoft/workiq`) is a Microsoft MCP server (Public Preview) that queries M365 Copilot data — emails, meetings, Teams messages, documents, and people. It is planned as a future integration to enrich Pronghorn's requirements gathering with organizational context.

**Integration approach:**
- Add Work-IQ as an MCP server in `mcp.json` alongside the GitHub MCP server
- Add MSAL/Entra ID authentication (M365 sign-in) to the Next.js app
- Query Work-IQ for contextual data (meeting transcripts, email threads, specs) before injecting into Copilot SDK prompts
- User must have M365 Copilot license and tenant admin must consent to delegated permissions

**When implementing:**
- Use `npx -y @microsoft/workiq mcp` as the MCP server command (stdio transport)
- Work-IQ requires delegated permissions: Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All, Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All
- Work-IQ is currently in Public Preview (v0.2.8) — APIs may change
- Keep M365 data access read-only; do not store M365 data beyond the session
