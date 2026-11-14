import { NextRequest, NextResponse } from "next/server";
import { buildFallbackObservations, Observacion } from "@/app/astronomy";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const OBSERVACIONES_CACHE = new Map<
  string,
  { total: number; observaciones: Observacion[] }
>();

function parseVOTableObservations(xml: string): Observacion[] {
  const fieldNames: string[] = [];
  const fieldRegex = /<FIELD\b([^>]*?)\/?>/gi;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(xml)) !== null) {
    const attrs = fieldMatch[1];
    const nameMatch =
      attrs.match(/\bname="([^"]+)"/i) || attrs.match(/\bID="([^"]+)"/i);
    fieldNames.push(nameMatch ? nameMatch[1] : "");
  }

  const tableDataMatch = xml.match(/<TABLEDATA\b[^>]*>([\s\S]*?)<\/TABLEDATA>/i);
  if (!tableDataMatch || fieldNames.length === 0) {
    return [];
  }

  const tableDataXml = tableDataMatch[1];
  const trRegex = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
  const tdRegex = /<TD(?:\s[^>]*)?>([\s\S]*?)<\/TD>|<TD\s*\/>/gi;

  const observaciones: Observacion[] = [];
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(tableDataXml)) !== null) {
    const rowXml = trMatch[1];
    const values: string[] = [];
    let tdMatch: RegExpExecArray | null;
    tdRegex.lastIndex = 0;

    while ((tdMatch = tdRegex.exec(rowXml)) !== null) {
      const rawVal = tdMatch[1] ?? "";
      values.push(
        rawVal
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .trim()
      );
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < fieldNames.length && i < values.length; i++) {
      if (fieldNames[i]) {
        row[fieldNames[i]] = values[i];
      }
    }

    const accessUrl = row["access_url"] || "";
    const obsId = row["obs_id"] || row["sia_obs_id"] || "";
    const ra = Number.parseFloat(row["s_ra"] || "");
    const dec = Number.parseFloat(row["s_dec"] || "");

    if (!accessUrl || !obsId || !Number.isFinite(ra) || !Number.isFinite(dec)) {
      continue;
    }

    const estSizeRaw = Number.parseInt(row["access_estsize"] || "", 10);

    observaciones.push({
      identificador: obsId,
      ascension_recta: ra,
      declinacion: dec,
      coleccion: row["obs_collection"] || "spherex_dr1",
      banda_espectral: row["energy_bandpassname"] || "SPHEREx-D1",
      tipo_producto: row["dataproduct_subtype"] || "science",
      url_acceso: accessUrl,
      tamano_estimado: Number.isFinite(estSizeRaw) ? estSizeRaw : null,
      url_imagen_png: `/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
        accessUrl
      )}`,
    });
  }

  return observaciones;
}

async function queryIrsaSiaDirect(
  raDeg: number,
  decDeg: number,
  radiusArcsec: number
): Promise<Observacion[]> {
  const radiiToTry =
    radiusArcsec > 5 ? [radiusArcsec, 5] : [Math.max(1, radiusArcsec)];

  for (const rArcsec of radiiToTry) {
    const rDeg = (rArcsec / 3600).toFixed(6);
    const siaUrl = `https://irsa.ipac.caltech.edu/SIA?POS=CIRCLE+${raDeg}+${decDeg}+${rDeg}&COLLECTION=spherex_dr1&COLLECTION=spherex_qr3&MAXREC=64`;
    try {
      const res = await fetch(siaUrl, {
        signal: AbortSignal.timeout(7500),
        headers: { Accept: "application/x-votable+xml, text/xml" },
      });
      if (res.ok) {
        const xml = await res.text();
        const parsed = parseVOTableObservations(xml);
        if (parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Reintentar con radio menor o pasar a la secuencia multiépoca local
    }
  }

  return [];
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raDeg = Number.parseFloat(params.get("ascension_recta") || "133.795129");
  const decDeg = Number.parseFloat(params.get("declinacion") || "-7.245147");
  const radiusArcsec = Number.parseFloat(params.get("radio") || "60");

  const cacheKey = `${raDeg.toFixed(4)}:${decDeg.toFixed(4)}:${radiusArcsec.toFixed(0)}`;
  const cached = OBSERVACIONES_CACHE.get(cacheKey);
  if (cached && cached.observaciones.length > 0) {
    return NextResponse.json(cached);
  }

  const search = params.toString();

  // 1. Intentar con el backend FastAPI multihilo si está activo
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/observaciones?${search}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.observaciones) && data.observaciones.length > 0) {
        OBSERVACIONES_CACHE.set(cacheKey, data);
        return NextResponse.json(data);
      }
    }
  } catch {
    // Si FastAPI no está levantado, consultar IRSA SIA directamente desde Next.js
  }

  // 2. Consulta directa a IRSA SIA v2 (garantiza datos reales de SPHEREx aunque FastAPI esté apagado)
  if (Number.isFinite(raDeg) && Number.isFinite(decDeg)) {
    const irsaObs = await queryIrsaSiaDirect(
      raDeg,
      decDeg,
      Number.isFinite(radiusArcsec) ? radiusArcsec : 60
    );
    if (irsaObs.length > 0) {
      const payload = {
        total: irsaObs.length,
        observaciones: irsaObs,
      };
      OBSERVACIONES_CACHE.set(cacheKey, payload);
      return NextResponse.json(payload);
    }
  }

  // 3. Respaldo multiépoca garantizado si no hay red externa disponible
  const fallback = buildFallbackObservations(
    Number.isFinite(raDeg) ? raDeg : 133.795129,
    Number.isFinite(decDeg) ? decDeg : -7.245147,
    "Todas"
  );
  return NextResponse.json({
    total: fallback.length,
    observaciones: fallback,
  });
}
