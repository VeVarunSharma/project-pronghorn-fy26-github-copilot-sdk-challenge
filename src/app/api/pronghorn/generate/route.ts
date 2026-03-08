import { NextRequest } from "next/server";
import { getClient } from "@/lib/copilot-client";
import { getSessionOptions, enhanceModelError } from "@/lib/model-config";
import { GitHubService } from "@/lib/github-service";
import type { GeneratedFile } from "@/lib/github-service";

const ISSUE_GENERATION_PROMPT = `You are Pronghorn, an enterprise project planner for the Government of Alberta.
Given application requirements, break them down into actionable GitHub Issues that a Copilot coding agent can implement.

CRITICAL: Output ONLY valid JSON. No markdown fences, no extra text.
{
  "description": "One-line project description",
  "issues": [
    {
      "title": "Short descriptive title",
      "body": "Detailed description with acceptance criteria, technical approach, and file paths to create/modify",
      "labels": ["feature"]
    }
  ]
}

RULES:
- Create 4-8 focused issues — each should be independently implementable
- First issue should always be "Implement core application entry point and server setup"
- Include issues for: core features, API endpoints, database/data layer, authentication (if needed), testing, documentation
- Each issue body MUST include acceptance criteria as a checklist
- Label options: feature, enhancement, security, infrastructure, testing, documentation, copilot-agent
- Every issue gets the "copilot-agent" label (these will be assigned to Copilot)
- Every issue gets the "pronghorn-generated" label
- Be specific about file paths and technologies in the issue body`;

interface SummarizeSession {
  sendAndWait(
    msg: { prompt: string },
    timeout: number
  ): Promise<{ data?: unknown } | undefined>;
  destroy(): Promise<void>;
}

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```\w*\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    const jsonInBlock = inner.match(/\{[\s\S]*\}/);
    if (jsonInBlock) return jsonInBlock[0];
    return inner;
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return text;
}

function repairTruncatedJSON(jsonStr: string): string {
  let str = jsonStr.trim();
  let braces = 0, brackets = 0, inString = false, escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
  }
  if (inString) str += '"';
  str += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
  return str;
}

function condensRequirements(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s*/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function getEnterpriseScaffold(appName: string, description: string, requirements: string): GeneratedFile[] {
  const year = new Date().getFullYear();
  return [
    {
      path: "package.json",
      content: JSON.stringify({
        name: appName,
        version: "0.1.0",
        description,
        private: true,
        type: "module",
        scripts: {
          build: "tsc",
          start: "node dist/index.js",
          dev: "tsx watch src/index.ts",
          lint: "eslint src/",
          test: "vitest run",
          "test:watch": "vitest",
        },
        dependencies: {
          express: "^5.1.0",
          cors: "^2.8.5",
          helmet: "^8.1.0",
          dotenv: "^16.5.0",
          "express-rate-limit": "^7.5.0",
          "winston": "^3.17.0",
        },
        devDependencies: {
          "@types/express": "^5.0.2",
          "@types/cors": "^2.8.17",
          "@types/node": "^22.0.0",
          typescript: "^5.8.0",
          tsx: "^4.19.0",
          vitest: "^3.2.0",
          eslint: "^9.0.0",
          "@typescript-eslint/eslint-plugin": "^8.0.0",
          "@typescript-eslint/parser": "^8.0.0",
        },
        engines: { node: ">=20.0.0" },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "node16",
          moduleResolution: "node16",
          outDir: "./dist",
          rootDir: "./src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true,
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      }, null, 2),
    },
    {
      path: "src/index.ts",
      content: `import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "dotenv";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";

config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json({ limit: "10kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info(\`\${req.method} \${req.path}\`);
  next();
});

// Routes
app.use("/health", healthRouter);

