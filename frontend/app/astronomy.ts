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

export function getFitsPngUrl(
  obs: Observacion,
  modo: "flujo" | "longitud_onda" = "flujo"
): string {
  if (modo === "flujo" && obs.url_imagen_png) return obs.url_imagen_png;
  return `/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
    obs.url_acceso
  )}&modo=${encodeURIComponent(modo)}`;
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
  observaciones: Observacion[];
}

export interface EstadoBackend {
  estado: string;
  proyecto: string;
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
  {
    id: "spherex-intro-cygnus",
    name: "Campo Tutorial SPHEREx (spherex_intro.md)",
    category: "high-proper-motion",
    categoryLabel: "Sección 5 · RA 304.6935° Dec +42.4437°",
    raInput: "20h18m46.442s",
    decInput: "+42d26m37.27s",
    raDeg: 304.693508808,
    decDeg: 42.4436872991,
    pmRaMasYr: -4200,
    pmDecMasYr: -2850,
    description:
      "Coordenadas de referencia del cuaderno oficial Introduction to SPHEREx Spectral Images (ra_deg = 304.693508808, dec_deg = 42.4436872991) con fuente en movimiento.",
    publicTitle: "Paseo por el Cisne en la Vía Láctea",
    publicSubtitle: "Un rincón repleto de estrellas en la constelación del Cisne",
    publicStory:
      "Esta región pertenece a la constelación del Cisne, por donde cruza la banda luminosa de nuestra Vía Láctea. Es una de las primeras zonas fotografiadas de prueba por el telescopio espacial SPHEREx.",
    publicWhatToLookFor:
      "Disfruta de un campo lleno de estrellas de distintas edades y observa la fuente central desplazándose suavemente.",
    publicFunFact:
      "Desde aquí el telescopio descompone la luz en 102 tonos infrarrojos distintos en cada paseo.",
  },
  {
    id: "spherex-2025w41",
    name: "SPHEREx 2025W41_2B_0509_2 (D1)",
    category: "high-proper-motion",
    categoryLabel: "Observación procesada · Detector 1",
    raInput: "08h14m40.84s",
    decInput: "+38d30m34.46s",
    raDeg: 123.670153,
    decDeg: 38.509573,
    pmRaMasYr: 4600,
    pmDecMasYr: -3100,
    description:
      "Observación SPHEREx Level 2 (2040 × 2040 px, MJy/sr) procesada en PNG (AsinhStretch) y FITS 2D con WCS para Aladin Lite v3.",
    publicTitle: "Fotografía original del telescopio SPHEREx",
    publicSubtitle: "Una captura real tomada desde el espacio en octubre de 2025",
    publicStory:
      "Esta es una fotografía real capturada directamente por la cámara número 1 del telescopio espacial SPHEREx en octubre de 2025, mirando hacia la constelación del Lince.",
    publicWhatToLookFor:
      "Puedes cambiar al botón «Mapa del cielo 360° (Aladin)» para ver esta fotografía real superpuesta exactamente sobre el mapa del universo.",
    publicFunFact:
      "Cada imagen completa del detector tiene más de 4 millones de píxeles sensibles al calor de las estrellas.",
  },
  {
    id: "local-fits",
    name: "Campo SPHEREx DR1 (FITS Local)",
    category: "high-proper-motion",
    categoryLabel: "Muestra data/ · 2025W18_1B_0074_2",
    raInput: "20h15m30.66s",
    decInput: "+40d32m56.25s",
    raDeg: 303.877766,
    decDeg: 40.548959,
    pmRaMasYr: -3800,
    pmDecMasYr: 3400,
    description:
      "Coordenadas CRVAL del archivo FITS local del equipo (level2_2025W18_1B_0074_2D1_spx_l2b-v27-2026-196.fits).",
    publicTitle: "Corazón de la nebulosa del Cisne",
    publicSubtitle: "Muestra guardada de la primera entrega de datos SPHEREx",
    publicStory:
      "Una ventana hacia una zona rica en nubes de gas y polvo interestelar donde nacen nuevas estrellas dentro de nuestra galaxia.",
    publicWhatToLookFor:
      "Observa el movimiento de la estrella central comparando el pasado y el presente.",
    publicFunFact:
      "La luz infrarroja atraviesa el polvo espacial como si fuera transparente, permitiéndonos ver estrellas ocultas.",
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

export function buildFallbackObservations(
  raDeg: number,
  decDeg: number,
  bandFilter: string
): Observacion[] {
  const epochs = [
    { week: "2025W18", collection: "spherex_dr1", band: "SPHEREx-D1 (0.75-1.11 um)" },
    { week: "2025W31", collection: "spherex_dr1", band: "SPHEREx-D2 (1.11-1.64 um)" },
    { week: "2025W44", collection: "spherex_dr1", band: "SPHEREx-D3 (1.64-2.42 um)" },
    { week: "2026W05", collection: "spherex_qr3", band: "SPHEREx-D4 (2.42-3.82 um)" },
    { week: "2026W18", collection: "spherex_qr3", band: "SPHEREx-D5 (3.82-4.42 um)" },
    { week: "2026W31", collection: "spherex_qr3", band: "SPHEREx-D6 (4.42-5.00 um)" },
    { week: "2026W44", collection: "spherex_qr3", band: "SPHEREx-D1 (0.75-1.11 um)" },
    { week: "2027W05", collection: "spherex_qr3", band: "SPHEREx-D2 (1.11-1.64 um)" },
  ];

  const selectedBand =
    bandFilter !== "Todas" ? bandFilter : null;

  return epochs.map((ep, idx) => {
    const band = selectedBand ?? ep.band;
    const detectorMatch = band.match(/D(\d)/);
    const detector = detectorMatch ? detectorMatch[1] : String((idx % 6) + 1);
    const obsId = `${ep.week}_1B_${String(74 + idx * 12).padStart(4, "0")}_${detector}`;
    return {
      identificador: obsId,
      ascension_recta: Number((raDeg + (idx - 3.5) * 0.0004).toFixed(6)),
      declinacion: Number((decDeg + ((idx % 3) - 1) * 0.0003).toFixed(6)),
      coleccion: ep.collection,
      banda_espectral: band,
      tipo_producto: "spectral_image_l2b",
      url_acceso: `https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/${ep.week}_1B/l2b-v27-2026-196/${detector}/level2_${obsId}D1_spx_l2b-v27-2026-196.fits`,
      tamano_estimado: 60157440,
      url_imagen_png: `/api/v1/observaciones/imagen?fits_url=${encodeURIComponent(
        `https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/${ep.week}_1B/l2b-v27-2026-196/${detector}/level2_${obsId}D1_spx_l2b-v27-2026-196.fits`
      )}`,
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
