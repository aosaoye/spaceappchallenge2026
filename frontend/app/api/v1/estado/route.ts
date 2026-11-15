import { connection, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.SPHEREX_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000";

export async function GET() {
  await connection();
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/estado`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Backend no disponible: ${error.message}`
            : "Backend no disponible",
      },
      { status: 502 }
    );
  }
}
