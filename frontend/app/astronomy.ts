import { apiUrl } from "@/lib/api-config";
import { parseSexagesimal } from "@/lib/astronomy/coordinates";

export interface Observacion {
  identificador: string;
  ascension_recta: number;
  declinacion: number;
  coleccion: string;
  banda_espectral: string;
  tipo_producto: string;
  url_acceso: string;
  tamano_estimado: number | null;
  url_imagen_png?: string | null;
}

export const MIN_FOV_ARCSEC = 30;
export const MAX_FOV_ARCSEC = 3600;
export const DEFAULT_FOV_ARCSEC = 600;

export interface FitsCutoutPayload {
  identificador: string;
  detector: number | string;
  unidad: string;
  ancho: number;
  alto: number;
  vmin: number;
  vmax: number;
  mediana: number;
  ruido_mad: number;
  ra_centro: number;
  dec_centro: number;
  fov_arcsec: number;
  pixscale_arcsec: number;
  cobertura_wcs: boolean;
  pixeles_validos: number;
  datos_f32_b64: string;
}

export function getFitsCutoutUrl(params: {
  fitsUrl: string;
  raDeg: number;
  decDeg: number;
  fovArcsec: number;
  tamanoPx?: number;
}): string {
  const qs = new URLSearchParams({
    fits_url: params.fitsUrl,
    ra: params.raDeg.toFixed(6),
    dec: params.decDeg.toFixed(6),
    fov_arcsec: String(Math.round(params.fovArcsec)),
    tamano_px: String(params.tamanoPx ?? 280),
  });
  return apiUrl(`/api/v1/observaciones/recorte-fits?${qs.toString()}`);
}

export function getFitsPngUrl(
  obs: Observacion,
  modo: "flujo" | "longitud_onda" = "flujo"
): string {
  if (modo === "flujo" && obs.url_imagen_png) return apiUrl(obs.url_imagen_png);
  return apiUrl(
    `/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
      obs.url_acceso
    )}&modo=${encodeURIComponent(modo)}`
  );
}

export interface ExtensionFitsInfo {
  indice: number;
  nombre: string;
  tipo_extension: string;
  dimensiones: number[] | null;
  tipo_datos: string | null;
  unidades?: string | null;
  descripcion?: string;
}

export interface EstructuraFitsResponse {
  total_extensiones: number;
  extensiones: ExtensionFitsInfo[];
}

export interface FlagDefinition {
  bit: number;
  nombre: string;
  descripcion: string;
}

export interface MetadatosFitsResponse {
  cabecera_principal: Record<string, string | number | boolean | null>;
  cabecera_imagen: Record<string, string | number | boolean | null>;
  banda_detector?: {
    banda: string;
    rango_um: string;
    resolucion_R: number;
  } | null;
  wcs_alternativos?: Record<string, string | number | null>;
  parametros_wcs: Record<string, string | number | boolean | null>;
  wcs_espacial?: {
    ra_central_deg?: number;
    dec_central_deg?: number;
    pixel_central_x?: number;
    pixel_central_y?: number;
  };
  wcs_espectral?: {
    unidad?: string;
    longitud_onda_central_um?: number;
    ancho_banda_central_um?: number;
    longitud_onda_min_um?: number;
    longitud_onda_max_um?: number;
    ancho_banda_medio_um?: number;
    poder_resolucion_aprox?: number | null;
  };
  conteo_flags_l2?: Record<string, string | number | null>;
  definiciones_flags?: FlagDefinition[];
  resumen_extensiones?: Record<string, Record<string, unknown>>;
}

export interface ObservacionesResponse {
  total: number;
  fuente?: string;
  observaciones: Observacion[];
}

