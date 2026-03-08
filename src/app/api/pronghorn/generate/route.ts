import { NextRequest } from "next/server";
import { getClient } from "@/lib/copilot-client";
import { getSessionOptions, enhanceModelError } from "@/lib/model-config";
import { GitHubService } from "@/lib/github-service";
import type { GeneratedFile } from "@/lib/github-service";

const PRONGHORN_SYSTEM_CONTEXT = `You are Pronghorn, an enterprise application generator for the Government of Alberta.
Generate complete, production-ready SOURCE CODE files based on user requirements.

CRITICAL INSTRUCTIONS:
- Output ONLY valid JSON. No markdown fences, no explanations.
- Use this exact format:
{
  "description": "Brief one-line project description",
  "files": [
    { "path": "relative/path/to/file", "content": "full file content" }
  ]
}
- Focus on SOURCE CODE files — the build pipeline adds boilerplate (Dockerfile, CI/CD, SECURITY.md, LICENSE, CODEOWNERS, PR templates)
- Always include: package.json with scripts, tsconfig.json, .gitignore, .env.example, README.md
- Always include ACTUAL SOURCE CODE in src/ directory with real implementation (routes, controllers, models, middleware)
- Use TypeScript strict mode for Node.js projects
- Include a health check endpoint at GET /health
- Include proper error handling middleware
- Add CORS and security headers (helmet)
- Include at least one working API route with full CRUD operations
- Keep file contents concise but fully functional — no placeholder comments like "// TODO"`;

interface SummarizeSession {
  sendAndWait(
    msg: { prompt: string },
    timeout: number
  ): Promise<{ data?: unknown } | undefined>;
  destroy(): Promise<void>;
}

interface GeneratedProject {
  description: string;
  files: GeneratedFile[];
}

