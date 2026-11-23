"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChallengeTarget,
  DEFAULT_FOV_ARCSEC,
  EpochFrame,
  FitsCutoutPayload,
  MAX_FOV_ARCSEC,
  MIN_FOV_ARCSEC,
  formatDecDMS,
  formatRAHMS,
  getFitsCutoutUrl,
} from "../astronomy";
import { SelectedSkySource } from "./SpherexSpectrumPanel";

export type ColormapMode = "wiseview-inverted" | "grayscale" | "infrared";
export type PlaybackMode = "loop" | "ping-pong" | "difference" | "sum";

interface SkyVideoCanvasProps {
  centerRaDeg: number;
  centerDecDeg: number;
  frames: EpochFrame[];
  currentFrameIndex: number;
  referenceFrameIndex: number;
  activeTarget: ChallengeTarget | null;
  fovArcsec: number;
  stretchGain: number;
  colormap: ColormapMode;
  playbackMode: PlaybackMode;
  showCrosshair: boolean;
  showGrid: boolean;
  showTargetOverlay: boolean;
  showHistoricalCatalogOverlay?: boolean;
  stackByDetector?: boolean;
  selectedSource?: SelectedSkySource | null;
  onSelectSkySource?: (source: SelectedSkySource) => void;
  onZoomChange: (nextFovArcsec: number) => void;
  fullViewport?: boolean;
}

interface DecodedFitsCutout {
  identificador: string;
  detector: number | string;
  unidad: string;
  ancho: number;
  alto: number;
  vmin: number;
  vmax: number;
  mediana: number;
  ruidoMad: number;
  raCentro: number;
  decCentro: number;
  fovArcsec: number;
  pixscaleArcsec: number;
  coberturaWcs: boolean;
  pixelesValidos: number;
  flux: Float32Array;
}

const MAX_CLIENT_CUTOUT_CACHE = 64;
const PREFETCH_CONCURRENCY = 2;
const OFFSCREEN_HEIGHT = 280;
const cutoutMemoryCache = new Map<string, DecodedFitsCutout>();
const cutoutInFlight = new Map<string, Promise<DecodedFitsCutout>>();

function decodeFloat32Base64(b64: string): Float32Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 4)
  );
}

function pickFetchFovArcsec(fovArcsec: number): number {
  if (fovArcsec <= 240) return 480;
  if (fovArcsec <= 600) return 1200;
  if (fovArcsec <= 1200) return 2400;
  if (fovArcsec <= 2400) return 4800;
  return 7200;
}

function buildCutoutKey(
  fitsUrl: string,
  raDeg: number,
  decDeg: number,
  fetchFovArcsec: number
): string {
  return `${fitsUrl}|${raDeg.toFixed(5)}|${decDeg.toFixed(5)}|${fetchFovArcsec}`;
}

function setBoundedCacheEntry(key: string, value: DecodedFitsCutout) {
  if (cutoutMemoryCache.has(key)) {
    cutoutMemoryCache.delete(key);
  }
  cutoutMemoryCache.set(key, value);
  if (cutoutMemoryCache.size > MAX_CLIENT_CUTOUT_CACHE) {
    const oldest = cutoutMemoryCache.keys().next().value;
    if (oldest !== undefined) {
      cutoutMemoryCache.delete(oldest);
    }
  }
}

async function fetchDecodedFitsCutout(
  fitsUrl: string,
  raDeg: number,
  decDeg: number,
  fetchFovArcsec: number
): Promise<DecodedFitsCutout> {
  const key = buildCutoutKey(fitsUrl, raDeg, decDeg, fetchFovArcsec);
  const cached = cutoutMemoryCache.get(key);
  if (cached) {
    cutoutMemoryCache.delete(key);
    cutoutMemoryCache.set(key, cached);
    return cached;
  }

  const existing = cutoutInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const url = getFitsCutoutUrl({
      fitsUrl,
      raDeg,
      decDeg,
      fovArcsec: fetchFovArcsec,
      tamanoPx: 280,
    });
    const res = await fetch(url, { cache: "no-store" });
    const raw = (await res.json()) as FitsCutoutPayload & { detail?: string };
    if (!res.ok) {
      throw new Error(
        raw?.detail || `Error HTTP ${res.status} al leer FITS real.`
      );
    }

    const decoded: DecodedFitsCutout = {
      identificador: raw.identificador,
      detector: raw.detector,
      unidad: raw.unidad || "MJy/sr",
      ancho: raw.ancho,
      alto: raw.alto,
      vmin: raw.vmin,
      vmax: raw.vmax,
      mediana: raw.mediana,
      ruidoMad: raw.ruido_mad,
      raCentro: raw.ra_centro,
      decCentro: raw.dec_centro,
      fovArcsec: raw.fov_arcsec,
      pixscaleArcsec: raw.pixscale_arcsec,
      coberturaWcs: raw.cobertura_wcs,
      pixelesValidos: raw.pixeles_validos,
      flux: decodeFloat32Base64(raw.datos_f32_b64),
    };
    setBoundedCacheEntry(key, decoded);
    return decoded;
  })();

  cutoutInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    cutoutInFlight.delete(key);
  }
}

