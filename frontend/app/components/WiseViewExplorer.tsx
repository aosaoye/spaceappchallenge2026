"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  FlaskConical,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Pause,
  Play,
  RotateCcw,
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
import { withBasePath } from "@/lib/api-config";
import { ChatVisorContext } from "@/lib/astronomy/chatbot-engine";
import { tryParseViewParams } from "@/lib/astronomy/parse-view-params";
import {
  buildEpochFrames,
  CHALLENGE_TARGETS,
  ChallengeTarget,
  DEFAULT_FOV_ARCSEC,
  fetchRegionObservationsData,
  findMatchingChallengeTarget,
  formatDecDMS,
  formatRAHMS,
  getFitsPngUrl,
  MAX_FOV_ARCSEC,
  MIN_FOV_ARCSEC,
  Observacion,
  parseDeclination,
  parseRightAscension,
} from "../astronomy";
import AstronomyChatbot from "./AstronomyChatbot";
import CustomSelect from "./CustomSelect";
import PanStarrsViewer from "./PanStarrsViewer";
import SkyCoordinateSearch, {
  SolvedSkyImageState,
} from "./SkyCoordinateSearch";
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

function CustomSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="group flex cursor-pointer items-center justify-between gap-3 py-0.5 select-none">
      <span>{label}</span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-[42px] items-center rounded-full border-2 transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-foreground/20 ${
            checked
              ? "border-transparent bg-foreground group-hover:bg-[#383838] dark:group-hover:bg-[#ccc]"
              : "border-black/[.22] bg-background group-hover:bg-[#f2f2f2] dark:border-white/[.25] dark:group-hover:bg-[#1a1a1a]"
          }`}
        >
          <span
            className={`rounded-full transition-all duration-200 ${
              checked
                ? "h-4 w-4 translate-x-[20px] bg-background"
                : "h-3 w-3 translate-x-[3px] bg-foreground/45 group-hover:bg-foreground/70"
            }`}
          />
        </span>
      </span>
    </label>
  );
}

function clampFovArcsec(value: number): number {
  return Math.max(MIN_FOV_ARCSEC, Math.min(MAX_FOV_ARCSEC, Math.round(value)));
}

function fovToSliderValue(fovArcsec: number): number {
  const clamped = clampFovArcsec(fovArcsec);
  const ratio =
    Math.log(clamped / MIN_FOV_ARCSEC) /
    Math.log(MAX_FOV_ARCSEC / MIN_FOV_ARCSEC);
  return Math.round((1 - ratio) * 100);
}

function sliderValueToFov(sliderVal: number): number {
  const t = Math.max(0, Math.min(100, sliderVal)) / 100;
  return clampFovArcsec(
    MIN_FOV_ARCSEC * Math.pow(MAX_FOV_ARCSEC / MIN_FOV_ARCSEC, 1 - t)
  );
}

function formatFovLabel(fovArcsec: number): string {
  return fovArcsec >= 120
    ? `${(fovArcsec / 60).toFixed(1)}'`
    : `${fovArcsec}"`;
}