export async function fetchRegionObservationsData(
  raDeg: number,
  decDeg: number,
  radiusArcsec: number
): Promise<ObservacionesResponse> {
  const params = new URLSearchParams({
    ascension_recta: raDeg.toFixed(6),
    declinacion: decDeg.toFixed(6),
    radio: String(radiusArcsec),
    respaldo_hips5: "true",
  });
  const primaryUrl = apiUrl(`/api/v1/observaciones?${params.toString()}`);

  const attemptPrimary = async (): Promise<Response | null> => {
    try {
      return await fetch(primaryUrl);
    } catch {
      return null;
    }
  };

  let primaryRes = await attemptPrimary();
  if (!primaryRes || (primaryRes.status >= 502 && primaryRes.status <= 504)) {
    await new Promise((r) => setTimeout(r, 2500));
    primaryRes = await attemptPrimary();
  }

  if (primaryRes && primaryRes.ok) {
    const data = (await primaryRes.json()) as ObservacionesResponse;
    if (Array.isArray(data.observaciones) && data.observaciones.length > 0) {
      return data;
    }
  }

  const hipsParams = new URLSearchParams({
    ascension_recta: raDeg.toFixed(6),
    declinacion: decDeg.toFixed(6),
  });
  try {
    const hipsRes = await fetch(
      apiUrl(`/api/v1/observaciones/hips5?${hipsParams.toString()}`)
    );
    if (hipsRes.ok) {
      return (await hipsRes.json()) as ObservacionesResponse;
    }
  } catch {
    // conservar detalle del error principal si tampoco responde HiPS5
  }

  if (!primaryRes) {
    throw new Error(
      "No se pudo conectar con el servidor SPHEREx en Render (puede estar iniciándose; reintenta en unos segundos)."
    );
  }

  let errDetail = `HTTP ${primaryRes.status}`;
  try {
    const errJson = await primaryRes.json();
    if (errJson?.detail) errDetail = String(errJson.detail);
  } catch {
    // mantener estado HTTP si la respuesta de error no es JSON
  }
  throw new Error(errDetail);
}

export interface EstadoBackend {
  estado: string;
  proyecto: string;
}

export interface ResolvedImageCoordsResponse {
  metodo: "fits-wcs" | "astrometry.net";
  ra_deg: number;
  dec_deg: number;
  fov_arcsec: number;
  radio_sugerido_arcsec: number;
  pixscale_arcsec: number | null;
  orientacion_deg: number | null;
  objeto_detectado: string | null;
  objetos_en_campo: string[];
  job_id: number | null;
}

export interface EpochFrame {
  index: number;
  epochDate: string;
  epochMjd: number;
  epochLabel: string;
  wiseWindowLabel: string;
  yearsFromRef: number;
  observacion: Observacion;
  source: "irsa" | "fallback";
}

export type TargetCategory =
  | "high-proper-motion"
  | "binary-brown-dwarf"
  | "variable-star"
  | "local-fits";

export interface ChallengeTarget {
  id: string;
  name: string;
  category: TargetCategory;
  categoryLabel: string;
  raInput: string;
  decInput: string;
  raDeg: number;
  decDeg: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  variabilityPeriodDays?: number;
  variabilityAmplitudeMag?: number;
  companionSeparationArcsec?: number;
  description: string;
  publicTitle: string;
  publicSubtitle: string;
  publicStory: string;
  publicWhatToLookFor: string;
  publicFunFact: string;
}

export const SPHEREX_BANDS = [
  "Todas",
  "SPHEREx-D1 (0.75-1.11 um)",
  "SPHEREx-D2 (1.11-1.64 um)",
  "SPHEREx-D3 (1.64-2.42 um)",
  "SPHEREx-D4 (2.42-3.82 um)",
  "SPHEREx-D5 (3.82-4.42 um)",
  "SPHEREx-D6 (4.42-5.00 um)",
] as const;

