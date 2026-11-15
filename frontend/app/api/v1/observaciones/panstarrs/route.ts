import { NextRequest, NextResponse } from "next/server";

export interface PanStarrsBandItem {
  projcell: string;
  subcell: string;
  ra: number;
  dec: number;
  filter: string;
  mjd: number;
  type: string;
  filename: string;
  shortname: string;
  badflag: number;
  imageUrl: string;
  fitsUrl: string;
  fitsCutoutUrl: string;
}

function parsePs1FilenamesTable(
  rawText: string,
  ra: number,
  dec: number,
  sizePx: number
): PanStarrsBandItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0].split(/\s+/);
  const idx = {
    projcell: headers.indexOf("projcell"),
    subcell: headers.indexOf("subcell"),
    ra: headers.indexOf("ra"),
    dec: headers.indexOf("dec"),
    filter: headers.indexOf("filter"),
    mjd: headers.indexOf("mjd"),
    type: headers.indexOf("type"),
    filename: headers.indexOf("filename"),
    shortname: headers.indexOf("shortname"),
    badflag: headers.indexOf("badflag"),
  };

  if (idx.filename === -1 || idx.filter === -1) return [];

  const items: PanStarrsBandItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\s+/);
    if (cols.length < headers.length) continue;

    const filename = cols[idx.filename];
    const filter = cols[idx.filter];
    if (!filename || !filter) continue;

    const encodedFile = encodeURIComponent(filename);
    const raStr = ra.toFixed(6);
    const decStr = dec.toFixed(6);

    items.push({
      projcell: idx.projcell >= 0 ? cols[idx.projcell] : "",
      subcell: idx.subcell >= 0 ? cols[idx.subcell] : "",
      ra: idx.ra >= 0 ? Number.parseFloat(cols[idx.ra]) : ra,
      dec: idx.dec >= 0 ? Number.parseFloat(cols[idx.dec]) : dec,
      filter,
      mjd: idx.mjd >= 0 ? Number.parseFloat(cols[idx.mjd]) : 0,
      type: idx.type >= 0 ? cols[idx.type] : "stack",
      filename,
      shortname: idx.shortname >= 0 ? cols[idx.shortname] : filename,
      badflag: idx.badflag >= 0 ? Number.parseInt(cols[idx.badflag], 10) : 0,
      imageUrl: `https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?ra=${raStr}&dec=${decStr}&size=${sizePx}&format=jpg&red=${encodedFile}`,
      fitsUrl: `https://ps1images.stsci.edu${filename.startsWith("/") ? "" : "/"}${filename}`,
      fitsCutoutUrl: `https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?ra=${raStr}&dec=${decStr}&size=${sizePx}&format=fits&red=${encodedFile}`,
    });
  }

  return items;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ra = Number.parseFloat(params.get("ra") || "");
  const dec = Number.parseFloat(params.get("dec") || "");
  const fovArcsec = Number.parseFloat(params.get("fov_arcsec") || "60");
  const fileType = params.get("type") === "warp" ? "warp" : "stack";

  if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
    return NextResponse.json(
      { detail: "Parámetros ra y dec requeridos" },
      { status: 400 }
    );
  }

  // Pan-STARRS1 tiene escala 0.25 arcsec/píxel
  const clampedFov = Math.max(15, Math.min(600, Number.isFinite(fovArcsec) ? fovArcsec : 60));
  const sizePx = Math.max(60, Math.min(2400, Math.round(clampedFov / 0.25)));

  const ps1QueryUrl = `https://ps1images.stsci.edu/cgi-bin/ps1filenames.py?ra=${ra.toFixed(
    6
  )}&dec=${dec.toFixed(6)}&filters=grizy&type=${fileType}`;

  try {
    const upstream = await fetch(ps1QueryUrl, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { detail: `Error de Pan-STARRS1 (HTTP ${upstream.status})` },
        { status: upstream.status }
      );
    }

    const rawText = await upstream.text();
    const items = parsePs1FilenamesTable(rawText, ra, dec, sizePx);

    const byFilter = new Map<string, PanStarrsBandItem>();
    for (const item of items) {
      if (!byFilter.has(item.filter)) {
        byFilter.set(item.filter, item);
      }
    }

    const yItem = byFilter.get("y");
    const iItem = byFilter.get("i");
    const gItem = byFilter.get("g");

    const colorUrl =
      yItem && iItem && gItem
        ? `https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?ra=${ra.toFixed(
            6
          )}&dec=${dec.toFixed(6)}&size=${sizePx}&format=jpg&red=${encodeURIComponent(
            yItem.filename
          )}&green=${encodeURIComponent(
            iItem.filename
          )}&blue=${encodeURIComponent(gItem.filename)}`
        : null;

    const ps1CutoutsWebUrl = `https://ps1images.stsci.edu/cgi-bin/ps1cutouts?pos=${encodeURIComponent(
      `${ra.toFixed(6)} ${dec.toFixed(6)}`
    )}&filter=color&filter=g&filter=r&filter=i&filter=z&filter=y&filetypes=${fileType}&size=${sizePx}`;

    return NextResponse.json({
      ra,
      dec,
      fovArcsec: clampedFov,
      sizePx,
      type: fileType,
      colorUrl,
      ps1CutoutsWebUrl,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Error al consultar Pan-STARRS1: ${error.message}`
            : "Error al consultar Pan-STARRS1",
      },
      { status: 502 }
    );
  }
}
