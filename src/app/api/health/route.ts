import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "Pronghorn",
    version: "1.0.0",
  });
}