export function computeTargetFluxMultiplier(
  target: ChallengeTarget | null,
  frame: EpochFrame | undefined
): number {
  if (!target || !frame) return 1;
  if (
    target.category !== "variable-star" ||
    !target.variabilityPeriodDays ||
    !target.variabilityAmplitudeMag
  ) {
    return 1;
  }

  const phase = frame.index * 0.85 + frame.yearsFromRef * 0.65;

  if (target.id === "rw-aurigae") {
    const dip =
      0.58 * Math.sin(phase) + 0.42 * Math.cos(phase * 1.9 + 0.7);
    const deltaMag = dip * (target.variabilityAmplitudeMag * 0.55);
    return Math.min(2.65, Math.max(0.15, Math.pow(10, -0.4 * deltaMag)));
  }

  const deltaMag =
    (Math.sin(phase - Math.PI / 4) * target.variabilityAmplitudeMag) / 2.2;
  return Math.min(2.95, Math.max(0.12, Math.pow(10, -0.4 * deltaMag)));
}

export function computeTargetOffsetArcsec(
  target: ChallengeTarget | null,
  frame: EpochFrame | undefined,
  midYears: number
): { dRaArcsec: number; dDecArcsec: number } {
  if (!frame || !target) return { dRaArcsec: 0, dDecArcsec: 0 };
  const dtYears = frame.yearsFromRef - midYears;
  return {
    dRaArcsec: (target.pmRaMasYr * dtYears) / 1000,
    dDecArcsec: (target.pmDecMasYr * dtYears) / 1000,
  };
}

