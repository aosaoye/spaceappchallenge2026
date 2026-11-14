"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  CHALLENGE_TARGETS,
  ChallengeTarget,
  EpochFrame,
  formatDecDMS,
  formatRAHMS,
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
  view360?: boolean;
}

interface BackgroundStar {
  id: string;
  dRaArcsec: number;
  dDecArcsec: number;
  baseFlux: number;
  spectralSlope: number;
}

const GRID_W = 380;
const GRID_H = 260;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateBackgroundStars(
  raDeg: number,
  decDeg: number
): BackgroundStar[] {
  const seed =
    (Math.round(raDeg * 1000) * 73856093) ^
    (Math.round((decDeg + 90) * 1000) * 19349663);
  const rand = mulberry32(seed);
  const stars: BackgroundStar[] = [];

  for (let i = 0; i < 140; i++) {
    const dRaArcsec = (rand() - 0.5) * 420;
    const dDecArcsec = (rand() - 0.5) * 320;
    if (Math.hypot(dRaArcsec, dDecArcsec) < 4.5) continue;
    const u = rand();
    const baseFlux = 0.08 + Math.pow(u, 3.2) * 3.8;
    const spectralSlope = (rand() - 0.5) * 0.45;
    stars.push({
      id: `SPX-STAR-${i + 1}`,
      dRaArcsec,
      dDecArcsec,
      baseFlux,
      spectralSlope,
    });
  }
  return stars;
}

function getBandIndex(bandLabel: string): number {
  const match = bandLabel.match(/D(\d)/i);
  return match ? Number.parseInt(match[1], 10) : 2;
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

  // Fase progresiva por fotograma para garantizar variación fotométrica nítida entre épocas
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
  if (!frame) return { dRaArcsec: 0, dDecArcsec: 0 };
  const dtYears = frame.yearsFromRef - midYears;
  if (!target) {
    return {
      dRaArcsec: -4.2 * dtYears,
      dDecArcsec: 2.5 * dtYears,
    };
  }
  return {
    dRaArcsec: (target.pmRaMasYr * dtYears) / 1000,
    dDecArcsec: (target.pmDecMasYr * dtYears) / 1000,
  };
}

function addGaussianSource(
  buffer: Float32Array,
  cx: number,
  cy: number,
  sigmaPx: number,
  amplitude: number
) {
  const radius = Math.ceil(sigmaPx * 4.5);
  const xMin = Math.max(0, Math.floor(cx - radius));
  const xMax = Math.min(GRID_W - 1, Math.ceil(cx + radius));
  const yMin = Math.max(0, Math.floor(cy - radius));
  const yMax = Math.min(GRID_H - 1, Math.ceil(cy + radius));
  const invTwoSigmaSq = 1 / (2 * sigmaPx * sigmaPx);

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    const rowOffset = y * GRID_W;
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const r2 = dx * dx + dy * dy;
      buffer[rowOffset + x] += amplitude * Math.exp(-r2 * invTwoSigmaSq);
    }
  }
}

