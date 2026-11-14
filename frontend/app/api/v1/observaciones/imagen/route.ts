import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.SPHEREX_BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const fitsUrl = request.nextUrl.searchParams.get("fits_url") || "";
  const modo = request.nextUrl.searchParams.get("modo") || "flujo";

  if (!fitsUrl) {
    return NextResponse.json(
      { detail: "Parámetro fits_url requerido" },
      { status: 400 }
    );
  }

  const isPrecomputedOrSynthetic =
    fitsUrl.includes("2025W41_2B_0509_2") ||
    fitsUrl.includes("2025W18_1B_0074") ||
    fitsUrl.includes("2025W31_1B_0086") ||
    fitsUrl.includes("2025W44_1B_0098") ||
    fitsUrl.includes("2026W05_1B_0110") ||
    fitsUrl.includes("2026W18_1B_0122") ||
    fitsUrl.includes("2026W31_1B_0134") ||
    fitsUrl.includes("2026W44_1B_0146") ||
    fitsUrl.includes("2027W05_1B_0158") ||
    fitsUrl.includes("2027W18_1B_0170");

  if (!isPrecomputedOrSynthetic) {
    try {
      const upstream = await fetch(
        `${BACKEND_BASE}/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
          fitsUrl
        )}&modo=${encodeURIComponent(modo)}`,
        {
          cache: "force-cache",
          signal: AbortSignal.timeout(4500),
        }
      );

      if (upstream.ok) {
        const bytes = await upstream.arrayBuffer();
        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    } catch {
      // Si el backend Python no está activo o expira el tiempo, servir el PNG procesado local
    }
  }

  try {
    const fileName =
      modo === "longitud_onda"
        ? "2025W41_2B_0509_2_D1_wavelength.png"
        : "2025W41_2B_0509_2_D1_preview.png";
    const fallbackPath = path.join(
      process.cwd(),
      "public",
      "processed",
      fileName
    );
    const fileBuffer = await readFile(fallbackPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { detail: "No se pudo obtener la imagen PNG" },
      { status: 502 }
    );
  }
}
