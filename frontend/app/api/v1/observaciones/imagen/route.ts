import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.SPHEREX_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const fitsUrl = request.nextUrl.searchParams.get("fits_url") || "";
  const modo = request.nextUrl.searchParams.get("modo") || "flujo";

  if (!fitsUrl) {
    return NextResponse.json(
      { detail: "Parámetro fits_url requerido" },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
        fitsUrl
      )}&modo=${encodeURIComponent(modo)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!upstream.ok) {
      let errorPayload: unknown = { detail: "No se pudo obtener la imagen PNG del backend" };
      try {
        errorPayload = await upstream.json();
      } catch {
        // mantener detalle por defecto si la respuesta de error no es JSON
      }
      return NextResponse.json(errorPayload, { status: upstream.status });
    }

    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Error al conectar con el backend: ${error.message}`
            : "No se pudo obtener la imagen PNG del backend",
      },
      { status: 502 }
    );
  }
}
