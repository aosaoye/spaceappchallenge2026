"use client";

import { Download, ExternalLink, Image as ImageIcon, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-config";

interface PanStarrsBandItem {
  projcell: string;
  subcell: string;
  ra: number;
  dec: number;
  filter: string;
  mjd: number;
  type: string;
  filename: string;
  shortname: string;
  badflag: number;
  imageUrl: string;
  fitsUrl: string;
  fitsCutoutUrl: string;
}

interface PanStarrsResponse {
  ra: number;
  dec: number;
  fovArcsec: number;
  sizePx: number;
  type: "stack" | "warp";
  colorUrl: string | null;
  ps1CutoutsWebUrl: string;
  items: PanStarrsBandItem[];
}

interface PanStarrsViewerProps {
  ra: number;
  dec: number;
  fovArcsec: number;
  compact?: boolean;
}

export default function PanStarrsViewer({
  ra,
  dec,
  fovArcsec,
  compact = false,
}: PanStarrsViewerProps) {
  const [fileType, setFileType] = useState<"stack" | "warp">("stack");
  const [data, setData] = useState<PanStarrsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("color");

  const fetchPanStarrs = useCallback(
    async (nextType: "stack" | "warp") => {
      setIsRefreshing(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          ra: ra.toFixed(6),
          dec: dec.toFixed(6),
          fov_arcsec: String(fovArcsec),
          type: nextType,
        });
        const res = await fetch(
          apiUrl(`/api/v1/observaciones/panstarrs?${params.toString()}`)
        );
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.detail || `HTTP ${res.status}`);
        }
        setData(payload as PanStarrsResponse);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Error al consultar las imágenes de Pan-STARRS1"
        );
        setData(null);
      } finally {
        setIsRefreshing(false);
      }
    },
    [ra, dec, fovArcsec]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const params = new URLSearchParams({
          ra: ra.toFixed(6),
          dec: dec.toFixed(6),
          fov_arcsec: String(fovArcsec),
          type: fileType,
        });
        const res = await fetch(
          apiUrl(`/api/v1/observaciones/panstarrs?${params.toString()}`)
        );
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.detail || `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setData(payload as PanStarrsResponse);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Error al consultar las imágenes de Pan-STARRS1"
          );
          setData(null);
        }
      }
    }
    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [ra, dec, fovArcsec, fileType]);

  const activeItem =
    selectedKey === "color"
      ? null
      : data?.items.find(
          (item, idx) => `${item.filter}-${idx}` === selectedKey
        ) ?? null;

  const mainImageUrl =
    selectedKey === "color" && data?.colorUrl
      ? data.colorUrl
      : activeItem?.imageUrl ?? data?.colorUrl ?? data?.items[0]?.imageUrl ?? null;

  const mainLabel =
    selectedKey === "color" && data?.colorUrl
      ? "Color RGB (y/i/g)"
      : activeItem
      ? `Filtro ${activeItem.filter}`
      : "Pan-STARRS1";

  return (
    <div className="space-y-4 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Pan-STARRS1</h3>
          <span className="font-mono text-xs text-foreground/60">
            {ra.toFixed(4)}°, {dec.toFixed(4)}°
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-black/[.1] bg-black/[.03] p-0.5 dark:border-white/[.16] dark:bg-white/[.05]">
            <button
              type="button"
              onClick={() => {
                setFileType("stack");
                setSelectedKey("color");
              }}
              className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                fileType === "stack"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-foreground/75 hover:text-foreground"
              }`}
            >
              Stack
            </button>
            <button
              type="button"
              onClick={() => {
                setFileType("warp");
                setSelectedKey("color");
              }}
              className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                fileType === "warp"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-foreground/75 hover:text-foreground"
              }`}
            >
              Warp
            </button>
          </div>

          <button
            type="button"
            onClick={() => fetchPanStarrs(fileType)}
            disabled={isRefreshing}
            title="Actualizar"
            aria-label="Actualizar"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>

          {data?.ps1CutoutsWebUrl && (
            <a
              href={data.ps1CutoutsWebUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              <span>STScI</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!error && !data && (
        <div className="rounded-md border border-black/[.08] bg-black/[.02] px-3 py-6 text-center font-mono text-xs text-foreground/70 dark:border-white/[.145] dark:bg-white/[.02]">
          Consultando Pan-STARRS1 (ps1images.stsci.edu) para ra={ra.toFixed(4)}°, dec={dec.toFixed(4)}°…
        </div>
      )}

      {!error && data && data.items.length === 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          No hay imágenes de Pan-STARRS1 disponibles para estas coordenadas (PS1 cubre declinaciones ≥ −30°).
        </div>
      )}

      {mainImageUrl && (
        <div
          className={
            compact
              ? "grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]"
              : "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_1fr]"
          }
        >
          {/* Visor principal ampliado */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-black/[.08] bg-black/[.03] p-3 dark:border-white/[.145] dark:bg-white/[.03]">
            <Image
              src={mainImageUrl}
              alt={mainLabel}
              width={400}
              height={400}
              unoptimized
              className={
                compact
                  ? "h-auto max-h-[220px] w-full rounded object-contain"
                  : "h-auto max-h-[380px] w-full rounded object-contain"
              }
            />
            <div className="mt-2 flex w-full flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono text-foreground/80">{mainLabel}</span>
              <div className="flex items-center gap-2">
                <a
                  href={mainImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-75"
                >
                  <ImageIcon className="h-3 w-3" />
                  <span>Display</span>
                </a>
                {activeItem && (
                  <>
                    <a
                      href={activeItem.fitsCutoutUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-75"
                    >
                      <Download className="h-3 w-3" />
                      <span>FITS-cutout</span>
                    </a>
                    <a
                      href={activeItem.fitsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-75"
                    >
                      <Download className="h-3 w-3" />
                      <span>FITS</span>
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Tira de tarjetas Color y bandas g, r, i, z, y */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data?.colorUrl && (
              <div
                onClick={() => setSelectedKey("color")}
                className={`relative cursor-pointer overflow-hidden rounded-lg border p-1.5 transition-colors ${
                  selectedKey === "color"
                    ? "border-foreground bg-black/[.04] dark:bg-white/[.08]"
                    : "border-black/[.08] hover:bg-black/[.02] dark:border-white/[.145] dark:hover:bg-white/[.04]"
                }`}
              >
                <span className="absolute left-2.5 top-2.5 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[10px] font-medium text-white">
                  RGB
                </span>
                <Image
                  src={data.colorUrl}
                  alt="Pan-STARRS1 Color y/i/g"
                  width={180}
                  height={180}
                  unoptimized
                  className="aspect-square w-full rounded object-cover"
                />
              </div>
            )}

            {data?.items.slice(0, 11).map((item, idx) => {
              const key = `${item.filter}-${idx}`;
              const isSelected = selectedKey === key;
              return (
                <div
                  key={`${item.filename}-${idx}`}
                  onClick={() => setSelectedKey(key)}
                  className={`relative cursor-pointer overflow-hidden rounded-lg border p-1.5 transition-colors ${
                    isSelected
                      ? "border-foreground bg-black/[.04] dark:bg-white/[.08]"
                      : "border-black/[.08] hover:bg-black/[.02] dark:border-white/[.145] dark:hover:bg-white/[.04]"
                  }`}
                >
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[10px] font-medium text-white">
                    {item.filter}
                  </span>
                  <Image
                    src={item.imageUrl}
                    alt={`Pan-STARRS1 ${item.filter}`}
                    width={180}
                    height={180}
                    unoptimized
                    className="aspect-square w-full rounded object-cover"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
