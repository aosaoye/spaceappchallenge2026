"use client";

import {
  Activity,
  Compass,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Flag,
  Layers,
  RefreshCw,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-config";
import {
  EstructuraFitsResponse,
  ExtensionFitsInfo,
  MetadatosFitsResponse,
  Observacion,
} from "../astronomy";

interface FitsScientificInspectorProps {
  observacion: Observacion;
}

interface EstadisticasBasicas {
  minimo: number | null;
  maximo: number | null;
  media: number | null;
  mediana: number | null;
  desviacion_estandar: number | null;
}

interface AnalisisFitsResponse {
  extension: string;
  dimensiones: number[];
  unidad: string | null;
  total_pixeles: number;
  pixeles_validos: number;
  pixeles_no_validos: number;
  estadisticas: EstadisticasBasicas;
}

interface AnalisisCalidadFitsResponse {
  varianza: {
    dimensiones: number[];
    total_pixeles: number;
    pixeles_validos: number;
    pixeles_no_finitos: number;
    varianzas_negativas: number;
    estadisticas: EstadisticasBasicas;
  };
  flags: {
    dimensiones: number[];
    total_pixeles: number;
    pixeles_validos: number;
    pixeles_no_validos?: number;
    flags_no_validos?: number;
    valores_distintos: number;
    distribucion: Array<{
      valor: number;
      cantidad: number;
      porcentaje: number;
    }>;
  };
}

type InspectorTab =
  | "estructura"
  | "metadatos-wcs"
  | "flags-calibracion"
  | "estadisticas-calidad";

export default function FitsScientificInspector({
  observacion,
}: FitsScientificInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("estructura");
  const [estructura, setEstructura] = useState<ExtensionFitsInfo[]>([]);
  const [metadatos, setMetadatos] = useState<MetadatosFitsResponse | null>(null);
  const [analisisImagen, setAnalisisImagen] =
    useState<AnalisisFitsResponse | null>(null);
  const [analisisCalidad, setAnalisisCalidad] =
    useState<AnalisisCalidadFitsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarInspeccionFits = useCallback(async (urlAcceso: string) => {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(urlAcceso);
      const [resEst, resMeta, resImg, resCal] = await Promise.all([
        fetch(apiUrl(`/api/v1/observaciones/estructura-fits?url_acceso=${encoded}`)),
        fetch(apiUrl(`/api/v1/observaciones/metadatos-fits?url_acceso=${encoded}`)),
        fetch(apiUrl(`/api/v1/observaciones/analisis-fits?url_acceso=${encoded}`)),
        fetch(
          apiUrl(`/api/v1/observaciones/analisis-calidad-fits?url_acceso=${encoded}`)
        ),
      ]);

      if (!resEst.ok || !resMeta.ok) {
        let detail = "No se pudo inspeccionar el archivo FITS desde el backend";
        try {
          const errJson = await (!resEst.ok ? resEst : resMeta).json();
          if (errJson?.detail) detail = String(errJson.detail);
        } catch {
          // mantener mensaje por defecto
        }
        throw new Error(detail);
      }

      const dataEst: EstructuraFitsResponse = await resEst.json();
      const dataMeta: MetadatosFitsResponse = await resMeta.json();
      const dataImg: AnalisisFitsResponse | null = resImg.ok
        ? await resImg.json()
        : null;
      const dataCal: AnalisisCalidadFitsResponse | null = resCal.ok
        ? await resCal.json()
        : null;

      setEstructura(dataEst.extensiones || []);
      setMetadatos(dataMeta);
      setAnalisisImagen(dataImg);
      setAnalisisCalidad(dataCal);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al consultar la estructura y metadatos FITS en el backend"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initInspeccion() {
      try {
        const encoded = encodeURIComponent(observacion.url_acceso);
        const [resEst, resMeta, resImg, resCal] = await Promise.all([
          fetch(apiUrl(`/api/v1/observaciones/estructura-fits?url_acceso=${encoded}`)),
          fetch(apiUrl(`/api/v1/observaciones/metadatos-fits?url_acceso=${encoded}`)),
          fetch(apiUrl(`/api/v1/observaciones/analisis-fits?url_acceso=${encoded}`)),
          fetch(
            apiUrl(`/api/v1/observaciones/analisis-calidad-fits?url_acceso=${encoded}`)
          ),
        ]);

        if (!resEst.ok || !resMeta.ok) {
          let detail = "No se pudo inspeccionar el archivo FITS desde el backend";
          try {
            const errJson = await (!resEst.ok ? resEst : resMeta).json();
            if (errJson?.detail) detail = String(errJson.detail);
          } catch {
            // mantener mensaje por defecto
          }
          throw new Error(detail);
        }

        const dataEst: EstructuraFitsResponse = await resEst.json();
        const dataMeta: MetadatosFitsResponse = await resMeta.json();
        const dataImg: AnalisisFitsResponse | null = resImg.ok
          ? await resImg.json()
          : null;
        const dataCal: AnalisisCalidadFitsResponse | null = resCal.ok
          ? await resCal.json()
          : null;

        if (!cancelled) {
          setEstructura(dataEst.extensiones || []);
          setMetadatos(dataMeta);
          setAnalisisImagen(dataImg);
          setAnalisisCalidad(dataCal);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Error al consultar la estructura y metadatos FITS en el backend"
          );
        }
      }
    }
    initInspeccion();
    return () => {
      cancelled = true;
    };
  }, [observacion.url_acceso]);

  return (
    <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-foreground/80" />
          <h2 className="text-sm font-semibold">Inspector FITS</h2>
          <span className="font-mono text-xs text-foreground/60">
            {observacion.identificador}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("estructura")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              activeTab === "estructura"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Estructura ({estructura.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("metadatos-wcs")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              activeTab === "metadatos-wcs"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Metadatos y WCS</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("flags-calibracion")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              activeTab === "flags-calibracion"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Flag className="h-3.5 w-3.5" />
            <span>Flags</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("estadisticas-calidad")}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              activeTab === "estadisticas-calidad"
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Calidad</span>
          </button>
          <button
            type="button"
            onClick={() => cargarInspeccionFits(observacion.url_acceso)}
            disabled={loading}
            title="Actualizar"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-black/[.08] px-2.5 text-xs font-medium transition-colors hover:bg-[#f2f2f2] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
          <a
            href={`https://irsa.ipac.caltech.edu/irsaviewer/`}
            target="_blank"
            rel="noreferrer"
            title="Abrir Firefly"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            <span>Firefly</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Pestaña 1: Estructura MEF (/api/v1/observaciones/estructura-fits) */}
      {activeTab === "estructura" && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-black/[.08] text-foreground/60 dark:border-white/[.145]">
                <th className="py-2 pr-3 font-medium">HDU</th>
                <th className="py-2 pr-3 font-medium">Extensión</th>
                <th className="py-2 pr-3 font-medium">Tipo HDU</th>
                <th className="py-2 pr-3 font-medium">Dimensiones</th>
                <th className="py-2 pr-3 font-medium">Tipo de datos</th>
                <th className="py-2 pr-3 font-medium">Unidades</th>
                <th className="py-2 font-medium">Descripción científica</th>
              </tr>
            </thead>
            <tbody>
              {estructura.map((ext) => (
                <tr
                  key={`${ext.indice}-${ext.nombre}`}
                  className="border-b border-black/[.06] dark:border-white/[.08]"
                >
                  <td className="py-2 pr-3 font-mono">{ext.indice}</td>
                  <td className="py-2 pr-3 font-mono font-semibold">
                    {ext.nombre}
                  </td>
                  <td className="py-2 pr-3 font-mono text-foreground/80">
                    {ext.tipo_extension}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {ext.dimensiones ? ext.dimensiones.join(" × ") : "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {ext.tipo_datos ?? "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {ext.unidades ?? "—"}
                  </td>
                  <td className="py-2 text-foreground/75">
                    {ext.descripcion ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pestaña 2: Metadatos y WCS Espacial + Espectral LVF (/api/v1/observaciones/metadatos-fits) */}
      {activeTab === "metadatos-wcs" && metadatos && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Cabecera IMAGE y Principal */}
          <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Cabecera IMAGE / Principal</span>
            </div>
            {metadatos.banda_detector && (
              <div className="mt-2 rounded bg-black/[.04] px-2.5 py-1.5 font-mono text-[11px] dark:bg-white/[.06]">
                {metadatos.banda_detector.banda} · λ ={" "}
                {metadatos.banda_detector.rango_um} · R ={" "}
                {metadatos.banda_detector.resolucion_R}
              </div>
            )}
            <dl className="mt-2 space-y-1 text-xs">
              {Object.entries({
                ...metadatos.cabecera_principal,
                ...metadatos.cabecera_imagen,
              }).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2 border-b border-black/[.04] py-0.5 font-mono dark:border-white/[.06]"
                >
                  <dt className="text-foreground/60">{k}</dt>
                  <dd className="truncate font-medium">{String(v ?? "—")}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* WCS Espacial (Sección 8a de spherex_intro.md) */}
          <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Compass className="h-3.5 w-3.5" />
              <span>WCS Espacial (Astrometría + SIP)</span>
            </div>
            {metadatos.wcs_espacial &&
              metadatos.wcs_espacial.ra_central_deg !== undefined && (
                <div className="mt-2 rounded bg-black/[.04] px-2.5 py-1.5 font-mono text-[11px] dark:bg-white/[.06]">
                  <div>
                    CRVAL: ({metadatos.wcs_espacial.ra_central_deg.toFixed(6)}°,{" "}
                    {metadatos.wcs_espacial.dec_central_deg?.toFixed(6)}°)
                  </div>
                  <div>
                    Píxel central (X, Y): (
                    {metadatos.wcs_espacial.pixel_central_x},{" "}
                    {metadatos.wcs_espacial.pixel_central_y})
                  </div>
                </div>
              )}
            <dl className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1 text-xs">
              {Object.entries(metadatos.parametros_wcs).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2 border-b border-black/[.04] py-0.5 font-mono dark:border-white/[.06]"
                >
                  <dt className="text-foreground/60">{k}</dt>
                  <dd className="truncate font-medium">{String(v ?? "—")}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* WCS Espectral LVF */}
          <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Waves className="h-3.5 w-3.5" />
              <span>WCS Espectral (LVF)</span>
            </div>
            {metadatos.wcs_espectral && (
              <dl className="mt-2 space-y-1 text-xs font-mono">
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">λ central</dt>
                  <dd className="font-medium">
                    {metadatos.wcs_espectral.longitud_onda_central_um}{" "}
                    {metadatos.wcs_espectral.unidad ?? "µm"}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Δλ central (Bandwidth)</dt>
                  <dd className="font-medium">
                    {metadatos.wcs_espectral.ancho_banda_central_um}{" "}
                    {metadatos.wcs_espectral.unidad ?? "µm"}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Rango λ detector</dt>
                  <dd className="font-medium">
                    {metadatos.wcs_espectral.longitud_onda_min_um} –{" "}
                    {metadatos.wcs_espectral.longitud_onda_max_um} µm
                  </dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Poder de resolución (λ/Δλ)</dt>
                  <dd className="font-medium">
                    R ≈ {metadatos.wcs_espectral.poder_resolucion_aprox ?? "39"}
                  </dd>
                </div>
              </dl>
            )}

            {metadatos.wcs_alternativos && (
              <div className="mt-3 border-t border-black/[.08] pt-2 dark:border-white/[.145]">
                <span className="block text-[11px] font-semibold">
                  Sistemas WCS en cabecera (WCSNAME*)
                </span>
                <dl className="mt-1 space-y-1 font-mono text-[11px]">
                  {Object.entries(metadatos.wcs_alternativos).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-foreground/60">{k}</dt>
                      <dd className="truncate text-right">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pestaña 3: Flags L2 y Calibración (Secciones 8d, 9, 10-13 de spherex_intro.md) */}
      {activeTab === "flags-calibracion" && metadatos && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Conteo de píxeles marcados L2 N_* y diccionario de bits FLAGS */}
          <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Flag className="h-3.5 w-3.5" />
              <span>Mapa de bits FLAGS (MSKN* / MSKD*)</span>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-black/[.08] text-foreground/60 dark:border-white/[.145]">
                    <th className="py-1 pr-2 font-medium">Bit</th>
                    <th className="py-1 pr-2 font-medium">Bandera</th>
                    <th className="py-1 font-medium">Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {(metadatos.definiciones_flags || []).map((flag) => (
                    <tr
                      key={flag.bit}
                      className="border-b border-black/[.04] dark:border-white/[.06]"
                    >
                      <td className="py-1 pr-2 font-mono">{flag.bit}</td>
                      <td className="py-1 pr-2 font-mono font-semibold">
                        {flag.nombre}
                      </td>
                      <td className="py-1 text-foreground/75">
                        {flag.descripcion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Conteo L2 N_* y Resumen de VARIANCE, ZODI, EPSF, WCS-WAVE */}
          <div className="space-y-3">
            {metadatos.conteo_flags_l2 &&
              Object.keys(metadatos.conteo_flags_l2).length > 0 && (
                <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Activity className="h-3.5 w-3.5" />
                    <span>Conteo de píxeles marcados (L2 N_*)</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
                    {Object.entries(metadatos.conteo_flags_l2).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-1 border-b border-black/[.04] py-0.5 dark:border-white/[.06]"
                      >
                        <span className="truncate text-foreground/60">
                          {k.replace("L2 ", "")}
                        </span>
                        <span className="font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {metadatos.resumen_extensiones && (
              <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
                <span className="block text-xs font-semibold">
                  Calibración
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2 font-mono text-[11px] sm:grid-cols-2">
                  <div className="rounded bg-black/[.03] p-2 dark:bg-white/[.04]">
                    <div className="font-semibold">VARIANCE &amp; ZODI</div>
                    <div className="text-foreground/70">
                      2040×2040 (MJy/sr)² · MJy/sr
                    </div>
                  </div>
                  <div className="rounded bg-black/[.03] p-2 dark:bg-white/[.04]">
                    <div className="font-semibold">EPSF &amp; WCS-WAVE</div>
                    <div className="text-foreground/70">
                      441 regiones · 45×45×2
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pestaña 4: Análisis Estadístico IMAGE y Calidad VARIANCE/FLAGS (nuevos endpoints del backend) */}
      {activeTab === "estadisticas-calidad" && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {analisisImagen && (
            <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Activity className="h-3.5 w-3.5" />
                <span>
                  Estadísticas {analisisImagen.extension} ({analisisImagen.unidad ?? "MJy/sr"})
                </span>
              </div>
              <dl className="mt-2 space-y-1 font-mono text-xs">
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Dimensiones</dt>
                  <dd>{analisisImagen.dimensiones.join(" × ")}</dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Píxeles válidos</dt>
                  <dd>
                    {analisisImagen.pixeles_validos.toLocaleString()} /{" "}
                    {analisisImagen.total_pixeles.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Píxeles no válidos (NaN)</dt>
                  <dd>{analisisImagen.pixeles_no_validos.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Mínimo / Máximo</dt>
                  <dd>
                    {analisisImagen.estadisticas.minimo?.toFixed(4)} /{" "}
                    {analisisImagen.estadisticas.maximo?.toFixed(3)}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                  <dt className="text-foreground/60">Media / Mediana</dt>
                  <dd>
                    {analisisImagen.estadisticas.media?.toFixed(4)} /{" "}
                    {analisisImagen.estadisticas.mediana?.toFixed(4)}
                  </dd>
                </div>
                <div className="flex justify-between py-0.5">
                  <dt className="text-foreground/60">Desviación estándar (σ)</dt>
                  <dd>
                    {analisisImagen.estadisticas.desviacion_estandar?.toFixed(4)}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {analisisCalidad && (
            <>
              <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Calidad de VARIANCE ((MJy/sr)²)</span>
                </div>
                <dl className="mt-2 space-y-1 font-mono text-xs">
                  <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                    <dt className="text-foreground/60">Píxeles válidos</dt>
                    <dd>
                      {analisisCalidad.varianza.pixeles_validos.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                    <dt className="text-foreground/60">No finitos / Negativos</dt>
                    <dd>
                      {analisisCalidad.varianza.pixeles_no_finitos} /{" "}
                      {analisisCalidad.varianza.varianzas_negativas}
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                    <dt className="text-foreground/60">Mínimo / Máximo</dt>
                    <dd>
                      {analisisCalidad.varianza.estadisticas.minimo?.toFixed(5)} /{" "}
                      {analisisCalidad.varianza.estadisticas.maximo?.toFixed(3)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-black/[.04] py-0.5 dark:border-white/[.06]">
                    <dt className="text-foreground/60">Media / Mediana</dt>
                    <dd>
                      {analisisCalidad.varianza.estadisticas.media?.toFixed(5)} /{" "}
                      {analisisCalidad.varianza.estadisticas.mediana?.toFixed(5)}
                    </dd>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <dt className="text-foreground/60">Desviación estándar</dt>
                    <dd>
                      {analisisCalidad.varianza.estadisticas.desviacion_estandar?.toFixed(
                        5
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border border-black/[.08] p-3 dark:border-white/[.145]">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Flag className="h-3.5 w-3.5" />
                  <span>
                    Distribución FLAGS ({analisisCalidad.flags.valores_distintos} estados)
                  </span>
                </div>
                <div className="mt-2 max-h-44 overflow-y-auto">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-black/[.08] text-foreground/60 dark:border-white/[.145]">
                        <th className="py-1 pr-2">Valor</th>
                        <th className="py-1 pr-2">Píxeles</th>
                        <th className="py-1">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analisisCalidad.flags.distribucion.map((item) => (
                        <tr
                          key={item.valor}
                          className="border-b border-black/[.04] dark:border-white/[.06]"
                        >
                          <td className="py-1 pr-2">{item.valor}</td>
                          <td className="py-1 pr-2">
                            {item.cantidad.toLocaleString()}
                          </td>
                          <td className="py-1">{item.porcentaje.toFixed(6)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
