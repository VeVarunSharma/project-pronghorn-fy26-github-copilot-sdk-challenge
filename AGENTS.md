# AGENTS.md

## Overview

Pronghorn 🦌 — AI-powered enterprise application generator using the GitHub Copilot SDK. Built with Next.js 16, shadcn/ui, and Tailwind CSS. Deployed to Azure Container Apps with blast radius isolation via sandboxed GitHub organizations.

- **`src/app/`** — Next.js 16 App Router. Server-side API routes + React pages.
- **`src/components/`** — shadcn/ui components (chat, generation panel, UI primitives).
- **`src/lib/`** — Shared libraries: Copilot SDK client, model config, GitHub service, utilities.
- **`infra/`** — Azure infrastructure (Bicep). Single container app + ACR + Key Vault + monitoring.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main app — dual-panel layout (chat + generate) |
| `src/app/layout.tsx` | Root layout with dark mode and metadata |
| `src/app/api/chat/route.ts` | POST `/api/chat` — requirements conversation with Pronghorn context (SSE) |
| `src/app/api/pronghorn/generate/route.ts` | POST `/api/pronghorn/generate` — full project generation pipeline (SSE) |
| `src/app/api/pronghorn/status/route.ts` | GET `/api/pronghorn/status` — service status |
| `src/app/api/health/route.ts` | GET `/api/health` — health check |
| `src/lib/copilot-client.ts` | CopilotClient singleton |
| `src/lib/model-config.ts` | Three-path model config (GitHub default, GitHub specific, Azure BYOM) |
| `src/lib/github-service.ts` | GitHub API wrapper — repo creation, code push, security configuration |
| `src/lib/utils.ts` | shadcn cn() utility |
| `src/components/chat-window.tsx` | Message display with markdown rendering |
| `src/components/message-input.tsx` | Chat input with send button |
| `src/components/generate-panel.tsx` | Project generation form with SSE progress tracking |
| `infra/main.bicep` | Bicep orchestration |
| `infra/resources.bicep` | Azure resources (Container App, ACR, Key Vault) |
| `scripts/get-github-token.mjs` | azd hook — injects GITHUB_TOKEN |

## Custom Agent: Pronghorn Requirements Advisor

**Role**: Enterprise application requirements advisor for the Government of Alberta

**Behavior**:
- Helps developers articulate and refine application requirements
- Recommends architectures (Node.js/Express, Python/Flask, React, etc.)
- Advises on security best practices and compliance standards
- Encourages use of the Generate panel when requirements are finalized

**System context** (injected in `src/app/api/chat/route.ts`):
```
You are Pronghorn 🦌, an enterprise application generator built for the Government of Alberta.
You help developers by understanding their application requirements, recommending architectures,
explaining security best practices, and guiding them to the Generate feature when ready.
```

## Custom Agent: Pronghorn Code Generator

**Role**: Structured code generation agent

**Behavior**:
- Takes natural language requirements and generates complete project files
- Outputs structured JSON with file paths and contents
- Follows enterprise standards: TypeScript, error handling, security headers
- Always includes README.md, .gitignore, health checks, and CORS

**System context** (injected in `src/app/api/pronghorn/generate/route.ts`):
```
Generate complete, production-ready project files based on user requirements.
Output ONLY valid JSON: { "description": "...", "files": [{ "path": "...", "content": "..." }] }
```

## Model Configuration

| Variable | Values | Effect |
|----------|--------|--------|
| `MODEL_PROVIDER` | unset or `azure` | GitHub models or Azure BYOM |
| `MODEL_NAME` | model name | Specific model selection |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint URL | Required for BYOM |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GITHUB_TOKEN` | Yes | Copilot SDK authentication |
| `PRONGHORN_SANDBOX_ORG` | Yes | Target org for generated repos |
| `PRONGHORN_GITHUB_TOKEN` | No | Separate PAT for GitHub API (falls back to GITHUB_TOKEN) |

## Environment

- Node ≥ 20, pnpm for package management. **Always use `pnpm`, never `npm` or `yarn`.**
- `gh` CLI required for provisioning.

## Commands

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Start production | `pnpm start` |
| Lint | `pnpm lint` |
| Deploy to Azure | `azd up` |

## Coding Conventions

- Next.js 16 App Router with `use client` directives for interactive components.
- API routes in `src/app/api/`.
- Components in `src/components/`, lib code in `src/lib/`.
- File names: kebab-case throughout.
- shadcn/ui for all UI primitives. Tailwind CSS for styling.

## Safety

- Never commit secrets. `GITHUB_TOKEN` is injected at deploy time via Key Vault.
- Generated repos are isolated in a sandbox organization.
- All generated repos get branch protection and Dependabot alerts.
- Dockerfile runs as non-root user (`app`).

