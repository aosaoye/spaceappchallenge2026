import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = "https://spaceappchallenge2026.onrender.com";

async function parseJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const search = params.toString();
  const ra = params.get("ascension_recta");
  const dec = params.get("declinacion");

  let upstreamStatus = 502;
  let upstreamData: Record<string, unknown> | null = null;
  let upstreamErrorMsg: string | null = null;

  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/observaciones?${search}`, {
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    upstreamStatus = upstream.status;
    upstreamData = await parseJsonSafe(upstream);

    if (
      upstream.ok &&
      upstreamData &&
      Array.isArray(upstreamData.observaciones) &&
      upstreamData.observaciones.length > 0
    ) {
      return NextResponse.json(upstreamData, { status: 200 });
    }
  } catch (error) {
    upstreamErrorMsg =
      error instanceof Error
        ? `Error al conectar con el backend: ${error.message}`
        : "Error al conectar con el backend";
  }

  const shouldFallbackToHips5 =
    ra !== null &&
    dec !== null &&
    (upstreamStatus === 200 || (upstreamStatus >= 502 && upstreamStatus <= 504));

  if (shouldFallbackToHips5) {
    try {
      const hipsParams = new URLSearchParams({
        ascension_recta: ra,
        declinacion: dec,
      });
      const hipsResp = await fetch(
        `${BACKEND_URL}/api/v1/observaciones/hips5?${hipsParams.toString()}`,
        {
          signal: AbortSignal.timeout(45000),
          cache: "no-store",
        }
      );
      const hipsData = await parseJsonSafe(hipsResp);
      if (
        hipsResp.ok &&
        hipsData &&
        Array.isArray(hipsData.observaciones) &&
        hipsData.observaciones.length > 0
      ) {
        return NextResponse.json(hipsData, { status: 200 });
      }
    } catch {
      // Conservar detalle del fallo original si tampoco pudo consultarse HiPS5
    }
  }

  if (upstreamData) {
    return NextResponse.json(upstreamData, { status: upstreamStatus });
  }

  return NextResponse.json(
    {
      detail: upstreamErrorMsg ?? "Error al conectar con el backend de observaciones.",
    },
    { status: 502 }
  );
}