function sampleCutoutBilinear(
  cutout: DecodedFitsCutout,
  dRaArcsec: number,
  dDecArcsec: number
): number {
  const { ancho, alto, flux, pixscaleArcsec, coberturaWcs, fovArcsec } = cutout;
  const scaleFactor = coberturaWcs
    ? 1.0
    : fovArcsec / Math.max(DEFAULT_FOV_ARCSEC, 1);

  const col = (ancho - 1) * 0.5 - (dRaArcsec * scaleFactor) / pixscaleArcsec;
  const row = (alto - 1) * 0.5 - (dDecArcsec * scaleFactor) / pixscaleArcsec;

  if (col < -0.5 || col > ancho - 0.5 || row < -0.5 || row > alto - 0.5) {
    return Number.NaN;
  }

  const cx = Math.max(0, Math.min(ancho - 1, col));
  const cy = Math.max(0, Math.min(alto - 1, row));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(ancho - 1, x0 + 1);
  const y1 = Math.min(alto - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const v00 = flux[y0 * ancho + x0];
  const v10 = flux[y0 * ancho + x1];
  const v01 = flux[y1 * ancho + x0];
  const v11 = flux[y1 * ancho + x1];

  let wSum = 0;
  let valSum = 0;
  if (Number.isFinite(v00)) {
    const w = (1 - fx) * (1 - fy);
    wSum += w;
    valSum += v00 * w;
  }
  if (Number.isFinite(v10)) {
    const w = fx * (1 - fy);
    wSum += w;
    valSum += v10 * w;
  }
  if (Number.isFinite(v01)) {
    const w = (1 - fx) * fy;
    wSum += w;
    valSum += v01 * w;
  }
  if (Number.isFinite(v11)) {
    const w = fx * fy;
    wSum += w;
    valSum += v11 * w;
  }

  return wSum > 1e-6 ? valSum / wSum : Number.NaN;
}

function mapFluxToRgb(
  val: number,
  blackLevel: number,
  span: number,
  isDifference: boolean,
  stretchGain: number,
  colormap: ColormapMode
): [number, number, number] {
  if (!Number.isFinite(val)) {
    if (colormap === "wiseview-inverted") return [236, 238, 242];
    return [16, 18, 23];
  }

  if (isDifference) {
    const scaled = (val / Math.max(span, 1e-6)) * 2.4;
    const norm = Math.tanh(scaled * stretchGain * 1.15);
    const t = (norm + 1) * 0.5;
    if (colormap === "wiseview-inverted") {
      const inv = Math.round((1 - t) * 255);
      return [inv, inv, inv];
    }
    if (colormap === "infrared") {
      const r = Math.round(t > 0.5 ? 128 + (t - 0.5) * 254 : t * 256);
      const g = Math.round(128 - Math.abs(t - 0.5) * 180);
      const b = Math.round(t < 0.5 ? 128 + (0.5 - t) * 254 : (1 - t) * 256);
      return [r, g, b];
    }
    const g = Math.round(t * 255);
    return [g, g, g];
  }

  const normalized = Math.max(0, (val - blackLevel) / Math.max(span, 1e-6));
  const stretched =
    Math.asinh(normalized * stretchGain * 3.0) / Math.asinh(3.0 * stretchGain);
  const t = Math.min(1, Math.max(0, stretched));

  if (colormap === "wiseview-inverted") {
    const r = Math.round(248 - t * 234);
    const g = Math.round(249 - t * 228);
    const b = Math.round(251 - t * 205);
    return [r, g, b];
  }

  if (colormap === "infrared") {
    const r = Math.round(Math.min(255, t * 380));
    const g = Math.round(Math.min(255, Math.max(0, (t - 0.28) * 340)));
    const b = Math.round(Math.min(255, Math.max(0, (t - 0.62) * 520)));
    return [r, g, b];
  }

  const v = Math.round(t * 255);
  return [v, v, v];
}

function renderRealFitsPixels(params: {
  gridW: number;
  gridH: number;
  activeCutout: DecodedFitsCutout;
  refCutout: DecodedFitsCutout | null;
  coaddCutouts: DecodedFitsCutout[];
  panRaArcsec: number;
  panDecArcsec: number;
  fovArcsec: number;
  playbackMode: PlaybackMode;
  stretchGain: number;
  colormap: ColormapMode;
}): Uint8ClampedArray {
  const {
    gridW,
    gridH,
    activeCutout,
    refCutout,
    coaddCutouts,
    panRaArcsec,
    panDecArcsec,
    fovArcsec,
    playbackMode,
    stretchGain,
    colormap,
  } = params;

  const isDiff = playbackMode === "difference" && refCutout !== null;
  const isSum = playbackMode === "sum" && refCutout !== null;

  const blackLevel = Math.max(
    activeCutout.vmin,
    activeCutout.mediana -
      1.2 * Math.max(activeCutout.ruidoMad, (activeCutout.vmax - activeCutout.vmin) * 0.02)
  );
  const span = Math.max(activeCutout.vmax - blackLevel, 1e-6);

  const pxPerArcsec = gridH / fovArcsec;
  const rgba = new Uint8ClampedArray(gridW * gridH * 4);
  const stackList =
    coaddCutouts.length > 1
      ? coaddCutouts.filter((c) => c.coberturaWcs === activeCutout.coberturaWcs)
      : [];
  const useStack = stackList.length > 1;

  for (let gy = 0; gy < gridH; gy++) {
    const dDec = -((gy + 0.5 - gridH * 0.5) / pxPerArcsec) + panDecArcsec;
    for (let gx = 0; gx < gridW; gx++) {
      const dRa = -((gx + 0.5 - gridW * 0.5) / pxPerArcsec) + panRaArcsec;

      let primaryVal: number;
      if (useStack) {
        let sum = 0;
        let count = 0;
        for (const c of stackList) {
          const s = sampleCutoutBilinear(c, dRa, dDec);
          if (Number.isFinite(s)) {
            sum += s;
            count += 1;
          }
        }
        primaryVal = count > 0 ? sum / count : Number.NaN;
      } else {
        primaryVal = sampleCutoutBilinear(activeCutout, dRa, dDec);
      }

      let displayVal = primaryVal;
      if ((isDiff || isSum) && refCutout) {
        const refVal = sampleCutoutBilinear(refCutout, dRa, dDec);
        if (Number.isFinite(primaryVal) && Number.isFinite(refVal)) {
          displayVal = isDiff
            ? primaryVal - refVal
            : (primaryVal + refVal) * 0.5;
        } else {
          displayVal = Number.NaN;
        }
      }

      const [r, g, b] = mapFluxToRgb(
        displayVal,
        blackLevel,
        span,
        isDiff,
        stretchGain,
        colormap
      );
      const idx = (gy * gridW + gx) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return rgba;
}

function measureApertureFlux(
  cutout: DecodedFitsCutout,
  dRaArcsec: number,
  dDecArcsec: number,
  centerRaDeg: number,
  centerDecDeg: number
): { fluxPeak: number; excessFlux: number; isRealSource: boolean; raDeg: number; decDeg: number } {
  const scaleFactor = cutout.coberturaWcs
    ? 1.0
    : cutout.fovArcsec / Math.max(DEFAULT_FOV_ARCSEC, 1);
  const cx = Math.round(
    (cutout.ancho - 1) * 0.5 - (dRaArcsec * scaleFactor) / cutout.pixscaleArcsec
  );
  const cy = Math.round(
    (cutout.alto - 1) * 0.5 - (dDecArcsec * scaleFactor) / cutout.pixscaleArcsec
  );

  let peak = sampleCutoutBilinear(cutout, dRaArcsec, dDecArcsec);
  let bestX = cx;
  let bestY = cy;

  for (let dy = -2; dy <= 2; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= cutout.alto) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= cutout.ancho) continue;
      const val = cutout.flux[yy * cutout.ancho + xx];
      if (Number.isFinite(val) && (!Number.isFinite(peak) || val > peak)) {
        peak = val;
        bestX = xx;
        bestY = yy;
      }
    }
  }

  const peakDRa =
    (((cutout.ancho - 1) * 0.5 - bestX) * cutout.pixscaleArcsec) / scaleFactor;
  const peakDDec =
    (((cutout.alto - 1) * 0.5 - bestY) * cutout.pixscaleArcsec) / scaleFactor;
  const cosDec = Math.max(0.1, Math.cos((centerDecDeg * Math.PI) / 180));
  const raDeg =
    (((centerRaDeg + peakDRa / (3600 * cosDec)) % 360) + 360) % 360;
  const decDeg = Math.max(-90, Math.min(90, centerDecDeg + peakDDec / 3600));

  const safePeak = Number.isFinite(peak) ? peak : cutout.mediana;
  const excessFlux = safePeak - cutout.mediana;
  const snrThreshold = Math.max(cutout.ruidoMad * 3.0, (cutout.vmax - cutout.mediana) * 0.2);

  return {
    fluxPeak: safePeak,
    excessFlux,
    isRealSource: excessFlux > snrThreshold,
    raDeg,
    decDeg,
  };
}

