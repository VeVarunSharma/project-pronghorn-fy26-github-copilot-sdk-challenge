import { NextResponse } from "next/server";

export async function GET() {
  const sandboxOrg = process.env.PRONGHORN_SANDBOX_ORG;
  const hasToken = !!(
    process.env.PRONGHORN_GITHUB_TOKEN || process.env.GITHUB_TOKEN
  );

  return NextResponse.json({
    service: "Pronghorn",
    version: "1.0.0",
    sandboxOrg: sandboxOrg || "(not configured)",
    tokenConfigured: hasToken,
    ready: !!sandboxOrg && hasToken,
  });
}
