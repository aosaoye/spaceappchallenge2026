"use client";

import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Eye,
  Film,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/api-config";
import {
  ChallengeTarget,
  EpochFrame,
  findMatchingChallengeTarget,
} from "@/app/astronomy";

type AladinImage = {
  setColormap?: (name: string, options?: { stretch?: string }) => void;
  setOpacity?: (opacity: number) => void;
};

type AladinCatalog = {
  show: () => void;
  hide: () => void;
  getSources: () => unknown[];
};

type AladinInstance = {
  displayFITS: (
    url: string,
    options: { colormap?: string; stretch?: string; name?: string },
    onSuccess?: (
      ra: number,
      dec: number,
      fov: number,
      image: AladinImage
    ) => void,
    onError?: (error: unknown) => void,
    layer?: string
  ) => void;
  gotoRaDec: (ra: number, dec: number) => void;
  setFoV: (fov: number) => void;
  getRaDec: () => [number, number];
  getFov: () => [number, number];
  setImageSurvey: (survey: string) => void;
  addCatalog: (catalog: AladinCatalog) => void;
  removeOverlay?: (overlay: unknown) => void;
};

declare global {
  interface Window {
    A?: {
      init: Promise<void>;
      aladin: (
        element: HTMLElement | string,
        options: Record<string, unknown>
      ) => AladinInstance;
      catalogFromURL?: (
        url: string,
        options: Record<string, unknown>,
        onSuccess?: (catalog: AladinCatalog) => void,
        onError?: (err: unknown) => void
      ) => AladinCatalog;
      catalogFromVizieR?: (
        vizCatId: string,
        target: string,
        radiusDeg: number,
        options: Record<string, unknown>,
        onSuccess?: (catalog: AladinCatalog) => void
      ) => AladinCatalog;
    };
  }
}

const HIPS_SURVEYS = [
  {
    id: "https://skies.esac.esa.int/AllWISEColor",
    name: "AllWISE color (2010)",
    url: "https://skies.esac.esa.int/AllWISEColor",
    copyright: "AllWISE Infrared Survey (2010) - JPL/IPAC/NASA, Healpixed by CDS",
  },
  {
    id: "https://skies.esac.esa.int/2MASSColor",
    name: "2MASS color (1998-2001)",
    url: "https://skies.esac.esa.int/2MASSColor",
    copyright: "2MASS All-Sky Survey - UMass/IPAC-Caltech/NASA, Healpixed by CDS",
  },
  {
    id: "https://skies.esac.esa.int/DSSColor",
    name: "DSS2 color",
    url: "https://skies.esac.esa.int/DSSColor",
    copyright: "Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS",
  },
  {
    id: "https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/PanSTARRS",
    name: "PanSTARRS irg",
    url: "https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/PanSTARRS",
    copyright: "Pan-STARRS1 - STScI/IfA Hawaii",
  },
  {
    id: "https://skies.esac.esa.int/SDSS9Color",
    name: "SDSS9 color",
    url: "https://skies.esac.esa.int/SDSS9Color",
    copyright: "Sloan Digital Sky Survey DR9 - Healpixed by CDS",
  },
];

let aladinScriptPromise: Promise<void> | null = null;

export function ensureAladinScriptLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.A) {
    return Promise.resolve();
  }
  if (aladinScriptPromise) {
    return aladinScriptPromise;
  }

  aladinScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-aladin-lite="true"]'
    ) as HTMLScriptElement | null;

    if (existing) {
      if (window.A) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar /aladin.js")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = withBasePath("/aladin.js");
    script.async = true;
    script.dataset.aladinLite = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      aladinScriptPromise = null;
      reject(new Error("Error cargando /aladin.js"));
    };
    document.head.appendChild(script);
  });

  return aladinScriptPromise;
}

function resolveSingleExtensionFitsUrl(fitsUrl: string): string {
  if (
    !fitsUrl ||
    fitsUrl.includes("2025W41_2B_0509_2") ||
    fitsUrl.includes("2025W18_1B_0074") ||
    fitsUrl.includes("l2b-v27-2026-196")
  ) {
    return withBasePath("/processed/2025W41_2B_0509_2_D1_aladin_fast.fits");
  }
  return fitsUrl;
}

