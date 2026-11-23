import {
  ChallengeTarget,
  formatDecDMS,
  formatRAHMS,
  ResolvedImageCoordsResponse,
} from "@/app/astronomy";
import { ColormapMode } from "@/app/components/SkyVideoCanvas";
import { SelectedSkySource } from "@/app/components/SpherexSpectrumPanel";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  suggestions?: string[];
}

export interface ChatVisorContext {
  audienceMode: "public" | "researcher";
  activeTarget: ChallengeTarget | null;
  activeRaDeg: number;
  activeDecDeg: number;
  fovArcsec: number;
  viewerMode: "canvas" | "fits-png" | "aladin";
  stackByDetector: boolean;
  showHistoricalCatalogOverlay: boolean;
  showGrid: boolean;
  colormap: ColormapMode;
  bandFilter: string;
  framesCount: number;
  selectedSource: SelectedSkySource | null;
  lastSolvedImage: {
    fileName: string;
    result: ResolvedImageCoordsResponse;
  } | null;
}

export interface ChatbotReply {
  text: string;
  suggestions: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\-./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(q: string, keywords: string[]): boolean {
  return keywords.some((kw) => q.includes(kw));
}

function countHits(q: string, keywords: string[]): number {
  return keywords.reduce((acc, kw) => (q.includes(kw) ? acc + 1 : acc), 0);
}

export function getInitialChatMessage(ctx: ChatVisorContext): ChatMessage {
  const isPublic = ctx.audienceMode === "public";
  const targetLabel = ctx.lastSolvedImage
    ? `la región de tu foto (${ctx.lastSolvedImage.fileName})`
    : ctx.activeTarget
    ? ctx.activeTarget.name
    : `${formatRAHMS(ctx.activeRaDeg)}, ${formatDecDMS(ctx.activeDecDeg)}`;

  return {
    id: "welcome",
    role: "assistant",
    content: isPublic
      ? `¡Hola! Soy tu guía de SPHEREx. Ahora mismo estamos mirando ${targetLabel}. Pregúntame con tus palabras cualquier cosa que veas en pantalla y no entiendas.`
      : `Asistente SPHEREx activo (${targetLabel} · FOV ${ctx.fovArcsec}"). Puedo explicarte conceptos astrofísicos, calibración SPHEREx (D1–D6 / LVF), WCS o los filtros activos.`,
    suggestions: getDefaultSuggestions(ctx),
  };
}

export function getDefaultSuggestions(ctx: ChatVisorContext): string[] {
  if (ctx.lastSolvedImage) {
    return [
      "¿Qué estoy viendo ahora?",
      "¿Cómo sacaste las coordenadas de mi foto?",
      "¿Qué significan RA, Dec y FOV?",
    ];
  }
  if (ctx.audienceMode === "public") {
    return [
      "¿Qué estoy viendo ahora?",
      "¿Por qué ese punto se mueve?",
      "¿Qué es el infrarrojo y SPHEREx?",
    ];
  }
  return [
    "Explica el objeto y los datos actuales",
    "¿Qué hacen los detectores D1–D6 y el espectro LVF?",
    "¿Para qué sirve Apilar D1–D6 y AllWISE / Gaia?",
  ];
}

function describeCurrentScene(ctx: ChatVisorContext): ChatbotReply {
  const raStr = formatRAHMS(ctx.activeRaDeg);
  const decStr = formatDecDMS(ctx.activeDecDeg);
  const isPublic = ctx.audienceMode === "public";

  const lines: string[] = [];

  if (ctx.lastSolvedImage) {
    const res = ctx.lastSolvedImage.result;
    lines.push(
      `Ahora estás explorando el trozo real de cielo extraído de **${ctx.lastSolvedImage.fileName}** mediante **${
        res.metodo === "fits-wcs" ? "cabecera FITS WCS" : "Astrometry.net"
      }**.`
    );
    lines.push(
      `• Coordenadas detectadas: **${raStr}, ${decStr}** (${res.ra_deg.toFixed(
        4
      )}°, ${res.dec_deg.toFixed(4)}°).`
    );
    if (res.objetos_en_campo.length > 0) {
      lines.push(
        `• Objetos catalogados en la imagen: ${res.objetos_en_campo.join(", ")}.`
      );
    }
    lines.push(
      ctx.framesCount > 0
        ? `• SPHEREx encontró **${ctx.framesCount}** observaciones/épocas en esta zona para comparar estrellas y brillo.`
        : "• Puedes ajustar el radio o pulsar en Pan-STARRS1 para ver también luz visible de esta región."
    );
  } else if (ctx.activeTarget) {
    const t = ctx.activeTarget;
    if (isPublic) {
      lines.push(`**${t.name}** — *${t.publicTitle}*`);
      lines.push(t.publicStory);
      lines.push(`Qué observar ahora: ${t.publicWhatToLookFor}`);
      lines.push(`Dato curioso: ${t.publicFunFact}`);
    } else {
      lines.push(`**${t.name}** (${t.categoryLabel}) en ${raStr}, ${decStr}.`);
      lines.push(t.description);
      const pmTotal = Math.hypot(t.pmRaMasYr, t.pmDecMasYr);
      if (t.category === "variable-star" && t.variabilityPeriodDays) {
        lines.push(
          `Variabilidad: período ~${t.variabilityPeriodDays} días, amplitud ~${t.variabilityAmplitudeMag} mag.`
        );
      } else if (pmTotal > 0) {
        lines.push(
          `Movimiento propio: μ_RA = ${t.pmRaMasYr} mas/año, μ_Dec = ${t.pmDecMasYr} mas/año (~${(
            pmTotal / 1000
          ).toFixed(2)}″/año).`
        );
      }
      if (t.companionSeparationArcsec) {
        lines.push(
          `Separación binaria aparente: ${t.companionSeparationArcsec}″.`
        );
      }
    }
  } else {
    lines.push(
      `Estás observando una región personalizada del cielo en **${raStr}, ${decStr}** con un campo de visión de **${ctx.fovArcsec}″** (${ctx.framesCount} fotogramas cargados).`
    );
  }

  if (ctx.selectedSource && !ctx.selectedSource.isPrimaryTarget) {
    lines.push(
      `Fuente seleccionada en el visor: **${ctx.selectedSource.label}** (${ctx.selectedSource.spectralType}).`
    );
  }

  const extras: string[] = [];
  if (ctx.stackByDetector) extras.push("Apilado D1–D6 activo");
  if (ctx.showHistoricalCatalogOverlay) extras.push("AllWISE / Gaia visible");
  if (extras.length > 0) {
    lines.push(`Estado del visor: ${extras.join(" · ")}.`);
  }

  return {
    text: lines.join("\n\n"),
    suggestions: [
      "¿Qué significan RA y Dec?",
      "¿Para qué sirven los filtros?",
      "¿Cómo funciona SPHEREx?",
    ],
  };
}

export function generateChatbotReply(
  rawInput: string,
  ctx: ChatVisorContext
): ChatbotReply {
  const q = normalize(rawInput);
  const isPublic = ctx.audienceMode === "public";

  if (!q) {
    return {
      text: "Escribe cualquier duda sobre el cielo, un botón del visor o un término que aparezca en pantalla.",
      suggestions: getDefaultSuggestions(ctx),
    };
  }

  // Saludo / ayuda general
  if (
    hasAny(q, ["hola", "buenas", "ayuda", "como funciona", "que puedes", "empezar"]) &&
    q.split(" ").length <= 6
  ) {
    return {
      text: isPublic
        ? "¡Hola! Puedo explicarte en lenguaje sencillo qué estrella estás viendo, por qué algunas parpadean o se mueven, qué es la luz infrarroja de SPHEREx o cómo subir una foto tuya del cielo para localizar sus estrellas."
        : "Puedo ayudarte a interpretar el objeto activo, las coordenadas ICRS (RA/Dec), los 6 detectores SPHEREx (D1–D6), el espectro LVF de 102 canales, los filtros históricos (AllWISE/Gaia) o el plate solving de imágenes.",
      suggestions: getDefaultSuggestions(ctx),
    };
  }

  // Qué estoy viendo ahora / objeto actual
  if (
    hasAny(q, [
      "que estoy viendo",
      "que es esto",
      "objeto actual",
      "estrella actual",
      "region actual",
      "esta imagen",
      "esta estrella",
      "explica el objeto",
      "donde estamos",
    ])
  ) {
    return describeCurrentScene(ctx);
  }

  // Puntúa categorías temáticas
  const topics: Array<{
    score: number;
    reply: () => ChatbotReply;
  }> = [
    {
      score: countHits(q, [
        "subir",
        "foto",
        "cargar imagen",
        "plate solving",
        "astrometry",
        "sacar coordenadas",
        "automaticamente",
      ]),
      reply: () => ({
        text: isPublic
          ? "**Subir una foto del cielo** evita tener que buscar números complicados. Al arrastrar tu imagen:\n\n1. Si es un archivo astronómico **FITS**, el sistema lee sus coordenadas internas al instante.\n2. Si es una foto **JPG o PNG** de estrellas, **Astrometry.net** analiza los triángulos que forman las estrellas para descubrir exactamente a qué punto del cielo apunta tu cámara.\n\nDespués, SPHEREx centra el visor ahí y te muestra todas las observaciones disponibles."
          : "El resolutor de imágenes admite dos rutas:\n\n• **FITS WCS local (`astropy.wcs`)**: lee ejes celestiales ICRS (`CRVAL`, `CRPIX`, `CD`/`CDELT`), escala de píxel y campo visual sin red externa.\n• **Astrometry.net (`nova.astrometry.net`)**: realiza *plate solving* ciego sobre fotografías JPG/PNG mediante asterismos estelares, devolviendo centro `(RA, Dec)`, `radius`, `pixscale` y objetos catalogados.",
        suggestions: [
          "¿Qué es un archivo FITS?",
          "¿Qué estoy viendo ahora?",
          "¿Qué son RA y Dec?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "coordenada",
        "ascension",
        "declinacion",
        "ra",
        "dec",
        "hms",
        "dms",
        "arcsec",
        "segundo de arco",
        "fov",
        "campo de vision",
        "grado",
      ]),
      reply: () => ({
        text: isPublic
          ? "Piensa en **RA** y **Dec** como el **GPS del cielo** (como la longitud y la latitud en la Tierra):\n\n• **RA (Ascensión Recta)**: indica el giro de este a oeste (se mide en horas `h m s` o en grados `0°–360°`).\n• **Dec (Declinación)**: indica altura hacia el norte (`+90°`) o hacia el sur (`-90°`).\n• **FOV / arcsec (segundos de arco)**: es el «zoom». La Luna llena mide unos `1.800\"` de ancho; ahora estás viendo un trocito de cielo de **" +
            `${ctx.fovArcsec}"**.\n\nRegión actual: **${formatRAHMS(
              ctx.activeRaDeg
            )}, ${formatDecDMS(ctx.activeDecDeg)}**.`
          : `Sistema ecuatorial ICRS actual: **RA ${formatRAHMS(
              ctx.activeRaDeg
            )}** (${ctx.activeRaDeg.toFixed(
              5
            )}°), **Dec ${formatDecDMS(ctx.activeDecDeg)}** (${ctx.activeDecDeg.toFixed(
              5
            )}°).\n\n• **1 hora de RA** = 15° en el ecuador celeste.\n• **1 grado** = 60 arcmin = **3.600 arcsec (″)**.\n• **FOV actual**: **${ctx.fovArcsec}″** (el radio de consulta envía un cono SIA en segundos de arco a IRSA).`,
        suggestions: [
          "¿Qué estoy viendo ahora?",
          "¿Cómo saco coordenadas desde una foto?",
          "¿Qué significa Rejilla WCS?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "mueve",
        "movimiento",
        "propio",
        "trayectoria",
        "desplaza",
        "salta",
        "mas/yr",
        "mas/ano",
        "epoca",
        "blink",
        "parpadeo",
        "cambia de sitio",
      ]),
      reply: () => ({
        text: isPublic
          ? "Aunque las estrellas parecen clavadas en el cielo, **todas se mueven por la galaxia**. Las que están muy cerca de la Tierra (como **WISE 0855** o la **Estrella de Barnard**) parecen correr mucho más rápido delante de las estrellas lejanas del fondo, igual que un árbol junto a la carretera pasa más rápido que las montañas del fondo.\n\nAl reproducir varias fotos tomadas en años distintos (*blink*), ves ese desplazamiento al instante."
          : "El **movimiento propio (μ)** es el desplazamiento angular aparente en el plano del cielo, expresado en **milisegundos de arco por año (mas/año)** o `arcsec/año`.\n\nAl comparar épocas históricas (WISE/NEOWISE 2010–2018 o Gaia DR3) con SPHEREx (2025+), objetos cercanos con alta velocidad tangencial como WISE 0855 (~8.15″/año) o Barnard (~10.39″/año) exhiben un desplazamiento medible frente a fuentes extragalácticas de fondo.",
        suggestions: [
          "¿Qué es una enana marrón?",
          "¿Qué hace el switch AllWISE / Gaia?",
          "¿Por qué otras estrellas parpadean?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "enana marron",
        "brown dwarf",
        "wise 0855",
        "epsilon indi",
        "barnard",
        "fallida",
        "helada",
        "binaria",
      ]),
      reply: () => ({
        text: isPublic
          ? "Una **enana marrón** es un astro intermedio entre un planeta gigante como Júpiter y una estrella normal: no tuvo suficiente masa para encender su núcleo con fuerza, así que es muy fría y tenue.\n\nPor eso apenas se ve con telescopios de luz normal, pero brilla suavemente en **infrarrojo** (calor), justo lo que captura SPHEREx."
          : "Las **enanas marrones (tipos espectrales L, T, Y)** tienen masas subestelares (~13–80 M_Jup) insuficientes para sostener la fusión estable de hidrógeno. Emiten casi toda su energía en el infrarrojo cercano y medio (1–5 µm), donde presentan bandas profundas de absorción de **H₂O, CH₄ y NH₃** observables en los detectores D2–D6 de SPHEREx.",
        suggestions: [
          "¿Qué es el infrarrojo y SPHEREx?",
          "¿Por qué se mueve respecto al fondo?",
          "¿Qué estoy viendo ahora?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "variable",
        "rw aurigae",
        "r draconis",
        "latido",
        "parpadea",
        "brillo",
        "flujo",
        "atenua",
        "mira",
        "t tauri",
        "variabilidad",
      ]),
      reply: () => ({
        text: isPublic
          ? "No todas las estrellas brillan siempre igual:\n\n• **Estrellas bebé** (como *RW Aurigae*): están rodeadas de nubes de polvo y roca que pasan por delante y tapan parte de su luz, haciéndolas parpadear.\n• **Estrellas gigantes ancianas** (como *R Draconis*): se hinchan y se encogen lentamente como un corazón que late cada varios meses."
          : "Las **estrellas variables** cambian su flujo aparente por causas intrínsecas (pulsación radial en gigantes Mira como **R Draconis**, ~245.6 d) o extrínsecas/circunestelares (ocultaciones por polvo en estrellas jóvenes T Tauri como **RW Aurigae**). El infrarrojo atraviesa mejor el polvo circunestelar que la luz óptica.",
        suggestions: [
          "¿Qué estoy viendo ahora?",
          "¿Cómo se mide el brillo (MJy/sr)?",
          "¿Para qué sirve Pan-STARRS1?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "spherex",
        "infrarrojo",
        "detector",
        "d1",
        "d2",
        "d3",
        "d4",
        "d5",
        "d6",
        "lvf",
        "espectro",
        "102",
        "micra",
        "um",
        "longitud de onda",
        "banda",
        "agua",
        "hielo",
      ]),
      reply: () => ({
        text: isPublic
          ? "**SPHEREx** es un telescopio espacial de la NASA que fotografía todo el cielo en **luz infrarroja** (un tipo de luz invisible para nuestros ojos que revela calor, polvo espacial y moléculas).\n\nEn lugar de sacar una sola foto, divide esa luz en **102 colores infrarrojos** usando **6 detectores (D1 a D6)**. Así los científicos saben de qué está hecho cada astro (por ejemplo, si hay hielo de agua o polvo)."
          : "**SPHEREx** emplea **6 detectores H2RG (D1–D6)** acoplados a filtros lineales variables (**LVF**, *Linear Variable Filters*) que cubren de **0.75 a 5.00 µm** en **102 canales espectrales**:\n\n• **D1–D4 (0.75–3.82 µm, R≈35–41)**: continuo estelar, bandas de H₂O/CH₄ y hielos (~3.0 µm).\n• **D5–D6 (3.83–5.00 µm, R≈112–128)**: emisión térmica, CO (4.67 µm) y CO₂ (4.26 µm).\n\nAl hacer clic en cualquier estrella del visor se inspecciona su espectro estimado en esos 102 canales.",
        suggestions: [
          "¿Para qué sirve Apilar D1–D6?",
          "¿Qué es Pan-STARRS1?",
          "¿Qué son FITS y MJy/sr?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "filtro",
        "switch",
        "reticula",
        "wcs",
        "rejilla",
        "allwise",
        "gaia",
        "apilar",
        "coadd",
        "panstarrs",
        "pan-starrs",
        "asinh",
        "contraste",
        "paleta",
        "diferencia",
        "suma",
        "ping-pong",
        "aladin",
      ]),
      reply: () => ({
        text:
          "Guía rápida de los controles y switches del visor:\n\n" +
          "• **Retícula**: marca el centro exacto de las coordenadas buscadas.\n" +
          "• **Rejilla WCS**: dibuja la cuadrícula celeste de RA y Dec sobre la imagen.\n" +
          "• **Trayectoria**: resalta el recorrido o variación del astro objetivo entre épocas.\n" +
          "• **AllWISE / Gaia**: superpone posiciones pasadas (2010–2018) para comparar cuánto se ha movido la estrella hasta SPHEREx.\n" +
          "• **Apilar D1–D6**: combina exposiciones de varios detectores para reducir el ruido y ver estrellas débiles con más nitidez.\n" +
          "• **Contraste (asinh)**: escala logarítmica suave que permite ver estrellas muy tenues sin quemar las brillantes.\n" +
          "• **Pan-STARRS1**: muestra el mismo trozo de cielo en luz visible óptica para compararlo con el infrarrojo.",
        suggestions: [
          "¿Qué es el movimiento propio?",
          "¿Qué es SPHEREx (D1–D6)?",
          "¿Qué estoy viendo ahora?",
        ],
      }),
    },
    {
      score: countHits(q, [
        "fits",
        "mef",
        "hdu",
        "mjy",
        "sr",
        "unidad",
        "calibracion",
        "flujo",
        "varianza",
      ]),
      reply: () => ({
        text: isPublic
          ? "**FITS** es el formato de fotografía científica que usa la NASA y los observatorios. A diferencia de un JPG normal, guarda medidas reales de luz en **MJy/sr** (cuánta energía llega desde cada píxel del cielo) junto con el «GPS» exacto (*WCS*) de dónde está cada estrella."
          : "• **MEF FITS**: archivo multi-extensión que agrupa flujo calibrado (`IMAGE`), mapa de calidad (`FLAGS`), varianza (`VARIANCE`), fondo zodiacal (`ZODI`), `EPSF` y tabla espectral `WCS-WAVE`.\n• **MJy/sr (Megajansky por estereorradián)**: unidad de brillo superficial espectral; permite medir tanto fuentes puntuales como emisión difusa.",
        suggestions: [
          "¿Cómo subo una foto para buscar coordenadas?",
          "¿Qué significan RA y Dec?",
          "¿Qué es SPHEREx?",
        ],
      }),
    },
  ];

  topics.sort((a, b) => b.score - a.score);
  if (topics[0] && topics[0].score > 0) {
    return topics[0].reply();
  }

  const fallbackCoord = `${formatRAHMS(ctx.activeRaDeg)}, ${formatDecDMS(
    ctx.activeDecDeg
  )}`;
  return {
    text: `Estoy conectado al visor en **${
      ctx.activeTarget?.name ?? fallbackCoord
    }** (${ctx.audienceMode === "public" ? "Paseo Estelar" : "Modo Investigador"}).\n\nNo he encontrado una coincidencia exacta para esa pregunta, pero puedo explicarte cualquier concepto del visor: el objeto que ves ahora, coordenadas (RA/Dec), detectores D1–D6, movimiento propio, estrellas variables, filtros o cómo subir una foto del cielo.`,
    suggestions: [
      "¿Qué estoy viendo ahora?",
      "¿Para qué sirven los filtros?",
      "¿Cómo funciona SPHEREx?",
    ],
  };
}
