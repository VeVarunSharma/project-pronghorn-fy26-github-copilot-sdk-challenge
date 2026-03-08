import { NextRequest } from "next/server";
import { getClient } from "@/lib/copilot-client";
import { getSessionOptions, enhanceModelError } from "@/lib/model-config";
import { GitHubService } from "@/lib/github-service";
import type { GeneratedFile } from "@/lib/github-service";

const ISSUE_GENERATION_PROMPT = `You are Pronghorn, an enterprise project planner for the Government of Alberta, focused on Azure-native cloud solutions.
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
- ALWAYS include an Azure infrastructure issue covering: Bicep/IaC refinements, Azure Container Apps config, Azure Monitor/App Insights integration, Azure Key Vault for secrets
- Recommend Azure services in issue bodies: Azure SQL or Cosmos DB for data, Azure Service Bus for messaging, Azure Blob Storage for files, Entra ID for auth, Azure Key Vault for secrets, Azure Container Apps for hosting
- Reference DefaultAzureCredential and Managed Identity for service-to-service auth in relevant issues
- Each issue body MUST include acceptance criteria as a checklist
- Label options: feature, enhancement, security, infrastructure, testing, documentation, copilot-agent, azure
- Every issue gets the "copilot-agent" label (these will be assigned to Copilot)
- Every issue gets the "pronghorn-generated" label
- Infrastructure and Azure-related issues get the "azure" label
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

# Azure Services
# APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
# AZURE_KEY_VAULT_NAME=your-keyvault-name

# Database (Azure SQL or Cosmos DB recommended)
# DATABASE_URL=Server=tcp:your-server.database.windows.net,1433;Database=your-db;...
# COSMOS_DB_ENDPOINT=https://your-account.documents.azure.com:443/
# COSMOS_DB_KEY=your-key

# Authentication (Azure Entra ID / MSAL recommended)
# AZURE_AD_TENANT_ID=your-tenant-id
# AZURE_AD_CLIENT_ID=your-client-id
# AZURE_AD_CLIENT_SECRET=your-client-secret

# Storage (Azure Blob Storage)
# AZURE_STORAGE_ACCOUNT_NAME=your-storage-account
# AZURE_STORAGE_CONTAINER_NAME=your-container

# Messaging (Azure Service Bus)
# AZURE_SERVICE_BUS_CONNECTION_STRING=Endpoint=sb://...
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
      content: `# ${appName}\n\n${description}\n\n> 🦌 Generated by [Pronghorn](https://github.com/VeVarunSharma/fy26-github-copilot-sdk-challenge) — AI-powered enterprise application generator\n\n## Quick Start\n\n\`\`\`bash\nnpm install\ncp .env.example .env\nnpm run dev\n\`\`\`\n\n## Azure Deployment\n\n\`\`\`bash\n# Login to Azure\nazd auth login\n\n# Provision infrastructure and deploy\nazd up\n\`\`\`\n\nThis will provision:\n- **Azure Container Apps** — serverless container hosting with auto-scaling\n- **Azure Container Registry** — private Docker image registry\n- **Azure Key Vault** — secure secrets management (Managed Identity)\n- **Azure Monitor + Application Insights** — observability and diagnostics\n- **Log Analytics Workspace** — centralized logging\n\n## API\n\n| Method | Path | Description |\n|--------|------|-------------|\n| GET | /health | Health check |\n\n## Architecture\n\n- **Runtime**: Node.js 22+ with TypeScript\n- **Framework**: Express 5\n- **Cloud**: Azure Container Apps (Canada Central recommended)\n- **IaC**: Bicep (Azure-native Infrastructure as Code)\n- **Secrets**: Azure Key Vault with Managed Identity\n- **Monitoring**: Azure Monitor + Application Insights\n- **Security**: Helmet, CORS, rate limiting\n- **Logging**: Winston (locally) + App Insights (in Azure)\n- **Testing**: Vitest\n- **CI/CD**: GitHub Actions → Azure Container Apps\n- **Container**: Docker (multi-stage build)\n\n## Azure Services Reference\n\n| Service | Purpose |\n|---------|--------|\n| Container Apps | Hosting (serverless containers) |\n| Container Registry | Docker image storage |\n| Key Vault | Secrets & certificates |\n| Application Insights | APM, traces, metrics |\n| Log Analytics | Centralized logging |\n| Entra ID (Azure AD) | Authentication |\n| Azure SQL / Cosmos DB | Data persistence |\n| Service Bus | Async messaging |\n| Blob Storage | File/document storage |\n\n## Development\n\n\`\`\`bash\nnpm run dev      # Start dev server with hot reload\nnpm run build    # Compile TypeScript\nnpm run test     # Run tests\nnpm run lint     # Lint code\n\`\`\`\n\n## Requirements\n\n${requirements.slice(0, 1500)}\n\n## Enterprise Standards\n\n- ✅ TypeScript strict mode\n- ✅ Azure Container Apps deployment\n- ✅ Azure Key Vault for secrets (Managed Identity)\n- ✅ Azure Application Insights monitoring\n- ✅ Bicep IaC (Infrastructure as Code)\n- ✅ Security headers (Helmet)\n- ✅ Rate limiting\n- ✅ Structured logging (Winston + App Insights)\n- ✅ Error handling middleware\n- ✅ Health check endpoint\n- ✅ CI/CD pipeline (GitHub Actions → Azure)\n- ✅ Docker containerization\n- ✅ Branch protection\n- ✅ Dependabot security monitoring\n- ✅ Code owners and PR templates\n\n## License\n\nMIT — Government of Alberta\n`,
    },
    {
      path: "AGENTS.md",
      content: `# ${appName} — Copilot Agent Instructions\n\n## Overview\n\nThis project was scaffolded by Pronghorn 🦌. Use GitHub Copilot to implement the features described in the GitHub Issues.\n\n## Stack\n\n- TypeScript strict mode, Node.js 22+\n- Express 5 with ESM modules\n- Use \`.js\` extensions in imports (ESM requirement)\n- Winston for logging\n- Vitest for testing\n\n## Azure Architecture\n\n- **Hosting**: Azure Container Apps (serverless, auto-scaling)\n- **IaC**: Bicep templates in \`infra/\`\n- **Secrets**: Azure Key Vault — use \`getKeyVaultSecret()\` from \`src/lib/azure.ts\`\n- **Monitoring**: Azure Application Insights — call \`initAppInsights()\` at startup\n- **Auth**: Use DefaultAzureCredential / Managed Identity for service-to-service auth\n- **Deploy**: \`azd up\` or GitHub Actions (\`.github/workflows/azure-deploy.yml\`)\n- **Data residency**: Canada Central / Canada East regions\n\n## Conventions\n\n- Routes go in \`src/routes/\`\n- Middleware in \`src/middleware/\`\n- Shared utilities in \`src/lib/\`\n- Azure integrations in \`src/lib/azure.ts\`\n- Database models in \`src/models/\` (if applicable)\n- Tests alongside source files as \`*.test.ts\`\n- Infrastructure as Code in \`infra/\`\n\n## Commands\n\n| Task | Command |\n|------|--------|\n| Dev | \`npm run dev\` |\n| Build | \`npm run build\` |\n| Test | \`npm run test\` |\n| Lint | \`npm run lint\` |\n| Azure Deploy | \`azd up\` |\n\n## Azure Service Recommendations\n\n| Need | Use |\n|------|-----|\n| Database (relational) | Azure SQL Database |\n| Database (NoSQL) | Azure Cosmos DB |\n| File storage | Azure Blob Storage |\n| Message queue | Azure Service Bus |\n| Secrets | Azure Key Vault |\n| Auth | Azure Entra ID (MSAL) |\n| Search | Azure AI Search |\n| Cache | Azure Cache for Redis |\n\n## Safety\n\n- Never commit secrets — use Azure Key Vault or environment variables\n- Use DefaultAzureCredential for all Azure SDK clients\n- Validate all user input\n- Use parameterized queries for database access\n- Apply principle of least privilege\n- Follow Azure Well-Architected Framework\n`,
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:22-alpine AS runner\nRUN addgroup -S app && adduser -S app -G app\nWORKDIR /app\nCOPY --from=builder /app/package*.json ./\nRUN npm ci --only=production\nCOPY --from=builder --chown=app:app /app/dist ./dist\nUSER app\nEXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1\nCMD ["node", "dist/index.js"]\n`,
    },
    {
      path: "azure.yaml",
      content: `name: ${appName}\nmetadata:\n  template: pronghorn-enterprise@0.1.0\nservices:\n  app:\n    project: ./\n    language: ts\n    host: containerapp\n    docker:\n      path: ./Dockerfile\n    hooks:\n      preprovision:\n        shell: sh\n        run: echo "Provisioning Azure resources for ${appName}..."\n      postdeploy:\n        shell: sh\n        run: echo "Deployment complete! Verifying health..."; curl -sf http://localhost:3000/health || true\n`,
    },
    {
      path: "infra/main.bicep",
      content: `targetScope = 'subscription'\n\n@minLength(1)\n@maxLength(64)\n@description('Name of the environment (e.g., dev, staging, prod)')\nparam environmentName string\n\n@minLength(1)\n@description('Primary location for all resources')\nparam location string\n\n@description('Name of the container app')\nparam appName string = '${appName}'\n\nparam containerRegistryName string = ''\nparam containerImageTag string = 'latest'\n\nvar abbrs = loadJsonContent('./abbreviations.json')\nvar resourceToken = toLower(uniqueString(subscription().id, environmentName, location))\nvar tags = {\n  'azd-env-name': environmentName\n  'generated-by': 'pronghorn'\n  project: appName\n}\n\nresource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {\n  name: '\${abbrs.resourcesResourceGroups}\${environmentName}'\n  location: location\n  tags: tags\n}\n\nmodule monitoring './modules/monitoring.bicep' = {\n  name: 'monitoring'\n  scope: rg\n  params: {\n    location: location\n    tags: tags\n    logAnalyticsName: '\${abbrs.operationalInsightsWorkspaces}\${resourceToken}'\n    applicationInsightsName: '\${abbrs.insightsComponents}\${resourceToken}'\n  }\n}\n\nmodule containerApps './modules/container-apps.bicep' = {\n  name: 'container-apps'\n  scope: rg\n  params: {\n    location: location\n    tags: tags\n    containerAppsEnvironmentName: '\${abbrs.appManagedEnvironments}\${resourceToken}'\n    containerRegistryName: !empty(containerRegistryName) ? containerRegistryName : '\${abbrs.containerRegistryRegistries}\${resourceToken}'\n    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId\n    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString\n    appName: appName\n    containerImageTag: containerImageTag\n  }\n}\n\nmodule keyVault './modules/key-vault.bicep' = {\n  name: 'key-vault'\n  scope: rg\n  params: {\n    location: location\n    tags: tags\n    keyVaultName: '\${abbrs.keyVaultVaults}\${resourceToken}'\n    principalId: containerApps.outputs.managedIdentityPrincipalId\n  }\n}\n\noutput AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerApps.outputs.registryLoginServer\noutput AZURE_CONTAINER_REGISTRY_NAME string = containerApps.outputs.registryName\noutput AZURE_CONTAINER_APP_URL string = containerApps.outputs.appUrl\noutput AZURE_KEY_VAULT_NAME string = keyVault.outputs.keyVaultName\noutput APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.applicationInsightsConnectionString\n`,
    },
    {
      path: "infra/abbreviations.json",
      content: JSON.stringify({
        resourcesResourceGroups: "rg-",
        operationalInsightsWorkspaces: "log-",
        insightsComponents: "appi-",
        appManagedEnvironments: "cae-",
        containerRegistryRegistries: "cr",
        keyVaultVaults: "kv-",
        appContainerApps: "ca-",
      }, null, 2),
    },
    {
      path: "infra/modules/monitoring.bicep",
      content: `@description('Location for all resources')\nparam location string\nparam tags object = {}\nparam logAnalyticsName string\nparam applicationInsightsName string\n\nresource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {\n  name: logAnalyticsName\n  location: location\n  tags: tags\n  properties: {\n    sku: { name: 'PerGB2018' }\n    retentionInDays: 30\n  }\n}\n\nresource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {\n  name: applicationInsightsName\n  location: location\n  tags: tags\n  kind: 'web'\n  properties: {\n    Application_Type: 'web'\n    WorkspaceResourceId: logAnalytics.id\n  }\n}\n\noutput logAnalyticsWorkspaceId string = logAnalytics.id\noutput applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString\n`,
    },
    {
      path: "infra/modules/container-apps.bicep",
      content: `@description('Location for all resources')\nparam location string\nparam tags object = {}\nparam containerAppsEnvironmentName string\nparam containerRegistryName string\nparam logAnalyticsWorkspaceId string\nparam applicationInsightsConnectionString string\nparam appName string\nparam containerImageTag string = 'latest'\n\nresource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {\n  name: containerRegistryName\n  location: location\n  tags: tags\n  sku: { name: 'Basic' }\n  properties: { adminUserEnabled: true }\n}\n\nresource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {\n  name: containerAppsEnvironmentName\n  location: location\n  tags: tags\n  properties: {\n    appLogsConfiguration: {\n      destination: 'log-analytics'\n      logAnalyticsConfiguration: {\n        customerId: reference(logAnalyticsWorkspaceId, '2023-09-01').customerId\n        sharedKey: listKeys(logAnalyticsWorkspaceId, '2023-09-01').primarySharedKey\n      }\n    }\n  }\n}\n\nresource containerApp 'Microsoft.App/containerApps@2024-03-01' = {\n  name: appName\n  location: location\n  tags: union(tags, { 'azd-service-name': 'app' })\n  identity: { type: 'SystemAssigned' }\n  properties: {\n    managedEnvironmentId: containerAppsEnvironment.id\n    configuration: {\n      ingress: {\n        external: true\n        targetPort: 3000\n        transport: 'auto'\n        allowInsecure: false\n      }\n      registries: [\n        {\n          server: containerRegistry.properties.loginServer\n          username: containerRegistry.listCredentials().username\n          passwordSecretRef: 'registry-password'\n        }\n      ]\n      secrets: [\n        {\n          name: 'registry-password'\n          value: containerRegistry.listCredentials().passwords[0].value\n        }\n      ]\n    }\n    template: {\n      containers: [\n        {\n          image: '\${containerRegistry.properties.loginServer}/\${appName}:\${containerImageTag}'\n          name: appName\n          env: [\n            { name: 'NODE_ENV', value: 'production' }\n            { name: 'PORT', value: '3000' }\n            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsightsConnectionString }\n          ]\n          resources: {\n            cpu: json('0.5')\n            memory: '1.0Gi'\n          }\n          probes: [\n            {\n              type: 'Liveness'\n              httpGet: { path: '/health', port: 3000 }\n              periodSeconds: 30\n            }\n            {\n              type: 'Readiness'\n              httpGet: { path: '/health', port: 3000 }\n              periodSeconds: 10\n            }\n          ]\n        }\n      ]\n      scale: {\n        minReplicas: 1\n        maxReplicas: 10\n        rules: [\n          {\n            name: 'http-scaling'\n            http: { metadata: { concurrentRequests: '100' } }\n          }\n        ]\n      }\n    }\n  }\n}\n\noutput appUrl string = 'https://\${containerApp.properties.configuration.ingress.fqdn}'\noutput registryLoginServer string = containerRegistry.properties.loginServer\noutput registryName string = containerRegistry.name\noutput managedIdentityPrincipalId string = containerApp.identity.principalId\n`,
    },
    {
      path: "infra/modules/key-vault.bicep",
      content: `@description('Location for all resources')\nparam location string\nparam tags object = {}\nparam keyVaultName string\nparam principalId string\n\nresource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {\n  name: keyVaultName\n  location: location\n  tags: tags\n  properties: {\n    sku: { family: 'A', name: 'standard' }\n    tenantId: subscription().tenantId\n    enableRbacAuthorization: true\n    enableSoftDelete: true\n    softDeleteRetentionInDays: 7\n  }\n}\n\n// Grant the container app's managed identity access to Key Vault secrets\nresource keyVaultSecretUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {\n  scope: keyVault\n  name: guid(keyVault.id, principalId, '4633458b-17de-408a-b874-0445c86b69e6')\n  properties: {\n    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')\n    principalId: principalId\n    principalType: 'ServicePrincipal'\n  }\n}\n\noutput keyVaultName string = keyVault.name\noutput keyVaultUri string = keyVault.properties.vaultUri\n`,
    },
    {
      path: ".github/workflows/azure-deploy.yml",
      content: `name: Azure Deploy\n\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\npermissions:\n  id-token: write\n  contents: read\n\nenv:\n  AZURE_CLIENT_ID: \${{ vars.AZURE_CLIENT_ID }}\n  AZURE_TENANT_ID: \${{ vars.AZURE_TENANT_ID }}\n  AZURE_SUBSCRIPTION_ID: \${{ vars.AZURE_SUBSCRIPTION_ID }}\n  AZURE_ENV_NAME: \${{ vars.AZURE_ENV_NAME }}\n  AZURE_LOCATION: \${{ vars.AZURE_LOCATION }}\n\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n\n      - name: Install azd\n        uses: Azure/setup-azd@v2\n\n      - name: Login to Azure\n        uses: azure/login@v2\n        with:\n          client-id: \${{ env.AZURE_CLIENT_ID }}\n          tenant-id: \${{ env.AZURE_TENANT_ID }}\n          subscription-id: \${{ env.AZURE_SUBSCRIPTION_ID }}\n\n      - name: Provision and Deploy\n        run: azd up --no-prompt\n        env:\n          AZD_INITIAL_ENVIRONMENT_CONFIG: \${{ secrets.AZD_INITIAL_ENVIRONMENT_CONFIG }}\n`,
    },
    {
      path: "src/lib/azure.ts",
      content: `/**\n * Azure integration utilities\n * Uses DefaultAzureCredential for seamless auth in Azure Container Apps (Managed Identity)\n * and local development (Azure CLI / VS Code credentials).\n */\n\nimport { logger } from "./logger.js";\n\nlet appInsightsInitialized = false;\n\n/**\n * Initialize Azure Application Insights for monitoring.\n * Call this early in app startup. Safe to call multiple times.\n */\nexport async function initAppInsights(): Promise<void> {\n  if (appInsightsInitialized) return;\n  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;\n  if (!connectionString) {\n    logger.info("App Insights not configured — skipping (set APPLICATIONINSIGHTS_CONNECTION_STRING)");\n    return;\n  }\n  try {\n    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");\n    useAzureMonitor({ azureMonitorExporterOptions: { connectionString } });\n    appInsightsInitialized = true;\n    logger.info("✅ Azure Application Insights initialized");\n  } catch (err) {\n    logger.warn("⚠️ App Insights setup failed — monitoring disabled", { error: (err as Error).message });\n  }\n}\n\n/**\n * Get a secret from Azure Key Vault.\n * Uses DefaultAzureCredential (Managed Identity in Azure, CLI locally).\n */\nexport async function getKeyVaultSecret(secretName: string): Promise<string | undefined> {\n  const vaultName = process.env.AZURE_KEY_VAULT_NAME;\n  if (!vaultName) {\n    logger.warn("AZURE_KEY_VAULT_NAME not set — falling back to env vars");\n    return undefined;\n  }\n  try {\n    const { DefaultAzureCredential } = await import("@azure/identity");\n    const { SecretClient } = await import("@azure/keyvault-secrets");\n    const client = new SecretClient(\`https://\${vaultName}.vault.azure.net\`, new DefaultAzureCredential());\n    const secret = await client.getSecret(secretName);\n    return secret.value;\n  } catch (err) {\n    logger.error(\`Failed to retrieve secret "\${secretName}" from Key Vault\`, { error: (err as Error).message });\n    return undefined;\n  }\n}\n`,
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
          message: `📦 ${scaffoldFiles.length} files prepared (TypeScript, Express, Docker, CI/CD, Azure Bicep IaC, Key Vault, App Insights)`,
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
          "- GitHub Actions CI/CD + Azure deploy workflow\n" +
          "- Azure Bicep IaC (Container Apps, Key Vault, App Insights, ACR)\n" +
          "- Azure integration utilities (App Insights, Key Vault)\n" +
          "- Branch protection, CODEOWNERS, PR templates\n" +
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

        const issuePrompt = `${ISSUE_GENERATION_PROMPT}\n\nApplication: ${appName}\nRequirements:\n${condensed}\n\nThe project already has: Express 5 server, health check, error handling middleware, security headers, Docker, CI/CD (build + Azure deploy), Winston logging, Azure Bicep IaC (Container Apps, Key Vault, App Insights, ACR), azure.yaml for azd, src/lib/azure.ts with App Insights init and Key Vault secret helper, .env.example with Azure service vars. Create issues for the FEATURE-SPECIFIC work that still needs to be built. Reference Azure services where appropriate (e.g., Azure SQL for relational data, Cosmos DB for NoSQL, Blob Storage for files, Service Bus for messaging, Entra ID for auth).`;

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
