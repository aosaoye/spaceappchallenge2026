"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Film,
  FlaskConical,
  Globe,
  Image as ImageIcon,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AladinSkyMap, {
  ensureAladinScriptLoaded,
} from "@/components/astronomy/AladinSkyMap";
import { tryParseViewParams } from "@/lib/astronomy/parse-view-params";
import {
  buildEpochFrames,
  CHALLENGE_TARGETS,
  ChallengeTarget,
  findMatchingChallengeTarget,
  formatDecDMS,
  formatRAHMS,
  getFitsPngUrl,
  Observacion,
  ObservacionesResponse,
  parseDeclination,
  parseRightAscension,
} from "../astronomy";
import CustomSelect from "./CustomSelect";
import FitsScientificInspector from "./FitsScientificInspector";
import SkyVideoCanvas, {
  ColormapMode,
  computeTargetFluxMultiplier,
  computeTargetOffsetArcsec,
  PlaybackMode,
} from "./SkyVideoCanvas";
import SpherexSpectrumPanel, {
  SelectedSkySource,
  SPHEREX_DETECTORS,
} from "./SpherexSpectrumPanel";
import ThemeToggle from "./ThemeToggle";

function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function FitsPngFrameView({
  observacion,
  epochLabel,
  onFallbackToCanvas,
}: {
  observacion: Observacion;
  epochLabel: string;
  onFallbackToCanvas: () => void;
}) {
  const [modoRender, setModoRender] = useState<"flujo" | "longitud_onda">(
    "flujo"
  );
  const pngUrl = getFitsPngUrl(observacion, modoRender);
  const [currentSrc, setCurrentSrc] = useState(pngUrl);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading"
  );

  function handleChangeModo(nextModo: "flujo" | "longitud_onda") {
    setModoRender(nextModo);
    setCurrentSrc(getFitsPngUrl(observacion, nextModo));
    setStatus("loading");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleChangeModo("flujo")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              modoRender === "flujo"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Flujo IMAGE (MJy/sr)</span>
          </button>
          <button
            type="button"
            onClick={() => handleChangeModo("longitud_onda")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              modoRender === "longitud_onda"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Waves className="h-3.5 w-3.5" />
            <span>Mapa λ LVF (WCS-WAVE)</span>
          </button>
        </div>
      </div>

      <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-lg border border-black/[.08] bg-black/[.02] p-3 dark:border-white/[.145] dark:bg-white/[.02] sm:min-h-[480px]">
        {status === "loading" && (
          <p className="absolute font-mono text-xs text-foreground/70">
            Descargando y convirtiendo FITS a PNG ({observacion.identificador})…
          </p>
        )}

        {status === "error" ? (
          <div className="max-w-md space-y-3 text-center">
            <p className="text-sm font-medium">
              No se pudo cargar la imagen PNG generada por el backend
            </p>
            <button
              type="button"
              onClick={onFallbackToCanvas}
              className="inline-flex h-8 items-center justify-center rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Volver al visor interactivo
            </button>
          </div>
        ) : (
          <Image
            src={currentSrc}
            alt={`SPHEREx ${observacion.identificador} (${epochLabel})`}
            width={1000}
            height={1000}
            unoptimized
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
            className={`max-h-[480px] w-auto rounded object-contain transition-opacity ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/70 font-mono">
        <span>
          {modoRender === "longitud_onda"
            ? "Mapa WCS espectral key='W' (WCS-WAVE · sip=None · longitud de onda por píxel)"
            : "Renderizado en backend: AsinhStretch · percentiles [1, 99.5] · MJy/sr"}
        </span>
        <a
          href={currentSrc}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-sans underline underline-offset-4 hover:opacity-75"
        >
          <span>Abrir PNG completo</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export default function WiseViewExplorer() {
  const initialTarget = CHALLENGE_TARGETS[0]; // WISE 0855

  // Audience mode: "public" (Paseo Estelar para todo público) vs "researcher" (Modo Investigador NASA)
  const [audienceMode, setAudienceMode] = useState<"public" | "researcher">(
    "public"
  );

  // Coordinate inputs (accepts HMS/DMS and decimal degrees)
  const [raInput, setRaInput] = useState(initialTarget.raInput);
  const [decInput, setDecInput] = useState(initialTarget.decInput);
  const [radiusInput, setRadiusInput] = useState("60");
  const [inputError, setInputError] = useState<string | null>(null);
  const [urlParamError, setUrlParamError] = useState<string | null>(null);
  const urlInitializedRef = useRef(false);

  // Active sky region
  const [activeRaDeg, setActiveRaDeg] = useState(initialTarget.raDeg);
  const [activeDecDeg, setActiveDecDeg] = useState(initialTarget.decDeg);
  const [activeTarget, setActiveTarget] = useState<ChallengeTarget | null>(
    initialTarget
  );

  // Backend & observation state
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    "Conectando con el backend para consultar observaciones SPHEREx en IRSA…"
  );
  const [rawObservations, setRawObservations] = useState<Observacion[]>([]);
  const [dataSource, setDataSource] = useState<"irsa" | "fallback">("irsa");

  // Filter & image display controls
  const [viewerMode, setViewerMode] = useState<"canvas" | "fits-png" | "aladin">(
    "canvas"
  );
  const [view360, setView360] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("Todas");
  const [bandFilter, setBandFilter] = useState("Todas");
  const [colormap, setColormap] = useState<ColormapMode>("wiseview-inverted");
  const [fovArcsec, setFovArcsec] = useState(60);
  const [stretchGain, setStretchGain] = useState(1.2);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showTargetOverlay, setShowTargetOverlay] = useState(true);
  const [showHistoricalCatalogOverlay, setShowHistoricalCatalogOverlay] =
    useState(true);
  const [stackByDetector, setStackByDetector] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [customSelectedSource, setCustomSelectedSource] =
    useState<SelectedSkySource | null>(null);

  // Video / Blink playback controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [fps, setFps] = useState(4);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("ping-pong");
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const pingPongDirRef = useRef<1 | -1>(1);
  const preloaderWorkerRef = useRef<Worker | null>(null);

  const liveParsedRa = useMemo(() => parseRightAscension(raInput), [raInput]);
  const liveParsedDec = useMemo(() => parseDeclination(decInput), [decInput]);

  // Distinct collections & spectral bands available in current results
  const availableCollections = useMemo(() => {
    const set = new Set(rawObservations.map((o) => o.coleccion).filter(Boolean));
    return ["Todas", ...Array.from(set)];
  }, [rawObservations]);

  const availableBands = useMemo(() => {
    const set = new Set(
      rawObservations.map((o) => o.banda_espectral).filter(Boolean)
    );
    return ["Todas", ...Array.from(set)];
  }, [rawObservations]);

  const detectorCounts = useMemo(() => {
    const counts: Record<string, number> = {
      D1: 0,
      D2: 0,
      D3: 0,
      D4: 0,
      D5: 0,
      D6: 0,
    };
    for (const obs of rawObservations) {
      const m =
        obs.banda_espectral.match(/D([1-6])/i) ||
        obs.identificador.match(/_([1-6])(?:D|$)/i);
      if (m) {
        const key = `D${m[1]}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [rawObservations]);

  const filteredObservations = useMemo(() => {
    return rawObservations.filter((obs) => {
      if (collectionFilter !== "Todas" && obs.coleccion !== collectionFilter) {
        return false;
      }
      if (bandFilter !== "Todas" && obs.banda_espectral !== bandFilter) {
        return false;
      }
      return true;
    });
  }, [rawObservations, collectionFilter, bandFilter]);

  const frames = useMemo(
    () => buildEpochFrames(filteredObservations, dataSource),
    [filteredObservations, dataSource]
  );

  const safeFrameIndex =
    frames.length === 0 ? 0 : Math.min(currentFrameIndex, frames.length - 1);

  // Sincronizar paleta del visor con el cambio de tema claro/oscuro
  useEffect(() => {
    function handleThemeEvent(e: Event) {
      const custom = e as CustomEvent<"light" | "dark">;
      if (custom.detail === "dark") {
        setColormap("grayscale");
      } else if (custom.detail === "light") {
        setColormap("wiseview-inverted");
      }
    }
    window.addEventListener("spherex-theme-change", handleThemeEvent);
    return () => {
      window.removeEventListener("spherex-theme-change", handleThemeEvent);
    };
  }, []);

  // Video timer loop
  useEffect(() => {
    if (!isPlaying || frames.length <= 1) return;
    const intervalMs = Math.max(80, Math.round(1000 / fps));
    const timer = window.setInterval(() => {
      setCurrentFrameIndex((prev) => {
        if (playbackMode === "ping-pong") {
          let next = prev + pingPongDirRef.current;
          if (next >= frames.length) {
            pingPongDirRef.current = -1;
            next = Math.max(0, frames.length - 2);
          } else if (next < 0) {
            pingPongDirRef.current = 1;
            next = Math.min(frames.length - 1, 1);
          }
          return next;
        }
        return (prev + 1) % frames.length;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, fps, playbackMode, frames.length]);

  // Atajos de teclado (Flechas ← / → para cambiar de época y Espacio para Play/Pause)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (e.key === "ArrowLeft" && frames.length > 1) {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentFrameIndex(
          (prev) => (prev - 1 + frames.length) % frames.length
        );
      } else if (e.key === "ArrowRight" && frames.length > 1) {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentFrameIndex((prev) => (prev + 1) % frames.length);
      } else if (e.key === " " && frames.length > 1) {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [frames.length]);

  const fetchRegionObservations = useCallback(
    async (
      raDeg: number,
      decDeg: number,
      radiusArcsec: number,
      presetTarget: ChallengeTarget | null,
      preserveError = false
    ) => {
      setLoading(true);
      if (!preserveError) {
        setInputError(null);
        setUrlParamError(null);
      }
      setActiveRaDeg(raDeg);
      setActiveDecDeg(decDeg);
      setActiveTarget(presetTarget ?? findMatchingChallengeTarget(raDeg, decDeg));
      setCollectionFilter("Todas");
      setBandFilter("Todas");
      setCurrentFrameIndex(0);
      setIsPlaying(true);
      pingPongDirRef.current = 1;
      setStatusMessage(
        `Consultando productos SPHEREx en IRSA para RA ${raDeg.toFixed(
          4
        )}°, Dec ${decDeg.toFixed(4)}°…`
      );

      try {
        const params = new URLSearchParams({
          ascension_recta: raDeg.toFixed(6),
          declinacion: decDeg.toFixed(6),
          radio: String(radiusArcsec),
        });
        const response = await fetch(`/api/v1/observaciones?${params.toString()}`);

        if (!response.ok) {
          let errDetail = `HTTP ${response.status}`;
          try {
            const errJson = await response.json();
            if (errJson?.detail) errDetail = String(errJson.detail);
          } catch {
            // ignorar si no es JSON
          }
          throw new Error(errDetail);
        }

        const payload: ObservacionesResponse = await response.json();
        const obsList = Array.isArray(payload.observaciones)
          ? payload.observaciones
          : [];
        setRawObservations(obsList);
        setDataSource("irsa");
        if (obsList.length > 0) {
          setStatusMessage(
            `${payload.total ?? obsList.length} observaciones reales cargadas desde el backend para ${formatRAHMS(
              raDeg
            )}, ${formatDecDMS(decDeg)}.`
          );
        } else {
          setStatusMessage(
            `El backend devolvió 0 observaciones en IRSA para ${formatRAHMS(
              raDeg
            )}, ${formatDecDMS(decDeg)}.`
          );
        }
      } catch (err) {
        setRawObservations([]);
        setStatusMessage(
          err instanceof Error
            ? `Error al consultar el backend: ${err.message}`
            : "Error al consultar el backend de observaciones."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Precarga multihilo con Web Worker en segundo plano para FITS, PNG y Aladin Lite
  useEffect(() => {
    ensureAladinScriptLoaded().catch(() => {});

    if (typeof Worker !== "undefined") {
      try {
        const worker = new Worker("/spherex-preloader.worker.js");
        preloaderWorkerRef.current = worker;
        worker.postMessage({
          urls: [
            "/aladin.js",
            "/processed/2025W41_2B_0509_2_D1_aladin_fast.fits",
            "/processed/2025W41_2B_0509_2_D1_preview.png",
            "/processed/2025W41_2B_0509_2_D1_wavelength.png",
          ],
        });
        return () => {
          worker.terminate();
          preloaderWorkerRef.current = null;
        };
      } catch {
        // Si el entorno restringe Workers, continuar normalmente
      }
    }
  }, []);

  // Leer parámetros de la URL (?ra=08h55m10.83s&dec=-07d14m42.5s&fov=0.1) al cargar
  useEffect(() => {
    let cancelled = false;
    async function init() {
      let startRa = initialTarget.raDeg;
      let startDec = initialTarget.decDeg;
      let startTarget: ChallengeTarget | null = initialTarget;
      let startRadius = 60;

      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const modeParam = params.get("mode");
        const audienceParam = params.get("audience");

        if (audienceParam === "researcher" || audienceParam === "public") {
          setAudienceMode(audienceParam);
        }

        const { hasUrlParams, view, error } = tryParseViewParams(
          window.location.search
        );

        if (hasUrlParams && error) {
          setUrlParamError(error);
          setInputError(`Parámetros URL inválidos: ${error}`);
        } else if (view) {
          setUrlParamError(null);
          startRa = view.ra;
          startDec = view.dec;
          startTarget = findMatchingChallengeTarget(view.ra, view.dec);
          setRaInput(view.raRaw);
          setDecInput(view.decRaw);

          // Si fov <= 2.5 se interpreta en grados (ej. fov=0.0250° = 90"); si es mayor, en arcsec
          const arcsec =
            view.fov <= 2.5
              ? Math.round(view.fov * 3600)
              : Math.round(view.fov);
          const clamped = Math.max(15, Math.min(240, arcsec));
          setFovArcsec(clamped);
          startRadius = Math.max(15, Math.min(360, arcsec));
        }

        if (
          modeParam === "aladin" ||
          modeParam === "fits-png" ||
          modeParam === "canvas"
        ) {
          setViewerMode(modeParam);
        }
      }

      if (!cancelled) {
        await fetchRegionObservations(
          startRa,
          startDec,
          startRadius,
          startTarget,
          true
        );
        urlInitializedRef.current = true;
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [fetchRegionObservations, initialTarget]);

  // Sincronizar la URL con ?ra=...&dec=...&fov=... para compartir descubrimientos
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlInitializedRef.current || urlParamError) return;
    const raStr = formatRAHMS(activeRaDeg);
    const decStr = formatDecDMS(activeDecDeg);
    const fovDeg = (fovArcsec / 3600).toFixed(4);
    const nextSearch = `?ra=${encodeURIComponent(raStr)}&dec=${encodeURIComponent(
      decStr
    )}&fov=${fovDeg}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch}`
    );
  }, [activeRaDeg, activeDecDeg, fovArcsec, urlParamError]);

  function handleShareDiscoveryUrl() {
    if (typeof window === "undefined") return;
    const raStr = formatRAHMS(activeRaDeg);
    const decStr = formatDecDMS(activeDecDeg);
    const fovDeg = (fovArcsec / 3600).toFixed(4);
    const shareUrl = `${window.location.origin}${window.location.pathname}?ra=${encodeURIComponent(
      raStr
    )}&dec=${encodeURIComponent(decStr)}&fov=${fovDeg}`;
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    setCopiedShareUrl(true);
    window.setTimeout(() => setCopiedShareUrl(false), 2200);
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const raDeg = parseRightAscension(raInput);
    const decDeg = parseDeclination(decInput);
    const radius = Number.parseFloat(radiusInput);

    if (raDeg === null) {
      setInputError(
        "Ascensión recta no válida. Usa grados (0–360) o formato HMS como 08h55m10.831s."
      );
      return;
    }
    if (decDeg === null) {
      setInputError(
        "Declinación no válida. Usa grados (-90 a +90) o formato DMS como -7d14m42.53s."
      );
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0 || radius > 3600) {
      setInputError("El radio debe estar entre 1 y 3600 segundos de arco.");
      return;
    }

    fetchRegionObservations(raDeg, decDeg, radius, null);
  }

  function handleSelectPreset(target: ChallengeTarget) {
    setRaInput(target.raInput);
    setDecInput(target.decInput);
    setCustomSelectedSource(null);
    setIsPlaying(true);
    setFovArcsec(target.category === "binary-brown-dwarf" ? 80 : 90);
    fetchRegionObservations(
      target.raDeg,
      target.decDeg,
      Number.parseFloat(radiusInput) || 60,
      target
    );
  }

  const publicTourTargets = useMemo(() => CHALLENGE_TARGETS.slice(0, 5), []);
  const activeTourIndex = useMemo(() => {
    if (!activeTarget) return 0;
    const idx = publicTourTargets.findIndex((t) => t.id === activeTarget.id);
    return idx >= 0 ? idx : 0;
  }, [activeTarget, publicTourTargets]);

  function handleStepPublicTour(delta: -1 | 1) {
    const nextIdx =
      (activeTourIndex + delta + publicTourTargets.length) %
      publicTourTargets.length;
    handleSelectPreset(publicTourTargets[nextIdx]);
  }

  const currentFrame = frames[safeFrameIndex];
  const inspectedObservacion =
    (isPlaying ? frames[0]?.observacion : currentFrame?.observacion) ??
    currentFrame?.observacion;
  const midYears =
    frames.length > 0
      ? frames[Math.floor((frames.length - 1) / 2)].yearsFromRef
      : 0;
  const currentOffset = computeTargetOffsetArcsec(
    activeTarget,
    currentFrame,
    midYears
  );
  const currentFluxMult = computeTargetFluxMultiplier(
    activeTarget,
    currentFrame
  );

  const effectiveSelectedSource: SelectedSkySource = useMemo(() => {
    if (customSelectedSource) return customSelectedSource;
    return {
      id: activeTarget?.id ?? "primary-center",
      label: activeTarget?.name ?? "Objeto central SPHEREx",
      raDeg: activeRaDeg,
      decDeg: activeDecDeg,
      dRaArcsec: currentOffset.dRaArcsec,
      dDecArcsec: currentOffset.dDecArcsec,
      isPrimaryTarget: true,
      spectralSlope: 0,
      baseFlux: 2.8,
      spectralType: activeTarget?.categoryLabel ?? "Fuente puntual infrarroja",
    };
  }, [
    customSelectedSource,
    activeTarget,
    activeRaDeg,
    activeDecDeg,
    currentOffset.dRaArcsec,
    currentOffset.dDecArcsec,
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="border-b border-black/[.08] dark:border-white/[.145]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Telescope className="h-4 w-4" />
              <span className="text-sm font-semibold tracking-tight">
                SPHEREx Explorer
              </span>
            </div>

            {/* Selector principal de público: Paseo Estelar (Todo público) vs Modo Investigador (NASA) */}
            <div
              role="group"
              aria-label="Modo de experiencia"
              className="inline-flex items-center rounded-full border border-black/[.1] bg-black/[.03] p-0.5 dark:border-white/[.16] dark:bg-white/[.05]"
            >
              <button
                type="button"
                onClick={() => setAudienceMode("public")}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                  audienceMode === "public"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-foreground/75 hover:text-foreground"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Paseo Estelar (Para todos)</span>
              </button>
              <button
                type="button"
                onClick={() => setAudienceMode("researcher")}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                  audienceMode === "researcher"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-foreground/75 hover:text-foreground"
                }`}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                <span>Modo Investigador (NASA)</span>
              </button>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleShareDiscoveryUrl}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              title="Copiar URL con ?ra=...&dec=...&fov=... para compartir este rincón del cielo"
            >
              {copiedShareUrl ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>¡Enlace copiado!</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  <span>
                    {audienceMode === "public"
                      ? "Compartir esta estrella"
                      : "Compartir enlace (?ra=&dec=&fov=)"}
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setView360((prev) => !prev);
                setViewerMode("canvas");
              }}
              className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                view360
                  ? "bg-foreground text-background shadow-sm"
                  : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              }`}
              title="Alternar Mapa del cielo 360° interactivo (React Three Fiber)"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>
                {view360 ? "Vista 360° activa" : "Mapa del cielo 360°"}
              </span>
            </button>
            {audienceMode === "researcher" && (
              <Link
                href={`/astronomy?ra=${encodeURIComponent(
                  formatRAHMS(activeRaDeg)
                )}&dec=${encodeURIComponent(formatDecDMS(activeDecDeg))}&fov=${(
                  fovArcsec / 3600
                ).toFixed(4)}`}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Aladin Lite</span>
              </Link>
            )}
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Aviso explícito si la URL contenía coordenadas inválidas */}
      {urlParamError && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-400"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>Coordenadas en la URL no válidas:</strong>{" "}
                {urlParamError}. Se ha cargado un rincón seguro del cielo por
                defecto para que el visor no falle.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setUrlParamError(null)}
              className="shrink-0 rounded-full border border-red-500/30 px-2.5 py-1 font-medium hover:bg-red-500/10"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {audienceMode === "public" ? (
        /* Modo Paseo Estelar: el visor ocupa todo el viewport (100vh) sin ruido lateral */
        <div className="relative h-[calc(100vh-53px)] w-full overflow-hidden">
          {frames.length > 0 && currentFrame && (
            <SkyVideoCanvas
              key={`public-${activeRaDeg.toFixed(6)}:${activeDecDeg.toFixed(6)}`}
              centerRaDeg={activeRaDeg}
              centerDecDeg={activeDecDeg}
              frames={frames}
              currentFrameIndex={safeFrameIndex}
              referenceFrameIndex={0}
              activeTarget={activeTarget}
              fovArcsec={fovArcsec}
              stretchGain={stretchGain}
              colormap={colormap}
              playbackMode={playbackMode}
              showCrosshair={showCrosshair}
              showGrid={showGrid}
              showTargetOverlay={showTargetOverlay}
              showHistoricalCatalogOverlay={showHistoricalCatalogOverlay}
              stackByDetector={stackByDetector}
              selectedSource={effectiveSelectedSource}
              onSelectSkySource={(src) => setCustomSelectedSource(src)}
              onZoomChange={setFovArcsec}
              fullViewport
              view360={view360}
            />
          )}

          {/* Barra flotante simplificada con iconos heredados de CustomSelect */}
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-black/[.12] bg-background/90 px-3 py-2 shadow-lg backdrop-blur-md dark:border-white/[.18]">
              {/* 1. Selector de muestra (solo el nombre de la muestra, sin subtítulos ni desbordamiento) */}
              <div className="w-52 sm:w-64">
                <CustomSelect
                  id="public-star-select"
                  value={activeTarget?.id ?? ""}
                  placeholder="Elegir muestra"
                  dropUp
                  panelClassName="left-0 w-72 sm:w-80"
                  options={CHALLENGE_TARGETS.map((target) => ({
                    value: target.id,
                    label: target.name,
                  }))}
                  onChange={(val) => {
                    const chosen = CHALLENGE_TARGETS.find((t) => t.id === val);
                    if (chosen) {
                      handleSelectPreset(chosen);
                    }
                  }}
                />
              </div>

              {/* 2. Desplegable Zoom y Contraste simplificado con icono (hereda de CustomSelect) */}
              <CustomSelect
                id="public-zoom-contrast-select"
                title="Zoom y contraste"
                icon={<ZoomIn className="h-4 w-4" />}
                iconOnly
                dropUp
                panelClassName="left-1/2 -translate-x-1/2 w-72 sm:w-80"
              >
                <div className="space-y-3.5">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="public-zoom-slider"
                        className="font-medium"
                      >
                        Zoom · Campo de visión (FOV)
                      </label>
                      <span className="font-mono text-foreground/70">
                        {(240 / fovArcsec).toFixed(1)}× ({fovArcsec}&quot;)
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <ZoomOut className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                      <input
                        id="public-zoom-slider"
                        type="range"
                        min={15}
                        max={240}
                        step={5}
                        value={255 - fovArcsec}
                        onChange={(e) => {
                          const inverted = Number.parseInt(e.target.value, 10);
                          setFovArcsec(
                            Math.max(15, Math.min(240, 255 - inverted))
                          );
                        }}
                        className="w-full cursor-pointer accent-foreground"
                      />
                      <ZoomIn className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="public-stretch-range"
                        className="font-medium"
                      >
                        Contraste (asinh)
                      </label>
                      <span className="font-mono text-foreground/70">
                        {stretchGain.toFixed(1)}×
                      </span>
                    </div>
                    <input
                      id="public-stretch-range"
                      type="range"
                      min={0.4}
                      max={4.0}
                      step={0.1}
                      value={stretchGain}
                      onChange={(e) =>
                        setStretchGain(Number.parseFloat(e.target.value))
                      }
                      className="mt-1.5 w-full cursor-pointer accent-foreground"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setFovArcsec(
                        activeTarget?.category === "binary-brown-dwarf"
                          ? 80
                          : 90
                      );
                      setStretchGain(1.2);
                    }}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-4 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Restablecer zoom y contraste</span>
                  </button>
                </div>
              </CustomSelect>

              {/* 3. Desplegable Filtros y ajustes simplificado con icono (hereda de CustomSelect) */}
              <CustomSelect
                id="public-filters-select"
                title="Filtros y ajustes de imagen"
                icon={<SlidersHorizontal className="h-4 w-4" />}
                iconOnly
                dropUp
                panelClassName="left-1/2 -translate-x-1/2 w-72 sm:w-80"
              >
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="public-collection-select"
                      className="mb-1 block text-xs font-medium text-foreground/80"
                    >
                      Colección SPHEREx
                    </label>
                    <CustomSelect
                      id="public-collection-select"
                      value={collectionFilter}
                      options={availableCollections.map((col) => ({
                        value: col,
                        label: col,
                      }))}
                      onChange={(val) => {
                        setCollectionFilter(val);
                        setCurrentFrameIndex(0);
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="public-band-select"
                      className="mb-1 block text-xs font-medium text-foreground/80"
                    >
                      Banda espectral
                    </label>
                    <CustomSelect
                      id="public-band-select"
                      value={bandFilter}
                      options={availableBands.map((band) => ({
                        value: band,
                        label: band,
                      }))}
                      onChange={(val) => {
                        setBandFilter(val);
                        setCurrentFrameIndex(0);
                      }}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="public-colormap-select"
                      className="mb-1 block text-xs font-medium text-foreground/80"
                    >
                      Paleta de color
                    </label>
                    <CustomSelect
                      id="public-colormap-select"
                      value={colormap}
                      options={[
                        {
                          value: "wiseview-inverted",
                          label: "Invertido (Alto contraste)",
                        },
                        { value: "grayscale", label: "Escala de grises" },
                        { value: "infrared", label: "Infrarrojo térmico" },
                      ]}
                      onChange={(val) => setColormap(val as ColormapMode)}
                    />
                  </div>

                  <div className="space-y-2 border-t border-black/[.08] pt-2.5 text-xs dark:border-white/[.145]">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={showCrosshair}
                        onChange={(e) => setShowCrosshair(e.target.checked)}
                      />
                      <span>Retícula central</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={(e) => setShowGrid(e.target.checked)}
                      />
                      <span>Rejilla WCS (RA / Dec)</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={showTargetOverlay}
                        onChange={(e) => setShowTargetOverlay(e.target.checked)}
                      />
                      <span>Resaltar trayectoria / variabilidad</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={showHistoricalCatalogOverlay}
                        onChange={(e) =>
                          setShowHistoricalCatalogOverlay(e.target.checked)
                        }
                      />
                      <span>Comparar con AllWISE (2010) y Gaia DR3</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={stackByDetector}
                        onChange={(e) => setStackByDetector(e.target.checked)}
                      />
                      <span>Apilar por detector (Coadd D1–D6)</span>
                    </label>
                  </div>
                </div>
              </CustomSelect>

              {/* 4. Desplegable Detectores D1–D6 y nitidez simplificado con icono (hereda de CustomSelect) */}
              <CustomSelect
                id="public-detectors-select"
                value={bandFilter}
                title="Detectores (D1–D6) y nitidez"
                icon={<Waves className="h-4 w-4" />}
                iconOnly
                dropUp
                panelClassName="right-0 w-72"
                headerContent={
                  <button
                    type="button"
                    onClick={() => setStackByDetector((prev) => !prev)}
                    className={`inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                      stackByDetector
                        ? "bg-foreground text-background"
                        : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>
                      {stackByDetector
                        ? "Nitidez mejorada activa"
                        : "Mejorar nitidez (Apilar)"}
                    </span>
                  </button>
                }
                options={[
                  {
                    value: "Todas",
                    label: "6 Detectores (102 bandas)",
                  },
                  ...SPHEREX_DETECTORS.map((det) => ({
                    value: det.name,
                    label: `${det.code} (${det.minUm}–${det.maxUm} µm)`,
                    badge: `${detectorCounts[det.code] || 1} exp`,
                    colorDot: det.color,
                  })),
                ]}
                onChange={(val) => {
                  setBandFilter(val);
                  setCurrentFrameIndex(0);
                }}
              />

              <div className="mx-0.5 h-5 w-px bg-black/[.1] dark:bg-white/[.16]" />

              {/* Controles de reproducción y paseo */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStepPublicTour(-1)}
                  aria-label="Estrella anterior"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[.1] bg-background transition-colors hover:bg-[#f2f2f2] dark:border-white/[.16] dark:hover:bg-[#1a1a1a]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsPlaying((p) => !p)}
                  aria-label={isPlaying ? "Pausar" : "Reproducir"}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleStepPublicTour(1)}
                  aria-label="Siguiente estrella"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[.1] bg-background transition-colors hover:bg-[#f2f2f2] dark:border-white/[.16] dark:hover:bg-[#1a1a1a]"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* FAB (Floating Action Button) de Coordenadas del cielo heredado de CustomSelect */}
          <div className="pointer-events-auto absolute bottom-5 right-5 z-20">
            <CustomSelect
              id="public-coordinates-fab"
              title="Coordenadas del cielo"
              icon={<Compass className="h-5 w-5" />}
              iconOnly
              triggerClassName="h-12 w-12 shadow-xl border-black/[.14] bg-background/95 backdrop-blur-md dark:border-white/[.22]"
              dropUp
              panelClassName="right-0 w-80"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-foreground/80" />
                  <h2 className="text-sm font-semibold">
                    Coordenadas del cielo
                  </h2>
                </div>
                <p className="mt-1 text-xs text-foreground/60">
                  Introduce RA y Dec en grados decimales o formato HMS/DMS.
                </p>

                <form onSubmit={handleSearchSubmit} className="mt-3 space-y-3">
                  <div>
                    <label
                      htmlFor="public-ra-input"
                      className="block text-xs font-medium text-foreground/80"
                    >
                      Ascensión recta (RA)
                    </label>
                    <input
                      id="public-ra-input"
                      type="text"
                      value={raInput}
                      onChange={(e) => setRaInput(e.target.value)}
                      placeholder="08h55m10.831s o 133.7951"
                      className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                    />
                    {liveParsedRa !== null && (
                      <p className="mt-1 pl-3 font-mono text-[11px] text-foreground/60">
                        = {liveParsedRa.toFixed(6)}° ({formatRAHMS(liveParsedRa)}
                        )
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="public-dec-input"
                      className="block text-xs font-medium text-foreground/80"
                    >
                      Declinación (Dec)
                    </label>
                    <input
                      id="public-dec-input"
                      type="text"
                      value={decInput}
                      onChange={(e) => setDecInput(e.target.value)}
                      placeholder="-7d14m42.53s o -7.2451"
                      className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                    />
                    {liveParsedDec !== null && (
                      <p className="mt-1 pl-3 font-mono text-[11px] text-foreground/60">
                        = {liveParsedDec.toFixed(6)}° (
                        {formatDecDMS(liveParsedDec)})
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="public-radius-input"
                      className="block text-xs font-medium text-foreground/80"
                    >
                      Radio de consulta (arcsec)
                    </label>
                    <input
                      id="public-radius-input"
                      type="number"
                      min={1}
                      max={3600}
                      step={1}
                      value={radiusInput}
                      onChange={(e) => setRadiusInput(e.target.value)}
                      className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                    />
                  </div>

                  {inputError && (
                    <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                      {inputError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
                  >
                    <Search className="h-4 w-4" />
                    <span>
                      {loading
                        ? "Consultando SPHEREx…"
                        : "Cargar observaciones"}
                    </span>
                  </button>
                </form>
              </div>
            </CustomSelect>
          </div>
        </div>
      ) : (
        /* Main Workspace (Modo Investigador NASA intacto) */
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Left Control Panel */}
          <aside className="space-y-6">
            {/* Coordinate Search Form */}
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-foreground/80" />
                <h2 className="text-sm font-semibold">Coordenadas del cielo</h2>
              </div>
              <p className="mt-1 text-xs text-foreground/60">
                Introduce RA y Dec en grados decimales o formato HMS/DMS.
              </p>

              <form onSubmit={handleSearchSubmit} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="ra-input"
                  className="block text-xs font-medium text-foreground/80"
                >
                  Ascensión recta (RA)
                </label>
                <input
                  id="ra-input"
                  type="text"
                  value={raInput}
                  onChange={(e) => setRaInput(e.target.value)}
                  placeholder="08h55m10.831s o 133.7951"
                  className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                />
                {liveParsedRa !== null && (
                  <p className="mt-1 pl-3 font-mono text-[11px] text-foreground/60">
                    = {liveParsedRa.toFixed(6)}° ({formatRAHMS(liveParsedRa)})
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="dec-input"
                  className="block text-xs font-medium text-foreground/80"
                >
                  Declinación (Dec)
                </label>
                <input
                  id="dec-input"
                  type="text"
                  value={decInput}
                  onChange={(e) => setDecInput(e.target.value)}
                  placeholder="-7d14m42.53s o -7.2451"
                  className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                />
                {liveParsedDec !== null && (
                  <p className="mt-1 pl-3 font-mono text-[11px] text-foreground/60">
                    = {liveParsedDec.toFixed(6)}° ({formatDecDMS(liveParsedDec)})
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="radius-input"
                  className="block text-xs font-medium text-foreground/80"
                >
                  Radio de consulta (arcsec)
                </label>
                <input
                  id="radius-input"
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  value={radiusInput}
                  onChange={(e) => setRadiusInput(e.target.value)}
                  className="mt-1 h-10 w-full rounded-full border border-black/[.08] bg-background px-4 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
                />
              </div>

              {inputError && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {inputError}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
              >
                <Search className="h-4 w-4" />
                <span>
                  {loading ? "Consultando SPHEREx…" : "Cargar observaciones"}
                </span>
              </button>
            </form>
          </section>

          {/* Mandatory Challenge Targets as Select + Custom Zoom Sliders */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Objetos de prueba</h2>
            </div>
            <p className="mt-1 text-xs text-foreground/60">
              Casos de movimiento rápido, binarias y estrellas variables.
            </p>

            <div className="mt-3">
              <label htmlFor="target-preset-select" className="sr-only">
                Seleccionar objeto de prueba
              </label>
              <CustomSelect
                id="target-preset-select"
                value={activeTarget?.id ?? ""}
                placeholder="Coordenadas personalizadas"
                options={CHALLENGE_TARGETS.map((target) => ({
                  value: target.id,
                  label: target.name,
                }))}
                onChange={(val) => {
                  const chosen = CHALLENGE_TARGETS.find((t) => t.id === val);
                  if (chosen) {
                    handleSelectPreset(chosen);
                  }
                }}
              />

              {activeTarget && (
                <div className="mt-2 flex items-center justify-between gap-2 px-2 text-[11px] text-foreground/70">
                  <span>{activeTarget.categoryLabel}</span>
                  <span className="font-mono">
                    {activeTarget.raInput} · {activeTarget.decInput}
                  </span>
                </div>
              )}
            </div>

            {/* Custom Zoom & Contrast Sliders below the Objects Select */}
            <div className="mt-4 space-y-3 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="zoom-slider" className="font-medium">
                    Zoom · Campo de visión (FOV)
                  </label>
                  <span className="font-mono text-foreground/70">
                    {(240 / fovArcsec).toFixed(1)}× ({fovArcsec}&quot;)
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <ZoomOut className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                  <input
                    id="zoom-slider"
                    type="range"
                    min={15}
                    max={240}
                    step={5}
                    value={255 - fovArcsec}
                    onChange={(e) => {
                      const inverted = Number.parseInt(e.target.value, 10);
                      setFovArcsec(Math.max(15, Math.min(240, 255 - inverted)));
                    }}
                    className="w-full cursor-pointer accent-foreground"
                  />
                  <ZoomIn className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="stretch-range" className="font-medium">
                    Contraste (asinh)
                  </label>
                  <span className="font-mono text-foreground/70">
                    {stretchGain.toFixed(1)}×
                  </span>
                </div>
                <input
                  id="stretch-range"
                  type="range"
                  min={0.4}
                  max={4.0}
                  step={0.1}
                  value={stretchGain}
                  onChange={(e) =>
                    setStretchGain(Number.parseFloat(e.target.value))
                  }
                  className="mt-1.5 w-full cursor-pointer accent-foreground"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setFovArcsec(
                    activeTarget?.category === "binary-brown-dwarf" ? 45 : 60
                  );
                  setStretchGain(1.2);
                }}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-4 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restablecer zoom y contraste</span>
              </button>
            </div>
          </section>

          {/* Video / Blink Playback Controls */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Reproducción temporal</h2>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                disabled={frames.length <= 1}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    <span>Pausar vídeo</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    <span>Reproducir</span>
                  </>
                )}
              </button>
              <button
                type="button"
                aria-label="Fotograma anterior"
                disabled={frames.length <= 1}
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentFrameIndex(
                    (prev) => (prev - 1 + frames.length) % frames.length
                  );
                }}
                className="inline-flex h-9 items-center justify-center rounded-full border border-black/[.08] px-3 text-sm font-medium transition-colors hover:bg-[#f2f2f2] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Fotograma siguiente"
                disabled={frames.length <= 1}
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentFrameIndex((prev) => (prev + 1) % frames.length);
                }}
                className="inline-flex h-9 items-center justify-center rounded-full border border-black/[.08] px-3 text-sm font-medium transition-colors hover:bg-[#f2f2f2] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex justify-between text-xs">
                  <label htmlFor="epoch-scrubber" className="font-medium">
                    Época actual
                  </label>
                  <span className="font-mono text-foreground/70">
                    {frames.length > 0
                      ? `${safeFrameIndex + 1} / ${frames.length}`
                      : "0 / 0"}
                  </span>
                </div>
                <input
                  id="epoch-scrubber"
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={safeFrameIndex}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setCurrentFrameIndex(Number.parseInt(e.target.value, 10));
                  }}
                  className="mt-1 w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs">
                  <label htmlFor="fps-range" className="font-medium">
                    Velocidad (FPS)
                  </label>
                  <span className="font-mono text-foreground/70">{fps} fps</span>
                </div>
                <input
                  id="fps-range"
                  type="range"
                  min={1}
                  max={10}
                  value={fps}
                  onChange={(e) => setFps(Number.parseInt(e.target.value, 10))}
                  className="mt-1 w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="playback-mode"
                  className="mb-1 block text-xs font-medium text-foreground/80"
                >
                  Modo de visualización
                </label>
                <CustomSelect
                  id="playback-mode"
                  value={playbackMode}
                  options={[
                    { value: "ping-pong", label: "Ping-Pong (Blink)" },
                    { value: "loop", label: "Ciclo continuo (Loop)" },
                    {
                      value: "difference",
                      label: "Resta: Época N − Época 1 (Dipolo)",
                    },
                    {
                      value: "sum",
                      label: "Suma: Época N + Época 1 (Rastro)",
                    },
                  ]}
                  onChange={(val) => setPlaybackMode(val as PlaybackMode)}
                />
                <p className="mt-1.5 font-mono text-[11px] text-foreground/60">
                  Teclado: ← / → cambiar época · Espacio Play/Pausa
                </p>
              </div>
            </div>
          </section>

          {/* Filters & Image Settings */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Filtros y ajustes de imagen</h2>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="collection-select"
                  className="mb-1 block text-xs font-medium text-foreground/80"
                >
                  Colección SPHEREx
                </label>
                <CustomSelect
                  id="collection-select"
                  value={collectionFilter}
                  options={availableCollections.map((col) => ({
                    value: col,
                    label: col,
                  }))}
                  onChange={(val) => {
                    setCollectionFilter(val);
                    setCurrentFrameIndex(0);
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="band-select"
                  className="mb-1 block text-xs font-medium text-foreground/80"
                >
                  Banda espectral
                </label>
                <CustomSelect
                  id="band-select"
                  value={bandFilter}
                  options={availableBands.map((band) => ({
                    value: band,
                    label: band,
                  }))}
                  onChange={(val) => {
                    setBandFilter(val);
                    setCurrentFrameIndex(0);
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="colormap-select"
                  className="mb-1 block text-xs font-medium text-foreground/80"
                >
                  Paleta de color
                </label>
                <CustomSelect
                  id="colormap-select"
                  value={colormap}
                  options={[
                    {
                      value: "wiseview-inverted",
                      label: "Invertido (Alto contraste)",
                    },
                    { value: "grayscale", label: "Escala de grises" },
                    { value: "infrared", label: "Infrarrojo térmico" },
                  ]}
                  onChange={(val) => setColormap(val as ColormapMode)}
                />
              </div>

              <div className="space-y-2 pt-1 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showCrosshair}
                    onChange={(e) => setShowCrosshair(e.target.checked)}
                  />
                  <span>Retícula central</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  <span>Rejilla WCS (RA / Dec)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showTargetOverlay}
                    onChange={(e) => setShowTargetOverlay(e.target.checked)}
                  />
                  <span>Resaltar trayectoria / variabilidad</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showHistoricalCatalogOverlay}
                    onChange={(e) =>
                      setShowHistoricalCatalogOverlay(e.target.checked)
                    }
                  />
                  <span>Comparar con AllWISE (2010) y Gaia DR3</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stackByDetector}
                    onChange={(e) => setStackByDetector(e.target.checked)}
                  />
                  <span>Apilar por detector (Coadd D1–D6)</span>
                </label>
              </div>
            </div>
          </section>
        </aside>

        {/* Right Main Sky Video Panel */}
        <main className="min-w-0 space-y-5">
          {/* Telemetry Header */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight">
                    {activeTarget
                      ? activeTarget.name
                      : `Región ${formatRAHMS(activeRaDeg)} ${formatDecDMS(
                          activeDecDeg
                        )}`}
                  </h1>
                  <span className="rounded-full border border-black/[.08] bg-black/[.04] px-2.5 py-0.5 font-mono text-xs dark:border-white/[.145] dark:bg-white/[.06]">
                    {frames.length} fotos SPHEREx
                  </span>
                </div>
                <p className="mt-1 text-xs text-foreground/70">{statusMessage}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewerMode("canvas")}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    viewerMode === "canvas"
                      ? "bg-foreground text-background"
                      : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  }`}
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Secuencia temporal</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setViewerMode("fits-png");
                  }}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    viewerMode === "fits-png"
                      ? "bg-foreground text-background"
                      : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>FITS → PNG (Backend)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setViewerMode("aladin");
                  }}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    viewerMode === "aladin"
                      ? "bg-foreground text-background"
                      : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>Aladin Lite v3</span>
                </button>
              </div>
            </div>

            {currentFrame ? (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-black/[.08] pt-3 text-xs dark:border-white/[.145] sm:grid-cols-4">
                <div>
                  <span className="block text-foreground/60">Época activa</span>
                  <span className="font-mono font-medium">
                    {currentFrame.epochLabel}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">ID observación</span>
                  <span className="font-mono font-medium">
                    {currentFrame.observacion.identificador}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">Banda / Colección</span>
                  <span className="font-mono font-medium">
                    {currentFrame.observacion.banda_espectral} ·{" "}
                    {currentFrame.observacion.coleccion}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">
                    {activeTarget?.category === "variable-star"
                      ? "Flujo relativo"
                      : "Desplazamiento época"}
                  </span>
                  <span className="font-mono font-medium">
                    {activeTarget?.category === "variable-star"
                      ? `${currentFluxMult.toFixed(2)}x`
                      : `ΔRA ${currentOffset.dRaArcsec.toFixed(
                          2
                        )}" · ΔDec ${currentOffset.dDecArcsec.toFixed(2)}"`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/[.08] pt-3 text-xs dark:border-white/[.145]">
                <span>
                  Ninguna observación coincide con los filtros actuales.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCollectionFilter("Todas");
                    setBandFilter("Todas");
                  }}
                  className="rounded-full border border-black/[.08] px-3 py-1 font-medium hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                >
                  Restablecer filtros
                </button>
              </div>
            )}
          </section>

          {/* Interactive Sky Video Canvas, Backend FITS→PNG, or Aladin Lite v3 */}
          {frames.length > 0 && currentFrame && (
            viewerMode === "fits-png" ? (
              <FitsPngFrameView
                key={currentFrame.observacion.identificador}
                observacion={currentFrame.observacion}
                epochLabel={currentFrame.epochLabel}
                onFallbackToCanvas={() => setViewerMode("canvas")}
              />
            ) : viewerMode === "aladin" ? (
              <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
                <AladinSkyMap
                  fitsUrl={currentFrame.observacion.url_acceso}
                  ra={activeRaDeg}
                  dec={activeDecDeg}
                  fov={Number((fovArcsec / 3600).toFixed(4))}
                  frames={frames}
                  currentFrameIndex={safeFrameIndex}
                  activeTarget={activeTarget}
                  onSelectFrameIndex={(idx) => {
                    setIsPlaying(false);
                    setCurrentFrameIndex(idx);
                  }}
                />
              </div>
            ) : (
              <SkyVideoCanvas
                key={`${activeRaDeg.toFixed(6)}:${activeDecDeg.toFixed(6)}`}
                centerRaDeg={activeRaDeg}
                centerDecDeg={activeDecDeg}
                frames={frames}
                currentFrameIndex={safeFrameIndex}
                referenceFrameIndex={0}
                activeTarget={activeTarget}
                fovArcsec={fovArcsec}
                stretchGain={stretchGain}
                colormap={colormap}
                playbackMode={playbackMode}
                showCrosshair={showCrosshair}
                showGrid={showGrid}
                showTargetOverlay={showTargetOverlay}
                showHistoricalCatalogOverlay={showHistoricalCatalogOverlay}
                stackByDetector={stackByDetector}
                selectedSource={effectiveSelectedSource}
                onSelectSkySource={(src) => setCustomSelectedSource(src)}
                onZoomChange={setFovArcsec}
                view360={view360}
              />
            )
          )}

          {/* Agrupación por detectores (D1–D6) y Espectro Infrarrojo SPHEREx (102 canales LVF) */}
          <SpherexSpectrumPanel
            selectedSource={effectiveSelectedSource}
            activeTarget={activeTarget}
            rawObservations={rawObservations}
            selectedBandFilter={bandFilter}
            stackByDetector={stackByDetector}
            fluxMultiplier={currentFluxMult}
            onSelectBandFilter={(nextBand) => {
              setBandFilter(nextBand);
              setCurrentFrameIndex(0);
            }}
            onToggleStackByDetector={(next) => setStackByDetector(next)}
          />

          {/* Target Scientific Note */}
          {activeTarget && (
            <section className="rounded-lg border border-black/[.08] p-4 text-xs dark:border-white/[.145]">
              <p className="font-medium text-foreground">
                {activeTarget.name} — {activeTarget.categoryLabel}
              </p>
              <p className="mt-1 text-foreground/70">
                {activeTarget.description}
              </p>
              <p className="mt-2 font-mono text-[11px] text-foreground/60">
                Movimiento propio: μ_RA = {activeTarget.pmRaMasYr} mas/año ·
                μ_Dec = {activeTarget.pmDecMasYr} mas/año
                {activeTarget.variabilityPeriodDays
                  ? ` · Período variable ≈ ${activeTarget.variabilityPeriodDays} d (Δmag ≈ ${activeTarget.variabilityAmplitudeMag})`
                  : ""}
              </p>
            </section>
          )}

          {/* Epoch Filmstrip */}
          {frames.length > 0 && (
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Secuencia de fotogramas ({frames.length})
                </h2>
                <span className="font-mono text-xs text-foreground/60">
                  Haz clic en cualquier época para inspeccionarla
                </span>
              </div>

              <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
                {frames.map((frame) => {
                  const active = frame.index === safeFrameIndex;
                  return (
                    <button
                      key={`${frame.observacion.identificador}-${frame.index}`}
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentFrameIndex(frame.index);
                      }}
                      className={`flex shrink-0 items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                      }`}
                    >
                      <Image
                        src="/processed/2025W41_2B_0509_2_D1_preview.png"
                        alt={`Miniatura ${frame.observacion.identificador}`}
                        width={36}
                        height={36}
                        unoptimized
                        className="h-9 w-9 shrink-0 rounded-lg border border-black/[.08] object-cover dark:border-white/[.145]"
                      />
                      <div>
                        <div className="font-mono text-xs font-medium">
                          #{frame.index + 1} · {frame.epochDate}
                        </div>
                        <div
                          className={`mt-0.5 font-mono text-[10px] ${
                            active ? "opacity-80" : "text-foreground/60"
                          }`}
                        >
                          {frame.observacion.banda_espectral}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Scientific FITS MEF Structure & Metadata Inspector */}
          {inspectedObservacion && (
            <FitsScientificInspector observacion={inspectedObservacion} />
          )}

          {/* Observations Table */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Observaciones SPHEREx ({filteredObservations.length} de{" "}
                {rawObservations.length})
              </h2>
              <span className="text-xs text-foreground/60">
                Candidato visual ≠ descubrimiento confirmado
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-black/[.08] text-foreground/60 dark:border-white/[.145]">
                    <th className="py-2 pr-3 font-medium">Época</th>
                    <th className="py-2 pr-3 font-medium">Identificador</th>
                    <th className="py-2 pr-3 font-medium">Colección</th>
                    <th className="py-2 pr-3 font-medium">Banda</th>
                    <th className="py-2 pr-3 font-medium">Coordenadas</th>
                    <th className="py-2 pr-3 font-medium">Tamaño</th>
                    <th className="py-2 pr-3 font-medium">PNG</th>
                    <th className="py-2 font-medium">FITS</th>
                  </tr>
                </thead>
                <tbody>
                  {frames.slice(0, 40).map((frame) => {
                    const obs = frame.observacion;
                    const active = frame.index === safeFrameIndex;
                    const pngUrl = getFitsPngUrl(obs);
                    return (
                      <tr
                        key={`${obs.identificador}-${frame.index}`}
                        onClick={() => {
                          setIsPlaying(false);
                          setCurrentFrameIndex(frame.index);
                        }}
                        className={`cursor-pointer border-b border-black/[.06] transition-colors dark:border-white/[.08] ${
                          active
                            ? "bg-black/[.05] dark:bg-white/[.08]"
                            : "hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
                        }`}
                      >
                        <td className="py-2 pr-3 font-mono">
                          {frame.epochDate}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {obs.identificador}
                        </td>
                        <td className="py-2 pr-3 font-mono">{obs.coleccion}</td>
                        <td className="py-2 pr-3 font-mono">
                          {obs.banda_espectral}
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {obs.ascension_recta.toFixed(4)}°,{" "}
                          {obs.declinacion.toFixed(4)}°
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {formatFileSize(obs.tamano_estimado)}
                        </td>
                        <td className="py-2 pr-3">
                          <a
                            href={pngUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="underline underline-offset-4 hover:opacity-75"
                          >
                            Ver PNG ↗
                          </a>
                        </td>
                        <td className="py-2">
                          <a
                            href={obs.url_acceso}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="underline underline-offset-4 hover:opacity-75"
                          >
                            Abrir ↗
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {frames.length > 40 && (
                <p className="mt-2 text-xs text-foreground/60">
                  Mostrando las primeras 40 observaciones de {frames.length}. Usa
                  los filtros de colección o banda para acotar la lista.
                </p>
              )}
            </div>
          </section>
        </main>
        </div>
      )}
    </div>
  );
}
