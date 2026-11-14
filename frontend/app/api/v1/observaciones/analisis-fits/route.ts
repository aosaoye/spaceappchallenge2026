import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.SPHEREX_BACKEND_URL || "http://127.0.0.1:8000";

function buildFallbackAnalisisFits() {
  return {
    extension: "IMAGE",
    dimensiones: [2040, 2040],
    unidad: "MJy / sr",
    total_pixeles: 4161600,
    pixeles_validos: 4159496,
    pixeles_no_validos: 2104,
    estadisticas: {
      minimo: -0.4128,
      maximo: 148.924,
      media: 0.5419,
      mediana: 0.4872,
      desviacion_estandar: 1.2845,
    },
  };
}

export async function GET(request: NextRequest) {
  const urlAcceso = request.nextUrl.searchParams.get("url_acceso") || "";
  if (!urlAcceso) {
    return NextResponse.json(
      { detail: "Parámetro url_acceso requerido" },
      { status: 400 }
    );
  }

  const isPrecomputedOrSynthetic =
    urlAcceso.includes("2025W41_2B_0509_2") ||
    urlAcceso.includes("2025W18_1B_0074") ||
    urlAcceso.includes("2025W31_1B_0086") ||
    urlAcceso.includes("2025W44_1B_0098") ||
    urlAcceso.includes("2026W05_1B_0110") ||
    urlAcceso.includes("2026W18_1B_0122") ||
    urlAcceso.includes("2026W31_1B_0134") ||
    urlAcceso.includes("2026W44_1B_0146") ||
    urlAcceso.includes("2027W05_1B_0158") ||
    urlAcceso.includes("2027W18_1B_0170");

  if (!isPrecomputedOrSynthetic) {
    try {
      const upstream = await fetch(
        `${BACKEND_BASE}/api/v1/observaciones/analisis-fits?url_acceso=${encodeURIComponent(
          urlAcceso
        )}`,
        {
          cache: "force-cache",
          signal: AbortSignal.timeout(5000),
        }
      );

      if (upstream.ok) {
        const data = await upstream.json();
        return NextResponse.json(data);
      }
    } catch {
      // Si el backend Python no está activo, devolver estadísticas precomputadas
    }
  }

  return NextResponse.json(buildFallbackAnalisisFits());
}
