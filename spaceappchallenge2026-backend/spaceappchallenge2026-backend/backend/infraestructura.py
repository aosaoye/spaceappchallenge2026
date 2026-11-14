"""
Representación, consulta e inspección científica multihilo de los datos astronómicos de SPHEREx.
Utiliza ThreadPoolExecutor y deduplicación single-flight para paralelizar descargas FITS,
cálculos WCS espaciales/espectrales (LVF) y renderizado de imágenes PNG sin bloquear la API.
"""

import http.client
import io
import ssl
import threading
import time
import urllib.error
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import urlopen

import certifi
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.table import Table
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa

from dominio import Observacion

conf.remote_timeout = 120

# Candado exclusivo para Matplotlib (Agg) cuando múltiples hilos renderizan figuras simultáneamente
_MATPLOTLIB_LOCK = threading.Lock()

DESCRIPCIONES_EXTENSIONES_MEF: dict[str, str] = {
    "PRIMARY": "Cabecera principal del archivo Multi-Extension FITS (MEF).",
    "IMAGE": "Flujo superficial calibrado del detector en unidades científicas de MJy/sr (2040 × 2040).",
    "FLAGS": "Mapa de bits con banderas de estado y procesamiento por píxel (2040 × 2040).",
    "VARIANCE": "Estimación por píxel de la varianza del flujo en (MJy/sr)^2 (2040 × 2040).",
    "ZODI": "Modelo de emisión de fondo de polvo zodiacal en MJy/sr (no sustraído de IMAGE).",
    "EPSF": "Tabla binaria con la función de dispersión de punto efectiva (ePSF) en 441 regiones (21 × 21).",
    "WCS-WAVE": "Tabla de búsqueda WCS espectral (WAVE-TAB) que asigna longitud de onda central y ancho de banda por píxel.",
}

BANDAS_LVF_DETECTOR: dict[int, dict[str, object]] = {
    1: {"banda": "Band 1 (D1)", "rango_um": "0.75 - 1.09 µm", "resolucion_R": 39},
    2: {"banda": "Band 2 (D2)", "rango_um": "1.10 - 1.62 µm", "resolucion_R": 41},
    3: {"banda": "Band 3 (D3)", "rango_um": "1.63 - 2.41 µm", "resolucion_R": 41},
    4: {"banda": "Band 4 (D4)", "rango_um": "2.42 - 3.82 µm", "resolucion_R": 35},
    5: {"banda": "Band 5 (D5)", "rango_um": "3.83 - 4.41 µm", "resolucion_R": 112},
    6: {"banda": "Band 6 (D6)", "rango_um": "4.42 - 5.00 µm", "resolucion_R": 128},
}


