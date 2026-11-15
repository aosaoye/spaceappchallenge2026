"""
Representación, consulta e inspección científica de datos astronómicos SPHEREx.
Deduplica descargas FITS simultáneas y protege las cachés y el renderizado concurrente.
"""

import http.client
import copy
import io
import logging
import os
import ssl
import threading
import time
import urllib.error
from collections import OrderedDict
from concurrent.futures import Future
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler

import certifi
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.table import Table
from astropy.time import Time
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa

from dominio import Observacion
from configuracion import obtener_entero

conf.remote_timeout = 120
logger = logging.getLogger(__name__)


class ErrorIRSA(ConnectionError):
    """Representa un fallo comunicado por el servicio IRSA."""

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

COLECCIONES_SPHEREX = (
    "spherex_dr1",
    "spherex_dr1_deep",
    "spherex_qr3",
    "spherex_qr3_deep",
)


class RepositorioIrsa:
    """
    Conecta con IRSA para consultar, descargar, inspeccionar y visualizar
    productos científicos Multi-Extension FITS (MEF) de SPHEREx con deduplicación
    de descargas y cachés concurrentes en memoria.
    """

    def __init__(
        self,
        max_cache_imagenes: int | None = None,
        max_cache_fits: int | None = None,
    ):
        self._max_cache_imagenes = max_cache_imagenes or obtener_entero("SPHEREX_CACHE_PNG", 8)
        self._max_cache_fits = max_cache_fits or obtener_entero("SPHEREX_CACHE_FITS", 2)
        self._max_bytes_fits = obtener_entero("SPHEREX_MAX_FITS_BYTES", 536870912)
        self._max_bytes_cache_fits = obtener_entero("SPHEREX_CACHE_FITS_BYTES", 536870912)
        self._timeout_descarga = obtener_entero("SPHEREX_TIMEOUT_DESCARGA", 90)
        self._lock = threading.RLock()
        self._vuelos_fits: dict[str, Future[bytes]] = {}
        self._cache_png: OrderedDict[str, bytes] = OrderedDict()
        self._cache_fits_bytes: OrderedDict[str, bytes] = OrderedDict()
        self._cache_estructura: OrderedDict[str, list[dict]] = OrderedDict()
        self._cache_metadatos: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_imagen: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_calidad: OrderedDict[str, dict] = OrderedDict()
        self._cache_busquedas: OrderedDict[str, list[Observacion]] = OrderedDict()

        # La precarga es local, opcional y se coordina fuera del pool de descargas.
        if os.getenv("SPHEREX_PRECARGA_LOCAL", "false").lower() in {"1", "true", "si", "sí"}:
            threading.Thread(target=self._precargar_recursos_locales, daemon=True, name="spherex_precarga").start()

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
                self._guardar_cache_fits(clave, contenido)
                self.obtener_estructura_fits("local")
                self.obtener_metadatos_fits("local")
                self.analizar_imagen_fits("local")
                self.analizar_calidad_fits("local")
                self.convertir_fits_a_png("local", modo="flujo")
        except Exception:
            logger.exception("Falló la precarga opcional de recursos FITS locales.")

    def buscar_por_coordenadas(
        self,
        ascension_recta: float,
        declinacion: float,
        radio: float
    ) -> list[Observacion]:
        """
        Consulta los productos SPHEREx cercanos a unas coordenadas en las colecciones DR1 y QR3.
        Devuelve los productos conservando las filas y metadatos temporales publicados por IRSA.
        """
        if not np.isfinite([ascension_recta, declinacion, radio]).all():
            raise ValueError("Las coordenadas y el radio deben ser valores finitos.")
        if not 0 <= ascension_recta <= 360 or not -90 <= declinacion <= 90:
            raise ValueError("RA debe estar entre 0 y 360 grados y DEC entre -90 y 90 grados.")
        if not 0 < radio <= 3600:
            raise ValueError("El radio debe ser mayor que 0 y no superar 3600 segundos de arco.")
        clave_busqueda = f"{ascension_recta:.8f}:{declinacion:.8f}:{radio:.4f}"
        with self._lock:
            if clave_busqueda in self._cache_busquedas:
                self._cache_busquedas.move_to_end(clave_busqueda)
                return copy.deepcopy(self._cache_busquedas[clave_busqueda])

        coordenadas = SkyCoord(
            ra=ascension_recta * u.deg,
            dec=declinacion * u.deg,
            frame="icrs"
        )

        try:
            resultados = Irsa.query_sia(
                pos=(coordenadas, radio * u.arcsec),
                collection=list(COLECCIONES_SPHEREX)
            )
        except Exception as error:
            logger.exception("Falló la consulta SIA a IRSA.")
            raise ErrorIRSA("No se pudo consultar IRSA.") from error

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
                url_imagen_png=f"/api/v1/observaciones/imagen?fits_url={quote(url_acceso, safe='')}",
                fecha_observacion=self._fecha_fila(fila),
                fecha_fin_observacion=self._fecha_fila(fila, final=True),
                mjd_inicio=self._mjd_fila(fila, final=False),
                mjd_fin=self._mjd_fila(fila, final=True),
            )

            observaciones.append(observacion)

        with self._lock:
            self._cache_busquedas[clave_busqueda] = copy.deepcopy(observaciones)
            while len(self._cache_busquedas) > 64:
                self._cache_busquedas.popitem(last=False)

        return observaciones

    def _fecha_fila(self, fila, final: bool = False) -> str | None:
        """Extrae una fecha explícita de los metadatos de IRSA.
        Devuelve la fecha ISO disponible o None cuando la fila no aporta una fecha verificable.
        """
        columnas_fecha = ("date_end", "DATE-END") if final else ("date_obs", "date-obs", "DATE-OBS", "date_beg", "DATE-BEG")
        columnas_mjd = ("mjd_end", "MJD-END", "t_max") if final else ("mjd_beg", "MJD-BEG", "t_min", "mjd_obs", "MJD-OBS")
        for nombre in (*columnas_fecha, *columnas_mjd):
            try:
                valor = self._obtener_valor(fila, nombre)
            except (KeyError, TypeError, IndexError):
                continue
            if valor is None:
                continue
            es_mjd = nombre.lower().replace("-", "_").startswith("mjd") or nombre.lower() in {"t_min", "t_max"}
            if es_mjd:
                try:
                    return str(Time(float(valor), format="mjd", scale="utc").isot)
                except (TypeError, ValueError, OverflowError):
                    continue
            texto = str(valor).strip()
            if texto and texto.lower() not in {"nan", "none", "masked"}:
                return texto
        return None

    def _mjd_fila(self, fila, final: bool) -> float | None:
        """Extrae el límite temporal MJD de una fila de IRSA.
        Devuelve el valor MJD finito original o None cuando IRSA no proporciona ese límite.
        """
        nombres = ("mjd_end", "MJD-END", "t_max") if final else ("mjd_beg", "MJD-BEG", "t_min", "mjd_obs", "MJD-OBS")
        for nombre in nombres:
            try:
                valor = self._obtener_valor(fila, nombre)
                if valor is not None and np.isfinite(float(valor)):
                    return float(valor)
            except (KeyError, TypeError, ValueError, IndexError):
                continue
        return None

    def _precalentar_fits_url(self, url_acceso: str) -> None:
        try:
            self.obtener_estructura_fits(url_acceso)
            self.obtener_metadatos_fits(url_acceso)
        except Exception:
            logger.exception("Falló el precalentamiento opcional de un FITS.")

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
            propietario = vuelo_existente is None
            if propietario:
                vuelo_existente = Future()
                self._vuelos_fits[clave_efectiva] = vuelo_existente

        if propietario:
            try:
                contenido = self._descargar_bytes_fits_worker(url_limpia, ruta_local)
                vuelo_existente.set_result(contenido)
            except BaseException as error:
                vuelo_existente.set_exception(error)
                raise
            finally:
                with self._lock:
                    if self._vuelos_fits.get(clave_efectiva) is vuelo_existente:
                        self._vuelos_fits.pop(clave_efectiva, None)
        else:
            contenido = vuelo_existente.result(timeout=self._timeout_descarga * 2 + 10)

        self._guardar_cache_fits(clave_efectiva, contenido)

        return contenido

    def _guardar_cache_fits(self, clave: str, contenido: bytes) -> None:
        """Guarda bytes FITS respetando los límites de memoria configurados.
        Devuelve None y omite la caché cuando el archivo excede el presupuesto permitido.
        """
        if len(contenido) > min(self._max_bytes_fits, self._max_bytes_cache_fits):
            return
        with self._lock:
            self._cache_fits_bytes[clave] = contenido
            self._cache_fits_bytes.move_to_end(clave)
            while (len(self._cache_fits_bytes) > self._max_cache_fits or
                   sum(map(len, self._cache_fits_bytes.values())) > self._max_bytes_cache_fits):
                self._cache_fits_bytes.popitem(last=False)

    def _descargar_bytes_fits_worker(
        self,
        url_limpia: str,
        ruta_local: Path | None,
    ) -> bytes:
        if ruta_local is not None and ruta_local.is_file():
            contenido_local = ruta_local.read_bytes()
            if len(contenido_local) > self._max_bytes_fits:
                raise ValueError("El FITS local supera el tamaño máximo permitido.")
            return contenido_local

        partes_url = urlsplit(url_limpia)
        if (
            partes_url.scheme != "https"
            or partes_url.hostname != "irsa.ipac.caltech.edu"
            or partes_url.username is not None
            or partes_url.password is not None
            or partes_url.port not in (None, 443)
        ):
            raise ValueError(
                "La URL debe pertenecer al servicio HTTPS de IRSA (irsa.ipac.caltech.edu)."
            )

        contexto_ssl = ssl.create_default_context(
            cafile=certifi.where()
        )

        class RedireccionSegura(HTTPRedirectHandler):
            """Limita las redirecciones al dominio HTTPS autorizado."""
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                """Valida cada destino de redirección.
                Devuelve una nueva solicitud solo si conserva HTTPS y el host autorizado.
                """
                partes = urlsplit(newurl)
                if (partes.scheme != "https" or partes.hostname != "irsa.ipac.caltech.edu"
                        or partes.port not in (None, 443) or partes.username is not None
                        or partes.password is not None):
                    raise ValueError("IRSA redirigió a un destino no autorizado.")
                return super().redirect_request(req, fp, code, msg, headers, newurl)

        max_reintentos = 2
        opener = build_opener(HTTPSHandler(context=contexto_ssl), RedireccionSegura())
        for intento in range(max_reintentos):
            try:
                request = Request(url_limpia, headers={"User-Agent": "SPHEREx-Explorer/1.0"})
                with opener.open(request, timeout=self._timeout_descarga) as respuesta:
                    largo = respuesta.headers.get("Content-Length")
                    if largo and int(largo) > self._max_bytes_fits:
                        raise ValueError("El FITS supera el tamaño máximo permitido.")
                    contenido = respuesta.read(self._max_bytes_fits + 1)
                    if len(contenido) > self._max_bytes_fits:
                        raise ValueError("El FITS supera el tamaño máximo permitido.")
                    if largo and len(contenido) != int(largo):
                        raise http.client.IncompleteRead(contenido, int(largo) - len(contenido))
                    if not contenido.startswith(b"SIMPLE  "):
                        raise ValueError("La respuesta remota no parece un archivo FITS válido.")
                    return contenido
            except ValueError:
                raise
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    raise FileNotFoundError("IRSA no encontró el archivo FITS solicitado.") from error
                if 400 <= error.code < 500:
                    raise ErrorIRSA(f"IRSA rechazó la descarga FITS con HTTP {error.code}.") from error
                if intento == max_reintentos - 1:
                    raise ErrorIRSA(f"IRSA respondió HTTP {error.code} al descargar el FITS.") from error
                logger.warning("IRSA devolvió HTTP %s al descargar un FITS (intento %s/%s).", error.code, intento + 1, max_reintentos)
                time.sleep(0.5 * (intento + 1))
            except (
                TimeoutError,
                urllib.error.URLError,
                http.client.IncompleteRead,
            ):
                if intento == max_reintentos - 1:
                    logger.exception("Se agotaron los intentos de descarga FITS de IRSA.")
                    raise ErrorIRSA("No se pudo descargar el archivo FITS desde IRSA.")
                logger.warning("Error temporal al descargar FITS de IRSA (intento %s/%s).", intento + 1, max_reintentos)
                time.sleep(0.5 * (intento + 1))

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
                return copy.deepcopy(self._cache_estructura[url_limpia])

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
                self._cache_estructura[url_limpia] = copy.deepcopy(extensiones)
                if len(self._cache_estructura) > 32:
                    self._cache_estructura.popitem(last=False)

            return extensiones
        finally:
            archivo.close()

    def obtener_metadatos_fits(self, url_acceso: str) -> dict:
        """
        Extrae metadatos científicos, WCS espacial y WCS espectral (LVF)
        de un archivo FITS de SPHEREx, guardando el resultado en caché.
        """
        url_limpia = url_acceso.strip().strip('"').strip("'")
        with self._lock:
            if url_limpia in self._cache_metadatos:
                self._cache_metadatos.move_to_end(url_limpia)
                return copy.deepcopy(self._cache_metadatos[url_limpia])

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
                "DATE-BEG",
                "MJD-BEG",
                "DATE-AVG",
                "MJD-AVG",
                "DATE-END",
                "MJD-END",
                "TIMESYS",
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
            fecha_observacion = (
                cabecera_imagen.get("DATE-OBS")
                or cabecera_principal.get("DATE-OBS")
            )
            if fecha_observacion is None:
                mjd_observacion = cabecera_imagen.get("MJD-OBS", cabecera_principal.get("MJD-OBS"))
                if mjd_observacion is not None:
                    try:
                        fecha_observacion = Time(float(mjd_observacion), format="mjd", scale="utc").isot
                    except (TypeError, ValueError, OverflowError):
                        logger.warning("MJD-OBS no contiene un valor temporal válido.")
            fecha_observacion = str(fecha_observacion) if fecha_observacion is not None else None

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
                logger.warning("No se pudo derivar el WCS espacial de la cabecera FITS.", exc_info=True)

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
                    logger.warning("No se pudo derivar el WCS espectral WCS-WAVE.", exc_info=True)

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
                    logger.warning("No se pudo resumir la tabla EPSF.", exc_info=True)
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
                    logger.warning("No se pudo resumir la tabla WCS-WAVE.", exc_info=True)

            resultado = {
                "fecha_observacion": fecha_observacion,
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
                self._cache_metadatos[url_limpia] = copy.deepcopy(resultado)
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
                return copy.deepcopy(self._cache_analisis_imagen[url_limpia])

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
                self._cache_analisis_imagen[url_limpia] = copy.deepcopy(resultado)
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
                return copy.deepcopy(self._cache_analisis_calidad[url_limpia])

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
                self._cache_analisis_calidad[url_limpia] = copy.deepcopy(resultado)
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
        if modo not in {"flujo", "longitud_onda"}:
            raise ValueError("El modo debe ser 'flujo' o 'longitud_onda'.")
        url_limpia = url_fits.strip().strip('"').strip("'")
        clave_cache = f"{modo}:{url_limpia}"

        with self._lock:
            if clave_cache in self._cache_png:
                self._cache_png.move_to_end(clave_cache)
                return bytes(self._cache_png[clave_cache])

        hdul = self.descargar_fits(url_limpia)
        try:
            ext_imagen = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]
            header = ext_imagen.header.copy()
            detector = header.get("DETECTOR", "Unknown")
            obsid = header.get("OBSID", header.get("OBS_ID", "Unknown"))

            if modo == "longitud_onda":
                if "WCS-WAVE" not in hdul:
                    raise ValueError("El FITS no contiene la extensión WCS-WAVE necesaria para el modo longitud_onda.")
                if ext_imagen.data is None or np.ndim(ext_imagen.data) != 2:
                    raise ValueError("La extensión IMAGE debe contener una matriz bidimensional.")
                try:
                    spectral_wcs = WCS(header=header, fobj=hdul, key="W")
                    spectral_wcs.sip = None
                    alto, ancho = ext_imagen.data.shape
                    paso = 8
                    y_idx, x_idx = np.mgrid[0:alto:paso, 0:ancho:paso]
                    wavelength, _ = spectral_wcs.pixel_to_world(x_idx, y_idx)
                    matriz_visual = np.asarray(wavelength.value, dtype=np.float32)
                    if not np.isfinite(matriz_visual).any():
                        raise ValueError("WCS-WAVE no produjo longitudes de onda válidas.")
                    etiqueta_cb = f"Wavelength [{wavelength.unit}]"
                    titulo = f"SPHEREx Wavelength Map | {obsid} | Detector {detector}"
                    norm = None
                    extent = [0, ancho, 0, alto]
                except ValueError:
                    raise
                except Exception as error:
                    raise ValueError("La extensión WCS-WAVE no permite construir un mapa de longitud de onda.") from error
            else:
                if ext_imagen.data is None or np.ndim(ext_imagen.data) != 2:
                    raise ValueError("La extensión IMAGE debe contener una matriz bidimensional.")
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
            self._cache_png[clave_cache] = bytes(png_bytes)
            if len(self._cache_png) > self._max_cache_imagenes:
                self._cache_png.popitem(last=False)

        return png_bytes

    def _resolver_fits_local(self, url_o_id: str) -> Path | None:
        """Resuelve el FITS local opcional del proyecto.
        Devuelve una ruta existente configurada o None cuando no hay coincidencia local.
        """
        configurada = os.getenv("SPHEREX_FITS_LOCAL")
        base_proyecto = Path(__file__).resolve().parent.parent
        candidato = Path(configurada).expanduser() if configurada else (
            base_proyecto / "data" / "level2_2025W18_1B_0074_2D1_spx_l2b-v27-2026-196.fits"
        )
        if (
            url_o_id in ("local", "2025W18_1B_0074_2")
            or "2025W18_1B_0074_2D1" in url_o_id
        ):
            if candidato.is_file():
                return candidato.resolve()
        return None

    def _serializar_valor_fits(self, valor: object) -> object:
        if isinstance(valor, np.ndarray):
            return [self._serializar_valor_fits(elemento) for elemento in valor.tolist()]
        if isinstance(valor, (list, tuple)):
            return [self._serializar_valor_fits(elemento) for elemento in valor]
        if isinstance(valor, (np.integer,)):
            return int(valor)
        if isinstance(valor, np.bool_):
            return bool(valor)
        if isinstance(valor, (np.floating,)):
            val_float = float(valor)
            return val_float if np.isfinite(val_float) else None
        if isinstance(valor, (bool, int, float, str)) or valor is None:
            return valor
        if isinstance(valor, bytes):
            return valor.decode("utf-8", errors="replace")
        return str(valor)

    def _obtener_valor(self, fila, columna):
        valor = fila[columna]
        if np.ma.is_masked(valor):
            return None
        return valor
