import { connection } from "next/server";
import { publicHealth } from "@/lib/ops/health";

// U-12: an unauthenticated, secret-free health endpoint for external monitoring.
// It exposes status and aggregate sizes only; names, paths and configuration stay out.
export async function GET() {
  await connection();
  try {
    const payload = await publicHealth();
    return Response.json(payload, {
      status: payload.status === "fail" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Never echo the error: it can name a file path.
    return Response.json(
      { status: "fail", error: "Health check failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
