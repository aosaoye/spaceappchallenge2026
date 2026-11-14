"use client";

import { ArrowLeft, Check, Download, Globe, Share2, Telescope } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildEpochFrames,
  buildFallbackObservations,
  CHALLENGE_TARGETS,
  findMatchingChallengeTarget,
  formatDecDMS,
  formatRAHMS,
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
  const [mode360, setMode360] = useState<"r3f-360" | "aladin">("r3f-360");

  const frames360 = useMemo(() => {
    const obs = buildFallbackObservations(ra, dec, "Todas");
    return buildEpochFrames(obs, "irsa");
  }, [ra, dec]);

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
            SPHEREx Explorer · Aladin Lite v3
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
                <span>¡Enlace copiado!</span>
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" />
                <span>Compartir URL (?ra=&amp;dec=&amp;fov=)</span>
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
            <span>Volver al explorador</span>
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      {urlError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-400"
        >
          <strong>Error en los parámetros de la URL:</strong> {urlError}. Se
          muestra la región de respaldo por defecto.
        </div>
      )}

      {/* Selector de muestras (usando CustomSelect por herencia) y alternador 360° R3F / Aladin Lite */}
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
            onClick={() => setMode360("r3f-360")}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              mode360 === "r3f-360"
                ? "bg-foreground text-background shadow-sm"
                : "text-foreground/75 hover:text-foreground"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Mapa del cielo 360° (React Three Fiber)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode360("aladin")}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              mode360 === "aladin"
                ? "bg-foreground text-background shadow-sm"
                : "text-foreground/75 hover:text-foreground"
            }`}
          >
            <Telescope className="h-3.5 w-3.5" />
            <span>Aladin Lite v3</span>
          </button>
        </div>
      </div>

      {mode360 === "r3f-360" ? (
        <SkyVideoCanvas
          centerRaDeg={ra}
          centerDecDeg={dec}
          frames={frames360}
          currentFrameIndex={0}
          referenceFrameIndex={0}
          activeTarget={matchedTarget}
          fovArcsec={Math.max(15, Math.min(240, Math.round(fov * 3600)))}
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
          view360
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

      <section className="grid grid-cols-1 gap-6 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145] lg:grid-cols-[1fr_360px]">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">
            Productos generados por process_spherex.py (Fase 3)
          </h2>
          <p className="text-xs text-foreground/70">
            El procesador científico extrae la extensión{" "}
            <code className="rounded bg-black/[.05] px-1 py-0.5 font-mono dark:bg-white/[.06]">
              IMAGE
            </code>{" "}
            (2040 × 2040, flujo calibrado en MJy/sr) y el WCS espacial{" "}
            <code className="rounded bg-black/[.05] px-1 py-0.5 font-mono dark:bg-white/[.06]">
              WCS(header, relax=True).celestial
            </code>{" "}
            para producir dos archivos complementarios:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-foreground/80 font-mono">
            <li>processed/2025W41_2B_0509_2_D1_preview.png (AsinhStretch [1, 99.5])</li>
            <li>processed/2025W41_2B_0509_2_D1_aladin_fast.fits (PrimaryHDU 2D + WCS celeste)</li>
          </ul>
          <div className="pt-2">
            <a
              href="/processed/2025W41_2B_0509_2_D1_aladin.fits"
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Descargar 2025W41_2B_0509_2_D1_aladin.fits</span>
            </a>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-lg border border-black/[.08] p-2 dark:border-white/[.145]">
          <Image
            src="/spherex_D1_preview.png"
            alt="Vista previa SPHEREx 2025W41_2B_0509_2 D1"
            width={340}
            height={340}
            unoptimized
            className="h-auto max-h-64 w-auto rounded object-contain"
          />
          <span className="mt-1 font-mono text-[11px] text-foreground/60">
            2025W41_2B_0509_2_D1_preview.png
          </span>
        </div>
      </section>
    </main>
  );
}