function ZoomSliderField({
  inputId,
  fovArcsec,
  onChange,
}: {
  inputId: string;
  fovArcsec: number;
  onChange: (nextFovArcsec: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={inputId} className="font-medium">
          Zoom
        </label>
        <span className="font-mono text-foreground/70">
          {(DEFAULT_FOV_ARCSEC / fovArcsec).toFixed(1)}× ({formatFovLabel(fovArcsec)})
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <ZoomOut className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
        <input
          id={inputId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={fovToSliderValue(fovArcsec)}
          onChange={(e) => onChange(sliderValueToFov(Number.parseInt(e.target.value, 10)))}
          className="w-full cursor-pointer accent-foreground"
        />
        <ZoomIn className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
      </div>
    </div>
  );
}

function FilterToggleList({
  showCrosshair,
  onToggleCrosshair,
  showGrid,
  onToggleGrid,
  showTargetOverlay,
  onToggleTargetOverlay,
  showHistoricalCatalogOverlay,
  onToggleHistoricalCatalogOverlay,
  stackByDetector,
  onToggleStackByDetector,
}: {
  showCrosshair: boolean;
  onToggleCrosshair: (checked: boolean) => void;
  showGrid: boolean;
  onToggleGrid: (checked: boolean) => void;
  showTargetOverlay: boolean;
  onToggleTargetOverlay: (checked: boolean) => void;
  showHistoricalCatalogOverlay: boolean;
  onToggleHistoricalCatalogOverlay: (checked: boolean) => void;
  stackByDetector: boolean;
  onToggleStackByDetector: (checked: boolean) => void;
}) {
  const items = [
    { label: "Retícula", checked: showCrosshair, onChange: onToggleCrosshair },
    { label: "Rejilla WCS", checked: showGrid, onChange: onToggleGrid },
    {
      label: "Trayectoria",
      checked: showTargetOverlay,
      onChange: onToggleTargetOverlay,
    },
    {
      label: "AllWISE / Gaia",
      checked: showHistoricalCatalogOverlay,
      onChange: onToggleHistoricalCatalogOverlay,
    },
    {
      label: "Apilar D1–D6",
      checked: stackByDetector,
      onChange: onToggleStackByDetector,
    },
  ];

  return (
    <>
      {items.map((item) => (
        <CustomSwitch
          key={item.label}
          label={item.label}
          checked={item.checked}
          onChange={item.onChange}
        />
      ))}
    </>
  );
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
      <div className="flex items-center justify-end text-xs text-foreground/70">
        <a
          href={currentSrc}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-75"
        >
          <span>Abrir PNG</span>
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rawObservations, setRawObservations] = useState<Observacion[]>([]);
  const [dataSource, setDataSource] = useState<"irsa" | "fallback">("irsa");

  // Filter & image display controls
  const [viewerMode, setViewerMode] = useState<"canvas" | "fits-png" | "aladin">(
    "canvas"
  );
  const [showPanStarrs, setShowPanStarrs] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("Todas");
  const [bandFilter, setBandFilter] = useState("Todas");
  const [colormap, setColormap] = useState<ColormapMode>("wiseview-inverted");
  const [fovArcsec, setFovArcsec] = useState(DEFAULT_FOV_ARCSEC);
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
  const [solvedSkyImage, setSolvedSkyImage] =
    useState<SolvedSkyImageState | null>(null);

  // Video / Blink playback controls
  const [isPlaying, setIsPlaying] = useState(true);
  const [fps, setFps] = useState(4);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("ping-pong");
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const pingPongDirRef = useRef<1 | -1>(1);
  const preloaderWorkerRef = useRef<Worker | null>(null);

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

  // Sincronizar paleta del visor con el cambio de tema claro/oscuro (incluyendo el tema inicial al montar)
  useEffect(() => {
    const syncFromTheme = (theme: string | null) => {
      if (theme === "dark") {
        setColormap("grayscale");
      } else if (theme === "light") {
        setColormap("wiseview-inverted");
      }
    };
    const initialTheme =
      document.documentElement.getAttribute("data-theme") ??
      (document.documentElement.classList.contains("dark") ? "dark" : null);
    if (initialTheme) {
      queueMicrotask(() => syncFromTheme(initialTheme));
    }

    function handleThemeEvent(e: Event) {
      const custom = e as CustomEvent<"light" | "dark">;
      syncFromTheme(custom.detail);
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
      setFetchError(null);

      try {
        const payload = await fetchRegionObservationsData(
          raDeg,
          decDeg,
          radiusArcsec
        );
        const obsList = Array.isArray(payload.observaciones)
          ? payload.observaciones
          : [];
        setRawObservations(obsList);
        setDataSource("irsa");
        setFetchError(null);
      } catch (err) {
        setRawObservations([]);
        setFetchError(
          err instanceof Error
            ? err.message
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
        const worker = new Worker(withBasePath("/spherex-preloader.worker.js"));
        preloaderWorkerRef.current = worker;
        worker.postMessage({
          urls: [
            withBasePath("/aladin.js"),
            withBasePath("/processed/2025W41_2B_0509_2_D1_aladin_fast.fits"),
            withBasePath("/processed/2025W41_2B_0509_2_D1_preview.png"),
            withBasePath("/processed/2025W41_2B_0509_2_D1_wavelength.png"),
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
          const clamped = clampFovArcsec(arcsec);
          setFovArcsec(clamped);
          startRadius = Math.max(15, Math.min(3600, arcsec));
        }

        if (
          modeParam === "aladin" ||
          modeParam === "fits-png" ||
          modeParam === "canvas"
        ) {
          setViewerMode(modeParam);
        } else if (modeParam === "panstarrs") {
          setShowPanStarrs(true);
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

  function clearSolvedSkyImage() {
    if (solvedSkyImage?.previewUrl) {
      URL.revokeObjectURL(solvedSkyImage.previewUrl);
    }
    setSolvedSkyImage(null);
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

    clearSolvedSkyImage();
    fetchRegionObservations(raDeg, decDeg, radius, null);
  }

  function handleSelectPreset(target: ChallengeTarget) {
    clearSolvedSkyImage();
    setRaInput(target.raInput);
    setDecInput(target.decInput);
    setCustomSelectedSource(null);
    setIsPlaying(true);
    setFovArcsec(DEFAULT_FOV_ARCSEC);
    fetchRegionObservations(
      target.raDeg,
      target.decDeg,
      Number.parseFloat(radiusInput) || 60,
      target
    );
  }

  function handleResolvedSkyImage(solved: SolvedSkyImageState) {
    if (
      solvedSkyImage?.previewUrl &&
      solvedSkyImage.previewUrl !== solved.previewUrl
    ) {
      URL.revokeObjectURL(solvedSkyImage.previewUrl);
    }
    setSolvedSkyImage(solved);
    setRaInput(formatRAHMS(solved.result.ra_deg));
    setDecInput(formatDecDMS(solved.result.dec_deg));
    setRadiusInput(String(solved.result.radio_sugerido_arcsec));
    setCustomSelectedSource(null);
    setIsPlaying(true);
    setFovArcsec(clampFovArcsec(solved.result.fov_arcsec));
    fetchRegionObservations(
      solved.result.ra_deg,
      solved.result.dec_deg,
      solved.result.radio_sugerido_arcsec,
      null
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

  const chatbotContext: ChatVisorContext = useMemo(
    () => ({
      audienceMode,
      activeTarget,
      activeRaDeg,
      activeDecDeg,
      fovArcsec,
      viewerMode,
      stackByDetector,
      showHistoricalCatalogOverlay,
      showGrid,
      colormap,
      bandFilter,
      framesCount: frames.length,
      selectedSource: effectiveSelectedSource,
      lastSolvedImage: solvedSkyImage
        ? {
            fileName: solvedSkyImage.fileName,
            result: solvedSkyImage.result,
          }
        : null,
    }),
    [
      audienceMode,
      activeTarget,
      activeRaDeg,
      activeDecDeg,
      fovArcsec,
      viewerMode,
      stackByDetector,
      showHistoricalCatalogOverlay,
      showGrid,
      colormap,
      bandFilter,
      frames.length,
      effectiveSelectedSource,
      solvedSkyImage,
    ]
  );

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
                <span>Paseo Estelar</span>
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
                <span>Modo Investigador</span>
              </button>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleShareDiscoveryUrl}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              title="Copiar enlace de esta región"
            >
              {copiedShareUrl ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Compartir</span>
                </>
              )}
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
        <div
          className={`relative w-full ${
            showPanStarrs
              ? "min-h-[calc(100vh-53px)] pb-24"
              : "h-[calc(100vh-53px)] overflow-hidden"
          }`}
        >
          {loading && frames.length === 0 ? (
            <div className="flex h-full min-h-[360px] items-center justify-center">
              <div className="rounded-full border border-black/[.08] bg-background/90 px-4 py-2 text-xs text-foreground/75 shadow-sm backdrop-blur-md dark:border-white/[.145]">
                Cargando observaciones del cielo…
              </div>
            </div>
          ) : (
            frames.length > 0 &&
            currentFrame && (
              <div className={showPanStarrs ? "h-[58vh] w-full" : "h-full w-full"}>
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
                />
              </div>
            )
          )}

          {showPanStarrs && (
            <div className="mx-auto max-w-6xl px-4 py-4">
              <PanStarrsViewer
                ra={activeRaDeg}
                dec={activeDecDeg}
                fovArcsec={fovArcsec}
                compact
              />
            </div>
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
                  <ZoomSliderField
                    inputId="public-zoom-slider"
                    fovArcsec={fovArcsec}
                    onChange={setFovArcsec}
                  />

                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="public-stretch-range"
                        className="font-medium"
                      >
                        Contraste
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
                      setFovArcsec(DEFAULT_FOV_ARCSEC);
                      setStretchGain(1.2);
                    }}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-4 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Restablecer</span>
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
                      Colección
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
                      Banda
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
                      Paleta
                    </label>
                    <CustomSelect
                      id="public-colormap-select"
                      value={colormap}
                      options={[
                        {
                          value: "wiseview-inverted",
                          label: "Invertido",
                        },
                        { value: "grayscale", label: "Grises" },
                        { value: "infrared", label: "Infrarrojo" },
                      ]}
                      onChange={(val) => setColormap(val as ColormapMode)}
                    />
                  </div>

                  <div className="space-y-1.5 border-t border-black/[.08] pt-2.5 text-xs dark:border-white/[.145]">
                    <FilterToggleList
                      showCrosshair={showCrosshair}
                      onToggleCrosshair={setShowCrosshair}
                      showGrid={showGrid}
                      onToggleGrid={setShowGrid}
                      showTargetOverlay={showTargetOverlay}
                      onToggleTargetOverlay={setShowTargetOverlay}
                      showHistoricalCatalogOverlay={
                        showHistoricalCatalogOverlay
                      }
                      onToggleHistoricalCatalogOverlay={
                        setShowHistoricalCatalogOverlay
                      }
                      stackByDetector={stackByDetector}
                      onToggleStackByDetector={setStackByDetector}
                    />
                  </div>
                </div>
              </CustomSelect>

              {/* 4. Desplegable Detectores D1–D6 y nitidez simplificado con icono (hereda de CustomSelect) */}
              <CustomSelect
                id="public-detectors-select"
                value={bandFilter}
                title="Detectores (D1–D6)"
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
                      {stackByDetector ? "Apilado activo" : "Apilar exposiciones"}
                    </span>
                  </button>
                }
                options={[
                  {
                    value: "Todas",
                    label: "Todos (D1–D6)",
                  },
                  ...SPHEREX_DETECTORS.map((det) => ({
                    value: det.name,
                    label: det.code,
                    badge: `${det.minUm}–${det.maxUm} µm`,
                    colorDot: det.color,
                  })),
                ]}
                onChange={(val) => {
                  setBandFilter(val);
                  setCurrentFrameIndex(0);
                }}
              />

              {/* 5. Botón Pan-STARRS1 (Comparación óptica lado a lado / debajo, igual que WiseView) */}
              <button
                type="button"
                title="Comparar con Pan-STARRS1 (imágenes ópticas y FITS)"
                aria-label="Comparar con Pan-STARRS1"
                aria-pressed={showPanStarrs}
                onClick={() => setShowPanStarrs((prev) => !prev)}
                className={`inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-black/[.1] px-3 text-xs font-medium transition-colors dark:border-white/[.16] ${
                  showPanStarrs
                    ? "bg-foreground text-background"
                    : "bg-background text-foreground hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
                }`}
              >
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Pan-STARRS1</span>
              </button>

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
        </div>
      ) : (
        /* Main Workspace (Modo Investigador) */
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Left Control Panel */}
          <aside className="space-y-6">
            {/* Image-first Sky Search + Collapsible Manual Coordinates */}
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <div className="mb-3 flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-foreground/80" />
                <h2 className="text-sm font-semibold">Imagen del cielo</h2>
              </div>

              <SkyCoordinateSearch
                raInput={raInput}
                decInput={decInput}
                radiusInput={radiusInput}
                inputError={inputError}
                loadingObservations={loading}
                solvedImage={solvedSkyImage}
                onChangeRa={setRaInput}
                onChangeDec={setDecInput}
                onChangeRadius={setRadiusInput}
                onSubmitManual={handleSearchSubmit}
                onSolvedImage={handleResolvedSkyImage}
              />
            </section>

          {/* Mandatory Challenge Targets as Select + Custom Zoom Sliders */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Objetos</h2>
            </div>

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
            </div>

            {/* Custom Zoom & Contrast Sliders below the Objects Select */}
            <div className="mt-4 space-y-3 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
              <ZoomSliderField
                inputId="zoom-slider"
                fovArcsec={fovArcsec}
                onChange={setFovArcsec}
              />

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="stretch-range" className="font-medium">
                    Contraste
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
                  setFovArcsec(DEFAULT_FOV_ARCSEC);
                  setStretchGain(1.2);
                }}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-4 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restablecer</span>
              </button>
            </div>
          </section>

          {/* Video / Blink Playback Controls */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Reproducción</h2>
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
                    <span>Pausar</span>
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
                    Época
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
                    Velocidad
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
                  Modo
                </label>
                <CustomSelect
                  id="playback-mode"
                  value={playbackMode}
                  options={[
                    { value: "ping-pong", label: "Ping-Pong" },
                    { value: "loop", label: "Loop" },
                    { value: "difference", label: "Diferencia" },
                    { value: "sum", label: "Suma" },
                  ]}
                  onChange={(val) => setPlaybackMode(val as PlaybackMode)}
                />
              </div>
            </div>
          </section>

          {/* Filters & Image Settings */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-foreground/80" />
              <h2 className="text-sm font-semibold">Filtros</h2>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="collection-select"
                  className="mb-1 block text-xs font-medium text-foreground/80"
                >
                  Colección
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
                  Banda
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
                  Paleta
                </label>
                <CustomSelect
                  id="colormap-select"
                  value={colormap}
                  options={[
                    {
                      value: "wiseview-inverted",
                      label: "Invertido",
                    },
                    { value: "grayscale", label: "Grises" },
                    { value: "infrared", label: "Infrarrojo" },
                  ]}
                  onChange={(val) => setColormap(val as ColormapMode)}
                />
              </div>

              <div className="space-y-1.5 pt-1 text-xs">
                <FilterToggleList
                  showCrosshair={showCrosshair}
                  onToggleCrosshair={setShowCrosshair}
                  showGrid={showGrid}
                  onToggleGrid={setShowGrid}
                  showTargetOverlay={showTargetOverlay}
                  onToggleTargetOverlay={setShowTargetOverlay}
                  showHistoricalCatalogOverlay={showHistoricalCatalogOverlay}
                  onToggleHistoricalCatalogOverlay={
                    setShowHistoricalCatalogOverlay
                  }
                  stackByDetector={stackByDetector}
                  onToggleStackByDetector={setStackByDetector}
                />
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
                    {frames.length} obs
                  </span>
                </div>
                {fetchError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {fetchError}
                  </p>
                )}
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
                  <span>Secuencia</span>
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
                  <span>FITS → PNG</span>
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
                  <span>Aladin Lite</span>
                </button>
                <button
                  type="button"
                  aria-pressed={showPanStarrs}
                  onClick={() => setShowPanStarrs((prev) => !prev)}
                  className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                    showPanStarrs
                      ? "bg-foreground text-background"
                      : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>Pan-STARRS1</span>
                </button>
              </div>
            </div>

            {currentFrame ? (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-black/[.08] pt-3 text-xs dark:border-white/[.145] sm:grid-cols-4">
                <div>
                  <span className="block text-foreground/60">Época</span>
                  <span className="font-mono font-medium">
                    {currentFrame.epochLabel}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">ID</span>
                  <span className="font-mono font-medium">
                    {currentFrame.observacion.identificador}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">Banda</span>
                  <span className="font-mono font-medium">
                    {currentFrame.observacion.banda_espectral}
                  </span>
                </div>
                <div>
                  <span className="block text-foreground/60">
                    {activeTarget?.category === "variable-star"
                      ? "Flujo"
                      : "Desplazamiento"}
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
            ) : loading ? (
              <div className="mt-3 border-t border-black/[.08] pt-3 text-xs text-foreground/70 dark:border-white/[.145]">
                Cargando observaciones…
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
              />
            )
          )}

          {/* Panel de comparación Pan-STARRS1 debajo del visor principal (igual que WiseView) */}
          {showPanStarrs && (
            <PanStarrsViewer
              ra={activeRaDeg}
              dec={activeDecDeg}
              fovArcsec={fovArcsec}
            />
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

          {/* Epoch Filmstrip */}
          {frames.length > 0 && (
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <h2 className="text-sm font-semibold">
                Fotogramas ({frames.length})
              </h2>

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

          {/* Observations Table */}
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <h2 className="text-sm font-semibold">
              Observaciones ({filteredObservations.length})
            </h2>

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
                  Mostrando 40 de {frames.length}.
                </p>
              )}
            </div>
          </section>
        </main>
        </div>
      )}

      {/* Botones flotantes inferiores derecha: subida de foto (Paseo) + Guía Astronómico IA */}
      <div className="fixed bottom-24 right-4 z-30 flex items-end gap-2.5 sm:bottom-5 sm:right-5">
        {audienceMode === "public" && (
          <CustomSelect
            id="public-coordinates-fab"
            title="Subir imagen del cielo o coordenadas"
            icon={<ImagePlus className="h-5 w-5" />}
            iconOnly
            triggerClassName="h-12 w-12 shadow-xl border-black/[.14] bg-background/95 backdrop-blur-md dark:border-white/[.22]"
            dropUp
            panelClassName="-right-14 w-[min(20rem,calc(100vw-2rem))] sm:right-0 sm:w-80"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-foreground/80" />
                <h2 className="text-sm font-semibold">Imagen del cielo</h2>
              </div>
              <SkyCoordinateSearch
                compact
                raInput={raInput}
                decInput={decInput}
                radiusInput={radiusInput}
                inputError={inputError}
                loadingObservations={loading}
                solvedImage={solvedSkyImage}
                onChangeRa={setRaInput}
                onChangeDec={setDecInput}
                onChangeRadius={setRadiusInput}
                onSubmitManual={handleSearchSubmit}
                onSolvedImage={handleResolvedSkyImage}
              />
            </div>
          </CustomSelect>
        )}

        <AstronomyChatbot context={chatbotContext} />
      </div>
    </div>
  );
}
