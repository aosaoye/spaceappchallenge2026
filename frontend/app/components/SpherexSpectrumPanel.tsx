"use client";

import { Layers, Sparkles, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { ChallengeTarget, Observacion } from "../astronomy";

export interface SelectedSkySource {
  id: string;
  label: string;
  raDeg: number;
  decDeg: number;
  dRaArcsec: number;
  dDecArcsec: number;
  isPrimaryTarget: boolean;
  spectralSlope: number;
  baseFlux: number;
  spectralType: string;
}

interface DetectorInfo {
  id: number;
  code: string;
  name: string;
  minUm: number;
  maxUm: number;
  resolvingPower: number;
  color: string;
  features: string;
}

export const SPHEREX_DETECTORS: DetectorInfo[] = [
  {
    id: 1,
    code: "D1",
    name: "SPHEREx-D1 (0.75-1.11 um)",
    minUm: 0.75,
    maxUm: 1.09,
    resolvingPower: 39,
    color: "#3b82f6",
    features: "Continuo óptico/NIR · TiO / VO / H₂O (0.93 µm)",
  },
  {
    id: 2,
    code: "D2",
    name: "SPHEREx-D2 (1.11-1.64 um)",
    minUm: 1.1,
    maxUm: 1.62,
    resolvingPower: 41,
    color: "#06b6d4",
    features: "Bandas J y H · Absorción CH₄ (1.15, 1.40 µm) y H₂O",
  },
  {
    id: 3,
    code: "D3",
    name: "SPHEREx-D3 (1.64-2.42 um)",
    minUm: 1.63,
    maxUm: 2.41,
    resolvingPower: 41,
    color: "#10b981",
    features: "Banda K · CH₄ (2.2 µm), CO (2.3 µm) y H₂O (1.9 µm)",
  },
  {
    id: 4,
    code: "D4",
    name: "SPHEREx-D4 (2.42-3.82 um)",
    minUm: 2.42,
    maxUm: 3.82,
    resolvingPower: 35,
    color: "#eab308",
    features: "Hielo H₂O (3.05 µm), CH₄ fundamental (3.3 µm), PAH",
  },
  {
    id: 5,
    code: "D5",
    name: "SPHEREx-D5 (3.82-4.42 um)",
    minUm: 3.83,
    maxUm: 4.41,
    resolvingPower: 112,
    color: "#f97316",
    features: "CO₂ (4.26 µm), ventana atmosférica 4.0 µm (R=112)",
  },
  {
    id: 6,
    code: "D6",
    name: "SPHEREx-D6 (4.42-5.00 um)",
    minUm: 4.42,
    maxUm: 5.0,
    resolvingPower: 128,
    color: "#ef4444",
    features: "Pico térmico 4.5–4.8 µm (enanas Y/T · WISE W2) y CO (4.67 µm)",
  },
];

interface SpectralChannel {
  channelIndex: number;
  detector: DetectorInfo;
  wavelengthUm: number;
  bandwidthUm: number;
  fluxMjySr: number;
}

function gaussian(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function generate102ChannelSpectrum(
  source: SelectedSkySource,
  activeTarget: ChallengeTarget | null,
  fluxMultiplier: number,
  stackByDetector: boolean
): SpectralChannel[] {
  const channels: SpectralChannel[] = [];
  let idx = 1;

  for (const det of SPHEREX_DETECTORS) {
    const numCh = 17; // 6 detectores × 17 canales = 102 canales espectrales LVF
    for (let i = 0; i < numCh; i++) {
      const frac = i / (numCh - 1);
      const wl = det.minUm + frac * (det.maxUm - det.minUm);
      const bw = wl / det.resolvingPower;

      let flux = 1.0;

      if (source.isPrimaryTarget && activeTarget) {
        if (activeTarget.id === "wise-0855") {
          // Enana marrón tipo Y (~250 K): flujo casi nulo en <2.5 µm, enorme pico en ventana de 4.5-4.8 µm (D6)
          flux =
            0.05 +
            0.12 * gaussian(wl, 1.05, 0.04) +
            0.18 * gaussian(wl, 1.27, 0.05) +
            0.15 * gaussian(wl, 1.58, 0.05) +
            0.42 * gaussian(wl, 3.95, 0.14) +
            3.65 * gaussian(wl, 4.62, 0.24) * (1 - 0.35 * gaussian(wl, 4.3, 0.08));
        } else if (activeTarget.id === "epsilon-indi-b") {
          // Binaria de enanas marrones T1 + T6: picos en J (1.25 µm), H (1.58 µm), K (2.1 µm) y 4.5 µm con profundas bandas CH4/H2O
          flux =
            0.22 +
            1.95 * gaussian(wl, 1.05, 0.06) +
            2.45 * gaussian(wl, 1.26, 0.07) +
            1.85 * gaussian(wl, 1.59, 0.08) +
            1.35 * gaussian(wl, 2.08, 0.1) +
            0.95 * gaussian(wl, 3.85, 0.18) +
            2.15 * gaussian(wl, 4.55, 0.25);
        } else if (activeTarget.id === "barnard") {
          // Enana roja M4V (~3130 K): pico en 1.0-1.6 µm con cola Rayleigh-Jeans y absorción de H2O/CO
          const blackbodyLike = Math.pow(wl, -1.35) * Math.exp(-0.95 / wl);
          const h2oDip =
            1 -
            0.18 * gaussian(wl, 1.4, 0.08) -
            0.22 * gaussian(wl, 1.9, 0.1) -
            0.25 * gaussian(wl, 2.7, 0.18) -
            0.16 * gaussian(wl, 2.35, 0.06);
          flux = 4.8 * blackbodyLike * h2oDip;
        } else if (activeTarget.id === "rw-aurigae") {
          // Estrella T Tauri con exceso infrarrojo de disco circunestelar cálido (crece hacia 3-5 µm)
          const stellar = 1.6 * Math.pow(wl / 1.0, -0.85);
          const diskExcess = 0.55 * Math.pow(wl / 1.5, 1.25);
          const iceFeature = 1 - 0.24 * gaussian(wl, 3.05, 0.14) + 0.22 * gaussian(wl, 4.67, 0.09);
          flux = (stellar + diskExcess) * iceFeature * fluxMultiplier;
        } else if (activeTarget.id === "r-draconis") {
          // Variable Mira M6e: fuerte emisión NIR con profundas bandas moleculares de H2O (1.4, 1.9, 2.7 µm) y CO (2.3, 4.6 µm)
          const coolGiant = 3.2 * Math.pow(wl / 1.2, -0.65) * Math.exp(-0.4 / wl);
          const molBands =
            1 -
            0.32 * gaussian(wl, 1.42, 0.09) -
            0.38 * gaussian(wl, 1.92, 0.11) -
            0.42 * gaussian(wl, 2.75, 0.22) -
            0.28 * gaussian(wl, 4.65, 0.14);
          flux = Math.max(0.15, coolGiant * molBands * fluxMultiplier);
        } else {
          // Fuente de campo SPHEREx DR1
          flux =
            1.4 * Math.pow(wl / 1.2, -0.75) *
            (1 - 0.15 * gaussian(wl, 1.88, 0.09) - 0.18 * gaussian(wl, 2.7, 0.15));
        }
      } else {
        // Estrella de fondo seleccionada con clic en el visor
        const slope = source.spectralSlope;
        const base = Math.max(0.25, source.baseFlux);
        flux =
          base *
          Math.pow(wl / 1.5, slope - 0.65) *
          (1 - 0.14 * gaussian(wl, 1.4, 0.07) - 0.16 * gaussian(wl, 1.9, 0.09) - 0.15 * gaussian(wl, 2.32, 0.06));
      }

      // Si no está apilado por detector, añadir una ligera dispersión instrumental realista
      const jitter = stackByDetector
        ? 1.0
        : 1.0 + Math.sin(idx * 12.9898 + source.raDeg) * 0.035;

      channels.push({
        channelIndex: idx++,
        detector: det,
        wavelengthUm: Number(wl.toFixed(3)),
        bandwidthUm: Number(bw.toFixed(4)),
        fluxMjySr: Number(Math.max(0.02, flux * jitter).toFixed(3)),
      });
    }
  }

  return channels;
}

interface SpherexSpectrumPanelProps {
  selectedSource: SelectedSkySource;
  activeTarget: ChallengeTarget | null;
  rawObservations: Observacion[];
  selectedBandFilter: string;
  stackByDetector: boolean;
  fluxMultiplier: number;
  onSelectBandFilter: (band: string) => void;
  onToggleStackByDetector: (next: boolean) => void;
}

export default function SpherexSpectrumPanel({
  selectedSource,
  activeTarget,
  rawObservations,
  selectedBandFilter,
  stackByDetector,
  fluxMultiplier,
  onSelectBandFilter,
  onToggleStackByDetector,
}: SpherexSpectrumPanelProps) {
  const [hoveredChannel, setHoveredChannel] = useState<SpectralChannel | null>(
    null
  );

  const channels = useMemo(
    () =>
      generate102ChannelSpectrum(
        selectedSource,
        activeTarget,
        fluxMultiplier,
        stackByDetector
      ),
    [selectedSource, activeTarget, fluxMultiplier, stackByDetector]
  );

  // Conteo de exposiciones por detector D1..D6 para apilado (coadd)
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

  const maxFlux = useMemo(
    () => Math.max(0.5, ...channels.map((c) => c.fluxMjySr)),
    [channels]
  );

  const svgW = 720;
  const svgH = 210;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 32;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const wlToX = (wl: number) =>
    padL + ((wl - 0.75) / (5.0 - 0.75)) * plotW;
  const fluxToY = (f: number) =>
    padT + plotH - Math.min(1, Math.max(0, f / (maxFlux * 1.1))) * plotH;

  const polylinePoints = channels
    .map((ch) => `${wlToX(ch.wavelengthUm).toFixed(1)},${fluxToY(ch.fluxMjySr).toFixed(1)}`)
    .join(" ");

  const activePoint = hoveredChannel ?? channels[Math.min(92, channels.length - 1)];

  return (
    <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Waves className="h-4 w-4 text-foreground/80" />
          <h2 className="text-sm font-semibold">Espectro SPHEREx</h2>
          <span className="rounded-full border border-black/[.08] bg-black/[.04] px-2.5 py-0.5 font-mono text-[11px] dark:border-white/[.145] dark:bg-white/[.06]">
            {selectedSource.label}
          </span>
        </div>

        {/* Botón de Apilado / Coadd por detector */}
        <button
          type="button"
          onClick={() => onToggleStackByDetector(!stackByDetector)}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
            stackByDetector
              ? "bg-foreground text-background"
              : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{stackByDetector ? "Apilado activo" : "Apilar D1–D6"}</span>
        </button>
      </div>

      {/* Selector de agrupación por los 6 detectores de SPHEREx */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelectBandFilter("Todas")}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
            selectedBandFilter === "Todas"
              ? "bg-foreground text-background"
              : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          }`}
        >
          <span>Todos</span>
        </button>
        {SPHEREX_DETECTORS.map((det) => {
          const isSelected = selectedBandFilter.includes(det.code);
          const count = detectorCounts[det.code] || 1;
          return (
            <button
              key={det.code}
              type="button"
              title={`${det.code} (${det.minUm}–${det.maxUm} µm) · ${count} exp`}
              onClick={() =>
                onSelectBandFilter(isSelected ? "Todas" : det.name)
              }
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-foreground text-background"
                  : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: det.color }}
              />
              <span>{det.code}</span>
            </button>
          );
        })}
      </div>

      {/* Gráfico interactivo SVG de los 102 canales espectrales */}
      <div className="mt-3 overflow-hidden rounded-lg border border-black/[.08] bg-black/[.02] p-3 dark:border-white/[.145] dark:bg-white/[.02]">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="h-48 w-full select-none overflow-visible"
          role="img"
          aria-label={`Espectro infrarrojo SPHEREx de ${selectedSource.label}`}
        >
          {/* Regiones sombreadas de los 6 detectores */}
          {SPHEREX_DETECTORS.map((det) => {
            const x1 = wlToX(det.minUm);
            const x2 = wlToX(det.maxUm);
            const isHighlighted =
              selectedBandFilter === "Todas" ||
              selectedBandFilter.includes(det.code);
            return (
              <g key={det.code}>
                <rect
                  x={x1}
                  y={padT}
                  width={Math.max(2, x2 - x1)}
                  height={plotH}
                  fill={det.color}
                  fillOpacity={isHighlighted ? 0.09 : 0.02}
                />
                <text
                  x={(x1 + x2) / 2}
                  y={padT + 12}
                  textAnchor="middle"
                  fill={det.color}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {det.code}
                </text>
              </g>
            );
          })}

          {/* Ejes de referencia */}
          <line
            x1={padL}
            y1={padT + plotH}
            x2={svgW - padR}
            y2={padT + plotH}
            stroke="currentColor"
            strokeOpacity={0.25}
          />
          <line
            x1={padL}
            y1={padT}
            x2={padL}
            y2={padT + plotH}
            stroke="currentColor"
            strokeOpacity={0.25}
          />

          {/* Marcas de longitud de onda (µm) */}
          {[0.75, 1.5, 2.5, 3.8, 5.0].map((tick) => {
            const x = wlToX(tick);
            return (
              <g key={tick}>
                <line
                  x1={x}
                  y1={padT}
                  x2={x}
                  y2={padT + plotH}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeDasharray="2 3"
                />
                <text
                  x={x}
                  y={svgH - 8}
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity={0.7}
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {tick} µm
                </text>
              </g>
            );
          })}

          {/* Etiqueta eje Y */}
          <text
            x={12}
            y={padT + plotH / 2}
            transform={`rotate(-90 12 ${padT + plotH / 2})`}
            textAnchor="middle"
            fill="currentColor"
            fillOpacity={0.65}
            fontSize="10"
            fontFamily="monospace"
          >
            MJy/sr
          </text>

          {/* Curva espectral continua */}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.65}
            strokeWidth={1.75}
            points={polylinePoints}
          />

          {/* 102 puntos de canal LVF interactivos */}
          {channels.map((ch) => {
            const cx = wlToX(ch.wavelengthUm);
            const cy = fluxToY(ch.fluxMjySr);
            const isHovered = activePoint?.channelIndex === ch.channelIndex;
            return (
              <circle
                key={ch.channelIndex}
                cx={cx}
                cy={cy}
                r={isHovered ? 5 : 2.7}
                fill={ch.detector.color}
                stroke={isHovered ? "currentColor" : "none"}
                strokeWidth={1.5}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredChannel(ch)}
                onClick={() => onSelectBandFilter(ch.detector.name)}
              />
            );
          })}
        </svg>

        {/* Telemetría del canal espectral bajo el cursor */}
        {activePoint && (
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-black/[.08] pt-2 text-xs font-mono dark:border-white/[.145]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              #{activePoint.channelIndex}/102 · {activePoint.detector.code}
            </span>
            <span>λ {activePoint.wavelengthUm.toFixed(2)} µm</span>
            <span>{activePoint.fluxMjySr.toFixed(2)} MJy/sr</span>
          </div>
        )}
      </div>
    </section>
  );
}
