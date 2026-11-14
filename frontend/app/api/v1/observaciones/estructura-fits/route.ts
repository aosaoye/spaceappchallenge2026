import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE =
  process.env.SPHEREX_BACKEND_URL || "http://127.0.0.1:8000";

const FALLBACK_ESTRUCTURA_MEF = [
  {
    indice: 0,
    nombre: "PRIMARY",
    tipo_extension: "PrimaryHDU",
    dimensiones: null,
    tipo_datos: null,
    unidades: null,
    descripcion:
      "Cabecera principal del archivo Multi-Extension FITS (MEF) de SPHEREx (VERSION 7.0.5).",
  },
  {
    indice: 1,
    nombre: "IMAGE",
    tipo_extension: "ImageHDU",
    dimensiones: [2040, 2040],
    tipo_datos: ">f4 (float32)",
    unidades: "MJy / sr",
    descripcion:
      "Flujo superficial calibrado del detector en unidades científicas de MJy/sr (sin sustracción zodiacal).",
  },
  {
    indice: 2,
    nombre: "FLAGS",
    tipo_extension: "ImageHDU",
    dimensiones: [2040, 2040],
    tipo_datos: ">i4 (int32 bitmap)",
    unidades: null,
    descripcion:
      "Mapa de bits por píxel con banderas de estado y procesamiento (MSKN0000..MSKN0021).",
  },
  {
    indice: 3,
    nombre: "VARIANCE",
    tipo_extension: "ImageHDU",
    dimensiones: [2040, 2040],
    tipo_datos: ">f4 (float32)",
    unidades: "(MJy / sr)^2",
    descripcion:
      "Estimación por píxel de la varianza del flujo superficial calibrado en (MJy/sr)^2.",
  },
  {
    indice: 4,
    nombre: "ZODI",
    tipo_extension: "ImageHDU",
    dimensiones: [2040, 2040],
    tipo_datos: ">f4 (float32)",
    unidades: "MJy / sr",
    descripcion:
      "Modelo de emisión de fondo de polvo zodiacal en MJy/sr (no sustraído de la extensión IMAGE).",
  },
  {
    indice: 5,
    nombre: "EPSF",
    tipo_extension: "BinTableHDU",
    dimensiones: [441],
    tipo_datos: "BinTable (33×33 oversampled ×5)",
    unidades: null,
    descripcion:
      "Función de dispersión de punto efectiva (ePSF) en una cuadrícula de 21 × 21 regiones (441 filas).",
  },
  {
    indice: 6,
    nombre: "WCS-WAVE",
    tipo_extension: "BinTableHDU",
    dimensiones: [1],
    tipo_datos: "BinTable (X, Y, VALUES)",
    unidades: "um",
    descripcion:
      "Tabla de búsqueda WCS espectral (WAVE-TAB) para filtros lineales variables (LVF): longitud de onda central y ancho de banda por píxel.",
  },
];

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
    urlAcceso.includes("2025W18_1B_0074_2") ||
    urlAcceso.includes("2026W05_1B_0110") ||
    urlAcceso.includes("2026W18_1B_0122") ||
    urlAcceso.includes("2026W31_1B_0134") ||
    urlAcceso.includes("2026W44_1B_0146") ||
    urlAcceso.includes("2027W05_1B_0158") ||
    urlAcceso.includes("2027W18_1B_0170");

  if (!isPrecomputedOrSynthetic) {
    try {
      const upstream = await fetch(
        `${BACKEND_BASE}/api/v1/observaciones/estructura-fits?url_acceso=${encodeURIComponent(
          urlAcceso
        )}`,
        {
          cache: "force-cache",
          signal: AbortSignal.timeout(6000),
        }
      );

      if (upstream.ok) {
        const data = await upstream.json();
        return NextResponse.json(data);
      }
    } catch {
      // Si el backend Python no está activo, devolver estructura MEF de referencia
    }
  }

  return NextResponse.json({
    total_extensiones: FALLBACK_ESTRUCTURA_MEF.length,
    extensiones: FALLBACK_ESTRUCTURA_MEF,
    origen: "referencia-local-mef",
  });
}