interface AladinSkyMapProps {
  fitsUrl: string;
  ra: number;
  dec: number;
  fov?: number;
  frames?: EpochFrame[];
  currentFrameIndex?: number;
  activeTarget?: ChallengeTarget | null;
  onSelectFrameIndex?: (index: number) => void;
}

export default function AladinSkyMap({
  fitsUrl,
  ra,
  dec,
  fov = 0.25,
  frames = [],
  currentFrameIndex = 0,
  activeTarget = null,
  onSelectFrameIndex,
}: AladinSkyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const aladinRef = useRef<AladinInstance | null>(null);
  const fitsImageRef = useRef<AladinImage | null>(null);
  const simbadCatalogRef = useRef<AladinCatalog | null>(null);
  const gaiaCatalogRef = useRef<AladinCatalog | null>(null);
  const allwiseCatalogRef = useRef<AladinCatalog | null>(null);
  const initializedRef = useRef(false);

  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [selectedSurveyId, setSelectedSurveyId] = useState(HIPS_SURVEYS[0].id);
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);

  // Estado de catálogos superpuestos (Gaia DR3, AllWISE, SIMBAD)
  const [simbadEnabled, setSimbadEnabled] = useState(false);
  const [simbadStatus, setSimbadStatus] = useState("");
  const [gaiaEnabled, setGaiaEnabled] = useState(false);
  const [gaiaStatus, setGaiaStatus] = useState("");
  const [allwiseCatEnabled, setAllwiseCatEnabled] = useState(false);
  const [allwiseCatStatus, setAllwiseCatStatus] = useState("");

  // Estado del Blink Comparator en Aladin Lite (AllWISE 2010 ↔ SPHEREx 2026)
  const [spherexFitsLoaded, setSpherexFitsLoaded] = useState(false);
  const [fitsOpacity, setFitsOpacity] = useState(1.0);
  const [blinkActive, setBlinkActive] = useState(false);
  const [blinkShowRecent, setBlinkShowRecent] = useState(true);

  const syncAladinTelemetry = useCallback((aladin: AladinInstance) => {
    try {
      console.log("Centro:", aladin.getRaDec());
      console.log("Campo de visión:", aladin.getFov());
    } catch {
      // ignore if aladin is still initializing
    }
  }, []);

  const matchedTarget =
    activeTarget ?? findMatchingChallengeTarget(ra, dec);

  // Desplazamiento total entre AllWISE (2010.5) y SPHEREx (2026.0, Δt = 15.5 años)
  const deltaYearsWiseToSpherex = 15.5;
  const wiseJumpArcsec = matchedTarget
    ? Math.hypot(
        (matchedTarget.pmRaMasYr * deltaYearsWiseToSpherex) / 1000,
        (matchedTarget.pmDecMasYr * deltaYearsWiseToSpherex) / 1000
      )
    : 0;

  const loadFits = useCallback(
    (aladin: AladinInstance, rawUrl: string, centerOnFits: boolean) => {
      const effectiveUrl = resolveSingleExtensionFitsUrl(rawUrl);
      setErrorStatus(null);

      try {
        aladin.displayFITS(
          effectiveUrl,
          {
            colormap: "grayscale",
            stretch: "asinh",
            name: "SPHEREx D1 FITS",
          },
          (imageRa, imageDec, imageFov, image) => {
            fitsImageRef.current = image;
            if (image && typeof image.setColormap === "function") {
              image.setColormap("grayscale", { stretch: "asinh" });
            }
            if (image && typeof image.setOpacity === "function") {
              image.setOpacity(fitsOpacity);
            }

            // Comprobar si la imagen FITS cargada cubre la región solicitada por el usuario
            const cosDec = Math.max(0.1, Math.cos((dec * Math.PI) / 180));
            const angularDistDeg =
              Number.isFinite(imageRa) && Number.isFinite(imageDec)
                ? Math.hypot((imageRa - ra) * cosDec, imageDec - dec)
                : Infinity;
            const footprintRadiusDeg =
              Number.isFinite(imageFov) && imageFov > 0 ? imageFov : 2.0;
            const coversRequestedRegion = angularDistDeg <= footprintRadiusDeg;

            if (
              centerOnFits &&
              !coversRequestedRegion &&
              Number.isFinite(imageRa) &&
              Number.isFinite(imageDec)
            ) {
              // Solo recentrar en el FITS si el usuario pulsó manualmente el botón de ir al recorte FITS
              aladin.gotoRaDec(imageRa, imageDec);
              if (Number.isFinite(imageFov) && imageFov > 0) {
                aladin.setFoV(imageFov);
              }
              syncAladinTelemetry(aladin);
            } else {
              // Conservar la vista solicitada por el usuario (requestedRA, requestedDEC, requestedFOV)
              aladin.gotoRaDec(ra, dec);
              aladin.setFoV(fov);
              syncAladinTelemetry(aladin);
            }

            setSpherexFitsLoaded(true);
            setErrorStatus(null);
          },
          (error) => {
            console.warn("Aviso al superponer capa FITS en Aladin:", error);
          },
          "spherex-frame"
        );
      } catch (err) {
        console.warn("Aviso en displayFITS:", err);
      }
    },
    [ra, dec, fov, fitsOpacity, syncAladinTelemetry]
  );

  // Cargar catálogo VizieR (Gaia DR3 o AllWISE)
  const loadVizierCatalog = useCallback(
    (
      vizierId: string,
      label: string,
      color: string,
      catRef: React.MutableRefObject<AladinCatalog | null>,
      setStatusFn: (s: string) => void
    ) => {
      const aladin = aladinRef.current;
      const A = window.A;
      if (!aladin || !A?.catalogFromURL) return;

      const [curRa, curDec] = aladin.getRaDec();
      const curFov = aladin.getFov();
      const radiusArcmin = Math.min(
        15,
        Math.max(2, Math.hypot(curFov[0] || 0.2, curFov[1] || 0.2) * 30)
      );
      setStatusFn("Cargando…");

      const vizUrl = `https://vizier.cds.unistra.fr/viz-bin/votable?-source=${encodeURIComponent(
        vizierId
      )}&-c=${encodeURIComponent(`${curRa} ${curDec}`)}&-c.rm=${radiusArcmin.toFixed(
        1
      )}&-out.max=500`;

      A.catalogFromURL(
        vizUrl,
        {
          name: label,
          color,
          sourceSize: 9,
          onClick: "showTable",
        },
        (catalog) => {
          if (catRef.current && aladin.removeOverlay) {
            aladin.removeOverlay(catRef.current);
          }
          catRef.current = catalog;
          aladin.addCatalog(catalog);
          setStatusFn(`${catalog.getSources().length} fuentes`);
        },
        () => {
          setStatusFn("Error red");
        }
      );
    },
    []
  );

  const fetchSimbadCone = useCallback(() => {
    const aladin = aladinRef.current;
    const A = window.A;
    if (!aladin || !A?.catalogFromURL) return;

    const [curRa, curDec] = aladin.getRaDec();
    const curFov = aladin.getFov();
    const radiusDeg = Math.min(
      5,
      Math.max(0.05, Math.hypot(curFov[0] || 0.5, curFov[1] || 0.5) / 2)
    );
    setSimbadStatus("Cargando…");

    const adql = [
      `SELECT TOP 500 basic.*, DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${curRa}, ${curDec})) AS "distance"`,
      "FROM basic",
      `WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${curRa}, ${curDec}, ${radiusDeg}))`,
      'ORDER BY "distance" ASC',
    ].join(" ");

    const tapUrl = `https://simbad.idia.ac.za/simbad/sim-tap/sync?${new URLSearchParams(
      {
        request: "doQuery",
        lang: "adql",
        format: "votable/td",
        query: adql,
      }
    ).toString()}`;

    A.catalogFromURL(
      tapUrl,
      {
        name: "SIMBAD",
        color: "#4c9b73",
        hoverColor: "#ffffff",
        selectionColor: "#00ff9d",
        sourceSize: 8,
        limit: 500,
        onClick: "showTable",
      },
      (catalog) => {
        if (simbadCatalogRef.current && aladin.removeOverlay) {
          aladin.removeOverlay(simbadCatalogRef.current);
        }
        simbadCatalogRef.current = catalog;
        aladin.addCatalog(catalog);
        const count = catalog.getSources().length;
        setSimbadStatus(`${count} objetos`);
      },
      () => {
        setSimbadStatus("Error red");
      }
    );
  }, []);

  // Efecto Blink Comparator automático en Aladin Lite (alterna AllWISE 2010 ↔ Época reciente / SPHEREx)
  useEffect(() => {
    if (!blinkActive) return;
    const timer = window.setInterval(() => {
      setBlinkShowRecent((prev) => {
        const next = !prev;
        const aladin = aladinRef.current;
        if (aladin) {
          if (spherexFitsLoaded && fitsImageRef.current?.setOpacity) {
            fitsImageRef.current.setOpacity(next ? 1.0 : 0.0);
            setFitsOpacity(next ? 1.0 : 0.0);
          } else {
            // Alternar entre AllWISE (2010) y PanSTARRS/2MASS para ver el salto de movimiento propio
            const surveyId = next
              ? HIPS_SURVEYS[3].id // PanSTARRS / Época posterior
              : HIPS_SURVEYS[0].id; // AllWISE (2010)
            setSelectedSurveyId(surveyId);
            aladin.setImageSurvey(surveyId);
          }
        }
        if (frames.length > 1 && onSelectFrameIndex) {
          onSelectFrameIndex(
            next ? frames.length - 1 : 0
          );
        }
        return next;
      });
    }, 950);

    return () => window.clearInterval(timer);
  }, [blinkActive, spherexFitsLoaded, frames.length, onSelectFrameIndex]);

  useEffect(() => {
    let cancelled = false;

    ensureAladinScriptLoaded()
      .then(() => {
        if (
          cancelled ||
          !window.A ||
          !containerRef.current ||
          initializedRef.current
        ) {
          return;
        }
        initializedRef.current = true;
        return window.A.init.then(() => {
          if (cancelled || !containerRef.current || !window.A) return;

          const aladin = window.A.aladin(containerRef.current, {
            survey: HIPS_SURVEYS[0].id,
            hipsList: HIPS_SURVEYS,
            target: `${ra} ${dec}`,
            fov,
            cooFrame: "ICRS",
            realFullscreen: true,
            showSimbadPointerControl: true,
            showCooGridControl: true,
            showContextMenu: true,
            showShareControl: true,
          });

          aladinRef.current = aladin;
          syncAladinTelemetry(aladin);
          setErrorStatus(null);

          const is2025W41Target =
            Math.abs(ra - 123.67) < 1 && Math.abs(dec - 38.51) < 1;
          if (is2025W41Target) {
            loadFits(aladin, fitsUrl, false);
          }
        });
      })
      .catch((err) => {
        initializedRef.current = false;
        console.error("Error inicializando Aladin Lite:", err);
        setErrorStatus("Error cargando Aladin Lite");
      });

    return () => {
      cancelled = true;
    };
  }, [ra, dec, fov, fitsUrl, loadFits, syncAladinTelemetry]);

  useEffect(() => {
    if (aladinRef.current) {
      aladinRef.current.gotoRaDec(ra, dec);
      aladinRef.current.setFoV(fov);
      syncAladinTelemetry(aladinRef.current);
      setErrorStatus(null);
    }
  }, [ra, dec, fov, syncAladinTelemetry]);

  return (
    <section className="w-full space-y-3">
      {/* Barra superior de control Blink Comparator */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {errorStatus && (
            <span className="font-mono text-red-600 dark:text-red-400" role="status">
              {errorStatus}
            </span>
          )}
          {frames.length > 0 && (
            <span className="font-mono text-foreground/70">
              Época {currentFrameIndex + 1}/{frames.length}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBlinkActive((b) => !b)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              blinkActive
                ? "bg-amber-500 text-black"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            {blinkActive ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>
                  {blinkShowRecent ? "SPHEREx" : "AllWISE"}
                </span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>Blink</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              const wiseId = HIPS_SURVEYS[0].id;
              setSelectedSurveyId(wiseId);
              if (aladinRef.current) {
                aladinRef.current.setImageSurvey(wiseId);
              }
            }}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              selectedSurveyId === HIPS_SURVEYS[0].id
                ? "bg-foreground text-background"
                : "border border-black/[.08] hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>AllWISE</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (aladinRef.current) {
                aladinRef.current.gotoRaDec(ra, dec);
                aladinRef.current.setFoV(fov);
              }
            }}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Centrar</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (aladinRef.current) {
                loadFits(aladinRef.current, fitsUrl, true);
              }
            }}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>FITS SPHEREx</span>
          </button>
        </div>
      </div>

      {/* Control de opacidad de superposición FITS */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-black/[.08] bg-black/[.02] px-3 py-2 text-xs dark:border-white/[.145] dark:bg-white/[.02]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Film className="h-3.5 w-3.5" />
            <span>Opacidad FITS</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={fitsOpacity}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value);
              setFitsOpacity(val);
              if (fitsImageRef.current?.setOpacity) {
                fitsImageRef.current.setOpacity(val);
              }
            }}
            className="w-28 cursor-pointer accent-foreground"
          />
          <span className="font-mono text-foreground/70">
            {Math.round(fitsOpacity * 100)}%
          </span>
        </div>

        {matchedTarget && wiseJumpArcsec > 0.5 && (
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-600 dark:text-amber-400">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>Δθ = {wiseJumpArcsec.toFixed(1)}&quot;</span>
          </div>
        )}
      </div>

      {/* Contenedor Aladin Lite */}
      <div className="aladin-viewport-host relative w-full overflow-hidden rounded-lg border border-black/[.08] bg-black dark:border-white/[.145]">
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: "620px" }}
        />

        {/* Selector HiPS */}
        <div
          aria-live="polite"
          className="pointer-events-auto absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center rounded border border-neutral-600 bg-neutral-950/90 px-2.5 py-1 text-[11px] text-neutral-100 shadow backdrop-blur"
        >
          <select
            aria-label="Change HiPS"
            value={selectedSurveyId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedSurveyId(nextId);
              if (aladinRef.current) {
                aladinRef.current.setImageSurvey(nextId);
              }
            }}
            className="cursor-pointer bg-transparent font-bold text-neutral-100 focus:outline-none"
          >
            {HIPS_SURVEYS.map((s) => (
              <option
                key={s.id}
                value={s.id}
                className="bg-neutral-900 text-neutral-100"
              >
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Panel lateral derecho Catalogs (Gaia DR3 + AllWISE + SIMBAD + SPHEREx FITS) */}
        <aside
          aria-label="Catalogs"
          className={`pointer-events-auto absolute right-1.5 top-28 z-20 overflow-hidden rounded border border-neutral-400 bg-neutral-950/95 text-[11px] text-neutral-100 shadow-md ${
            catalogCollapsed ? "h-6 w-6" : "w-44"
          }`}
        >
          <button
            type="button"
            onClick={() => setCatalogCollapsed((c) => !c)}
            aria-label={
              catalogCollapsed ? "Show catalog panel" : "Hide catalog panel"
            }
            className="absolute right-0 top-0 z-10 grid h-5 w-5 place-items-center border-b border-l border-neutral-500 bg-neutral-900 font-bold text-neutral-100 hover:bg-sky-700"
          >
            {catalogCollapsed ? (
              <ChevronLeft className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>

          {!catalogCollapsed && (
            <div className="flex flex-col gap-1.5 p-2">
              <h3 className="pr-5 text-[11px] font-bold leading-none">
                Catálogos
              </h3>

              {/* Gaia DR3 */}
              <label className="flex cursor-pointer items-center gap-1.5 pt-1">
                <span
                  className="inline-block h-4 w-1 rounded bg-[#06b6d4]"
                  aria-hidden="true"
                />
                <input
                  type="checkbox"
                  checked={gaiaEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setGaiaEnabled(checked);
                    if (checked) {
                      if (gaiaCatalogRef.current) {
                        gaiaCatalogRef.current.show();
                        setGaiaStatus(
                          `${gaiaCatalogRef.current.getSources().length} fuentes`
                        );
                      } else {
                        loadVizierCatalog(
                          "I/355/gaiadr3",
                          "Gaia DR3 (2016)",
                          "#06b6d4",
                          gaiaCatalogRef,
                          setGaiaStatus
                        );
                      }
                    } else {
                      gaiaCatalogRef.current?.hide();
                      setGaiaStatus("");
                    }
                  }}
                  className="h-3 w-3 accent-cyan-500"
                />
                <span className="font-medium">Gaia DR3</span>
              </label>
              {gaiaStatus && (
                <span className="pl-5 text-[10px] text-neutral-400">
                  {gaiaStatus}
                </span>
              )}

              {/* AllWISE */}
              <label className="flex cursor-pointer items-center gap-1.5 pt-0.5">
                <span
                  className="inline-block h-4 w-1 rounded bg-[#f59e0b]"
                  aria-hidden="true"
                />
                <input
                  type="checkbox"
                  checked={allwiseCatEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllwiseCatEnabled(checked);
                    if (checked) {
                      if (allwiseCatalogRef.current) {
                        allwiseCatalogRef.current.show();
                        setAllwiseCatStatus(
                          `${allwiseCatalogRef.current.getSources().length} fuentes`
                        );
                      } else {
                        loadVizierCatalog(
                          "II/328/allwise",
                          "AllWISE (2010)",
                          "#f59e0b",
                          allwiseCatalogRef,
                          setAllwiseCatStatus
                        );
                      }
                    } else {
                      allwiseCatalogRef.current?.hide();
                      setAllwiseCatStatus("");
                    }
                  }}
                  className="h-3 w-3 accent-amber-500"
                />
                <span className="font-medium">AllWISE</span>
              </label>
              {allwiseCatStatus && (
                <span className="pl-5 text-[10px] text-neutral-400">
                  {allwiseCatStatus}
                </span>
              )}

              {/* SIMBAD */}
              <label className="flex cursor-pointer items-center gap-1.5 pt-0.5">
                <span
                  className="inline-block h-4 w-1 rounded bg-[#4c9b73]"
                  aria-hidden="true"
                />
                <input
                  type="checkbox"
                  checked={simbadEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSimbadEnabled(checked);
                    if (checked) {
                      if (simbadCatalogRef.current) {
                        simbadCatalogRef.current.show();
                        setSimbadStatus(
                          `${simbadCatalogRef.current.getSources().length} objetos`
                        );
                      } else {
                        fetchSimbadCone();
                      }
                    } else {
                      simbadCatalogRef.current?.hide();
                      setSimbadStatus("");
                    }
                  }}
                  className="h-3 w-3 accent-sky-600"
                />
                <span className="font-medium">SIMBAD</span>
              </label>
              {simbadStatus && (
                <span className="pl-5 text-[10px] text-neutral-400">
                  {simbadStatus}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  if (gaiaEnabled) {
                    loadVizierCatalog(
                      "I/355/gaiadr3",
                      "Gaia DR3 (2016)",
                      "#06b6d4",
                      gaiaCatalogRef,
                      setGaiaStatus
                    );
                  }
                  if (allwiseCatEnabled) {
                    loadVizierCatalog(
                      "II/328/allwise",
                      "AllWISE (2010)",
                      "#f59e0b",
                      allwiseCatalogRef,
                      setAllwiseCatStatus
                    );
                  }
                  if (simbadEnabled) {
                    fetchSimbadCone();
                  }
                }}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-neutral-500 bg-neutral-900 px-2 py-1 text-[11px] hover:bg-sky-700"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Actualizar vista</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (aladinRef.current) {
                    loadFits(aladinRef.current, fitsUrl, true);
                  }
                }}
                className="flex w-full items-center justify-center gap-1 rounded border border-neutral-500 bg-neutral-900 px-2 py-1 text-[11px] hover:bg-sky-700"
              >
                <Plus className="h-3 w-3" />
                <span>SPHEREx FITS</span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
