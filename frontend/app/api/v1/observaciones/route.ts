import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.SPHEREX_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();

  try {
    let upstream = await fetch(
      `${BACKEND_URL}/api/v1/observaciones?${search}`,
      {
        signal: AbortSignal.timeout(60000),
        cache: "no-store",
      }
    );

    if (upstream.status >= 502 && upstream.status <= 504) {
      upstream = await fetch(
        `${BACKEND_URL}/api/v1/observaciones?${search}`,
        {
          signal: AbortSignal.timeout(60000),
          cache: "no-store",
        }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Error al conectar con el backend: ${error.message}`
            : "Error al conectar con el backend",
      },
      { status: 502 }
    );
  }
}