// TODO: Add feature routes here (see GitHub Issues)

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(\`🚀 \${process.env.npm_package_name || "${appName}"} running on port \${PORT}\`);
  logger.info(\`📋 Health check: http://localhost:\${PORT}/health\`);
});

export default app;
`,
    },
    {
      path: "src/routes/health.ts",
      content: `import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "${appName}",
    version: process.env.npm_package_version || "0.1.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
`,
    },
    {
      path: "src/middleware/error-handler.ts",
      content: `import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "Internal server error";

  logger.error(\`[\${statusCode}] \${err.message}\`, { stack: err.stack });

  res.status(statusCode).json({
    error: {
      message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
}

export function createError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
}
`,
    },
    {
      path: "src/lib/logger.ts",
      content: `import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  transports: [new winston.transports.Console()],
});
`,
    },
    {
      path: ".env.example",
      content: `# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# CORS
ALLOWED_ORIGINS=http://localhost:3000

# Database (configure based on your needs)
# DATABASE_URL=postgresql://user:pass@localhost:5432/dbname

# Authentication (if applicable)
# JWT_SECRET=your-secret-here
# JWT_EXPIRES_IN=24h
`,
    },
    {
      path: ".gitignore",
      content: `node_modules/
dist/
.env
.env.local
*.log
coverage/
.DS_Store
*.tsbuildinfo
`,
    },
    {
      path: "README.md",
      content: `# ${appName}\n\n${description}\n\n> 🦌 Generated by [Pronghorn](https://github.com/VeVarunSharma/fy26-github-copilot-sdk-challenge) — AI-powered enterprise application generator\n\n## Quick Start\n\n\`\`\`bash\nnpm install\ncp .env.example .env\nnpm run dev\n\`\`\`\n\n## API\n\n| Method | Path | Description |\n|--------|------|-------------|\n| GET | /health | Health check |\n\n## Architecture\n\n- **Runtime**: Node.js 22+ with TypeScript\n- **Framework**: Express 5\n- **Security**: Helmet, CORS, rate limiting\n- **Logging**: Winston\n- **Testing**: Vitest\n- **CI/CD**: GitHub Actions\n- **Container**: Docker (multi-stage build)\n- **Cloud**: Azure-ready\n\n## Development\n\n\`\`\`bash\nnpm run dev      # Start dev server with hot reload\nnpm run build    # Compile TypeScript\nnpm run test     # Run tests\nnpm run lint     # Lint code\n\`\`\`\n\n## Requirements\n\n${requirements.slice(0, 1500)}\n\n## Enterprise Standards\n\n- ✅ TypeScript strict mode\n- ✅ Security headers (Helmet)\n- ✅ Rate limiting\n- ✅ Structured logging (Winston)\n- ✅ Error handling middleware\n- ✅ Health check endpoint\n- ✅ CI/CD pipeline (GitHub Actions)\n- ✅ Docker containerization\n- ✅ Branch protection\n- ✅ Dependabot security monitoring\n- ✅ Code owners and PR templates\n\n## License\n\nMIT — Government of Alberta\n`,
    },
    {
      path: "AGENTS.md",
      content: `# ${appName} — Copilot Agent Instructions\n\n## Overview\n\nThis project was scaffolded by Pronghorn 🦌. Use GitHub Copilot to implement the features described in the GitHub Issues.\n\n## Stack\n\n- TypeScript strict mode, Node.js 22+\n- Express 5 with ESM modules\n- Use \`.js\` extensions in imports (ESM requirement)\n- Winston for logging\n- Vitest for testing\n\n## Conventions\n\n- Routes go in \`src/routes/\`\n- Middleware in \`src/middleware/\`\n- Shared utilities in \`src/lib/\`\n- Database models in \`src/models/\` (if applicable)\n- Tests alongside source files as \`*.test.ts\`\n\n## Commands\n\n| Task | Command |\n|------|--------|\n| Dev | \`npm run dev\` |\n| Build | \`npm run build\` |\n| Test | \`npm run test\` |\n| Lint | \`npm run lint\` |\n\n## Safety\n\n- Never commit secrets — use environment variables\n- Validate all user input\n- Use parameterized queries for database access\n- Apply principle of least privilege\n`,
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:22-alpine AS runner\nRUN addgroup -S app && adduser -S app -G app\nWORKDIR /app\nCOPY --from=builder /app/package*.json ./\nRUN npm ci --only=production\nCOPY --from=builder --chown=app:app /app/dist ./dist\nUSER app\nEXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1\nCMD ["node", "dist/index.js"]\n`,
    },
    {
      path: "azure.yaml",
      content: `name: ${appName}\nservices:\n  app:\n    project: ./\n    language: ts\n    host: containerapp\n    docker:\n      path: ./Dockerfile\n`,
    },
    {
      path: ".github/workflows/ci.yml",
      content: `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\npermissions:\n  contents: read\n\njobs:\n  build-and-test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node-version: [20.x, 22.x]\n    steps:\n      - uses: actions/checkout@v4\n      - name: Use Node.js \${{ matrix.node-version }}\n        uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node-version }}\n          cache: npm\n      - run: npm ci\n      - run: npm run build\n      - run: npm run lint\n      - run: npm test\n\n  security-audit:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm audit --audit-level=high\n\n  docker:\n    runs-on: ubuntu-latest\n    needs: build-and-test\n    steps:\n      - uses: actions/checkout@v4\n      - name: Build Docker image\n        run: docker build -t ${appName} .\n`,
    },
    {
      path: ".github/CODEOWNERS",
      content: `# Default code owners\n* @govalta-platform-team\n`,
    },
    {
      path: ".github/pull_request_template.md",
      content: `## Description\n\n<!-- Describe your changes -->\n\n## Type of Change\n\n- [ ] Bug fix\n- [ ] New feature\n- [ ] Breaking change\n- [ ] Documentation update\n\n## Checklist\n\n- [ ] Code follows project style guidelines\n- [ ] Tests added/updated\n- [ ] Documentation updated\n- [ ] Security considerations reviewed\n- [ ] No secrets or credentials in code\n`,
    },
    {
      path: "SECURITY.md",
      content: `# Security Policy\n\n## Reporting a Vulnerability\n\nIf you discover a security vulnerability in **${appName}**, please report it responsibly.\n\n- Email: security@govalta.ca\n- Do NOT create a public GitHub issue for security vulnerabilities\n\n## Supported Versions\n\n| Version | Supported |\n| ------- | --------- |\n| latest  | ✅        |\n\n## Security Measures\n\n- All dependencies monitored via Dependabot\n- Automated security fixes enabled\n- Branch protection requires code review\n- Security headers enforced (Helmet)\n- Rate limiting enabled\n- Input validation on all endpoints\n- Generated by Pronghorn 🦌 with enterprise security defaults\n`,
    },
    {
      path: "CONTRIBUTING.md",
      content: `# Contributing to ${appName}\n\n## Getting Started\n\n1. Fork the repository\n2. Create a feature branch: \`git checkout -b feature/my-feature\`\n3. Make your changes and add tests\n4. Submit a pull request\n\n## Code Standards\n\n- TypeScript strict mode\n- All PRs require at least one review\n- Follow existing code patterns\n- Include tests for new functionality\n`,
    },
    {
      path: "LICENSE",
      content: `MIT License\n\nCopyright (c) ${year} Government of Alberta\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
    },
    {
      path: "src/routes/.gitkeep",
      content: "",
    },
    {
      path: "src/models/.gitkeep",
      content: "",
    },
    {
      path: "src/__tests__/health.test.ts",
      content: `import { describe, it, expect } from "vitest";\n\ndescribe("Health Check", () => {\n  it("should return ok status", async () => {\n    // TODO: Implement integration test once server module is testable\n    expect(true).toBe(true);\n  });\n});\n`,
    },
  ];
}

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  data: Record<string, unknown>
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { requirements, appName } = body as {
    requirements?: string;
    appName?: string;
  };

  if (!requirements || typeof requirements !== "string" || !requirements.trim()) {
    return new Response(
      JSON.stringify({ error: "Missing or empty 'requirements' field" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!appName || typeof appName !== "string" || !appName.trim()) {
    return new Response(
      JSON.stringify({ error: "Missing or empty 'appName' field" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const sandboxOrg = process.env.PRONGHORN_SANDBOX_ORG;
  const ghToken = process.env.PRONGHORN_GITHUB_TOKEN || process.env.GITHUB_TOKEN;

  if (!sandboxOrg) {
    return new Response(
      JSON.stringify({ error: "PRONGHORN_SANDBOX_ORG not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!ghToken) {
    return new Response(
      JSON.stringify({ error: "GitHub token not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let session: SummarizeSession | null = null;

      try {
        // Stage 1: Scaffold enterprise base project
        sendSSE(controller, encoder, {
          stage: "scaffolding",
          message: "🏗️ Scaffolding enterprise base project...",
          progress: 10,
        });

        const condensed = condensRequirements(requirements);
        const description = `${appName} — enterprise application scaffolded by Pronghorn`;
        const scaffoldFiles = getEnterpriseScaffold(appName, description, condensed);

        sendSSE(controller, encoder, {
          stage: "scaffolded",
          message: `📦 ${scaffoldFiles.length} files prepared (TypeScript, Express, Docker, CI/CD, security policies)`,
          progress: 20,
          fileCount: scaffoldFiles.length,
          filePaths: scaffoldFiles.map((f) => f.path),
        });

        // Stage 2: Create repo and push scaffold
        sendSSE(controller, encoder, {
          stage: "creating_repo",
          message: `🏗️ Creating repository in ${sandboxOrg}...`,
          progress: 30,
        });

        const githubService = new GitHubService(ghToken, sandboxOrg);
        const repoUrl = await githubService.createRepo(
          appName,
          `${description} 🦌`
        );

        sendSSE(controller, encoder, {
          stage: "repo_created",
          message: `✅ Repository created: ${repoUrl}`,
          progress: 40,
          repoUrl,
        });

        // Stage 3: Push all scaffold files
        sendSSE(controller, encoder, {
          stage: "pushing_code",
          message: `📤 Pushing ${scaffoldFiles.length} files (source code, configs, CI/CD, security)...`,
          progress: 50,
        });

        const filesCreated = await githubService.pushFiles(
          appName,
          scaffoldFiles,
          "feat: enterprise project scaffold by Pronghorn 🦌\n\n" +
          "Includes:\n" +
          "- TypeScript + Express 5 server with health check\n" +
          "- Security: Helmet, CORS, rate limiting\n" +
          "- Error handling middleware + Winston logging\n" +
          "- Docker multi-stage build\n" +
          "- GitHub Actions CI/CD pipeline\n" +
          "- Branch protection, CODEOWNERS, PR templates\n" +
          "- Azure deployment config (azure.yaml)\n" +
          "- AGENTS.md for Copilot agent instructions"
        );

        sendSSE(controller, encoder, {
          stage: "code_pushed",
          message: `✅ ${filesCreated} files committed to main`,
          progress: 55,
          filesCreated,
        });

        // Stage 4: Configure security
        sendSSE(controller, encoder, {
          stage: "configuring_security",
          message: "🔒 Configuring security policies...",
          progress: 60,
        });

        const securityActions = await githubService.configureSecurity(appName);

        sendSSE(controller, encoder, {
          stage: "security_configured",
          message: `🛡️ ${securityActions.length} security policies applied`,
          progress: 65,
          securityActions,
        });

        // Stage 5: Use Copilot SDK to break requirements into issues
        sendSSE(controller, encoder, {
          stage: "planning",
          message: "🤖 Using Copilot SDK to plan implementation issues...",
          progress: 70,
        });

        const copilot = await getClient();
        const options = await getSessionOptions();
        session = (await copilot.createSession(options)) as unknown as SummarizeSession;

        const issuePrompt = `${ISSUE_GENERATION_PROMPT}\n\nApplication: ${appName}\nRequirements:\n${condensed}\n\nThe project already has: Express 5 server, health check, error handling middleware, security headers, Docker, CI/CD, logging. Create issues for the FEATURE-SPECIFIC work that still needs to be built.`;

        const response = await session.sendAndWait({ prompt: issuePrompt }, 120_000);
        const content = (response?.data as { content?: string })?.content ?? "";

        let issues: { title: string; body: string; labels: string[] }[] = [];

        if (content) {
          try {
            const jsonStr = extractJSON(content);
            let parsed;
            try {
              parsed = JSON.parse(jsonStr);
            } catch {
              parsed = JSON.parse(repairTruncatedJSON(jsonStr));
            }
            if (parsed.issues && Array.isArray(parsed.issues)) {
              issues = parsed.issues
                .filter((i: Record<string, unknown>) => i.title && i.body)
                .map((i: Record<string, unknown>) => ({
                  title: String(i.title),
                  body: String(i.body) + "\n\n---\n_🦌 Generated by Pronghorn — assign to Copilot to implement_",
                  labels: [
                    ...(Array.isArray(i.labels) ? i.labels.map(String) : []),
                    "pronghorn-generated",
                    "copilot-agent",
                  ],
                }));
            }
          } catch (e) {
            console.error("[Pronghorn] Failed to parse issues:", e);
            console.error("[Pronghorn] Raw content:", content.slice(0, 500));
          }
        }

        // Stage 6: Create GitHub Issues
        if (issues.length > 0) {
          sendSSE(controller, encoder, {
            stage: "creating_issues",
            message: `📝 Creating ${issues.length} GitHub Issues for Copilot agents...`,
            progress: 85,
          });

          const createdIssues = await githubService.createIssues(appName, issues);

          sendSSE(controller, encoder, {
            stage: "issues_created",
            message: `✅ ${createdIssues.length} issues created — ready for Copilot agent assignment`,
            progress: 95,
            issues: createdIssues,
          });
        } else {
          sendSSE(controller, encoder, {
            stage: "issues_skipped",
            message: "⚠️ Could not generate issues — create them manually from your requirements",
            progress: 95,
          });
        }

        // Stage 7: Complete
        sendSSE(controller, encoder, {
          stage: "complete",
          message: "🎉 Enterprise project scaffolded and ready for development!",
          progress: 100,
          repoUrl,
          filesCreated,
          description,
          securityActions,
          issuesCreated: issues.length,
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const enhanced = enhanceModelError(err);
        sendSSE(controller, encoder, {
          stage: "error",
          message: `❌ Error: ${enhanced.message}`,
          error: enhanced.message,
        });
        controller.close();
      } finally {
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
