import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE = "https://spaceappchallenge2026.onrender.com";

export async function GET(request: NextRequest) {
  const urlAcceso = request.nextUrl.searchParams.get("url_acceso") || "";
  if (!urlAcceso) {
    return NextResponse.json(
      { detail: "Parámetro url_acceso requerido" },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/v1/observaciones/analisis-calidad-fits?url_acceso=${encodeURIComponent(
        urlAcceso
      )}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      }
    );

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