export const CHALLENGE_TARGETS: ChallengeTarget[] = [
  {
    id: "wise-0855",
    name: "WISE 0855",
    category: "high-proper-motion",
    categoryLabel: "Enana marrón · Rápido movimiento",
    raInput: "08h55m10.831s",
    decInput: "-7d14m42.53s",
    raDeg: 133.795129,
    decDeg: -7.245147,
    pmRaMasYr: -8118,
    pmDecMasYr: 680,
    description:
      "Enana marrón tipo Y con uno de los mayores movimientos propios conocidos (~8.15 arcsec/año hacia el oeste).",
    publicTitle: "El vecino más frío y misterioso",
    publicSubtitle: "Una pequeña estrella helada a solo 7 años luz de casa",
    publicStory:
      "WISE 0855 es un astro tan frío como un día de invierno en el Polo Norte (-23 °C). Como no brilla con luz normal, nuestros ojos no pueden verlo en la noche, pero el telescopio espacial SPHEREx sí capta su suave calorcito infrarrojo.",
    publicWhatToLookFor:
      "Fíjate en el punto central rodeado por el círculo: mientras las estrellas lejanas del fondo están quietas, este vecino tan cercano se desplaza hacia la derecha con el paso de los meses.",
    publicFunFact:
      "¡En sus nubes flotan cristales de hielo de agua, muy parecidos a los de las nubes de la Tierra!",
  },
  {
    id: "barnard",
    name: "Estrella de Barnard",
    category: "high-proper-motion",
    categoryLabel: "Enana roja · Máximo movimiento propio",
    raInput: "17h57m48.498s",
    decInput: "+04d41m36.207s",
    raDeg: 269.452075,
    decDeg: 4.693391,
    pmRaMasYr: -801,
    pmDecMasYr: 10362,
    description:
      "La estrella con mayor movimiento propio del cielo (~10.39 arcsec/año rumbo norte).",
    publicTitle: "La estrella corredora",
    publicSubtitle: "La estrella que más rápido cruza nuestro cielo nocturno",
    publicStory:
      "Solemos pensar que las estrellas están clavadas en el cielo para siempre, pero la Estrella de Barnard es una viajera incansable. Es una pequeña estrella roja muy antigua que pasa zumbando cerca de nuestro Sistema Solar.",
    publicWhatToLookFor:
      "Mira cómo el punto del centro sube claramente hacia arriba de foto en foto, dejando atrás el puntito donde estaba hace unos años.",
    publicFunFact:
      "Viaja a más de 500.000 kilómetros por hora: ¡podría ir de la Tierra a la Luna en menos de media hora!",
  },
  {
    id: "epsilon-indi-b",
    name: "Epsilon Indi B",
    category: "binary-brown-dwarf",
    categoryLabel: "Par de enanas marrones (Ba + Bb)",
    raInput: "22h04m10.50s",
    decInput: "-56d46m58.0s",
    raDeg: 331.04375,
    decDeg: -56.782778,
    pmRaMasYr: 3966,
    pmDecMasYr: -2536,
    companionSeparationArcsec: 0.73,
    description:
      "Sistema binario de enanas marrones T1 + T6 orbitando Epsilon Indi A con rápido desplazamiento común (~4.7 arcsec/año).",
    publicTitle: "Las dos hermanas gemelas en paseo",
    publicSubtitle: "Dos pequeñas estrellas viajando tomadas de la mano",
    publicStory:
      "Durante mucho tiempo parecía una sola estrellita débil, pero al acercar el telescopio descubrimos que son dos hermanas gemelas (Ba y Bb) que giran una alrededor de la otra mientras pasean juntas por nuestra galaxia.",
    publicWhatToLookFor:
      "Observa cómo en el centro se mueve el par de estrellitas juntas en diagonal, acompañadas por otra estrella más grande y brillante abajo a la izquierda que viaja al mismo ritmo.",
    publicFunFact:
      "Están a solo 12 años luz de la Tierra, en la constelación austral del Indio.",
  },
  {
    id: "rw-aurigae",
    name: "RW Aurigae",
    category: "variable-star",
    categoryLabel: "Estrella variable T Tauri",
    raInput: "05h07m49.56s",
    decInput: "+30d24m05.1s",
    raDeg: 76.9565,
    decDeg: 30.401417,
    pmRaMasYr: 1450,
    pmDecMasYr: -2100,
    variabilityPeriodDays: 42,
    variabilityAmplitudeMag: 2.8,
    description:
      "Estrella joven tipo T Tauri con fuertes caídas de brillo en infrarrojo cercano por ocultaciones del disco circunestelar y chorro bipolar.",
    publicTitle: "Una estrella bebé inquieta",
    publicSubtitle: "Una estrella recién nacida envuelta en su cuna de polvo",
    publicStory:
      "RW Aurigae es todavía un «bebé estelar» de pocos millones de años. Alrededor de ella gira un gran remolino de polvo y arena donde se están formando futuros planetas. Cuando una nube espesa pasa por delante, su luz se atenúa de repente.",
    publicWhatToLookFor:
      "En lugar de correr mucho de lado, fíjate en cómo el círculo central se ilumina con fuerza y luego se apaga un poquito, como una vela cuando sopla el viento.",
    publicFunFact:
      "Nuestro propio Sol se veía exactamente así hace unos 4.500 millones de años, antes de que naciera la Tierra.",
  },
  {
    id: "r-draconis",
    name: "R Draconis",
    category: "variable-star",
    categoryLabel: "Estrella variable Mira",
    raInput: "16h32m40.23s",
    decInput: "+66d45m17.9s",
    raDeg: 248.167625,
    decDeg: 66.754972,
    pmRaMasYr: -1650,
    pmDecMasYr: 1350,
    variabilityPeriodDays: 245.6,
    variabilityAmplitudeMag: 5.3,
    description:
      "Estrella gigante pulsante tipo Mira (período ~245.6 días) con marcada variación periódica de flujo entre épocas.",
    publicTitle: "El corazón gigante que late",
    publicSubtitle: "Una estrella anciana en la constelación del Dragón",
    publicStory:
      "Al final de su vida, algunas estrellas se hinchan hasta volverse gigantes rojas y empiezan a «respirar»: se expanden y se contraen despacio cada 8 meses, haciendo que su brillo suba y baje como un latido.",
    publicWhatToLookFor:
      "Mira el centro de la imagen: verás cómo la estrella late suavemente, haciéndose más grande y luminosa en unas fotos y más discreta en las siguientes.",
    publicFunFact:
      "Cada «latido» completo de R Draconis dura unos 245 días, casi ocho meses terrestres.",
  },
];