function renderEpochFluxBuffer(params: {
  frame: EpochFrame;
  midYears: number;
  stars: BackgroundStar[];
  target: ChallengeTarget | null;
  panRaArcsec: number;
  panDecArcsec: number;
  fovArcsec: number;
  stackByDetector: boolean;
  showHistoricalCatalogOverlay: boolean;
}): Float32Array {
  const {
    frame,
    midYears,
    stars,
    target,
    panRaArcsec,
    panDecArcsec,
    fovArcsec,
    stackByDetector,
    showHistoricalCatalogOverlay,
  } = params;

  const buffer = new Float32Array(GRID_W * GRID_H);
  const pxPerArcsec = GRID_H / fovArcsec;
  const psfSharpness = stackByDetector ? 0.84 : 1.0;
  const psfSigmaPx =
    Math.max(0.95, Math.min(4.2, 1.35 * pxPerArcsec)) * psfSharpness;
  const bandIdx = getBandIndex(frame.observacion.banda_espectral);

  // Al apilar por detector (Coadd), el ruido de lectura disminuye por 1/√N
  const noiseRand = mulberry32(1013904223 + frame.index * 9176);
  const zodiBase = 0.04 + bandIdx * 0.006;
  const noiseScale = stackByDetector ? 0.009 : 0.028;

  for (let y = 0; y < GRID_H; y++) {
    const grad = (y / GRID_H) * 0.015;
    const rowOffset = y * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const n = (noiseRand() + noiseRand() - 1) * noiseScale;
      buffer[rowOffset + x] = zodiBase + grad + n;
    }
  }

  const skyToGrid = (dRaArcsec: number, dDecArcsec: number) => ({
    gx: GRID_W / 2 - (dRaArcsec - panRaArcsec) * pxPerArcsec,
    gy: GRID_H / 2 - (dDecArcsec - panDecArcsec) * pxPerArcsec,
  });

  // Render static background field stars
  const snrBoost = stackByDetector ? 1.25 : 1.0;
  for (const star of stars) {
    const { gx, gy } = skyToGrid(star.dRaArcsec, star.dDecArcsec);
    if (gx < -12 || gx > GRID_W + 12 || gy < -12 || gy > GRID_H + 12) continue;
    const bandMod = 1 + star.spectralSlope * ((bandIdx - 3) / 3);
    const amp = Math.max(0.04, star.baseFlux * bandMod * snrBoost);
    addGaussianSource(buffer, gx, gy, psfSigmaPx, amp);
  }

  // Si está activa la superposición histórica AllWISE (2010.5), dibujar también la huella tenue de la posición antigua
  if (
    showHistoricalCatalogOverlay &&
    target &&
    (target.category === "high-proper-motion" ||
      target.category === "binary-brown-dwarf")
  ) {
    // Posición hace 4 años (Gaia/NEOWISE) y hace 15 años (AllWISE 2010.5)
    const dtWiseYears = -3.0; // Escala visual comprimida dentro del recorte + posición exacta
    const wisePos = skyToGrid(
      (target.pmRaMasYr * dtWiseYears) / 1000,
      (target.pmDecMasYr * dtWiseYears) / 1000
    );
    addGaussianSource(buffer, wisePos.gx, wisePos.gy, psfSigmaPx * 1.25, 1.15);
  }

  // Render primary challenge target (or field reference center source)
  const { dRaArcsec, dDecArcsec } = computeTargetOffsetArcsec(
    target,
    frame,
    midYears
  );
  const fluxMult = computeTargetFluxMultiplier(target, frame) * snrBoost;

  if (target?.companionSeparationArcsec) {
    // Par binario de enanas marrones (Epsilon Indi Ba + Bb) + componente brillante comóvil
    const angle = 0.55 + frame.yearsFromRef * 0.18;
    const visualSep = Math.max(
      target.companionSeparationArcsec * 2.2,
      fovArcsec * 0.028
    );
    const halfSep = visualSep * 0.5;
    const ba = skyToGrid(
      dRaArcsec - Math.cos(angle) * halfSep,
      dDecArcsec - Math.sin(angle) * halfSep
    );
    const bb = skyToGrid(
      dRaArcsec + Math.cos(angle) * halfSep,
      dDecArcsec + Math.sin(angle) * halfSep
    );
    addGaussianSource(buffer, ba.gx, ba.gy, psfSigmaPx * 1.18, 3.2 * fluxMult);
    addGaussianSource(buffer, bb.gx, bb.gy, psfSigmaPx * 1.02, 2.1 * fluxMult);

    // Fuente brillante comóvil en la esquina inferior izquierda (como en WiseView)
    const comovingBright = skyToGrid(dRaArcsec + 16, dDecArcsec - 14);
    addGaussianSource(
      buffer,
      comovingBright.gx,
      comovingBright.gy,
      psfSigmaPx * 1.65,
      4.4 * snrBoost
    );
  } else if (target) {
    const pos = skyToGrid(dRaArcsec, dDecArcsec);
    const isVar = target.category === "variable-star";
    const baseAmp = isVar ? 2.8 : 3.2;
    const dynamicSigma = isVar
      ? psfSigmaPx * (0.72 + 0.58 * Math.sqrt(fluxMult))
      : psfSigmaPx * 1.18;
    addGaussianSource(buffer, pos.gx, pos.gy, dynamicSigma, baseAmp * fluxMult);
  } else {
    const pos = skyToGrid(dRaArcsec, dDecArcsec);
    addGaussianSource(
      buffer,
      pos.gx,
      pos.gy,
      psfSigmaPx * 1.15,
      2.6 * snrBoost
    );
  }

  return buffer;
}

