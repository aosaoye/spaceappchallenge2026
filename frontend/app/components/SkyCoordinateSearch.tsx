"use client";

import {
  ChevronDown,
  Compass,
  ImagePlus,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useId, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-config";
import {
  formatDecDMS,
  formatRAHMS,
  ResolvedImageCoordsResponse,
} from "../astronomy";

export interface SolvedSkyImageState {
  fileName: string;
  previewUrl: string | null;
  result: ResolvedImageCoordsResponse;
}

interface SkyCoordinateSearchProps {
  raInput: string;
  decInput: string;
  radiusInput: string;
  inputError: string | null;
  loadingObservations: boolean;
  solvedImage: SolvedSkyImageState | null;
  compact?: boolean;
  onChangeRa: (val: string) => void;
  onChangeDec: (val: string) => void;
  onChangeRadius: (val: string) => void;
  onSubmitManual: (e: FormEvent) => void;
  onSolvedImage: (solved: SolvedSkyImageState) => void;
}

const ASTROMETRY_STORAGE_KEY = "spherex-astrometry-key";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export default function SkyCoordinateSearch({
  raInput,
  decInput,
  radiusInput,
  inputError,
  loadingObservations,
  solvedImage,
  compact = false,
  onChangeRa,
  onChangeDec,
  onChangeRadius,
  onSubmitManual,
  onSolvedImage,
}: SkyCoordinateSearchProps) {
  const fileInputId = useId();
  const raId = useId();
  const decId = useId();
  const radiusId = useId();
  const apiKeyId = useId();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    solvedImage?.previewUrl ?? null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [solving, setSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [showApiKeyBox, setShowApiKeyBox] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(ASTROMETRY_STORAGE_KEY) || "";
  });

  async function resolveSkyFile(file: File, explicitKey?: string) {
    setPendingFile(file);
    setSolveError(null);
    setSolving(true);

    const isRasterImage =
      file.type.startsWith("image/") &&
      !/\.(fits?|fts)$/i.test(file.name || "");
    const nextPreview = isRasterImage ? URL.createObjectURL(file) : null;
    if (previewUrl && previewUrl !== solvedImage?.previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(nextPreview);

    const keyToUse = (
      explicitKey ??
      apiKeyInput ??
      (typeof window !== "undefined"
        ? window.localStorage.getItem(ASTROMETRY_STORAGE_KEY) || ""
        : "")
    ).trim();

    try {
      const archivoBase64 = await fileToBase64(file);
      const response = await fetch(
        apiUrl("/api/v1/observaciones/resolver-imagen"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archivo_base64: archivoBase64,
            nombre_archivo: file.name || "cielo.png",
            astrometry_api_key: keyToUse || null,
          }),
        }
      );

      const payload = (await response.json()) as
        | ResolvedImageCoordsResponse
        | { detail?: string };

      if (!response.ok || !("ra_deg" in payload)) {
        const msg =
          "detail" in payload && payload.detail
            ? String(payload.detail)
            : `No se pudieron extraer coordenadas (HTTP ${response.status}).`;
        throw new Error(msg);
      }

      onSolvedImage({
        fileName: file.name,
        previewUrl: nextPreview,
        result: payload,
      });
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se pudieron resolver las coordenadas de la imagen.";
      setSolveError(msg);
      if (
        msg.includes("ASTROMETRY_API_KEY") ||
        msg.includes("astrometry.net")
      ) {
        setShowApiKeyBox(true);
      }
    } finally {
      setSolving(false);
    }
  }

  function handleSaveApiKey(nextVal: string) {
    setApiKeyInput(nextVal);
    if (typeof window !== "undefined") {
      if (nextVal.trim()) {
        window.localStorage.setItem(ASTROMETRY_STORAGE_KEY, nextVal.trim());
      } else {
        window.localStorage.removeItem(ASTROMETRY_STORAGE_KEY);
      }
    }
  }

  const displayedPreview = previewUrl ?? solvedImage?.previewUrl ?? null;

  return (
    <div className="space-y-3">
      {/* Zona principal de subida / arrastre de imagen del cielo */}
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        accept=".fits,.fit,.fts,.jpg,.jpeg,.png,.webp,image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            resolveSkyFile(file);
          }
          e.target.value = "";
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => !solving && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !solving) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !solving) {
            resolveSkyFile(file);
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-3 ${
          compact ? "py-3.5" : "py-4"
        } text-center transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
          isDragging
            ? "border-foreground bg-black/[.05] dark:bg-white/[.08]"
            : "border-black/[.2] hover:bg-[#f2f2f2]/70 dark:border-white/[.22] dark:hover:bg-[#1a1a1a]/70"
        }`}
      >
        {solving ? (
          <div className="flex flex-col items-center gap-1.5 py-1">
            <Loader2 className="h-5 w-5 animate-spin text-foreground" />
            <span className="text-xs font-medium">
              Extrayendo coordenadas del cielo…
            </span>
            <span className="text-[11px] text-foreground/60">
              {pendingFile?.name}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
              <ImagePlus className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold">
              Subir foto del cielo
            </span>
            <span className="text-[11px] text-foreground/60">
              Arrastra o haz clic · JPG, PNG o FITS
            </span>
          </div>
        )}
      </div>

      {/* Resultado resuelto o vista previa de la última imagen */}
      {(solvedImage || (displayedPreview && solving)) && (
        <div className="flex items-start gap-2.5 rounded-xl border border-black/[.08] bg-black/[.02] p-2.5 dark:border-white/[.145] dark:bg-white/[.03]">
          {displayedPreview ? (
            <Image
              src={displayedPreview}
              alt={solvedImage?.fileName ?? pendingFile?.name ?? "Foto del cielo"}
              width={52}
              height={52}
              unoptimized
              className="h-12 w-12 shrink-0 rounded-lg border border-black/[.08] object-cover dark:border-white/[.145]"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-black/[.08] bg-background dark:border-white/[.145]">
              <Sparkles className="h-4 w-4 text-foreground/70" />
            </div>
          )}

          {solvedImage && (
            <div className="min-w-0 flex-1 space-y-0.5 text-[11px]">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-medium">
                  {solvedImage.fileName}
                </span>
                <span className="shrink-0 rounded-full border border-black/[.08] px-1.5 py-0.5 font-mono text-[10px] dark:border-white/[.145]">
                  {solvedImage.result.metodo === "fits-wcs"
                    ? "FITS WCS"
                    : "Astrometry"}
                </span>
              </div>
              <div className="font-mono text-foreground/80">
                {formatRAHMS(solvedImage.result.ra_deg)} ·{" "}
                {formatDecDMS(solvedImage.result.dec_deg)}
              </div>
              {solvedImage.result.objetos_en_campo.length > 0 && (
                <div className="truncate text-foreground/65">
                  Campo: {solvedImage.result.objetos_en_campo.slice(0, 3).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error al resolver + reintento rápido */}
      {solveError && (
        <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
          <p>{solveError}</p>
          {pendingFile && !solving && (
            <button
              type="button"
              onClick={() => resolveSkyFile(pendingFile)}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-500/40 px-2.5 text-[11px] font-medium hover:bg-red-500/10"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Reintentar</span>
            </button>
          )}
        </div>
      )}

      {/* Configuración opcional de API Key de Astrometry.net */}
      <div>
        <button
          type="button"
          onClick={() => setShowApiKeyBox((prev) => !prev)}
          className="inline-flex items-center gap-1.5 text-[11px] text-foreground/65 underline-offset-4 hover:text-foreground hover:underline"
        >
          <KeyRound className="h-3 w-3" />
          <span>
            {showApiKeyBox
              ? "Ocultar clave Astrometry.net"
              : "Clave API Astrometry.net (JPG/PNG)"}
          </span>
        </button>

        {showApiKeyBox && (
          <div className="mt-2 space-y-1.5">
            <label
              htmlFor={apiKeyId}
              className="block text-[11px] text-foreground/70"
            >
              Clave gratuita de{" "}
              <a
                href="https://nova.astrometry.net/api_help"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                nova.astrometry.net
              </a>{" "}
              (si no está en `.env`)
            </label>
            <input
              id={apiKeyId}
              type="password"
              value={apiKeyInput}
              onChange={(e) => handleSaveApiKey(e.target.value)}
              placeholder="Pega tu ASTROMETRY_API_KEY"
              className="h-9 w-full rounded-full border border-black/[.08] bg-background px-3.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
            />
          </div>
        )}
      </div>

      {/* Botón discreto para mostrar u ocultar la entrada manual RA/Dec */}
      <div className="border-t border-black/[.08] pt-2.5 dark:border-white/[.145]">
        <button
          type="button"
          onClick={() => setShowManual((prev) => !prev)}
          aria-expanded={showManual}
          className="inline-flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-black/[.08] bg-background px-3.5 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          <span className="inline-flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-foreground/75" />
            <span>Manual</span>
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-foreground/70 transition-transform duration-150 ${
              showManual ? "rotate-180" : ""
            }`}
          />
        </button>

        {showManual && (
          <form onSubmit={onSubmitManual} className="mt-3 space-y-2.5">
            <div>
              <label
                htmlFor={raId}
                className="block text-xs font-medium text-foreground/80"
              >
                RA
              </label>
              <input
                id={raId}
                type="text"
                value={raInput}
                onChange={(e) => onChangeRa(e.target.value)}
                placeholder="08h55m10.831s o 133.7951"
                className="mt-1 h-9 w-full rounded-full border border-black/[.08] bg-background px-3.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
              />
            </div>

            <div>
              <label
                htmlFor={decId}
                className="block text-xs font-medium text-foreground/80"
              >
                Dec
              </label>
              <input
                id={decId}
                type="text"
                value={decInput}
                onChange={(e) => onChangeDec(e.target.value)}
                placeholder="-7d14m42.53s o -7.2451"
                className="mt-1 h-9 w-full rounded-full border border-black/[.08] bg-background px-3.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
              />
            </div>

            <div>
              <label
                htmlFor={radiusId}
                className="block text-xs font-medium text-foreground/80"
              >
                Radio (arcsec)
              </label>
              <input
                id={radiusId}
                type="number"
                min={1}
                max={3600}
                step={1}
                value={radiusInput}
                onChange={(e) => onChangeRadius(e.target.value)}
                className="mt-1 h-9 w-full rounded-full border border-black/[.08] bg-background px-3.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
              />
            </div>

            {inputError && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {inputError}
              </p>
            )}

            <button
              type="submit"
              disabled={loadingObservations}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              <Search className="h-3.5 w-3.5" />
              <span>{loadingObservations ? "Buscando…" : "Buscar"}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