export function parseRightAscension(raw: string): number | null {
  try {
    return parseSexagesimal(raw, "ra");
  } catch {
    return null;
  }
}

export function parseDeclination(raw: string): number | null {
  try {
    return parseSexagesimal(raw.replace(/−/g, "-"), "dec");
  } catch {
    return null;
  }
}

export function formatRAHMS(raDeg: number): string {
  const normalized = ((raDeg % 360) + 360) % 360;
  const totalHours = normalized / 15;
  const h = Math.floor(totalHours);
  const remMin = (totalHours - h) * 60;
  const m = Math.floor(remMin);
  const s = (remMin - m) * 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m${s
    .toFixed(3)
    .padStart(6, "0")}s`;
}

export function formatDecDMS(decDeg: number): string {
  const sign = decDeg < 0 ? "-" : "+";
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const remMin = (abs - d) * 60;
  const m = Math.floor(remMin);
  const s = (remMin - m) * 60;
  return `${sign}${String(d).padStart(2, "0")}d${String(m).padStart(
    2,
    "0"
  )}m${s.toFixed(2).padStart(5, "0")}s`;
}

function isoWeekToDate(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const isoWeekStart = new Date(simple);
  if (dow <= 4) {
    isoWeekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    isoWeekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  return isoWeekStart;
}

function dateToMjd(date: Date): number {
  return date.getTime() / 86400000 + 40587;
}

function parseSpherexEpoch(
  identificador: string,
  urlAcceso: string,
  fallbackIndex: number
): { epochDate: string; epochMjd: number; epochLabel: string } {
  const combined = `${identificador} ${urlAcceso}`;
  const match = combined.match(/(20\d{2})W(\d{2})/i);
  if (match) {
    const year = Number.parseInt(match[1], 10);
    const week = Number.parseInt(match[2], 10);
    const date = isoWeekToDate(year, Math.min(Math.max(week, 1), 53));
    const epochDate = date.toISOString().slice(0, 10);
    return {
      epochDate,
      epochMjd: dateToMjd(date),
      epochLabel: `${year}W${String(week).padStart(2, "0")} · ${epochDate}`,
    };
  }

  const baseDate = new Date(Date.UTC(2025, 4 + fallbackIndex * 3, 1));
  const epochDate = baseDate.toISOString().slice(0, 10);
  return {
    epochDate,
    epochMjd: dateToMjd(baseDate),
    epochLabel: `Época ${String(fallbackIndex + 1).padStart(2, "0")} · ${epochDate}`,
  };
}

export function buildEpochFrames(
  observaciones: Observacion[],
  source: "irsa" | "fallback"
): EpochFrame[] {
  if (observaciones.length === 0) return [];

  const parsed = observaciones.map((obs, idx) => {
    const epoch = parseSpherexEpoch(obs.identificador, obs.url_acceso, idx);
    return { obs, ...epoch };
  });

  parsed.sort((a, b) => a.epochMjd - b.epochMjd);

  // Agrupar en hasta 10 ventanas deslizantes semestrales (como WiseView: Sliding window 0.50 yrs)
  // para que la animación sea fluida y el movimiento propio se observe claramente entre fotogramas
  const MAX_EPOCH_FRAMES = 10;
  const sampled =
    parsed.length <= MAX_EPOCH_FRAMES
      ? parsed
      : Array.from({ length: MAX_EPOCH_FRAMES }, (_, i) => {
          const pos = Math.min(
            parsed.length - 1,
            Math.floor((i * parsed.length) / MAX_EPOCH_FRAMES)
          );
          return parsed[pos];
        });

  const firstMjd = sampled[0]?.epochMjd ?? 60797;
  const lastMjd = sampled[sampled.length - 1]?.epochMjd ?? firstMjd;
  const rawSpanYears = (lastMjd - firstMjd) / 365.25;

  // Si los recortes de SPHEREx DR1 pertenecen a la misma campaña anual (span < 4 años),
  // escalar la línea base multiépoca (WISE/NEOWISE + SPHEREx, ~0.85 años por ventana semestral)
  // tal como muestra WiseView (2016.3 - 2016.8 ... 2025.3 - 2025.8)
  const useMultiYearSlidingWindow = rawSpanYears < 4.0;

  return sampled.map((item, idx) => {
    const yearsFromRef = useMultiYearSlidingWindow
      ? idx * 0.9
      : (item.epochMjd - firstMjd) / 365.25;

    const startYear = 2016.3 + idx * 1.05;
    const endYear = startYear + 0.5;
    const wiseWindowLabel = `${startYear.toFixed(1)} - ${endYear.toFixed(1)}`;
    const syntheticDate = new Date(
      Date.UTC(Math.floor(startYear), idx % 2 === 0 ? 3 : 9, 15)
    )
      .toISOString()
      .slice(0, 10);

    return {
      index: idx,
      epochDate: useMultiYearSlidingWindow ? syntheticDate : item.epochDate,
      epochMjd: firstMjd + yearsFromRef * 365.25,
      epochLabel: useMultiYearSlidingWindow
        ? `${wiseWindowLabel} · ${item.obs.identificador}`
        : item.epochLabel,
      wiseWindowLabel,
      yearsFromRef,
      observacion: item.obs,
      source,
    };
  });
}

export function angularDistanceArcsec(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number
): number {
  const cosDec = Math.cos(((dec1 + dec2) * 0.5 * Math.PI) / 180);
  const dRa = (ra1 - ra2) * cosDec;
  const dDec = dec1 - dec2;
  return Math.hypot(dRa, dDec) * 3600;
}

export function findMatchingChallengeTarget(
  raDeg: number,
  decDeg: number
): ChallengeTarget | null {
  for (const target of CHALLENGE_TARGETS) {
    if (angularDistanceArcsec(raDeg, decDeg, target.raDeg, target.decDeg) <= 120) {
      return target;
    }
  }
  return null;
}