class RepositorioIrsa:
    """
    Conecta con IRSA para consultar, descargar, inspeccionar y visualizar
    productos científicos Multi-Extension FITS (MEF) de SPHEREx usando un
    pool de hilos (ThreadPoolExecutor) y caché concurrente en memoria.
    """

    def __init__(
        self,
        max_cache_imagenes: int = 48,
        max_cache_fits: int = 8,
        max_workers: int = 8,
    ):
        self._max_cache_imagenes = max_cache_imagenes
        self._max_cache_fits = max_cache_fits
        self._lock = threading.RLock()
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="spherex_worker",
        )
        self._vuelos_fits: dict[str, Future[bytes]] = {}
        self._cache_png: OrderedDict[str, bytes] = OrderedDict()
        self._cache_fits_bytes: OrderedDict[str, bytes] = OrderedDict()
        self._cache_estructura: OrderedDict[str, list[dict]] = OrderedDict()
        self._cache_metadatos: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_imagen: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_calidad: OrderedDict[str, dict] = OrderedDict()
        self._cache_busquedas: OrderedDict[str, list[Observacion]] = OrderedDict()

        # Precargar en segundo plano el archivo FITS local para respuesta instantánea (0 ms)
        self._pool.submit(self._precargar_recursos_locales)

    def _precargar_recursos_locales(self) -> None:
        """
        Lee en un hilo de fondo el archivo FITS local y precalcula su estructura,
        metadatos WCS y vista previa PNG sin bloquear el arranque del servidor.
        """
        try:
            ruta = self._resolver_fits_local("local")
            if ruta is not None and ruta.is_file():
                contenido = ruta.read_bytes()
                clave = str(ruta)
                with self._lock:
                    self._cache_fits_bytes[clave] = contenido
                self.obtener_estructura_fits("local")
                self.obtener_metadatos_fits("local")
                self.analizar_imagen_fits("local")
                self.analizar_calidad_fits("local")
                self.convertir_fits_a_png("local", modo="flujo")
        except Exception:
            pass

    def buscar_por_coordenadas(
        self,
        ascension_recta: float,
        declinacion: float,
        radio: float
    ) -> list[Observacion]:
        """
        Consulta los productos SPHEREx cercanos a unas coordenadas en las
        colecciones recomendadas ('spherex_dr1', 'spherex_qr3') y lanza
        precarga en segundo plano del primer resultado en el pool de hilos.
        """
        clave_busqueda = f"{ascension_recta:.4f}:{declinacion:.4f}:{radio:.1f}"
        with self._lock:
            if clave_busqueda in self._cache_busquedas:
                self._cache_busquedas.move_to_end(clave_busqueda)
                return list(self._cache_busquedas[clave_busqueda])

        coordenadas = SkyCoord(
            ra=ascension_recta * u.deg,
            dec=declinacion * u.deg,
            frame="icrs"
        )

        try:
            resultados = Irsa.query_sia(
                pos=(coordenadas, radio * u.arcsec),
                collection=["spherex_dr1", "spherex_qr3"]
            )
        except Exception:
            radio_reducido = min(float(radio), 5.0)
            resultados = Irsa.query_sia(
                pos=(coordenadas, radio_reducido * u.arcsec),
                collection=["spherex_dr1", "spherex_qr3"]
            )

        observaciones: list[Observacion] = []

        for fila in resultados:
            tamano = self._obtener_valor(fila, "access_estsize")
            url_acceso = str(fila["access_url"])

            observacion = Observacion(
                identificador=str(fila["obs_id"]),
                ascension_recta=float(fila["s_ra"]),
                declinacion=float(fila["s_dec"]),
                coleccion=str(fila["obs_collection"]),
                banda_espectral=str(fila["energy_bandpassname"]),
                tipo_producto=str(fila["dataproduct_subtype"]),
                url_acceso=url_acceso,
                tamano_estimado=int(tamano) if tamano is not None else None,
                url_imagen_png=f"/api/v1/observaciones/imagen?fits_url={quote(url_acceso, safe='')}"
            )

            observaciones.append(observacion)

        with self._lock:
            self._cache_busquedas[clave_busqueda] = observaciones
            while len(self._cache_busquedas) > 64:
                self._cache_busquedas.popitem(last=False)

        # Precargar en paralelo el primer FITS encontrado sin bloquear la respuesta HTTP
        if observaciones:
            primera_url = observaciones[0].url_acceso
            self._pool.submit(self._precalentar_fits_url, primera_url)

        return observaciones

    def _precalentar_fits_url(self, url_acceso: str) -> None:
        try:
            self.obtener_estructura_fits(url_acceso)
            self.obtener_metadatos_fits(url_acceso)
        except Exception:
            pass

    def _obtener_bytes_fits_con_deduplicacion(self, url_limpia: str) -> bytes:
        """
        Obtiene los bytes de un archivo FITS usando caché en RAM y deduplicación
        single-flight: si varios hilos piden simultáneamente el mismo archivo FITS
        (por ejemplo estructura-fits, metadatos-fits e imagen), se realiza una
        única descarga compartida entre todos los hilos.
        """
        ruta_local = self._resolver_fits_local(url_limpia)
        clave_efectiva = str(ruta_local) if ruta_local is not None else url_limpia

        with self._lock:
            if clave_efectiva in self._cache_fits_bytes:
                self._cache_fits_bytes.move_to_end(clave_efectiva)
                return self._cache_fits_bytes[clave_efectiva]

            vuelo_existente = self._vuelos_fits.get(clave_efectiva)
            if vuelo_existente is None:
                vuelo_existente = self._pool.submit(
                    self._descargar_bytes_fits_worker,
                    url_limpia,
                    ruta_local,
                )
                self._vuelos_fits[clave_efectiva] = vuelo_existente

        try:
            contenido = vuelo_existente.result(timeout=125)
        finally:
            with self._lock:
                self._vuelos_fits.pop(clave_efectiva, None)

        with self._lock:
            self._cache_fits_bytes[clave_efectiva] = contenido
            if len(self._cache_fits_bytes) > self._max_cache_fits:
                self._cache_fits_bytes.popitem(last=False)

        return contenido

    def _descargar_bytes_fits_worker(
        self,
        url_limpia: str,
        ruta_local: Path | None,
    ) -> bytes:
        if ruta_local is not None and ruta_local.is_file():
            return ruta_local.read_bytes()

        partes_url = urlsplit(url_limpia)
        if (
            partes_url.scheme != "https"
            or partes_url.hostname != "irsa.ipac.caltech.edu"
        ):
            raise ValueError(
                "La URL debe pertenecer al servicio HTTPS de IRSA (irsa.ipac.caltech.edu)."
            )

        contexto_ssl = ssl.create_default_context(
            cafile=certifi.where()
        )

        max_reintentos = 3
        for intento in range(max_reintentos):
            try:
                with urlopen(
                    url_limpia,
                    timeout=90,
                    context=contexto_ssl
                ) as respuesta:
                    return respuesta.read()
            except (
                TimeoutError,
                urllib.error.HTTPError,
                urllib.error.URLError,
                http.client.IncompleteRead,
            ):
                if intento == max_reintentos - 1:
                    raise
                time.sleep(1.5 * (intento + 1))

        raise RuntimeError("No se pudo descargar el contenido del archivo FITS.")

    def descargar_fits(self, url_acceso: str) -> fits.HDUList:
        """
        Descarga o recupera de caché un archivo FITS y devuelve su HDUList en memoria.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        contenido = self._obtener_bytes_fits_con_deduplicacion(url_limpia)
        return fits.open(BytesIO(contenido), memmap=False)

    def obtener_estructura_fits(self, url_acceso: str) -> list[dict]:
        """
        Inspecciona las extensiones de un archivo FITS Multi-Extensión (MEF) con caché en RAM.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        with self._lock:
            if url_limpia in self._cache_estructura:
                self._cache_estructura.move_to_end(url_limpia)
                return self._cache_estructura[url_limpia]

        archivo = self.descargar_fits(url_limpia)
        try:
            extensiones = []
            for indice, extension in enumerate(archivo):
                datos = extension.data
                nombre = extension.name or ("PRIMARY" if indice == 0 else f"EXT_{indice}")
                cabecera = extension.header

                informacion = {
                    "indice": indice,
                    "nombre": nombre,
                    "tipo_extension": type(extension).__name__,
                    "dimensiones": (
                        list(datos.shape)
                        if datos is not None
                        else None
                    ),
                    "tipo_datos": (
                        str(datos.dtype)
                        if datos is not None
                        else None
                    ),
                    "unidades": cabecera.get("BUNIT"),
                    "descripcion": DESCRIPCIONES_EXTENSIONES_MEF.get(
                        nombre,
                        "Extensión científica del archivo FITS."
                    ),
                }
                extensiones.append(informacion)

            with self._lock:
                self._cache_estructura[url_limpia] = extensiones
                if len(self._cache_estructura) > 32:
                    self._cache_estructura.popitem(last=False)

            return extensiones
        finally:
            archivo.close()

    def obtener_metadatos_fits(self, url_acceso: str) -> dict:
        """
        Extrae en paralelo los metadatos científicos, WCS espacial y WCS espectral (LVF)
        de un archivo FITS de SPHEREx, guardando el resultado en caché.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        with self._lock:
            if url_limpia in self._cache_metadatos:
                self._cache_metadatos.move_to_end(url_limpia)
                return self._cache_metadatos[url_limpia]

        archivo = self.descargar_fits(url_limpia)
        try:
            cabecera_principal = archivo[0].header
            cabecera_imagen = (
                archivo["IMAGE"].header
                if "IMAGE" in archivo
                else archivo[0].header
            )

            campos_generales = [
                "EXTNAME",
                "NAXIS1",
                "NAXIS2",
                "TELESCOP",
                "INSTRUME",
                "VERSION",
                "OBJECT",
                "DATE",
                "DATE-OBS",
                "MJD-OBS",
                "OBSID",
                "OBS_ID",
                "DETECTOR",
                "BUNIT",
                "EXPTIME",
                "PSF_FWHM",
                "CRPIX1A",
                "CRPIX2A",
            ]

            metadatos_principales = {
                clave: self._serializar_valor_fits(cabecera_principal[clave])
                for clave in campos_generales
                if clave in cabecera_principal
            }

            metadatos_imagen = {
                clave: self._serializar_valor_fits(cabecera_imagen[clave])
                for clave in campos_generales
                if clave in cabecera_imagen
            }

            wcs_alternativos = {
                clave: self._serializar_valor_fits(cabecera_imagen[clave])
                for clave in cabecera_imagen.keys()
                if clave.startswith("WCSNAME")
            }

            claves_wcs = [
                "RADESYS",
                "EQUINOX",
                "WCSAXES",
                "LONPOLE",
                "LATPOLE",
            ]

            parametros_wcs = {
                clave: self._serializar_valor_fits(cabecera_imagen[clave])
                for clave in cabecera_imagen.keys()
                if (
                    clave in claves_wcs
                    or clave.startswith((
                        "CRPIX",
                        "CRVAL",
                        "CTYPE",
                        "CUNIT",
                        "CDELT",
                        "CD",
                        "PC",
                        "CROTA",
                    ))
                )
            }

            detector_val = cabecera_imagen.get("DETECTOR")
            info_detector = (
                BANDAS_LVF_DETECTOR.get(int(detector_val))
                if isinstance(detector_val, (int, np.integer))
                or (isinstance(detector_val, str) and detector_val.isdigit())
                else None
            )

            # 8a. WCS Espacial
            wcs_espacial_info: dict[str, object] = {}
            x_central = 1020.0
            y_central = 1020.0
            try:
                wcs_espacial = WCS(cabecera_imagen, relax=True).celestial
                ra_crval, dec_crval = wcs_espacial.wcs.crval
                px, py = wcs_espacial.world_to_pixel(
                    SkyCoord(ra=ra_crval, dec=dec_crval, unit="deg")
                )
                x_central = float(px)
                y_central = float(py)
                wcs_espacial_info = {
                    "ra_central_deg": float(ra_crval),
                    "dec_central_deg": float(dec_crval),
                    "pixel_central_x": round(x_central, 2),
                    "pixel_central_y": round(y_central, 2),
                }
            except Exception:
                pass

            # 8b y 8c. WCS Espectral ('W' -> tabla WCS-WAVE) con sip = None
            wcs_espectral_info: dict[str, object] = {}
            if "IMAGE" in archivo and "WCS-WAVE" in archivo:
                try:
                    spectral_wcs = WCS(
                        header=archivo["IMAGE"].header,
                        fobj=archivo,
                        key="W"
                    )
                    spectral_wcs.sip = None
                    wl_central, bw_central = spectral_wcs.pixel_to_world(
                        x_central,
                        y_central
                    )
                    alto, ancho = archivo["IMAGE"].data.shape
                    muestra_x = np.array([0, ancho // 2, ancho - 1], dtype=float)
                    muestra_y = np.linspace(0, alto - 1, 9, dtype=float)
                    gx, gy = np.meshgrid(muestra_x, muestra_y)
                    wl_grid, bw_grid = spectral_wcs.pixel_to_world(gx, gy)
                    wl_vals = np.asarray(wl_grid.value, dtype=float)
                    bw_vals = np.asarray(bw_grid.value, dtype=float)

                    wcs_espectral_info = {
                        "unidad": str(wl_central.unit),
                        "longitud_onda_central_um": round(float(wl_central.value), 4),
                        "ancho_banda_central_um": round(float(bw_central.value), 5),
                        "longitud_onda_min_um": round(float(np.nanmin(wl_vals)), 4),
                        "longitud_onda_max_um": round(float(np.nanmax(wl_vals)), 4),
                        "ancho_banda_medio_um": round(float(np.nanmean(bw_vals)), 5),
                        "poder_resolucion_aprox": round(
                            float(wl_central.value / bw_central.value), 1
                        )
                        if float(bw_central.value) > 0
                        else None,
                    }
                except Exception:
                    pass

            conteo_flags_l2 = {
                clave: self._serializar_valor_fits(cabecera_imagen[clave])
                for clave in cabecera_imagen.keys()
                if clave.startswith("L2 N_")
            }

            definiciones_flags: list[dict[str, object]] = []
            if "FLAGS" in archivo:
                flags_header = archivo["FLAGS"].header
                for clave in flags_header.keys():
                    if clave.startswith("MSKN"):
                        sufijo = clave[4:]
                        if sufijo.isdigit():
                            definiciones_flags.append({
                                "bit": int(sufijo),
                                "nombre": str(flags_header[clave]),
                                "descripcion": str(
                                    flags_header.get(f"MSKD{sufijo}", "")
                                ),
                            })

            resumen_extensiones: dict[str, object] = {}
            for ext_name in ("VARIANCE", "ZODI"):
                if ext_name in archivo:
                    h = archivo[ext_name].header
                    resumen_extensiones[ext_name] = {
                        "naxis1": h.get("NAXIS1"),
                        "naxis2": h.get("NAXIS2"),
                        "bunit": h.get("BUNIT"),
                    }

            if "EPSF" in archivo:
                psf_h = archivo["EPSF"].header
                epsf_info: dict[str, object] = {
                    "regiones_naxis2": psf_h.get("NAXIS2"),
                    "detector": psf_h.get("DETECTOR"),
                    "ovsmpx": psf_h.get("OVSMPX"),
                    "ovsmpy": psf_h.get("OVSMPY"),
                    "tdim11": psf_h.get("TDIM11"),
                    "version_pipeline": cabecera_principal.get("VERSION"),
                }
                try:
                    epsf_table = Table(archivo["EPSF"].data)
                    epsf_info["columnas"] = list(epsf_table.colnames)
                    if "BINX" in epsf_table.colnames and "BINY" in epsf_table.colnames:
                        epsf_info["nzones_x"] = int(len(np.unique(epsf_table["BINX"])))
                        epsf_info["nzones_y"] = int(len(np.unique(epsf_table["BINY"])))
                    if "NEFF_MEAN" in epsf_table.colnames:
                        epsf_info["neff_mean_promedio"] = round(
                            float(np.nanmean(epsf_table["NEFF_MEAN"])), 3
                        )
                    if "CWAVE" in epsf_table.colnames:
                        epsf_info["cwave_central_um"] = round(
                            float(np.nanmedian(epsf_table["CWAVE"])), 4
                        )
                except Exception:
                    pass
                resumen_extensiones["EPSF"] = epsf_info

            if "WCS-WAVE" in archivo:
                try:
                    wcs_wave_table = Table(archivo["WCS-WAVE"].data)
                    x_arr = np.asarray(wcs_wave_table["X"][0])
                    y_arr = np.asarray(wcs_wave_table["Y"][0])
                    valores_arr = np.asarray(wcs_wave_table["VALUES"][0])
                    resumen_extensiones["WCS-WAVE"] = {
                        "filas": len(wcs_wave_table),
                        "columnas": list(wcs_wave_table.colnames),
                        "dimensiones_x": list(x_arr.shape),
                        "dimensiones_y": list(y_arr.shape),
                        "dimensiones_values": list(valores_arr.shape),
                    }
                except Exception:
                    pass

            resultado = {
                "cabecera_principal": metadatos_principales,
                "cabecera_imagen": metadatos_imagen,
                "banda_detector": info_detector,
                "wcs_alternativos": wcs_alternativos,
                "parametros_wcs": parametros_wcs,
                "wcs_espacial": wcs_espacial_info,
                "wcs_espectral": wcs_espectral_info,
                "conteo_flags_l2": conteo_flags_l2,
                "definiciones_flags": definiciones_flags,
                "resumen_extensiones": resumen_extensiones,
                "url_firefly": f"https://irsa.ipac.caltech.edu/irsaviewer/?__action=table.search&url={quote(url_limpia, safe='')}",
            }

            with self._lock:
                self._cache_metadatos[url_limpia] = resultado
                if len(self._cache_metadatos) > 32:
                    self._cache_metadatos.popitem(last=False)

            return resultado
        finally:
            archivo.close()

    def analizar_imagen_fits(self, url_acceso: str) -> dict:
        """
        Analiza estadísticamente los píxeles de la imagen científica (IMAGE).
        Devuelve las estadísticas y el recuento de píxeles válidos y no válidos.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        with self._lock:
            if url_limpia in self._cache_analisis_imagen:
                self._cache_analisis_imagen.move_to_end(url_limpia)
                return self._cache_analisis_imagen[url_limpia]

        archivo = self.descargar_fits(url_limpia)
        try:
            extension_imagen = (
                archivo["IMAGE"] if "IMAGE" in archivo else archivo[0]
            )
            datos = extension_imagen.data

            if datos is None:
                raise ValueError(
                    "La extensión IMAGE no contiene datos."
                )

            unidad = extension_imagen.header.get("BUNIT")
            mascara_validos = np.isfinite(datos)

            total_pixeles = int(datos.size)
            pixeles_validos = int(np.count_nonzero(mascara_validos))
            pixeles_no_validos = total_pixeles - pixeles_validos

            valores_validos = datos[mascara_validos]

            if pixeles_validos == 0:
                raise ValueError(
                    "La extensión IMAGE no contiene píxeles válidos."
                )

            resultado = {
                "extension": "IMAGE",
                "dimensiones": list(datos.shape),
                "unidad": unidad,
                "total_pixeles": total_pixeles,
                "pixeles_validos": pixeles_validos,
                "pixeles_no_validos": pixeles_no_validos,
                "estadisticas": {
                    "minimo": float(np.min(valores_validos)),
                    "maximo": float(np.max(valores_validos)),
                    "media": float(np.mean(valores_validos)),
                    "mediana": float(np.median(valores_validos)),
                    "desviacion_estandar": float(np.std(valores_validos)),
                },
            }

            with self._lock:
                self._cache_analisis_imagen[url_limpia] = resultado
                if len(self._cache_analisis_imagen) > 32:
                    self._cache_analisis_imagen.popitem(last=False)

            return resultado
        finally:
            archivo.close()

    def analizar_calidad_fits(self, url_acceso: str) -> dict:
        """
        Analiza las extensiones VARIANCE y FLAGS de un archivo FITS.
        Devuelve estadísticas de varianza y frecuencias de los indicadores de calidad.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        with self._lock:
            if url_limpia in self._cache_analisis_calidad:
                self._cache_analisis_calidad.move_to_end(url_limpia)
                return self._cache_analisis_calidad[url_limpia]

        archivo = self.descargar_fits(url_limpia)
        try:
            if "VARIANCE" not in archivo or "FLAGS" not in archivo:
                raise ValueError(
                    "Las extensiones VARIANCE o FLAGS no están presentes en el archivo FITS."
                )

            datos_varianza = archivo["VARIANCE"].data
            datos_flags = archivo["FLAGS"].data

            if datos_varianza is None or datos_flags is None:
                raise ValueError(
                    "Las extensiones VARIANCE o FLAGS no contienen datos."
                )

            mascara_finitos = np.isfinite(datos_varianza)
            mascara_validos = mascara_finitos & (datos_varianza >= 0)
            valores_varianza = datos_varianza[mascara_validos]

            total_varianza = int(datos_varianza.size)
            pixeles_validos = int(np.count_nonzero(mascara_validos))
            pixeles_no_finitos = int(np.count_nonzero(~mascara_finitos))
            varianzas_negativas = int(
                np.count_nonzero(mascara_finitos & (datos_varianza < 0))
            )

            if pixeles_validos > 0:
                estadisticas_varianza = {
                    "minimo": float(np.min(valores_varianza)),
                    "maximo": float(np.max(valores_varianza)),
                    "media": float(np.mean(valores_varianza)),
                    "mediana": float(np.median(valores_varianza)),
                    "desviacion_estandar": float(np.std(valores_varianza)),
                }
            else:
                estadisticas_varianza = {
                    "minimo": None,
                    "maximo": None,
                    "media": None,
                    "mediana": None,
                    "desviacion_estandar": None,
                }

            mascara_flags = np.isfinite(datos_flags)
            valores_flags = datos_flags[mascara_flags]

            total_flags = int(datos_flags.size)
            flags_validos = int(valores_flags.size)
            flags_no_validos = total_flags - flags_validos

            valores_unicos, frecuencias = np.unique(
                valores_flags,
                return_counts=True,
            )

            distribucion_flags = []
            for valor, frecuencia in zip(valores_unicos, frecuencias):
                cantidad = int(frecuencia)
                distribucion_flags.append(
                    {
                        "valor": int(valor),
                        "cantidad": cantidad,
                        "porcentaje": round(
                            cantidad / flags_validos * 100,
                            6,
                        )
                        if flags_validos > 0
                        else 0.0,
                    }
                )

            resultado = {
                "varianza": {
                    "dimensiones": list(datos_varianza.shape),
                    "total_pixeles": total_varianza,
                    "pixeles_validos": pixeles_validos,
                    "pixeles_no_finitos": pixeles_no_finitos,
                    "varianzas_negativas": varianzas_negativas,
                    "estadisticas": estadisticas_varianza,
                },
                "flags": {
                    "dimensiones": list(datos_flags.shape),
                    "total_pixeles": total_flags,
                    "pixeles_validos": flags_validos,
                    "pixeles_no_validos": flags_no_validos,
                    "valores_distintos": len(valores_unicos),
                    "distribucion": distribucion_flags,
                },
            }

            with self._lock:
                self._cache_analisis_calidad[url_limpia] = resultado
                if len(self._cache_analisis_calidad) > 32:
                    self._cache_analisis_calidad.popitem(last=False)

            return resultado
        finally:
            archivo.close()

    def convertir_fits_a_png(self, url_fits: str, modo: str = "flujo") -> bytes:
        """
        Lee un archivo FITS de SPHEREx y lo exporta rápidamente como PNG usando
        muestreo optimizado y bloqueo seguro de Matplotlib entre hilos.
        """
        url_limpia = url_fits.strip().strip('"').strip("'")
        clave_cache = f"{modo}:{url_limpia}"

        with self._lock:
            if clave_cache in self._cache_png:
                self._cache_png.move_to_end(clave_cache)
                return self._cache_png[clave_cache]

        hdul = self.descargar_fits(url_limpia)
        try:
            ext_imagen = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]
            header = ext_imagen.header.copy()
            detector = header.get("DETECTOR", "Unknown")
            obsid = header.get("OBSID", header.get("OBS_ID", "Unknown"))

            if modo == "longitud_onda" and "WCS-WAVE" in hdul:
                spectral_wcs = WCS(header=header, fobj=hdul, key="W")
                spectral_wcs.sip = None
                alto, ancho = ext_imagen.data.shape
                paso = 8
                y_idx, x_idx = np.mgrid[0:alto:paso, 0:ancho:paso]
                wavelength, _ = spectral_wcs.pixel_to_world(x_idx, y_idx)
                matriz_visual = np.asarray(wavelength.value, dtype=np.float32)
                etiqueta_cb = f"Wavelength [{wavelength.unit}]"
                titulo = f"SPHEREx Wavelength Map | {obsid} | Detector {detector}"
                norm = None
                extent = [0, ancho, 0, alto]
            else:
                image = np.array(ext_imagen.data, dtype=np.float32)
                # Submuestreo 2x para cálculo ultrarrápido de percentiles en matrices 2040x2040
                muestra = image[::2, ::2]
                valid_pixels = muestra[np.isfinite(muestra)]
                if valid_pixels.size == 0:
                    raise ValueError("La imagen no contiene píxeles válidos")

                vmin, vmax = np.percentile(valid_pixels, [1, 99.5])
                norm = ImageNormalize(
                    vmin=float(vmin),
                    vmax=float(vmax),
                    stretch=AsinhStretch(),
                )
                matriz_visual = np.ma.masked_invalid(image)
                etiqueta_cb = header.get("BUNIT", "Flux")
                titulo = f"SPHEREx | {obsid} | Detector {detector}"
                extent = None

            with _MATPLOTLIB_LOCK:
                fig, ax = plt.subplots(figsize=(7.5, 7.5))
                try:
                    im = ax.imshow(
                        matriz_visual,
                        origin="lower",
                        cmap="gray",
                        norm=norm,
                        extent=extent,
                    )
                    fig.colorbar(im, ax=ax, label=etiqueta_cb)
                    ax.set_title(titulo)
                    ax.set_xlabel("X [pixels]")
                    ax.set_ylabel("Y [pixels]")

                    buffer = io.BytesIO()
                    fig.savefig(
                        buffer,
                        format="png",
                        dpi=120,
                        bbox_inches="tight",
                    )
                    png_bytes = buffer.getvalue()
                finally:
                    plt.close(fig)
        finally:
            hdul.close()

        with self._lock:
            self._cache_png[clave_cache] = png_bytes
            if len(self._cache_png) > self._max_cache_imagenes:
                self._cache_png.popitem(last=False)

        return png_bytes

    def _resolver_fits_local(self, url_o_id: str) -> Path | None:
        base_proyecto = Path(__file__).resolve().parents[3]
        candidato = (
            base_proyecto
            / "data"
            / "level2_2025W18_1B_0074_2D1_spx_l2b-v27-2026-196.fits"
        )
        if (
            url_o_id in ("local", "2025W18_1B_0074_2")
            or "2025W18_1B_0074_2D1" in url_o_id
        ):
            if candidato.is_file():
                return candidato
        return None

    def _serializar_valor_fits(self, valor: object) -> object:
        if isinstance(valor, (np.integer,)):
            return int(valor)
        if isinstance(valor, (np.floating,)):
            val_float = float(valor)
            return val_float if np.isfinite(val_float) else None
        if isinstance(valor, (bool, int, float, str)) or valor is None:
            return valor
        return str(valor)

    def _obtener_valor(self, fila, columna):
        valor = fila[columna]
        if np.ma.is_masked(valor):
            return None
        return valor
