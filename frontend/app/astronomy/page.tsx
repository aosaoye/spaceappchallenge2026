"use client";

import { ArrowLeft, Check, Download, Film, Share2, Telescope } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/api-config";
import {
  buildEpochFrames,
  CHALLENGE_TARGETS,
  fetchRegionObservationsData,
  findMatchingChallengeTarget,
  formatDecDMS,
  formatRAHMS,
  MAX_FOV_ARCSEC,
  MIN_FOV_ARCSEC,
  Observacion,
} from "@/app/astronomy";
import CustomSelect from "@/app/components/CustomSelect";
import SkyVideoCanvas from "@/app/components/SkyVideoCanvas";
import ThemeToggle from "@/app/components/ThemeToggle";
import AladinSkyMap from "@/components/astronomy/AladinSkyMap";
import { tryParseViewParams } from "@/lib/astronomy/parse-view-params";

const SPHEREX_FITS =
  "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W41_2B/l2b-v27-2026-242/1/level2_2025W41_2B_0509_2D1_spx_l2b-v27-2026-242.fits";

export default function AstronomyPage() {
  const [ra, setRa] = useState(123.66900080879154);
  const [dec, setDec] = useState(38.507790883374376);
  const [fov, setFov] = useState(0.3);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewerTab, setViewerTab] = useState<"fits" | "aladin">("fits");
  const [observations, setObservations] = useState<Observacion[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadObs() {
      try {
        const data = await fetchRegionObservationsData(ra, dec, 60);
        if (!cancelled) {
          setObservations(Array.isArray(data.observaciones) ? data.observaciones : []);
        }
      } catch {
        if (!cancelled) setObservations([]);
      }
    }
    loadObs();
    return () => {
      cancelled = true;
    };
  }, [ra, dec]);

  const frames360 = useMemo(() => {
    return buildEpochFrames(observations, "irsa");
  }, [observations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { hasUrlParams, view, error } = tryParseViewParams(
      window.location.search
    );

    const timer = window.setTimeout(() => {
      if (hasUrlParams && error) {
        setUrlError(error);
        return;
      }
      setUrlError(null);
      if (view) {
        setRa(view.ra);
        setDec(view.dec);
        setFov(view.fov <= 5 ? view.fov : view.fov / 3600);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const matchedTarget = findMatchingChallengeTarget(ra, dec);

  function handleSelectTarget(nextRa: number, nextDec: number, nextFov = 0.12) {
    setRa(nextRa);
    setDec(nextDec);
    setFov(nextFov);
    if (typeof window !== "undefined") {
      const qs = `?ra=${encodeURIComponent(
        formatRAHMS(nextRa)
      )}&dec=${encodeURIComponent(
        formatDecDMS(nextDec)
      )}&fov=${nextFov.toFixed(4)}`;
      window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
    }
  }

  function handleShareUrl() {
    if (typeof window === "undefined") return;
    const qs = `?ra=${encodeURIComponent(
      formatRAHMS(ra)
    )}&dec=${encodeURIComponent(formatDecDMS(dec))}&fov=${fov.toFixed(4)}`;
    const url = `${window.location.origin}${window.location.pathname}${qs}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-7xl min-h-screen space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[.08] pb-4 dark:border-white/[.145]">
        <div className="flex items-center gap-2">
          <Telescope className="h-4 w-4" />
          <span className="text-sm font-semibold tracking-tight">
            SPHEREx Explorer
          </span>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleShareUrl}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            {copied ? (
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
          <Link
            href={`/?ra=${encodeURIComponent(
              formatRAHMS(ra)
            )}&dec=${encodeURIComponent(formatDecDMS(dec))}&fov=${fov.toFixed(
              4
            )}`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Volver</span>
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      {urlError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-400"
        >
          <strong>Error en URL:</strong> {urlError}
        </div>
      )}

      {/* Selector de muestras (usando CustomSelect por herencia) y alternador FITS SPHEREx / Aladin Lite */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-64">
          <CustomSelect
            id="astronomy-target-select"
            value={matchedTarget?.id ?? ""}
            placeholder="Elegir muestra"
            options={CHALLENGE_TARGETS.map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            onChange={(val) => {
              const chosen = CHALLENGE_TARGETS.find((t) => t.id === val);
              if (chosen) {
                handleSelectTarget(chosen.raDeg, chosen.decDeg, 0.12);
              }
            }}
          />
        </div>

        <div className="inline-flex items-center rounded-full border border-black/[.1] bg-black/[.03] p-0.5 dark:border-white/[.16] dark:bg-white/[.05]">
          <button
            type="button"
            onClick={() => setViewerTab("fits")}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              viewerTab === "fits"
                ? "bg-foreground text-background shadow-sm"
                : "text-foreground/75 hover:text-foreground"
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>FITS SPHEREx</span>
          </button>
          <button
            type="button"
            onClick={() => setViewerTab("aladin")}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              viewerTab === "aladin"
                ? "bg-foreground text-background shadow-sm"
                : "text-foreground/75 hover:text-foreground"
            }`}
          >
            <Telescope className="h-3.5 w-3.5" />
            <span>Aladin Lite</span>
          </button>
        </div>
      </div>

      {viewerTab === "fits" ? (
        <SkyVideoCanvas
          centerRaDeg={ra}
          centerDecDeg={dec}
          frames={frames360}
          currentFrameIndex={0}
          referenceFrameIndex={0}
          activeTarget={matchedTarget}
          fovArcsec={Math.max(
            MIN_FOV_ARCSEC,
            Math.min(MAX_FOV_ARCSEC, Math.round(fov * 3600))
          )}
          stretchGain={1.2}
          colormap="grayscale"
          playbackMode="ping-pong"
          showCrosshair
          showGrid
          showTargetOverlay
          showHistoricalCatalogOverlay
          onZoomChange={(nextArcsec) =>
            setFov(Number((nextArcsec / 3600).toFixed(4)))
          }
        />
      ) : (
        <AladinSkyMap
          fitsUrl={SPHEREX_FITS}
          ra={ra}
          dec={dec}
          fov={fov}
          activeTarget={matchedTarget}
        />
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
        <a
          href={withBasePath("/processed/2025W41_2B_0509_2_D1_aladin.fits")}
          download
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-4 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Descargar FITS</span>
        </a>

        <Image
          src="/spherex_D1_preview.png"
          alt="SPHEREx D1"
          width={160}
          height={160}
          unoptimized
          className="h-24 w-24 rounded object-cover"
        />
      </section>
    </main>
  );
}