function extractJSON(text: string): string {
  // Match any code block (```json, ```bash, ```typescript, etc.)
  const codeBlockMatch = text.match(/```\w*\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    // The code block might contain non-JSON preamble — find the JSON object inside
    const jsonInBlock = inner.match(/\{[\s\S]*\}/);
    if (jsonInBlock) return jsonInBlock[0];
    return inner;
  }
  // No code block — find the outermost JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return text;
}

function repairTruncatedJSON(jsonStr: string): string {
  let str = jsonStr.trim();

  // Count unclosed braces and brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

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

  // If we're still inside a string, close it
  if (inString) {
    str += '"';
  }

  // If truncated mid-file-object, try to close the current object and finish the array
  // Find the last complete file object
  const lastCompleteFile = str.lastIndexOf('"content"');
  if (lastCompleteFile > 0 && (braces > 0 || brackets > 0)) {
    // Find the last properly closed }, after a "content": "..." value
    const lastCloseBrace = str.lastIndexOf("}");
    const lastOpenBrace = str.lastIndexOf("{", lastCloseBrace);

    // Try to find the last cleanly terminated file entry
    const filePattern = /\{\s*"path"\s*:\s*"[^"]+"\s*,\s*"content"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/g;
    let lastGoodEnd = 0;
    let match;
    while ((match = filePattern.exec(str)) !== null) {
      lastGoodEnd = match.index + match[0].length;
    }

    if (lastGoodEnd > 0) {
      // Truncate to last complete file, close the array and outer object
      str = str.substring(0, lastGoodEnd);
      // Check if we need to close ] and }
      const remaining = str;
      let b = 0, k = 0;
      let inStr = false;
      let esc = false;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") b++;
        if (c === "}") b--;
        if (c === "[") k++;
        if (c === "]") k--;
      }
      str += "]".repeat(Math.max(0, k)) + "}".repeat(Math.max(0, b));
    } else {
      // Brute force: close everything
      str += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
    }
  } else {
    // Simple case: just close unclosed brackets/braces
    str += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
  }

  return str;
}

function parseGeneratedProject(content: string): GeneratedProject {
  const jsonStr = extractJSON(content);

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Attempt to repair truncated JSON
    const repaired = repairTruncatedJSON(jsonStr);
    try {
      parsed = JSON.parse(repaired);
    } catch (e2) {
      console.error("[Pronghorn] Raw SDK response (first 500 chars):", content.slice(0, 500));
      console.error("[Pronghorn] Extracted JSON (first 500 chars):", jsonStr.slice(0, 500));
      throw new Error(
        `Failed to parse generated project JSON: ${e2 instanceof Error ? e2.message : "unknown error"}`
      );
    }
  }

  if (!parsed.files || !Array.isArray(parsed.files)) {
    throw new Error("Invalid response: missing 'files' array");
  }
  const files: GeneratedFile[] = parsed.files
    .filter((f: Record<string, unknown>) => f.path && f.content)
    .map((f: Record<string, unknown>) => ({
      path: String(f.path),
      content: String(f.content),
    }));
  if (files.length === 0) {
    throw new Error("No valid files generated");
  }
  return {
    description: String(parsed.description || "Generated by Pronghorn"),
    files,
  };
}

function condensRequirements(text: string): string {
  // Strip markdown formatting noise, keep the substance
  return text
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s*/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function getEnterpriseBoilerplate(appName: string, description: string): GeneratedFile[] {
  return [
    {
      path: "SECURITY.md",
      content: `# Security Policy\n\n## Reporting a Vulnerability\n\nIf you discover a security vulnerability in **${appName}**, please report it responsibly.\n\n- Email: security@govalta.ca\n- Do NOT create a public GitHub issue for security vulnerabilities\n\n## Supported Versions\n\n| Version | Supported |\n| ------- | --------- |\n| latest  | ✅        |\n\n## Security Measures\n\n- All dependencies are monitored via Dependabot\n- Automated security fixes are enabled\n- Branch protection requires code review before merge\n- Generated by Pronghorn 🦌 with enterprise security defaults\n`,
    },
    {
      path: "CONTRIBUTING.md",
      content: `# Contributing to ${appName}\n\nThank you for your interest in contributing!\n\n## Getting Started\n\n1. Fork the repository\n2. Create a feature branch: \`git checkout -b feature/my-feature\`\n3. Make your changes and add tests\n4. Submit a pull request\n\n## Code Standards\n\n- TypeScript strict mode\n- All PRs require at least one review\n- Follow existing code patterns\n- Include tests for new functionality\n\n## Code of Conduct\n\nThis project follows the Government of Alberta's code of conduct for open source projects.\n`,
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nRUN npm run build 2>/dev/null || true\n\nFROM node:22-alpine AS runner\nRUN addgroup -S app && adduser -S app -G app\nWORKDIR /app\nCOPY --from=builder --chown=app:app /app .\nUSER app\nEXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1\nCMD ["node", "dist/index.js"]\n`,
    },
    {
      path: ".github/workflows/ci.yml",
      content: `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node-version: [20.x, 22.x]\n    steps:\n      - uses: actions/checkout@v4\n      - name: Use Node.js \${{ matrix.node-version }}\n        uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node-version }}\n      - run: npm ci\n      - run: npm run build --if-present\n      - run: npm test --if-present\n\n  security:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm audit --audit-level=high\n`,
    },
    {
      path: ".github/CODEOWNERS",
      content: `# Default code owners for all files\n* @govalta-platform-team\n`,
    },
    {
      path: ".github/pull_request_template.md",
      content: `## Description\n\n<!-- Describe your changes -->\n\n## Type of Change\n\n- [ ] Bug fix\n- [ ] New feature\n- [ ] Breaking change\n- [ ] Documentation update\n\n## Checklist\n\n- [ ] Code follows project style guidelines\n- [ ] Tests added/updated\n- [ ] Documentation updated\n- [ ] Security considerations reviewed\n- [ ] No secrets or credentials in code\n`,
    },
    {
      path: "LICENSE",
      content: `MIT License\n\nCopyright (c) ${new Date().getFullYear()} Government of Alberta\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
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
        // Stage 1
        sendSSE(controller, encoder, {
          stage: "analyzing",
          message: "🔍 Analyzing requirements...",
          progress: 10,
        });

        const copilot = await getClient();
        const options = await getSessionOptions();
        session = (await copilot.createSession(
          options
        )) as unknown as SummarizeSession;

        // Stage 2
        sendSSE(controller, encoder, {
          stage: "generating",
          message: "⚡ Generating project with Copilot SDK...",
          progress: 25,
        });

        const condensed = condensRequirements(requirements);
        const prompt = `${PRONGHORN_SYSTEM_CONTEXT}\n\nGenerate a minimal but complete project for:\nApplication Name: ${appName}\nRequirements:\n${condensed}\n\nIMPORTANT: Keep files concise. Output ONLY valid JSON with "description" and "files" array. Aim for 5-8 files maximum.`;

        const response = await session.sendAndWait({ prompt }, 180_000);
        const content =
          (response?.data as { content?: string })?.content ?? "";
        if (!content) throw new Error("Empty response from Copilot SDK");

        // Stage 3
        sendSSE(controller, encoder, {
          stage: "parsing",
          message: "📦 Parsing generated project files...",
          progress: 50,
        });

        const project = parseGeneratedProject(content);

        // Merge enterprise boilerplate with SDK-generated files
        const boilerplate = getEnterpriseBoilerplate(appName, project.description);
        const sdkPaths = new Set(project.files.map((f) => f.path));
        const allFiles = [
          ...project.files,
          ...boilerplate.filter((f) => !sdkPaths.has(f.path)),
        ];

        sendSSE(controller, encoder, {
          stage: "parsed",
          message: `📄 Generated ${project.files.length} source files + ${allFiles.length - project.files.length} enterprise boilerplate files`,
          progress: 55,
          fileCount: allFiles.length,
          filePaths: allFiles.map((f) => f.path),
        });

        // Stage 4
        sendSSE(controller, encoder, {
          stage: "creating_repo",
          message: `🏗️ Creating repository in ${sandboxOrg}...`,
          progress: 60,
        });

        const githubService = new GitHubService(ghToken, sandboxOrg);
        const repoUrl = await githubService.createRepo(
          appName,
          `${project.description} — Generated by Pronghorn 🦌`
        );

        sendSSE(controller, encoder, {
          stage: "repo_created",
          message: `✅ Repository created: ${repoUrl}`,
          progress: 70,
          repoUrl,
        });

        // Stage 5
        sendSSE(controller, encoder, {
          stage: "pushing_code",
          message: `📤 Pushing ${allFiles.length} files...`,
          progress: 80,
        });

        const filesCreated = await githubService.pushFiles(
          appName,
          allFiles,
          "feat: initial project scaffold generated by Pronghorn\n\nGenerated from requirements using GitHub Copilot SDK\nIncludes enterprise boilerplate: CI/CD, security policy, Dockerfile, CODEOWNERS"
        );

        sendSSE(controller, encoder, {
          stage: "code_pushed",
          message: `✅ ${filesCreated} files committed to main`,
          progress: 85,
          filesCreated,
        });

        // Stage 6
        sendSSE(controller, encoder, {
          stage: "configuring_security",
          message: "🔒 Configuring security policies...",
          progress: 90,
        });

        const securityActions =
          await githubService.configureSecurity(appName);

        sendSSE(controller, encoder, {
          stage: "security_configured",
          message: `🛡️ Security: ${securityActions.length} policies applied`,
          progress: 95,
          securityActions,
        });

        // Stage 7
        sendSSE(controller, encoder, {
          stage: "complete",
          message: "🎉 Project generated and deployed successfully!",
          progress: 100,
          repoUrl,
          filesCreated,
          description: project.description,
          securityActions,
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