function mapFluxToRgb(
  val: number,
  isDifference: boolean,
  stretchGain: number,
  colormap: ColormapMode
): [number, number, number] {
  if (isDifference) {
    const norm = Math.tanh(val * stretchGain * 1.15);
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

  const shifted = Math.max(0, val - 0.02);
  const stretched =
    Math.asinh(shifted * stretchGain * 2.4) / Math.asinh(4.5 * stretchGain);
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

function Camera360Rig({
  yawDeg,
  pitchDeg,
  fovArcsec,
}: {
  yawDeg: number;
  pitchDeg: number;
  fovArcsec: number;
}) {
  const { camera } = useThree();
  const targetVecRef = useRef(new THREE.Vector3(0, 0, -1));

  useFrame(() => {
    const yawRad = THREE.MathUtils.degToRad(yawDeg);
    const pitchRad = THREE.MathUtils.degToRad(
      Math.max(-85, Math.min(85, pitchDeg))
    );
    const x = -Math.sin(yawRad) * Math.cos(pitchRad);
    const y = Math.sin(pitchRad);
    const z = -Math.cos(yawRad) * Math.cos(pitchRad);

    targetVecRef.current.set(x * 100, y * 100, z * 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(targetVecRef.current);

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = Math.max(
        22,
        Math.min(88, 22 + (fovArcsec / 240) * 60)
      );
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.25);
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}

function AllSky360Stars({
  centerRaDeg,
  centerDecDeg,
  stretchGain,
  colormap,
}: {
  centerRaDeg: number;
  centerDecDeg: number;
  stretchGain: number;
  colormap: ColormapMode;
}) {
  const { positions, colors } = useMemo(() => {
    const total = 3600;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const rand = mulberry32(
      Math.round(centerRaDeg * 100 + (centerDecDeg + 90) * 100) ^ 0x9e3779b9
    );

    const isInverted = colormap === "wiseview-inverted";
    const isThermal = colormap === "infrared";

    for (let i = 0; i < total; i++) {
      // Distribución isótropa en 360° + banda galáctica infrarroja SPHEREx
      const isGalacticPlane = i < 1200;
      const lon = rand() * Math.PI * 2;
      let lat: number;
      if (isGalacticPlane) {
        const u1 = Math.max(1e-5, rand());
        const u2 = rand();
        const gauss =
          Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gauss * 0.16));
      } else {
        lat = Math.asin(2 * rand() - 1);
      }

      const r = 92;
      let x = r * Math.cos(lat) * Math.sin(lon);
      let y = r * Math.sin(lat);
      let z = -r * Math.cos(lat) * Math.cos(lon);

      if (isGalacticPlane) {
        const tilt = 0.58;
        const ny = y * Math.cos(tilt) - z * Math.sin(tilt);
        const nz = y * Math.sin(tilt) + z * Math.cos(tilt);
        y = ny;
        z = nz;
      }

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      const temp = rand();
      const bright = Math.min(
        1,
        (0.35 + Math.pow(rand(), 2.2) * 0.65) * Math.min(1.6, stretchGain)
      );

      if (isInverted) {
        const v = Math.max(0.05, 1 - bright * 0.88);
        col[i * 3] = v;
        col[i * 3 + 1] = v;
        col[i * 3 + 2] = Math.min(1, v + 0.04);
      } else if (isThermal) {
        col[i * 3] = Math.min(1, bright * 1.15);
        col[i * 3 + 1] = bright * (0.45 + temp * 0.45);
        col[i * 3 + 2] = bright * (0.15 + temp * 0.25);
      } else {
        // Colores estelares espectrales realistas (O/B azulados, G/K blancos/ámbar, M rojizos)
        if (temp < 0.22) {
          col[i * 3] = bright * 1.0;
          col[i * 3 + 1] = bright * 0.68;
          col[i * 3 + 2] = bright * 0.48;
        } else if (temp < 0.68) {
          col[i * 3] = bright * 0.98;
          col[i * 3 + 1] = bright * 0.95;
          col[i * 3 + 2] = bright * 0.88;
        } else {
          col[i * 3] = bright * 0.76;
          col[i * 3 + 1] = bright * 0.88;
          col[i * 3 + 2] = bright * 1.0;
        }
      }
    }

    return { positions: pos, colors: col };
  }, [centerRaDeg, centerDecDeg, stretchGain, colormap]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={2.1}
        sizeAttenuation={false}
        transparent
        opacity={0.92}
      />
    </points>
  );
}

function CelestialGrid360({
  showGrid,
  isLightSky,
}: {
  showGrid: boolean;
  isLightSky: boolean;
}) {
  const linePositions = useMemo(() => {
    const pts: number[] = [];
    const r = 88;
    const segs = 72;

    // Paralelos de declinación (-60°, -30°, 0°, +30°, +60°)
    const decList = showGrid ? [-60, -30, 0, 30, 60] : [0];
    for (const decDeg of decList) {
      const lat = THREE.MathUtils.degToRad(decDeg);
      const y = r * Math.sin(lat);
      const rad = r * Math.cos(lat);
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        pts.push(
          rad * Math.sin(a0),
          y,
          -rad * Math.cos(a0),
          rad * Math.sin(a1),
          y,
          -rad * Math.cos(a1)
        );
      }
    }

    // Meridianos de ascensión recta cada 30° (2h)
    const raStep = showGrid ? 30 : 90;
    for (let raDeg = 0; raDeg < 360; raDeg += raStep) {
      const lon = THREE.MathUtils.degToRad(raDeg);
      for (let i = 0; i < segs; i++) {
        const lat0 = -Math.PI / 2 + (i / segs) * Math.PI;
        const lat1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI;
        pts.push(
          r * Math.cos(lat0) * Math.sin(lon),
          r * Math.sin(lat0),
          -r * Math.cos(lat0) * Math.cos(lon),
          r * Math.cos(lat1) * Math.sin(lon),
          r * Math.sin(lat1),
          -r * Math.cos(lat1) * Math.cos(lon)
        );
      }
    }

    return new Float32Array(pts);
  }, [showGrid]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[linePositions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={isLightSky ? "#171717" : "#38bdf8"}
        transparent
        opacity={showGrid ? 0.24 : 0.1}
      />
    </lineSegments>
  );
}

function SkySphere360Scene({
  centerRaDeg,
  centerDecDeg,
  frames,
  activeFrame,
  midYears,
  activeTarget,
  fovArcsec,
  stretchGain,
  colormap,
  showGrid,
  showTargetOverlay,
  showHistoricalCatalogOverlay,
  yawDeg,
  pitchDeg,
  onSelectSkySource,
}: {
  centerRaDeg: number;
  centerDecDeg: number;
  frames: EpochFrame[];
  activeFrame: EpochFrame;
  midYears: number;
  activeTarget: ChallengeTarget | null;
  fovArcsec: number;
  stretchGain: number;
  colormap: ColormapMode;
  showGrid: boolean;
  showTargetOverlay: boolean;
  showHistoricalCatalogOverlay: boolean;
  yawDeg: number;
  pitchDeg: number;
  onSelectSkySource?: (source: SelectedSkySource) => void;
}) {
  const isLightSky = colormap === "wiseview-inverted";
  const localStars = useMemo(
    () => generateBackgroundStars(centerRaDeg, centerDecDeg),
    [centerRaDeg, centerDecDeg]
  );

  // Convierte desplazamientos locales en arcsec (dRa, dDec) a coordenadas 3D frente al observador
  const arcsecTo3D = (
    dRaArcsec: number,
    dDecArcsec: number,
    dist = 42
  ): [number, number, number] => {
    const scale = 0.22;
    const az = THREE.MathUtils.degToRad(-dRaArcsec * scale);
    const el = THREE.MathUtils.degToRad(dDecArcsec * scale);
    return [
      dist * Math.cos(el) * Math.sin(az),
      dist * Math.sin(el),
      -dist * Math.cos(el) * Math.cos(az),
    ];
  };

  const curOffset = computeTargetOffsetArcsec(
    activeTarget,
    activeFrame,
    midYears
  );
  const fluxMult = computeTargetFluxMultiplier(activeTarget, activeFrame);
  const targetPos = arcsecTo3D(curOffset.dRaArcsec, curOffset.dDecArcsec, 40);

  const trajectoryPoints = useMemo(() => {
    if (frames.length < 2) return null;
    const first = computeTargetOffsetArcsec(activeTarget, frames[0], midYears);
    const last = computeTargetOffsetArcsec(
      activeTarget,
      frames[frames.length - 1],
      midYears
    );
    const p0 = arcsecTo3D(first.dRaArcsec, first.dDecArcsec, 40);
    const p1 = arcsecTo3D(last.dRaArcsec, last.dDecArcsec, 40);
    return new Float32Array([...p0, ...p1]);
  }, [activeTarget, frames, midYears]);

  const wiseOldPos = useMemo(() => {
    if (!activeTarget) return null;
    const dRa = (activeTarget.pmRaMasYr * -3.0) / 1000;
    const dDec = (activeTarget.pmDecMasYr * -3.0) / 1000;
    return arcsecTo3D(dRa, dDec, 40);
  }, [activeTarget]);

  const bgColor = isLightSky
    ? "#f6f7f9"
    : colormap === "infrared"
    ? "#0b0308"
    : "#04060b";

  return (
    <>
      <color attach="background" args={[bgColor]} />
      <Camera360Rig
        yawDeg={yawDeg}
        pitchDeg={pitchDeg}
        fovArcsec={fovArcsec}
      />

      {/* Domo esférico 360° de fondo */}
      <mesh>
        <sphereGeometry args={[96, 48, 32]} />
        <meshBasicMaterial
          color={bgColor}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Estrellas 360° de todo el cielo + Vía Láctea Infrarroja */}
      <AllSky360Stars
        centerRaDeg={centerRaDeg}
        centerDecDeg={centerDecDeg}
        stretchGain={stretchGain}
        colormap={colormap}
      />

      {/* Rejilla celeste 360° (RA / Dec) */}
      <CelestialGrid360 showGrid={showGrid} isLightSky={isLightSky} />

      {/* Estrellas de campo de la región SPHEREx activa (interactivas con clic) */}
      <group>
        {localStars.slice(0, 75).map((st) => {
          const pos = arcsecTo3D(st.dRaArcsec, st.dDecArcsec, 42);
          const radius = Math.max(
            0.12,
            Math.min(0.46, 0.11 + Math.sqrt(st.baseFlux) * 0.14 * stretchGain)
          );
          const starColor = isLightSky
            ? "#1e293b"
            : colormap === "infrared"
            ? "#fb923c"
            : st.spectralSlope > 0.1
            ? "#fdba74"
            : "#e2e8f0";
          return (
            <mesh
              key={st.id}
              position={pos}
              onClick={(e) => {
                e.stopPropagation();
                if (!onSelectSkySource) return;
                const cosDec = Math.max(
                  0.1,
                  Math.cos((centerDecDeg * Math.PI) / 180)
                );
                const stRa =
                  (((centerRaDeg + st.dRaArcsec / (3600 * cosDec)) % 360) +
                    360) %
                  360;
                const stDec = Math.max(
                  -90,
                  Math.min(90, centerDecDeg + st.dDecArcsec / 3600)
                );
                onSelectSkySource({
                  id: st.id,
                  label: `Estrella de campo ${st.id}`,
                  raDeg: stRa,
                  decDeg: stDec,
                  dRaArcsec: st.dRaArcsec,
                  dDecArcsec: st.dDecArcsec,
                  isPrimaryTarget: false,
                  spectralSlope: st.spectralSlope,
                  baseFlux: st.baseFlux,
                  spectralType:
                    st.spectralSlope > 0.1
                      ? "Enana M / Fuente fría IR"
                      : "Estrella de secuencia principal G/K",
                });
              }}
            >
              <sphereGeometry args={[radius, 12, 12]} />
              <meshBasicMaterial color={starColor} />
            </mesh>
          );
        })}
      </group>

      {/* Otros objetos del reto distribuidos por la bóveda celeste 360° */}
      <group>
        {CHALLENGE_TARGETS.filter((t) => t.id !== activeTarget?.id).map((t) => {
          const dRaDeg = t.raDeg - centerRaDeg;
          const dDecDeg = t.decDeg - centerDecDeg;
          const lon = THREE.MathUtils.degToRad(-dRaDeg);
          const lat = THREE.MathUtils.degToRad(dDecDeg * 0.6);
          const r = 75;
          const pos: [number, number, number] = [
            r * Math.cos(lat) * Math.sin(lon),
            r * Math.sin(lat),
            -r * Math.cos(lat) * Math.cos(lon),
          ];
          return (
            <mesh key={t.id} position={pos}>
              <sphereGeometry args={[0.55, 16, 16]} />
              <meshBasicMaterial
                color={isLightSky ? "#0284c7" : "#38bdf8"}
              />
            </mesh>
          );
        })}
      </group>

      {/* Trayectoria temporal 3D y comparación con AllWISE (2010) */}
      {showTargetOverlay && trajectoryPoints && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[trajectoryPoints, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={isLightSky ? "#171717" : "#38bdf8"}
            transparent
            opacity={0.75}
          />
        </line>
      )}

      {showHistoricalCatalogOverlay && wiseOldPos && (
        <mesh position={wiseOldPos}>
          <ringGeometry args={[0.55, 0.72, 24]} />
          <meshBasicMaterial
            color="#f59e0b"
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}

      {/* Estrella objetivo principal animada entre épocas en el espacio 3D */}
      <group
        position={targetPos}
        onClick={(e) => {
          e.stopPropagation();
          onSelectSkySource?.({
            id: activeTarget?.id ?? "primary-center",
            label: activeTarget?.name ?? "Objeto central SPHEREx",
            raDeg: centerRaDeg,
            decDeg: centerDecDeg,
            dRaArcsec: curOffset.dRaArcsec,
            dDecArcsec: curOffset.dDecArcsec,
            isPrimaryTarget: true,
            spectralSlope: 0,
            baseFlux: 2.8 * fluxMult,
            spectralType:
              activeTarget?.categoryLabel ?? "Fuente puntual infrarroja",
          });
        }}
      >
        <mesh>
          <sphereGeometry
            args={[
              Math.max(0.35, Math.min(1.15, 0.48 * Math.sqrt(fluxMult))),
              24,
              24,
            ]}
          />
          <meshBasicMaterial
            color={
              isLightSky
                ? "#0f172a"
                : activeTarget?.id === "wise-0855"
                ? "#f97316"
                : "#fde047"
            }
          />
        </mesh>

        {/* Compañera binaria en 3D para Epsilon Indi B (Ba + Bb) */}
        {activeTarget?.category === "binary-brown-dwarf" && (
          <mesh position={[-0.95, 0.42, 0]}>
            <sphereGeometry args={[0.32, 16, 16]} />
            <meshBasicMaterial
              color={isLightSky ? "#334155" : "#fb923c"}
            />
          </mesh>
        )}

        {/* Anillo marcador 3D alrededor de la muestra activa */}
        {showTargetOverlay && (
          <mesh>
            <ringGeometry
              args={[
                1.05 * Math.sqrt(fluxMult),
                1.22 * Math.sqrt(fluxMult),
                32,
              ]}
            />
            <meshBasicMaterial
              color={isLightSky ? "#171717" : "#ffffff"}
              side={THREE.DoubleSide}
              transparent
              opacity={0.85}
            />
          </mesh>
        )}
      </group>
    </>
  );
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
  view360 = false,
}: SkyVideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const [panArcsec, setPanArcsec] = useState<{ ra: number; dec: number }>({
    ra: 0,
    dec: 0,
  });
  const [rot360, setRot360] = useState<{ yaw: number; pitch: number }>({
    yaw: 0,
    pitch: 0,
  });
  const rotDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
  });
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

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
      offscreenRef.current.width = GRID_W;
      offscreenRef.current.height = GRID_H;
    }
    const offscreen = offscreenRef.current;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const stars = generateBackgroundStars(centerRaDeg, centerDecDeg);
    const currentBuffer = renderEpochFluxBuffer({
      frame: activeFrame,
      midYears,
      stars,
      target: activeTarget,
      panRaArcsec: panArcsec.ra,
      panDecArcsec: panArcsec.dec,
      fovArcsec,
      stackByDetector,
      showHistoricalCatalogOverlay,
    });

    const isDiff = playbackMode === "difference" && Boolean(refFrame);
    const isSum = playbackMode === "sum" && Boolean(refFrame);
    let displayBuffer = currentBuffer;

    if ((isDiff || isSum) && refFrame) {
      const refBuffer = renderEpochFluxBuffer({
        frame: refFrame,
        midYears,
        stars,
        target: activeTarget,
        panRaArcsec: panArcsec.ra,
        panDecArcsec: panArcsec.dec,
        fovArcsec,
        stackByDetector,
        showHistoricalCatalogOverlay,
      });
      displayBuffer = new Float32Array(currentBuffer.length);
      if (isDiff) {
        for (let i = 0; i < currentBuffer.length; i++) {
          displayBuffer[i] = currentBuffer[i] - refBuffer[i];
        }
      } else {
        for (let i = 0; i < currentBuffer.length; i++) {
          displayBuffer[i] = (currentBuffer[i] + refBuffer[i]) * 0.58;
        }
      }
    }

    const imgData = offCtx.createImageData(GRID_W, GRID_H);
    const pixels = imgData.data;
    for (let i = 0; i < displayBuffer.length; i++) {
      const [r, g, b] = mapFluxToRgb(
        displayBuffer[i],
        isDiff,
        stretchGain,
        colormap
      );
      const p = i * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }
    offCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, cssWidth, cssHeight);

    const pxPerArcsec = cssHeight / fovArcsec;
    const skyToCss = (dRaArcsec: number, dDecArcsec: number) => ({
      x: cssWidth / 2 - (dRaArcsec - panArcsec.ra) * pxPerArcsec,
      y: cssHeight / 2 - (dDecArcsec - panArcsec.dec) * pxPerArcsec,
    });

    const isLightSky = colormap === "wiseview-inverted";
    const overlayMuted = isLightSky
      ? "rgba(23, 23, 23, 0.28)"
      : "rgba(237, 237, 237, 0.28)";
    const overlayText = isLightSky
      ? "rgba(23, 23, 23, 0.82)"
      : "rgba(237, 237, 237, 0.88)";
    const overlayAccent = isLightSky ? "#171717" : "#ededed";

    // Optional WCS Grid
    if (showGrid) {
      const stepArcsec = fovArcsec > 140 ? 40 : fovArcsec > 65 ? 20 : 10;
      ctx.strokeStyle = overlayMuted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let off = -180; off <= 180; off += stepArcsec) {
        const vx = skyToCss(off, 0).x;
        if (vx >= 0 && vx <= cssWidth) {
          ctx.beginPath();
          ctx.moveTo(vx, 0);
          ctx.lineTo(vx, cssHeight);
          ctx.stroke();
        }
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

    // Optional Central Crosshair
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

    // Comparación con catálogos antiguos (AllWISE 2010 / Gaia DR3 2016)
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

      // Vector desde posición antigua (WISE/Gaia) hasta época actual SPHEREx
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pWise.x, pWise.y);
      ctx.lineTo(pCur.x, pCur.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marcador AllWISE (ámbar)
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pWise.x, pWise.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "10px monospace";
      ctx.fillStyle = isLightSky ? "#b45309" : "#fbbf24";
      ctx.fillText("WISE/NEOWISE (época antigua)", pWise.x + 13, pWise.y + 3);

      // Marcador Gaia DR3 (cian)
      ctx.strokeStyle = "#06b6d4";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(pGaia.x - 5, pGaia.y - 5, 10, 10);
      ctx.stroke();
      ctx.fillStyle = isLightSky ? "#0e7490" : "#22d3ee";
      ctx.fillText("Gaia DR3", pGaia.x + 10, pGaia.y - 4);
    }

    // Optional Target Motion / Variability Overlay
    if (showTargetOverlay) {
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

      // Puntos de posición de cada época a lo largo de la trayectoria
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

      const mult = computeTargetFluxMultiplier(activeTarget, activeFrame);
      const ringRadius =
        activeTarget?.category === "variable-star"
          ? Math.max(10, Math.min(24, 11 + mult * 4.5))
          : 14;

      ctx.strokeStyle = overlayAccent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = "bold 11px monospace";
      ctx.fillStyle = overlayText;
      const targetTitle = activeTarget
        ? activeTarget.category === "variable-star"
          ? `${activeTarget.name} (${mult.toFixed(2)}x flujo)`
          : `${activeTarget.name}`
        : "Candidato en movimiento";
      ctx.fillText(targetTitle, pc.x + ringRadius + 5, pc.y - 4);
    }

    // Cabecera de ventana deslizante estilo WiseView (ej. "2016.3 - 2016.8") + riel vertical de épocas
    if (activeFrame.wiseWindowLabel) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fillRect(10, 10, 195, 30);
      ctx.font = "bold 16px monospace";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(activeFrame.wiseWindowLabel, 18, 31);

      // Riel vertical de épocas en el margen izquierdo (· · + + · · como en WiseView)
      for (let i = 0; i < frames.length; i++) {
        const ry = 54 + i * 16;
        const isCurrent =
          i === activeFrame.index ||
          Math.abs(i - activeFrame.index) === 1;
        ctx.font = "bold 12px monospace";
        ctx.fillStyle =
          i === activeFrame.index
            ? overlayAccent
            : isCurrent
            ? overlayText
            : overlayMuted;
        ctx.fillText(i === activeFrame.index ? "+" : "·", 14, ry);
      }
    }

    // Retícula espectroscópica sobre la estrella seleccionada con clic
    if (selectedSource && !selectedSource.isPrimaryTarget) {
      const ps = skyToCss(selectedSource.dRaArcsec, selectedSource.dDecArcsec);
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "10px monospace";
      ctx.fillStyle = isLightSky ? "#047857" : "#34d399";
      ctx.fillText(
        `${selectedSource.label} (Espectro 102 ch)`,
        ps.x + 15,
        ps.y + 3
      );
    }

    // Scale Bar + N/E Compass
    const barArcsec = fovArcsec >= 120 ? 30 : fovArcsec >= 50 ? 15 : 5;
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
    ctx.fillText(`${barArcsec}"`, barX, barY - 7);
    ctx.fillText("N ↑  E ←", cssWidth - 68, cssHeight - 14);

    ctx.restore();
  }, [
    activeFrame,
    refFrame,
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
    stackByDetector,
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

    if (distToTarget <= Math.max(4.5, fovArcsec * 0.08)) {
      onSelectSkySource({
        id: activeTarget?.id ?? "primary-center",
        label: activeTarget?.name ?? "Objeto central SPHEREx",
        raDeg: centerRaDeg,
        decDeg: centerDecDeg,
        dRaArcsec: curTargetOffset.dRaArcsec,
        dDecArcsec: curTargetOffset.dDecArcsec,
        isPrimaryTarget: true,
        spectralSlope: 0,
        baseFlux: 2.8,
        spectralType: activeTarget?.categoryLabel ?? "Fuente puntual IR",
      });
      return;
    }

    const stars = generateBackgroundStars(centerRaDeg, centerDecDeg);
    let bestStar: BackgroundStar | null = null;
    let bestDist = Infinity;

    for (const st of stars) {
      const d = Math.hypot(
        coords.dRaArcsec - st.dRaArcsec,
        coords.dDecArcsec - st.dDecArcsec
      );
      if (d < bestDist) {
        bestDist = d;
        bestStar = st;
      }
    }

    if (bestStar && bestDist <= Math.max(5.5, fovArcsec * 0.09)) {
      const cosDec = Math.max(0.1, Math.cos((centerDecDeg * Math.PI) / 180));
      const stRa =
        (((centerRaDeg + bestStar.dRaArcsec / (3600 * cosDec)) % 360) + 360) %
        360;
      const stDec = Math.max(
        -90,
        Math.min(90, centerDecDeg + bestStar.dDecArcsec / 3600)
      );
      onSelectSkySource({
        id: bestStar.id,
        label: `Estrella de campo ${bestStar.id}`,
        raDeg: stRa,
        decDeg: stDec,
        dRaArcsec: bestStar.dRaArcsec,
        dDecArcsec: bestStar.dDecArcsec,
        isPrimaryTarget: false,
        spectralSlope: bestStar.spectralSlope,
        baseFlux: bestStar.baseFlux,
        spectralType:
          bestStar.spectralSlope > 0.1
            ? "Enana M / Fuente fría IR"
            : "Estrella de secuencia principal G/K",
      });
    } else {
      onSelectSkySource({
        id: `APERTURE-${coords.raDeg.toFixed(4)}`,
        label: `Apertura (${coords.raDeg.toFixed(4)}°, ${coords.decDeg.toFixed(
          4
        )}°)`,
        raDeg: coords.raDeg,
        decDeg: coords.decDeg,
        dRaArcsec: coords.dRaArcsec,
        dDecArcsec: coords.dDecArcsec,
        isPrimaryTarget: false,
        spectralSlope: -0.1,
        baseFlux: 0.9,
        spectralType: "Apertura fotométrica del cielo",
      });
    }
  }

  if (view360 && activeFrame) {
    return (
      <div className={fullViewport ? "h-full w-full" : "space-y-2"}>
        <div
          className={
            fullViewport
              ? "relative h-[calc(100vh-53px)] w-full cursor-grab overflow-hidden select-none active:cursor-grabbing"
              : "relative h-[420px] w-full cursor-grab overflow-hidden rounded-lg border border-black/[.08] select-none active:cursor-grabbing sm:h-[480px] dark:border-white/[.145]"
          }
          onPointerDown={(e) => {
            rotDragRef.current = {
              active: true,
              startX: e.clientX,
              startY: e.clientY,
              startYaw: rot360.yaw,
              startPitch: rot360.pitch,
            };
          }}
          onPointerMove={(e) => {
            if (!rotDragRef.current.active) return;
            const dx = e.clientX - rotDragRef.current.startX;
            const dy = e.clientY - rotDragRef.current.startY;
            setRot360({
              yaw: (rotDragRef.current.startYaw - dx * 0.28 + 360) % 360,
              pitch: Math.max(
                -85,
                Math.min(85, rotDragRef.current.startPitch + dy * 0.25)
              ),
            });
          }}
          onPointerUp={() => {
            rotDragRef.current.active = false;
          }}
          onPointerLeave={() => {
            rotDragRef.current.active = false;
          }}
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 0.87;
            const next = Math.round(
              Math.min(240, Math.max(15, fovArcsec * factor))
            );
            onZoomChange(next);
          }}
        >
          <Canvas
            camera={{ position: [0, 0, 0.01], fov: 55, near: 0.1, far: 250 }}
          >
            <SkySphere360Scene
              centerRaDeg={centerRaDeg}
              centerDecDeg={centerDecDeg}
              frames={frames}
              activeFrame={activeFrame}
              midYears={midYears}
              activeTarget={activeTarget}
              fovArcsec={fovArcsec}
              stretchGain={stretchGain}
              colormap={colormap}
              showGrid={showGrid}
              showTargetOverlay={showTargetOverlay}
              showHistoricalCatalogOverlay={showHistoricalCatalogOverlay}
              yawDeg={rot360.yaw}
              pitchDeg={rot360.pitch}
              onSelectSkySource={onSelectSkySource}
            />
          </Canvas>

          {/* HUD minimalista de orientación 360° */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-black/[.12] bg-background/85 px-3 py-1 font-mono text-xs font-medium shadow-sm backdrop-blur-md dark:border-white/[.18]">
              {activeTarget?.name ?? "Cielo 360°"} · {activeFrame.epochDate} ·
              Giro 360° ({Math.round(rot360.yaw)}°,{" "}
              {rot360.pitch >= 0 ? `+${Math.round(rot360.pitch)}` : Math.round(rot360.pitch)}
              °)
            </span>
            {(Math.abs(rot360.yaw) > 1 || Math.abs(rot360.pitch) > 1) && (
              <button
                type="button"
                onClick={() => setRot360({ yaw: 0, pitch: 0 })}
                className="pointer-events-auto cursor-pointer rounded-full border border-black/[.12] bg-background/90 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur-md transition-colors hover:bg-[#f2f2f2] dark:border-white/[.18] dark:hover:bg-[#1a1a1a]"
              >
                Centrar 360°
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

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
              Math.min(240, Math.max(15, fovArcsec * factor))
            );
            onZoomChange(next);
          }}
        />
      </div>

      {!fullViewport && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/70 font-mono">
          <span>
            {cursorSky
              ? `Cursor: ${formatRAHMS(cursorSky.raDeg)}  ${formatDecDMS(
                  cursorSky.decDeg
                )} (${cursorSky.raDeg.toFixed(5)}°, ${cursorSky.decDeg.toFixed(
                  5
                )}°) · Clic en estrella = ver espectro 102 bandas`
              : "Haz clic en una estrella para graficar su espectro IR · Arrastra para mover · Flechas ←/→ para épocas"}
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