export default function SkyVideoCanvas({
  centerRaDeg,
  centerDecDeg,
  frames,
  currentFrameIndex,
  referenceFrameIndex,
  activeTarget,
  fovArcsec,
  stretchGain,
  colormap,
  playbackMode,
  showCrosshair,
  showGrid,
  showTargetOverlay,
  showHistoricalCatalogOverlay = true,
  stackByDetector = false,
  selectedSource = null,
  onSelectSkySource,
  onZoomChange,
  fullViewport = false,
}: SkyVideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const [panArcsec, setPanArcsec] = useState({ ra: 0, dec: 0 });
  const [cacheTick, setCacheTick] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [frameErrors, setFrameErrors] = useState<Record<string, string>>({});

  const [cursorSky, setCursorSky] = useState<{
    raDeg: number;
    decDeg: number;
  } | null>(null);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startPanRa: number;
    startPanDec: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startPanRa: 0,
    startPanDec: 0,
  });

  const activeFrame = frames[currentFrameIndex] ?? frames[0];
  const refFrame = frames[referenceFrameIndex] ?? frames[0];
  const midYears =
    frames.length > 0
      ? frames[Math.floor((frames.length - 1) / 2)].yearsFromRef
      : 0;

  const fetchFovArcsec = pickFetchFovArcsec(fovArcsec);
  const activeKey = activeFrame
    ? buildCutoutKey(
        activeFrame.observacion.url_acceso,
        centerRaDeg,
        centerDecDeg,
        fetchFovArcsec
      )
    : null;
  const refKey = refFrame
    ? buildCutoutKey(
        refFrame.observacion.url_acceso,
        centerRaDeg,
        centerDecDeg,
        fetchFovArcsec
      )
    : null;

  useEffect(() => {
    if (frames.length === 0) return;
    let cancelled = false;

    const queue: Array<{ fitsUrl: string; key: string }> = [];
    const seen = new Set<string>();

    const enqueue = (frame: EpochFrame | undefined) => {
      if (!frame) return;
      const fitsUrl = frame.observacion.url_acceso;
      const key = buildCutoutKey(
        fitsUrl,
        centerRaDeg,
        centerDecDeg,
        fetchFovArcsec
      );
      if (seen.has(key) || cutoutMemoryCache.has(key)) return;
      seen.add(key);
      queue.push({ fitsUrl, key });
    };

    enqueue(activeFrame);
    if (playbackMode === "difference" || playbackMode === "sum") {
      enqueue(refFrame);
    }
    const maxPrefetch = stackByDetector ? frames.length : Math.min(frames.length, 8);
    for (let i = 0; i < maxPrefetch; i++) {
      enqueue(frames[i]);
    }

    if (queue.length === 0) return;

    let cursor = 0;
    const workerCount = Math.min(PREFETCH_CONCURRENCY, queue.length);

    async function runWorker() {
      while (!cancelled) {
        const idx = cursor++;
        if (idx >= queue.length) break;
        const item = queue[idx];
        try {
          await fetchDecodedFitsCutout(
            item.fitsUrl,
            centerRaDeg,
            centerDecDeg,
            fetchFovArcsec
          );
          if (!cancelled) {
            setFrameErrors((prev) => {
              if (!(item.key in prev)) return prev;
              const next = { ...prev };
              delete next[item.key];
              return next;
            });
            setCacheTick((t) => t + 1);
          }
        } catch (err) {
          if (!cancelled) {
            const msg =
              err instanceof Error
                ? err.message
                : "Error al cargar el recorte FITS.";
            setFrameErrors((prev) => ({ ...prev, [item.key]: msg }));
          }
        }
      }
    }

    void Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return () => {
      cancelled = true;
    };
  }, [
    frames,
    activeFrame,
    refFrame,
    centerRaDeg,
    centerDecDeg,
    fetchFovArcsec,
    playbackMode,
    stackByDetector,
    reloadNonce,
  ]);

  const activeCutout = useMemo(() => {
    void cacheTick;
    return activeKey ? cutoutMemoryCache.get(activeKey) ?? null : null;
  }, [activeKey, cacheTick]);

  const refCutout = useMemo(() => {
    void cacheTick;
    return refKey ? cutoutMemoryCache.get(refKey) ?? null : null;
  }, [refKey, cacheTick]);

  const coaddCutouts = useMemo(() => {
    void cacheTick;
    if (!stackByDetector) return [];
    const list: DecodedFitsCutout[] = [];
    for (const fr of frames) {
      const k = buildCutoutKey(
        fr.observacion.url_acceso,
        centerRaDeg,
        centerDecDeg,
        fetchFovArcsec
      );
      const item = cutoutMemoryCache.get(k);
      if (item) list.push(item);
    }
    return list;
  }, [stackByDetector, frames, centerRaDeg, centerDecDeg, fetchFovArcsec, cacheTick]);

  const activeError = activeKey ? frameErrors[activeKey] ?? null : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeFrame) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 760;
    const cssHeight = canvas.clientHeight || 520;
    const pixelW = Math.round(cssWidth * dpr);
    const pixelH = Math.round(cssHeight * dpr);

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isLightSky = colormap === "wiseview-inverted";

    if (!activeCutout) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = isLightSky ? "#f4f5f7" : "#07090e";
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.restore();
      return;
    }

    const aspect = cssWidth / Math.max(cssHeight, 1);
    const gridH = OFFSCREEN_HEIGHT;
    const gridW = Math.max(120, Math.min(720, Math.round(gridH * aspect)));

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
    }
    const offscreen = offscreenRef.current;
    if (offscreen.width !== gridW || offscreen.height !== gridH) {
      offscreen.width = gridW;
      offscreen.height = gridH;
    }
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const rgba = renderRealFitsPixels({
      gridW,
      gridH,
      activeCutout,
      refCutout,
      coaddCutouts,
      panRaArcsec: panArcsec.ra,
      panDecArcsec: panArcsec.dec,
      fovArcsec,
      playbackMode,
      stretchGain,
      colormap,
    });

    const imgData = offCtx.createImageData(gridW, gridH);
    imgData.data.set(rgba);
    offCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(offscreen, 0, 0, cssWidth, cssHeight);

    const pxPerArcsec = cssHeight / fovArcsec;
    const skyToCss = (dRaArcsec: number, dDecArcsec: number) => ({
      x: cssWidth / 2 - (dRaArcsec - panArcsec.ra) * pxPerArcsec,
      y: cssHeight / 2 - (dDecArcsec - panArcsec.dec) * pxPerArcsec,
    });

    const overlayMuted = isLightSky
      ? "rgba(23, 23, 23, 0.28)"
      : "rgba(237, 237, 237, 0.28)";
    const overlayText = isLightSky
      ? "rgba(23, 23, 23, 0.82)"
      : "rgba(237, 237, 237, 0.88)";
    const overlayAccent = isLightSky ? "#171717" : "#ededed";

    if (showGrid) {
      const halfH = fovArcsec * 0.5;
      const halfW = halfH * aspect;
      const stepArcsec =
        fovArcsec >= 1800
          ? 600
          : fovArcsec >= 600
          ? 180
          : fovArcsec >= 240
          ? 60
          : fovArcsec >= 90
          ? 30
          : 15;
      const startRa = Math.floor((panArcsec.ra - halfW) / stepArcsec) * stepArcsec;
      const endRa = Math.ceil((panArcsec.ra + halfW) / stepArcsec) * stepArcsec;
      const startDec = Math.floor((panArcsec.dec - halfH) / stepArcsec) * stepArcsec;
      const endDec = Math.ceil((panArcsec.dec + halfH) / stepArcsec) * stepArcsec;

      ctx.strokeStyle = overlayMuted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let off = startRa; off <= endRa; off += stepArcsec) {
        const vx = skyToCss(off, 0).x;
        if (vx >= 0 && vx <= cssWidth) {
          ctx.beginPath();
          ctx.moveTo(vx, 0);
          ctx.lineTo(vx, cssHeight);
          ctx.stroke();
        }
      }
      for (let off = startDec; off <= endDec; off += stepArcsec) {
        const hy = skyToCss(0, off).y;
        if (hy >= 0 && hy <= cssHeight) {
          ctx.beginPath();
          ctx.moveTo(0, hy);
          ctx.lineTo(cssWidth, hy);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    if (showCrosshair) {
      const centerPos = skyToCss(0, 0);
      ctx.strokeStyle = overlayMuted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerPos.x - 16, centerPos.y);
      ctx.lineTo(centerPos.x - 5, centerPos.y);
      ctx.moveTo(centerPos.x + 5, centerPos.y);
      ctx.lineTo(centerPos.x + 16, centerPos.y);
      ctx.moveTo(centerPos.x, centerPos.y - 16);
      ctx.lineTo(centerPos.x, centerPos.y - 5);
      ctx.moveTo(centerPos.x, centerPos.y + 5);
      ctx.lineTo(centerPos.x, centerPos.y + 16);
      ctx.stroke();
    }

    if (
      showHistoricalCatalogOverlay &&
      activeTarget &&
      (activeTarget.category === "high-proper-motion" ||
        activeTarget.category === "binary-brown-dwarf")
    ) {
      const curOffset = computeTargetOffsetArcsec(
        activeTarget,
        activeFrame,
        midYears
      );
      const wiseRefOffset = {
        dRaArcsec: (activeTarget.pmRaMasYr * -3.0) / 1000,
        dDecArcsec: (activeTarget.pmDecMasYr * -3.0) / 1000,
      };
      const gaiaRefOffset = {
        dRaArcsec: (activeTarget.pmRaMasYr * -1.8) / 1000,
        dDecArcsec: (activeTarget.pmDecMasYr * -1.8) / 1000,
      };
      const pWise = skyToCss(wiseRefOffset.dRaArcsec, wiseRefOffset.dDecArcsec);
      const pGaia = skyToCss(gaiaRefOffset.dRaArcsec, gaiaRefOffset.dDecArcsec);
      const pCur = skyToCss(curOffset.dRaArcsec, curOffset.dDecArcsec);

      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pWise.x, pWise.y);
      ctx.lineTo(pCur.x, pCur.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pWise.x, pWise.y, 7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#06b6d4";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pGaia.x, pGaia.y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (showTargetOverlay && activeTarget) {
      const firstOffset = computeTargetOffsetArcsec(
        activeTarget,
        frames[0],
        midYears
      );
      const lastOffset = computeTargetOffsetArcsec(
        activeTarget,
        frames[frames.length - 1],
        midYears
      );
      const curOffset = computeTargetOffsetArcsec(
        activeTarget,
        activeFrame,
        midYears
      );
      const p0 = skyToCss(firstOffset.dRaArcsec, firstOffset.dDecArcsec);
      const p1 = skyToCss(lastOffset.dRaArcsec, lastOffset.dDecArcsec);
      const pc = skyToCss(curOffset.dRaArcsec, curOffset.dDecArcsec);

      ctx.strokeStyle = overlayText;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const fr of frames) {
        const off = computeTargetOffsetArcsec(activeTarget, fr, midYears);
        const pf = skyToCss(off.dRaArcsec, off.dDecArcsec);
        ctx.fillStyle =
          fr.index === activeFrame.index ? overlayAccent : overlayMuted;
        ctx.beginPath();
        ctx.arc(
          pf.x,
          pf.y,
          fr.index === activeFrame.index ? 3 : 1.8,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      ctx.strokeStyle = overlayAccent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (selectedSource && !selectedSource.isPrimaryTarget) {
      const ps = skyToCss(selectedSource.dRaArcsec, selectedSource.dDecArcsec);
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!fullViewport) {
      const barArcsec =
        fovArcsec >= 1800
          ? 600
          : fovArcsec >= 600
          ? 120
          : fovArcsec >= 240
          ? 60
          : fovArcsec >= 90
          ? 30
          : 15;
      const barPx = barArcsec * pxPerArcsec;
      const barX = 16;
      const barY = cssHeight - 18;
      ctx.strokeStyle = overlayAccent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barX, barY);
      ctx.lineTo(barX + barPx, barY);
      ctx.moveTo(barX, barY - 3);
      ctx.lineTo(barX, barY + 3);
      ctx.moveTo(barX + barPx, barY - 3);
      ctx.lineTo(barX + barPx, barY + 3);
      ctx.stroke();

      ctx.font = "11px monospace";
      ctx.fillStyle = overlayText;
      const barLabel =
        barArcsec >= 60 ? `${barArcsec / 60}'` : `${barArcsec}"`;
      ctx.fillText(barLabel, barX, barY - 7);
    }

    ctx.restore();
  }, [
    activeFrame,
    activeCutout,
    refCutout,
    coaddCutouts,
    activeTarget,
    centerRaDeg,
    centerDecDeg,
    fovArcsec,
    frames,
    midYears,
    panArcsec,
    playbackMode,
    showCrosshair,
    showGrid,
    showTargetOverlay,
    showHistoricalCatalogOverlay,
    selectedSource,
    stretchGain,
    colormap,
    fullViewport,
  ]);

  function clientToSkyOffsets(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const pxPerArcsec = rect.height / fovArcsec;
    const dRaArcsec = -(cssX - rect.width / 2) / pxPerArcsec + panArcsec.ra;
    const dDecArcsec = -(cssY - rect.height / 2) / pxPerArcsec + panArcsec.dec;
    const cosDec = Math.max(0.1, Math.cos((centerDecDeg * Math.PI) / 180));
    const raDeg =
      (((centerRaDeg + dRaArcsec / (3600 * cosDec)) % 360) + 360) % 360;
    const decDeg = Math.max(
      -90,
      Math.min(90, centerDecDeg + dDecArcsec / 3600)
    );
    return { dRaArcsec, dDecArcsec, raDeg, decDeg };
  }

  function handleCanvasClick(clientX: number, clientY: number) {
    if (!onSelectSkySource) return;
    const coords = clientToSkyOffsets(clientX, clientY);
    if (!coords) return;

    const curTargetOffset = computeTargetOffsetArcsec(
      activeTarget,
      activeFrame,
      midYears
    );
    const distToTarget = Math.hypot(
      coords.dRaArcsec - curTargetOffset.dRaArcsec,
      coords.dDecArcsec - curTargetOffset.dDecArcsec
    );

    if (activeTarget && distToTarget <= Math.max(12, fovArcsec * 0.05)) {
      const measured = activeCutout
        ? measureApertureFlux(
            activeCutout,
            coords.dRaArcsec,
            coords.dDecArcsec,
            centerRaDeg,
            centerDecDeg
          )
        : null;
      onSelectSkySource({
        id: activeTarget.id,
        label: activeTarget.name,
        raDeg: centerRaDeg,
        decDeg: centerDecDeg,
        dRaArcsec: curTargetOffset.dRaArcsec,
        dDecArcsec: curTargetOffset.dDecArcsec,
        isPrimaryTarget: true,
        spectralSlope: 0,
        baseFlux: measured ? Math.max(0.4, measured.excessFlux) : 2.8,
        spectralType: activeTarget.categoryLabel,
      });
      return;
    }

    if (!activeCutout) return;

    const aperture = measureApertureFlux(
      activeCutout,
      coords.dRaArcsec,
      coords.dDecArcsec,
      centerRaDeg,
      centerDecDeg
    );

    onSelectSkySource({
      id: `fits-src-${Math.round(aperture.raDeg * 10000)}-${Math.round(
        aperture.decDeg * 10000
      )}`,
      label: aperture.isRealSource
        ? `Fuente FITS (${aperture.fluxPeak.toFixed(2)} ${activeCutout.unidad})`
        : `Píxel FITS (${aperture.fluxPeak.toFixed(2)} ${activeCutout.unidad})`,
      raDeg: aperture.raDeg,
      decDeg: aperture.decDeg,
      dRaArcsec: coords.dRaArcsec,
      dDecArcsec: coords.dDecArcsec,
      isPrimaryTarget: false,
      spectralSlope: 0,
      baseFlux: Math.max(0.2, aperture.excessFlux),
      spectralType: aperture.isRealSource
        ? `Fuente real en FITS (${activeCutout.unidad})`
        : `Fondo infrarrojo FITS (${activeCutout.unidad})`,
    });
  }

  const handleRetryCutout = () => {
    setFrameErrors({});
    setReloadNonce((n) => n + 1);
  };

  return (
    <div className={fullViewport ? "h-full w-full" : "space-y-2"}>
      <div
        className={
          fullViewport
            ? "relative h-full w-full overflow-hidden"
            : "relative overflow-hidden rounded-lg border border-black/[.08] dark:border-white/[.145]"
        }
      >
        <canvas
          ref={canvasRef}
          className={
            fullViewport
              ? "block h-[calc(100vh-53px)] w-full cursor-grab select-none active:cursor-grabbing"
              : "block h-[420px] w-full cursor-crosshair select-none sm:h-[480px]"
          }
          onPointerDown={(e) => {
            dragRef.current = {
              active: true,
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
              startPanRa: panArcsec.ra,
              startPanDec: panArcsec.dec,
            };
            (e.currentTarget as HTMLCanvasElement).setPointerCapture(
              e.pointerId
            );
          }}
          onPointerMove={(e) => {
            const coords = clientToSkyOffsets(e.clientX, e.clientY);
            if (coords) {
              setCursorSky({ raDeg: coords.raDeg, decDeg: coords.decDeg });
            }
            if (!dragRef.current.active || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const pxPerArcsec = rect.height / fovArcsec;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (Math.hypot(dx, dy) > 4) {
              dragRef.current.moved = true;
            }
            setPanArcsec({
              ra: dragRef.current.startPanRa + dx / pxPerArcsec,
              dec: dragRef.current.startPanDec + dy / pxPerArcsec,
            });
          }}
          onPointerUp={(e) => {
            const wasClick = !dragRef.current.moved;
            dragRef.current.active = false;
            (e.currentTarget as HTMLCanvasElement).releasePointerCapture(
              e.pointerId
            );
            if (wasClick) {
              handleCanvasClick(e.clientX, e.clientY);
            }
          }}
          onPointerLeave={() => {
            dragRef.current.active = false;
            setCursorSky(null);
          }}
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 0.87;
            const next = Math.round(
              Math.min(MAX_FOV_ARCSEC, Math.max(MIN_FOV_ARCSEC, fovArcsec * factor))
            );
            onZoomChange(next);
          }}
        />

        {!activeCutout && !activeError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/[.08] bg-background/90 px-3.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-md dark:border-white/[.145]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Extrayendo píxeles reales del FITS…
            </div>
          </div>
        )}

        {!activeCutout && activeError && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-red-500/30 bg-background/95 p-4 text-center text-xs shadow-sm backdrop-blur-md">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <p className="text-foreground/85">{activeError}</p>
              <button
                type="button"
                onClick={handleRetryCutout}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
              >
                <RefreshCw className="h-3 w-3" />
                Reintentar FITS
              </button>
            </div>
          </div>
        )}

        {activeCutout && !activeCutout.coberturaWcs && (
          <div className="pointer-events-none absolute left-3 top-3 z-10">
            <span className="inline-flex items-center rounded-full border border-black/[.08] bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground/80 shadow-sm backdrop-blur-md dark:border-white/[.145]">
              FITS de referencia sin solapamiento WCS exacto · mostrando cuadro completo
            </span>
          </div>
        )}
      </div>

      {!fullViewport &&
        (cursorSky || panArcsec.ra !== 0 || panArcsec.dec !== 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/70 font-mono">
            <span>
              {cursorSky
                ? `${formatRAHMS(cursorSky.raDeg)}  ${formatDecDMS(
                    cursorSky.decDeg
                  )}`
                : ""}
            </span>
            {(panArcsec.ra !== 0 || panArcsec.dec !== 0) && (
              <button
                type="button"
                onClick={() => setPanArcsec({ ra: 0, dec: 0 })}
                className="rounded-full border border-black/[.08] px-2.5 py-0.5 text-xs font-sans hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                Centrar vista
              </button>
            )}
          </div>
        )}
    </div>
  );
}
