import { parseSexagesimal } from "./coordinates";

export interface SkyViewParams {
  ra: number;
  dec: number;
  fov: number;
  raRaw: string;
  decRaw: string;
  fovRaw: string;
}

/**
 * Extrae y valida los parámetros ?ra=...&dec=...&fov=... desde window.location.search.
 * Convierte RA y DEC a grados decimales (ICRS) y valida que FOV esté en grados (0 < fov <= 180).
 * Lanza un Error descriptivo si falta algún parámetro o si alguno es inválido.
 */
export function parseViewParams(search: string): SkyViewParams {
  const params = new URLSearchParams(search);

  const raRaw = params.get("ra");
  const decRaw = params.get("dec");
  const fovRaw = params.get("fov");

  if (!raRaw || !decRaw || !fovRaw) {
    throw new Error("Faltan parámetros RA, DEC o FOV");
  }

  const ra = parseSexagesimal(raRaw, "ra");
  const dec = parseSexagesimal(decRaw, "dec");
  const fov = Number(fovRaw);

  if (ra < 0 || ra >= 360) {
    throw new Error("RA fuera de rango");
  }

  if (dec < -90 || dec > 90) {
    throw new Error("DEC fuera de rango");
  }

  if (!Number.isFinite(fov) || fov <= 0 || fov > 180) {
    throw new Error("FOV inválido");
  }

  return { ra, dec, fov, raRaw, decRaw, fovRaw };
}

export interface TryParseViewParamsResult {
  hasUrlParams: boolean;
  view: SkyViewParams | null;
  error: string | null;
}

/**
 * Evalúa window.location.search:
 * - Si no hay parámetros ra/dec/fov en la URL, devuelve { hasUrlParams: false, view: null, error: null }.
 * - Si hay parámetros y son válidos, devuelve { hasUrlParams: true, view, error: null }.
 * - Si hay parámetros parciales o inválidos, devuelve { hasUrlParams: true, view: null, error: mensaje }
 *   para mostrar un aviso claro al usuario sin fallar silenciosamente.
 */
export function tryParseViewParams(search: string): TryParseViewParamsResult {
  const params = new URLSearchParams(search);
  const hasRa = params.has("ra");
  const hasDec = params.has("dec");
  const hasFov = params.has("fov");

  if (!hasRa && !hasDec && !hasFov) {
    return { hasUrlParams: false, view: null, error: null };
  }

  try {
    // Si el usuario pasó ?ra=...&dec=... sin fov, usamos 0.0250° (90") por defecto
    const effectiveSearch = new URLSearchParams(search);
    if (hasRa && hasDec && !hasFov) {
      effectiveSearch.set("fov", "0.0250");
    }
    const view = parseViewParams(effectiveSearch.toString());
    return { hasUrlParams: true, view, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Parámetros de coordenadas en la URL inválidos";
    return { hasUrlParams: true, view: null, error: message };
  }
}
