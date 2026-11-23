import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = "https://spaceappchallenge2026.onrender.com"

const MAX_UPLOAD_BYTES = 26_214_400; // 25 MB

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let payload: {
      archivo_base64: string;
      nombre_archivo: string;
      astrometry_api_key?: string | null;
    };

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const fileEntry = form.get("file");
      if (!(fileEntry instanceof File)) {
        return NextResponse.json(
          { detail: "Debes adjuntar un archivo de imagen en el campo 'file'." },
          { status: 400 }
        );
      }
      if (fileEntry.size === 0) {
        return NextResponse.json(
          { detail: "El archivo de imagen está vacío." },
          { status: 400 }
        );
      }
      if (fileEntry.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { detail: "La imagen supera el tamaño máximo permitido (25 MB)." },
          { status: 413 }
        );
      }

      const bytes = Buffer.from(await fileEntry.arrayBuffer());
      const rawKey = form.get("astrometry_api_key");
      const apiKey =
        typeof rawKey === "string" && rawKey.trim() ? rawKey.trim() : null;

      payload = {
        archivo_base64: bytes.toString("base64"),
        nombre_archivo: fileEntry.name || "cielo.png",
        astrometry_api_key: apiKey,
      };
    } else {
      const body = (await request.json()) as {
        archivo_base64?: string;
        nombre_archivo?: string;
        astrometry_api_key?: string | null;
      };
      if (!body?.archivo_base64 || typeof body.archivo_base64 !== "string") {
        return NextResponse.json(
          { detail: "Se requiere 'file' (multipart) o 'archivo_base64' (JSON)." },
          { status: 400 }
        );
      }
      payload = {
        archivo_base64: body.archivo_base64,
        nombre_archivo: body.nombre_archivo || "cielo.png",
        astrometry_api_key: body.astrometry_api_key || null,
      };
    }

    const upstream = await fetch(
      `${BACKEND_URL}/api/v1/observaciones/resolver-imagen`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      }
    );

    let data: unknown;
    try {
      data = await upstream.json();
    } catch {
      data = { detail: `Respuesta inesperada del backend (${upstream.status})` };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? `Error al resolver la imagen con el backend: ${error.message}`
            : "Error al resolver la imagen con el backend",
      },
      { status: 502 }
    );
  }
}
