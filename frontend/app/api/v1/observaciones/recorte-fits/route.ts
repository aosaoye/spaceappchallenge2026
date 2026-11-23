import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE = "https://spaceappchallenge2026.onrender.com"

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fitsUrl = params.get("fits_url") || "";
  if (!fitsUrl) {
    return NextResponse.json(
      { detail: "Parámetro fits_url requerido" },
      { status: 400 }
    );
  }

  const upstreamParams = new URLSearchParams();
  upstreamParams.set("fits_url", fitsUrl);
  for (const key of ["ra", "dec", "fov_arcsec", "tamano_px"]) {
    const val = params.get(key);
    if (val !== null && val !== "") {
      upstreamParams.set(key, val);
    }
  }

  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/v1/observaciones/recorte-fits?${upstreamParams.toString()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      }
    );

    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { detail: text || "Respuesta no válida del backend." };
    }

    if (!upstream.ok) {
      return NextResponse.json(
        payload ?? { detail: "No se pudo extraer el recorte FITS real." },
        { status: upstream.status }
      );
    }

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=1800",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Error al conectar con el backend: ${error.message}`
            : "No se pudo extraer el recorte FITS del backend.",
      },
      { status: 502 }
    );
  }
}
