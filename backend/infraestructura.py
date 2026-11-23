"""
Representación, consulta e inspección científica de datos astronómicos SPHEREx.
Deduplica descargas FITS simultáneas y protege las cachés y el renderizado concurrente.
"""

import base64
import gc
import http.client
import copy
import io
import json
import logging
import math
import os
import re
import ssl
import threading
import time
import urllib.error
import uuid
from collections import OrderedDict
from concurrent.futures import Future
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler, urlopen

import certifi
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.table import Table
from astropy.time import Time
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales
from astroquery.ipac.irsa import Irsa

from dominio import Observacion
from configuracion import obtener_entero

conf.remote_timeout = 120
logger = logging.getLogger(__name__)


class ErrorIRSA(ConnectionError):
    """Representa un fallo comunicado por el servicio IRSA."""


class ErrorAstrometry(ConnectionError):
    """Representa un fallo de red o protocolo al consultar Astrometry.net."""

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

HOSTS_FITS_PERMITIDOS = frozenset({
    "irsa.ipac.caltech.edu",
    "nasa-irsa-spherex.s3.us-east-1.amazonaws.com",
})

URL_BASE_HIPS5_IBE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026"
URL_BASE_HIPS5_S3 = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/dr1/hips5_cube/hips_20261026"

PLANOS_HIPS5_BANDAS: tuple[tuple[int, int, str], ...] = (
    (1, 8, "SPHEREx-D1 (0.75-1.09 um)"),
    (2, 25, "SPHEREx-D2 (1.10-1.62 um)"),
    (3, 42, "SPHEREx-D3 (1.63-2.41 um)"),
    (4, 59, "SPHEREx-D4 (2.42-3.82 um)"),
    (5, 76, "SPHEREx-D5 (3.83-4.41 um)"),
    (6, 93, "SPHEREx-D6 (4.42-5.00 um)"),
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
        self._max_bytes_cache_fits = obtener_entero("SPHEREX_CACHE_FITS_BYTES", 25165824)
        self._timeout_descarga = obtener_entero("SPHEREX_TIMEOUT_DESCARGA", 90)
        self._max_bytes_resolver = obtener_entero("SPHEREX_MAX_UPLOAD_SOLVE_BYTES", 26214400)
        self._timeout_astrometry = obtener_entero("SPHEREX_ASTROMETRY_TIMEOUT", 90)
        self._astrometry_base_url = os.getenv(
            "SPHEREX_ASTROMETRY_URL",
            "https://nova.astrometry.net/api",
        ).rstrip("/")
        self._lock = threading.RLock()
        self._semaforo_recortes = threading.BoundedSemaphore(
            obtener_entero("SPHEREX_CONCURRENCIA_RECORTES", 2)
        )
        self._vuelos_fits: dict[str, Future[bytes]] = {}
        self._cache_png: OrderedDict[str, bytes] = OrderedDict()
        self._cache_recortes: OrderedDict[str, dict] = OrderedDict()
        self._max_cache_recortes = obtener_entero("SPHEREX_CACHE_RECORTES", 48)
        self._cache_fits_bytes: OrderedDict[str, bytes] = OrderedDict()
        self._cache_estructura: OrderedDict[str, list[dict]] = OrderedDict()
        self._cache_metadatos: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_imagen: OrderedDict[str, dict] = OrderedDict()
        self._cache_analisis_calidad: OrderedDict[str, dict] = OrderedDict()
        self._cache_busquedas: OrderedDict[str, list[Observacion]] = OrderedDict()
        self._cache_hips_headers: OrderedDict[str, dict] = OrderedDict()
        self._cache_hips5_busquedas: OrderedDict[int, list[Observacion]] = OrderedDict()

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
            logger.warning("Falló la consulta SIA a IRSA: %s", error)
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

    @staticmethod
    def _radec_a_healpix_nest_5(ascension_recta: float, declinacion: float) -> int:
        """Convierte coordenadas ICRS (RA, Dec) al píxel HEALPix NESTED de orden 5 (NSIDE=32)."""
        nside = 32
        z = math.sin(math.radians(max(-90.0, min(90.0, float(declinacion)))))
        za = abs(z)
        tt = math.radians(float(ascension_recta) % 360.0) / (math.pi * 0.5)
        if za <= 2.0 / 3.0:
            temp1 = nside * (0.5 + tt)
            temp2 = nside * z * 0.75
            jp = int(temp1 - temp2)
            jm = int(temp1 + temp2)
            ifp = jp // nside
            ifm = jm // nside
            if ifp == ifm:
                face = (ifp % 4) + 4
            elif ifp < ifm:
                face = ifp % 4
            else:
                face = (ifm % 4) + 8
            ix = jm & (nside - 1)
            iy = nside - (jp & (nside - 1)) - 1
        else:
            ntt = min(3, int(tt))
            tp = tt - ntt
            tmp = nside * math.sqrt(max(0.0, 3.0 * (1.0 - za)))
            jp = min(nside - 1, int(tp * tmp))
            jm = min(nside - 1, int((1.0 - tp) * tmp))
            if z >= 0.0:
                face = ntt
                ix = nside - jm - 1
                iy = nside - jp - 1
            else:
                face = ntt + 8
                ix = jp
                iy = jm

        intercalado = 0
        for bit in range(5):
            if (ix >> bit) & 1:
                intercalado |= 1 << (2 * bit)
            if (iy >> bit) & 1:
                intercalado |= 1 << (2 * bit + 1)
        return face * nside * nside + intercalado

    @staticmethod
    def _encontrar_fin_hdu(buf: bytes, inicio: int) -> int | None:
        """Devuelve el desplazamiento de fin (múltiplo de 2880) de la cabecera FITS que empieza en `inicio`."""
        off = inicio
        largo = len(buf)
        while off + 80 <= largo:
            tarjeta = buf[off : off + 80].decode("ascii", errors="ignore")
            if tarjeta[:8] == "END     ":
                return ((off + 80 - inicio + 2879) // 2880) * 2880 + inicio
            off += 80
        return None

    @staticmethod
    def _parsear_blankch(blankch: str) -> set[int]:
        """Convierte BLANKCH (ej. 'D3:17,D4:01') a índices de plano 0-based."""
        vacios: set[int] = set()
        for det_str, ch_str in re.findall(r"D([1-6]):(\d{1,2})", blankch or ""):
            det = int(det_str)
            ch = int(ch_str)
            if 1 <= ch <= 17:
                vacios.add((det - 1) * 17 + (ch - 1))
        return vacios

    @classmethod
    def _elegir_plano_valido(
        cls,
        plano_preferido: int,
        detector: int,
        nz: int,
        blankch: str
    ) -> int:
        vacios = cls._parsear_blankch(blankch)
        inicio_det = max(0, (detector - 1) * 17)
        fin_det = min(nz - 1, detector * 17 - 1)
        plano = max(inicio_det, min(fin_det, plano_preferido))
        if plano not in vacios:
            return plano
        for delta in range(1, 17):
            for candidato in (plano + delta, plano - delta):
                if inicio_det <= candidato <= fin_det and candidato not in vacios:
                    return candidato
        return max(0, min(nz - 1, plano))

    def _obtener_info_cubo_hips5(self, url_sin_frag: str) -> dict:
        """Lee y cachea los metadatos y desplazamientos binarios de un cubo HiPS5 por HTTP Range."""
        with self._lock:
            if url_sin_frag in self._cache_hips_headers:
                self._cache_hips_headers.move_to_end(url_sin_frag)
                return copy.deepcopy(self._cache_hips_headers[url_sin_frag])

        hdr_bytes = self._descargar_rango_http(url_sin_frag, 0, 14399)
        if not hdr_bytes.startswith(b"SIMPLE  "):
            raise ValueError("El cubo HiPS5 remoto no tiene cabecera FITS válida.")

        hdu1_start = self._encontrar_fin_hdu(hdr_bytes, 0)
        if hdu1_start is None:
            hdr_bytes = self._descargar_rango_http(url_sin_frag, 0, 28799)
            hdu1_start = self._encontrar_fin_hdu(hdr_bytes, 0)
        if hdu1_start is None:
            raise ValueError("No se encontró el cierre de la cabecera primaria HiPS5.")

        data_start = self._encontrar_fin_hdu(hdr_bytes, hdu1_start)
        if data_start is None:
            hdr_bytes = self._descargar_rango_http(url_sin_frag, 0, 28799)
            data_start = self._encontrar_fin_hdu(hdr_bytes, hdu1_start)
        if data_start is None:
            raise ValueError("No se encontró el cierre de la extensión IMAGE del cubo HiPS5.")

        hdr0 = fits.Header.fromstring(hdr_bytes[:hdu1_start], sep="")
        hdr1 = fits.Header.fromstring(hdr_bytes[hdu1_start:data_start], sep="")
        nx = int(hdr1.get("NAXIS1", 512))
        ny = int(hdr1.get("NAXIS2", 512))
        nz = int(hdr1.get("NAXIS3", 102))

        info = {
            "nx": nx,
            "ny": ny,
            "nz": nz,
            "data_start": data_start,
            "hdr0": hdr0,
            "hdr1": hdr1,
            "blankch": str(hdr0.get("BLANKCH", "")),
            "fecha_inicio": str(hdr0.get("DATE-BEG") or "") or None,
            "fecha_fin": str(hdr0.get("DATE-END") or "") or None,
            "mjd_inicio": float(hdr0["MJD-BEG"]) if hdr0.get("MJD-BEG") is not None else None,
            "mjd_fin": float(hdr0["MJD-END"]) if hdr0.get("MJD-END") is not None else None,
        }

        with self._lock:
            self._cache_hips_headers[url_sin_frag] = copy.deepcopy(info)
            while len(self._cache_hips_headers) > 128:
                self._cache_hips_headers.popitem(last=False)

        return info

    def buscar_cubo_hips5(
        self,
        ascension_recta: float,
        declinacion: float
    ) -> list[Observacion]:
        """
        Resuelve 6 planos espectrales reales (D1–D6) desde el mosaico al-sky SPHEREx DR1 HiPS5 (Norder=5)
        para las coordenadas indicadas sin depender del servicio SIA/TAP.
        """
        if not np.isfinite([ascension_recta, declinacion]).all():
            raise ValueError("Las coordenadas deben ser valores finitos.")
        if not 0 <= ascension_recta <= 360 or not -90 <= declinacion <= 90:
            raise ValueError("RA debe estar entre 0 y 360 grados y DEC entre -90 y 90 grados.")

        ipix = self._radec_a_healpix_nest_5(ascension_recta, declinacion)
        with self._lock:
            if ipix in self._cache_hips5_busquedas:
                self._cache_hips5_busquedas.move_to_end(ipix)
                cacheadas = copy.deepcopy(self._cache_hips5_busquedas[ipix])
                for obs in cacheadas:
                    obs.ascension_recta = float(ascension_recta)
                    obs.declinacion = float(declinacion)
                return cacheadas

        dir_idx = (ipix // 10000) * 10000
        url_cubo = f"{URL_BASE_HIPS5_IBE}/Norder5/Dir{dir_idx}/Npix{ipix}_cube.fits"
        info = self._obtener_info_cubo_hips5(url_cubo)
        tamano_plano = int(info["nx"]) * int(info["ny"]) * 4

        observaciones: list[Observacion] = []
        for det, plano_def, banda_nombre in PLANOS_HIPS5_BANDAS:
            plano = self._elegir_plano_valido(
                plano_def,
                det,
                int(info["nz"]),
                str(info["blankch"]),
            )
            url_plano = f"{url_cubo}#plane={plano}"
            observaciones.append(
                Observacion(
                    identificador=f"SPHEREx_DR1_HPX5_{ipix}_D{det}",
                    ascension_recta=float(ascension_recta),
                    declinacion=float(declinacion),
                    coleccion="spherex_dr1_hips5",
                    banda_espectral=banda_nombre,
                    tipo_producto="hips5_spectral_plane",
                    url_acceso=url_plano,
                    tamano_estimado=tamano_plano,
                    url_imagen_png=f"/api/v1/observaciones/imagen?fits_url={quote(url_plano, safe='')}",
                    fecha_observacion=info["fecha_inicio"],
                    fecha_fin_observacion=info["fecha_fin"],
                    mjd_inicio=info["mjd_inicio"],
                    mjd_fin=info["mjd_fin"],
                )
            )

        with self._lock:
            self._cache_hips5_busquedas[ipix] = copy.deepcopy(observaciones)
            while len(self._cache_hips5_busquedas) > 64:
                self._cache_hips5_busquedas.popitem(last=False)

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

    @staticmethod
    def _validar_url_fits_segura(url_limpia: str):
        partes_url = urlsplit(url_limpia)
        if (
            partes_url.scheme != "https"
            or partes_url.hostname not in HOSTS_FITS_PERMITIDOS
            or partes_url.username is not None
            or partes_url.password is not None
            or partes_url.port not in (None, 443)
        ):
            raise ValueError(
                "La URL debe pertenecer al servicio HTTPS de IRSA (irsa.ipac.caltech.edu)."
            )
        return partes_url

    @staticmethod
    def _construir_opener_seguro():
        contexto_ssl = ssl.create_default_context(cafile=certifi.where())

        class RedireccionSegura(HTTPRedirectHandler):
            """Limita las redirecciones a los dominios HTTPS autorizados."""

            def redirect_request(self, req, fp, code, msg, headers, newurl):
                partes = urlsplit(newurl)
                if (
                    partes.scheme != "https"
                    or partes.hostname not in HOSTS_FITS_PERMITIDOS
                    or partes.port not in (None, 443)
                    or partes.username is not None
                    or partes.password is not None
                ):
                    raise ValueError("IRSA redirigió a un destino no autorizado.")
                return super().redirect_request(req, fp, code, msg, headers, newurl)

        return build_opener(HTTPSHandler(context=contexto_ssl), RedireccionSegura())

    @staticmethod
    def _espejo_s3_hips5(url_sin_frag: str) -> str | None:
        prefijo = "https://irsa.ipac.caltech.edu/ibe/data/spherex/"
        if url_sin_frag.startswith(prefijo):
            return "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/" + url_sin_frag[len(prefijo) :]
        return None

    def _descargar_rango_http(self, url_sin_frag: str, inicio: int, fin: int) -> bytes:
        """Descarga un rango exacto de bytes por HTTPS con respaldo automático hacia S3 Open Data."""
        self._validar_url_fits_segura(url_sin_frag)
        opener = self._construir_opener_seguro()
        esperado = fin - inicio + 1
        candidatos = [url_sin_frag]
        espejo = self._espejo_s3_hips5(url_sin_frag)
        if espejo:
            candidatos.append(espejo)

        ultimo_error: Exception | None = None
        for idx, destino in enumerate(candidatos):
            try:
                req = Request(
                    destino,
                    headers={
                        "User-Agent": "SPHEREx-Explorer/1.0",
                        "Range": f"bytes={inicio}-{fin}",
                    },
                )
                with opener.open(req, timeout=min(self._timeout_descarga, 30)) as resp:
                    status = getattr(resp, "status", 200)
                    largo = resp.headers.get("Content-Length")
                    if status == 200 and largo and int(largo) > esperado + 65536:
                        raise ErrorIRSA("El servidor ignoró HTTP Range en un cubo HiPS5.")
                    datos = resp.read(esperado + 1)
                    if len(datos) > esperado:
                        datos = datos[:esperado]
                    if not datos:
                        raise ErrorIRSA("Respuesta vacía al descargar rango de bytes del cubo HiPS5.")
                    return datos
            except FileNotFoundError:
                raise
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    if idx < len(candidatos) - 1:
                        ultimo_error = error
                        continue
                    raise FileNotFoundError("IRSA no encontró el cubo HiPS5 solicitado.") from error
                ultimo_error = ErrorIRSA(f"Error HTTP {error.code} al acceder al cubo HiPS5.")
            except (TimeoutError, urllib.error.URLError, http.client.HTTPException, OSError) as error:
                ultimo_error = ErrorIRSA("Error de red al descargar rango del cubo HiPS5.")
                logger.warning("Reintentando descarga HiPS5 en espejo alternativo tras fallo en %s: %s", destino, error)

        if isinstance(ultimo_error, ErrorIRSA):
            raise ultimo_error
        raise ErrorIRSA("No se pudo acceder al cubo HiPS5 de SPHEREx.")

    def _descargar_plano_hips5_como_fits(self, url_con_frag: str, partes_url) -> bytes:
        """Extrae un único plano 2D por HTTP Range de un cubo HiPS5 y devuelve un FITS 2D en memoria."""
        try:
            plano = int(partes_url.fragment.split("=", 1)[1])
        except (IndexError, ValueError) as error:
            raise ValueError("Identificador de plano HiPS5 no válido.") from error

        url_sin_frag = url_con_frag.split("#", 1)[0]
        info = self._obtener_info_cubo_hips5(url_sin_frag)
        nx = int(info["nx"])
        ny = int(info["ny"])
        nz = int(info["nz"])
        data_start = int(info["data_start"])
        if not 0 <= plano < nz:
            raise ValueError("El índice de plano espectral está fuera de rango.")

        plano_nbytes = nx * ny * 4
        p_inicio = data_start + plano * plano_nbytes
        raw_plane = self._descargar_rango_http(url_sin_frag, p_inicio, p_inicio + plano_nbytes - 1)
        if len(raw_plane) != plano_nbytes:
            raise ErrorIRSA("Descarga incompleta del plano espectral HiPS5.")

        datos_2d = np.frombuffer(raw_plane, dtype=">f4").reshape((ny, nx)).astype(np.float32)

        hdr0: fits.Header = info["hdr0"]
        hdr1: fits.Header = info["hdr1"]

        hdr_prim = fits.Header()
        for clave in (
            "TELESCOP",
            "INSTRUME",
            "ORIGIN",
            "VERSION",
            "TIMESYS",
            "DATE",
            "DATE-BEG",
            "DATE-END",
            "MJD-BEG",
            "MJD-END",
        ):
            if clave in hdr0:
                hdr_prim[clave] = hdr0[clave]

        detector = min(6, max(1, plano // 17 + 1))
        npix_val = hdr1.get("NPIX", 0)
        hdr_prim["OBSID"] = f"SPHEREx_DR1_HPX5_{npix_val}_D{detector}"
        hdr_prim["DETECTOR"] = detector
        if hdr0.get("DATE-BEG") is not None:
            hdr_prim["DATE-OBS"] = hdr0["DATE-BEG"]
        if hdr0.get("MJD-BEG") is not None:
            hdr_prim["MJD-OBS"] = hdr0["MJD-BEG"]

        hdr_img = fits.Header()
        hdr_img["WCSAXES"] = 2
        for clave in (
            "CRPIX1",
            "CRPIX2",
            "PC1_1",
            "PC1_2",
            "PC2_1",
            "PC2_2",
            "CDELT1",
            "CDELT2",
            "CUNIT1",
            "CUNIT2",
            "CTYPE1",
            "CTYPE2",
            "CRVAL1",
            "CRVAL2",
            "PV2_1",
            "PV2_2",
            "LONPOLE",
            "LATPOLE",
            "MJDREF",
            "RADESYS",
            "ORDER",
            "NPIX",
            "BUNIT",
            "WLMIN",
            "WLMAX",
        ):
            if clave in hdr1:
                hdr_img[clave] = hdr1[clave]
        hdr_img["OBSID"] = hdr_prim["OBSID"]
        hdr_img["DETECTOR"] = detector
        if "DATE-OBS" in hdr_prim:
            hdr_img["DATE-OBS"] = hdr_prim["DATE-OBS"]
        if "MJD-OBS" in hdr_prim:
            hdr_img["MJD-OBS"] = hdr_prim["MJD-OBS"]

        salida = BytesIO()
        hdul = fits.HDUList([
            fits.PrimaryHDU(header=hdr_prim),
            fits.ImageHDU(data=datos_2d, header=hdr_img, name="IMAGE"),
        ])
        hdul.writeto(salida)
        return salida.getvalue()

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

        partes_url = self._validar_url_fits_segura(url_limpia)
        if partes_url.fragment.startswith("plane="):
            return self._descargar_plano_hips5_como_fits(url_limpia, partes_url)

        max_reintentos = 2
        opener = self._construir_opener_seguro()
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
                import matplotlib

                matplotlib.use("Agg")
                import matplotlib.pyplot as plt

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

    @staticmethod
    def _reducir_por_bloques(
        data: np.ndarray,
        paso_y: int,
        paso_x: int
    ) -> np.ndarray:
        """Reduce una matriz 2D mediante promedio por bloques tolerante a NaN."""
        if paso_y <= 1 and paso_x <= 1:
            return data.astype(np.float32, copy=False)
        ny, nx = data.shape
        cy = ny // paso_y
        cx = nx // paso_x
        if cy <= 0 or cx <= 0:
            return data[::paso_y, ::paso_x].astype(np.float32, copy=False)
        trimmed = data[: cy * paso_y, : cx * paso_x].reshape(cy, paso_y, cx, paso_x)
        valid = np.isfinite(trimmed)
        counts = np.sum(valid, axis=(1, 3))
        summed = np.sum(np.where(valid, trimmed, 0.0), axis=(1, 3))
        return np.where(counts > 0, summed / np.maximum(counts, 1), np.nan).astype(np.float32)

    def _remuestrear_wcs_tangente(
        self,
        data: np.ndarray,
        wcs_in: WCS,
        ra_centro: float,
        dec_centro: float,
        fov_arcsec: float,
        tamano_px: int,
        native_scale_arcsec: float
    ) -> np.ndarray | None:
        """Reproyecta la imagen FITS a una malla tangente Norte-arriba / Este-izquierda centrada en (RA, Dec)."""
        ny, nx = data.shape
        step_deg = (fov_arcsec / 3600.0) / float(tamano_px)
        out_wcs = WCS(naxis=2)
        out_wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        out_wcs.wcs.crval = [ra_centro, dec_centro]
        out_wcs.wcs.crpix = [(tamano_px - 1) / 2.0 + 1.0, (tamano_px - 1) / 2.0 + 1.0]
        out_wcs.wcs.cdelt = [-step_deg, step_deg]

        yy_idx, xx_idx = np.mgrid[0:tamano_px, 0:tamano_px]
        try:
            ra_grid, dec_grid = out_wcs.pixel_to_world_values(xx_idx, yy_idx)
            px_in, py_in = wcs_in.world_to_pixel_values(ra_grid, dec_grid)
        except Exception:
            return None

        px_arr = np.asarray(px_in, dtype=np.float64)
        py_arr = np.asarray(py_in, dtype=np.float64)
        step_arcsec = fov_arcsec / float(tamano_px)
        block = max(1, int(step_arcsec / max(native_scale_arcsec, 0.05)))
        if block > 1 and ny >= block * 4 and nx >= block * 4:
            data_src = self._reducir_por_bloques(data, block, block)
            px_s = (px_arr - (block - 1) * 0.5) / block
            py_s = (py_arr - (block - 1) * 0.5) / block
        else:
            data_src = data
            px_s = px_arr
            py_s = py_arr

        h_s, w_s = data_src.shape
        inside = (
            np.isfinite(px_s)
            & np.isfinite(py_s)
            & (px_s >= -0.5)
            & (px_s <= w_s - 0.5)
            & (py_s >= -0.5)
            & (py_s <= h_s - 0.5)
        )
        if not np.any(inside):
            return None

        px_clamped = np.clip(px_s, 0.0, float(w_s - 1))
        py_clamped = np.clip(py_s, 0.0, float(h_s - 1))
        x0 = np.floor(px_clamped).astype(np.int32)
        y0 = np.floor(py_clamped).astype(np.int32)
        x1 = np.minimum(x0 + 1, w_s - 1)
        y1 = np.minimum(y0 + 1, h_s - 1)
        fx = px_clamped - x0
        fy = py_clamped - y0

        v00 = data_src[y0, x0]
        v10 = data_src[y0, x1]
        v01 = data_src[y1, x0]
        v11 = data_src[y1, x1]

        w00 = np.where(inside & np.isfinite(v00), (1.0 - fx) * (1.0 - fy), 0.0)
        w10 = np.where(inside & np.isfinite(v10), fx * (1.0 - fy), 0.0)
        w01 = np.where(inside & np.isfinite(v01), (1.0 - fx) * fy, 0.0)
        w11 = np.where(inside & np.isfinite(v11), fx * fy, 0.0)
        w_sum = w00 + w10 + w01 + w11
        val_sum = (
            np.where(w00 > 0, v00 * w00, 0.0)
            + np.where(w10 > 0, v10 * w10, 0.0)
            + np.where(w01 > 0, v01 * w01, 0.0)
            + np.where(w11 > 0, v11 * w11, 0.0)
        )
        recorte = np.where(w_sum > 1e-6, val_sum / np.maximum(w_sum, 1e-6), np.nan).astype(np.float32)
        if not np.isfinite(recorte).any():
            return None
        # Invierte filas para que fila 0 sea el Norte (arriba en canvas HTML5) y col 0 el Este (izquierda).
        return recorte[::-1, :]

    def _descargar_recorte_ibe_fits(
        self,
        url_limpia: str,
        ra_deg: float,
        dec_deg: float,
        fov_arcsec: float,
    ) -> fits.HDUList | None:
        """
        Solicita a IRSA IBE un recorte espacial acotado (?center=RA,DEC&size=DEG)
        para reducir de ~66 MB a ~2-5 MB los FITS Level-2 en memoria.
        Devuelve None si IRSA rechaza el recorte o si la coordenada no solapa el detector.
        """
        size_deg = max(0.08, min(2.5, (fov_arcsec * 1.35) / 3600.0))
        url_recorte = f"{url_limpia}?center={ra_deg:.6f},{dec_deg:.6f}&size={size_deg:.4f}"
        opener = self._construir_opener_seguro()
        max_bytes = min(self._max_bytes_fits, 41_943_040)
        try:
            req = Request(url_recorte, headers={"User-Agent": "SPHEREx-Explorer/1.0"})
            with opener.open(req, timeout=min(self._timeout_descarga, 35)) as resp:
                largo = resp.headers.get("Content-Length")
                if largo and int(largo) > max_bytes:
                    return None
                contenido = resp.read(max_bytes + 1)
                if len(contenido) > max_bytes or not contenido.startswith(b"SIMPLE  "):
                    return None
                return fits.open(BytesIO(contenido), memmap=False)
        except (urllib.error.HTTPError, TimeoutError, urllib.error.URLError, http.client.HTTPException, OSError):
            return None

    def obtener_recorte_fits(
        self,
        url_fits: str,
        ascension_recta: float | None = None,
        declinacion: float | None = None,
        fov_arcsec: float = 600.0,
        tamano_px: int = 280
    ) -> dict:
        """
        Extrae un recorte real de la extensión IMAGE en formato float32 base64,
        alineado al cielo mediante su cabecera WCS cuando cubre (RA, Dec).
        """
        url_limpia = url_fits.strip().strip('"').strip("'")
        if not url_limpia:
            raise ValueError("Debes proporcionar una URL FITS válida.")

        tamano = max(64, min(384, int(tamano_px)))
        fov = max(15.0, min(14400.0, float(fov_arcsec)))
        ra_norm = (float(ascension_recta) % 360.0) if ascension_recta is not None else None
        dec_norm = float(declinacion) if declinacion is not None else None
        if dec_norm is not None and not (-90.0 <= dec_norm <= 90.0):
            raise ValueError("La declinación debe estar comprendida entre -90 y 90 grados.")

        ra_clave = f"{ra_norm:.6f}" if ra_norm is not None else "none"
        dec_clave = f"{dec_norm:.6f}" if dec_norm is not None else "none"
        clave_cache = f"{url_limpia}:{ra_clave}:{dec_clave}:{fov:.1f}:{tamano}"

        with self._lock:
            if clave_cache in self._cache_recortes:
                self._cache_recortes.move_to_end(clave_cache)
                return dict(self._cache_recortes[clave_cache])

        es_nivel2_ibe = (
            url_limpia.startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")
            and "#" not in url_limpia
            and "?" not in url_limpia
            and "/hips5_cube/" not in url_limpia
            and ra_norm is not None
            and dec_norm is not None
        )

        with self._semaforo_recortes:
            hdul = (
                self._descargar_recorte_ibe_fits(url_limpia, ra_norm, dec_norm, fov)
                if es_nivel2_ibe
                else None
            )
            if hdul is None:
                hdul = self.descargar_fits(url_limpia)
            data = None
            try:
                ext_imagen = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]
                if ext_imagen.data is None or np.ndim(ext_imagen.data) != 2:
                    raise ValueError("La extensión IMAGE debe contener una matriz bidimensional.")

                header = ext_imagen.header.copy()
                data = np.asarray(ext_imagen.data, dtype=np.float32)
                ny, nx = data.shape

                wcs_in: WCS | None = None
                native_scale_arcsec = 6.2
                try:
                    candidato = WCS(header, relax=True).celestial
                    if candidato.has_celestial:
                        wcs_in = candidato
                        scales = proj_plane_pixel_scales(candidato)
                        mean_deg = float(np.nanmean(scales))
                        if np.isfinite(mean_deg) and mean_deg > 0:
                            native_scale_arcsec = mean_deg * 3600.0
                except Exception:
                    wcs_in = None

                recorte: np.ndarray | None = None
                cobertura_wcs = False
                ra_resultado = ra_norm if ra_norm is not None else 0.0
                dec_resultado = dec_norm if dec_norm is not None else 0.0
                fov_resultado = fov

                if wcs_in is not None and ra_norm is not None and dec_norm is not None:
                    recorte = self._remuestrear_wcs_tangente(
                        data=data,
                        wcs_in=wcs_in,
                        ra_centro=ra_norm,
                        dec_centro=dec_norm,
                        fov_arcsec=fov,
                        tamano_px=tamano,
                        native_scale_arcsec=native_scale_arcsec,
                    )
                    if recorte is not None:
                        cobertura_wcs = True

                if recorte is None:
                    paso_y = max(1, int(np.ceil(ny / tamano)))
                    paso_x = max(1, int(np.ceil(nx / tamano)))
                    reducida = self._reducir_por_bloques(data, paso_y, paso_x)
                    recorte = reducida[::-1, :]
                    fov_resultado = float(max(ny, nx) * native_scale_arcsec)
                    if wcs_in is not None:
                        try:
                            ra_c, dec_c = wcs_in.pixel_to_world_values((nx - 1) / 2.0, (ny - 1) / 2.0)
                            if np.isfinite(ra_c) and np.isfinite(dec_c):
                                ra_resultado = float(ra_c) % 360.0
                                dec_resultado = float(dec_c)
                        except Exception:
                            pass

                valid_pixels = recorte[np.isfinite(recorte)]
                if valid_pixels.size == 0:
                    raise ValueError("La extensión IMAGE no contiene píxeles válidos.")

                vmin, vmax = np.percentile(valid_pixels, [1.0, 99.5])
                if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
                    vmin = float(np.min(valid_pixels))
                    vmax = float(vmin + 1e-6)
                mediana = float(np.median(valid_pixels))
                ruido_mad = float(np.median(np.abs(valid_pixels - mediana)))

                alto_out, ancho_out = recorte.shape
                datos_bytes = np.ascontiguousarray(recorte, dtype="<f4").tobytes()
                datos_b64 = base64.b64encode(datos_bytes).decode("ascii")

                detector_val = header.get("DETECTOR")
                if isinstance(detector_val, (int, np.integer)):
                    detector: int | str = int(detector_val)
                elif isinstance(detector_val, str) and detector_val.isdigit():
                    detector = int(detector_val)
                else:
                    detector = str(detector_val or "")

                resultado = {
                    "identificador": str(header.get("OBSID", header.get("OBS_ID", "SPHEREx"))),
                    "detector": detector,
                    "unidad": str(header.get("BUNIT", "MJy/sr")),
                    "ancho": int(ancho_out),
                    "alto": int(alto_out),
                    "vmin": float(vmin),
                    "vmax": float(vmax),
                    "mediana": mediana,
                    "ruido_mad": ruido_mad,
                    "ra_centro": float(ra_resultado),
                    "dec_centro": float(dec_resultado),
                    "fov_arcsec": float(fov_resultado),
                    "pixscale_arcsec": float(fov_resultado / max(ancho_out, alto_out)),
                    "cobertura_wcs": bool(cobertura_wcs),
                    "pixeles_validos": int(valid_pixels.size),
                    "datos_f32_b64": datos_b64,
                }
            finally:
                hdul.close()
                if data is not None:
                    del data
                gc.collect()

        with self._lock:
            self._cache_recortes[clave_cache] = dict(resultado)
            if len(self._cache_recortes) > self._max_cache_recortes:
                self._cache_recortes.popitem(last=False)

        return resultado

    def resolver_coordenadas_imagen(
        self,
        contenido: bytes,
        nombre_archivo: str,
        astrometry_api_key: str | None = None
    ) -> dict:
        """Resuelve coordenadas celestes (RA, Dec, FOV) desde una imagen subida.
        Prioriza la cabecera WCS local en archivos FITS y recurre a Astrometry.net para fotos estándar.
        """
        if not contenido:
            raise ValueError("El archivo de imagen está vacío.")
        if len(contenido) > self._max_bytes_resolver:
            raise ValueError("La imagen supera el tamaño máximo permitido (25 MB).")

        nombre = (nombre_archivo or "cielo.png").strip()
        nombre_lower = nombre.lower()
        es_fits = (
            contenido.lstrip()[:8] == b"SIMPLE  "
            or nombre_lower.endswith((".fits", ".fit", ".fts"))
        )

        if es_fits:
            resultado_wcs = self._extraer_wcs_fits(contenido)
            if resultado_wcs is not None:
                return resultado_wcs

        clave_api = (
            (astrometry_api_key or "").strip()
            or os.getenv("SPHEREX_ASTROMETRY_API_KEY", "").strip()
            or os.getenv("ASTROMETRY_API_KEY", "").strip()
        )
        if not clave_api:
            if es_fits:
                raise ValueError(
                    "El archivo FITS no incluye cabecera WCS espacial (RA/Dec). "
                    "Configura ASTROMETRY_API_KEY o introduce una clave gratuita de nova.astrometry.net para resolverlo por estrellas."
                )
            raise ValueError(
                "Para extraer coordenadas de fotos JPG/PNG configura ASTROMETRY_API_KEY en el servidor "
                "o introduce una clave gratuita de nova.astrometry.net."
            )

        return self._resolver_con_astrometry(contenido, nombre, clave_api)

    def _extraer_wcs_fits(self, contenido: bytes) -> dict | None:
        """Extrae RA, Dec, escala de píxel y campo visual desde una cabecera FITS WCS local.
        Devuelve el resultado calibrado o None si el FITS no posee ejes celestiales válidos.
        """
        try:
            hdul = fits.open(BytesIO(contenido), memmap=False)
        except Exception as error:
            raise ValueError("El archivo FITS proporcionado no pudo abrirse o está dañado.") from error

        try:
            candidatos = []
            if "IMAGE" in hdul:
                candidatos.append(hdul["IMAGE"])
            for hdu in hdul:
                if all(hdu is not c for c in candidatos):
                    candidatos.append(hdu)

            objeto_global = self._limpiar_nombre_objeto(hdul[0].header.get("OBJECT")) if len(hdul) > 0 else None

            for hdu in candidatos:
                header = getattr(hdu, "header", None)
                if header is None:
                    continue
                try:
                    wcs = WCS(header, relax=True)
                except Exception:
                    continue
                if not wcs.has_celestial:
                    continue

                wcs_cel = wcs.celestial
                data = getattr(hdu, "data", None)
                if data is not None and getattr(data, "ndim", 0) >= 2:
                    alto, ancho = int(data.shape[-2]), int(data.shape[-1])
                else:
                    ancho = int(header.get("NAXIS1") or 0)
                    alto = int(header.get("NAXIS2") or 0)

                if ancho > 0 and alto > 0:
                    coord = wcs_cel.pixel_to_world((ancho - 1) / 2.0, (alto - 1) / 2.0).icrs
                else:
                    crval = wcs_cel.wcs.crval
                    coord = SkyCoord(ra=float(crval[0]), dec=float(crval[1]), unit="deg", frame="icrs")

                ra_deg = float(coord.ra.deg) % 360.0
                dec_deg = float(coord.dec.deg)
                if not (np.isfinite(ra_deg) and np.isfinite(dec_deg) and -90.0 <= dec_deg <= 90.0):
                    continue

                pixscale_arcsec: float | None = None
                try:
                    escalas_deg = proj_plane_pixel_scales(wcs_cel)
                    escala = float(np.mean(escalas_deg[:2]) * 3600.0)
                    if np.isfinite(escala) and escala > 0:
                        pixscale_arcsec = escala
                except Exception:
                    pixscale_arcsec = None

                if pixscale_arcsec and ancho > 0 and alto > 0:
                    fov_arcsec = float(max(ancho, alto) * pixscale_arcsec)
                else:
                    fov_arcsec = 120.0

                radio_sugerido = int(max(60, min(600, round(fov_arcsec / 2.0 if fov_arcsec > 180 else fov_arcsec))))
                objeto = (
                    self._limpiar_nombre_objeto(header.get("OBJECT"))
                    or self._limpiar_nombre_objeto(header.get("TARGNAME"))
                    or objeto_global
                )

                return {
                    "metodo": "fits-wcs",
                    "ra_deg": round(ra_deg, 6),
                    "dec_deg": round(dec_deg, 6),
                    "fov_arcsec": round(fov_arcsec, 1),
                    "radio_sugerido_arcsec": radio_sugerido,
                    "pixscale_arcsec": round(pixscale_arcsec, 4) if pixscale_arcsec else None,
                    "orientacion_deg": None,
                    "objeto_detectado": objeto,
                    "objetos_en_campo": [objeto] if objeto else [],
                    "job_id": None,
                }
            return None
        finally:
            hdul.close()

    def _limpiar_nombre_objeto(self, valor: object) -> str | None:
        if valor is None:
            return None
        texto = str(valor).strip()
        if not texto or texto.upper() in {"NONE", "N/A", "NULL", "UNKNOWN", "UNDEFINED"}:
            return None
        return texto

    def _resolver_con_astrometry(
        self,
        contenido: bytes,
        nombre_archivo: str,
        api_key: str
    ) -> dict:
        """Envía una imagen estelar a nova.astrometry.net y recupera RA, Dec, FOV y objetos."""
        base = self._astrometry_base_url
        login_res = self._astrometry_post_json(f"{base}/login", {"apikey": api_key})
        if login_res.get("status") != "success" or not login_res.get("session"):
            mensaje = login_res.get("errormessage") or "API key inválida o rechazada por Astrometry.net."
            raise ValueError(f"Error de autenticación en Astrometry.net: {mensaje}")
        session = str(login_res["session"])

        upload_res = self._astrometry_subir_archivo(
            f"{base}/upload",
            session=session,
            nombre_archivo=nombre_archivo,
            contenido=contenido,
        )
        if upload_res.get("status") != "success" or upload_res.get("subid") is None:
            mensaje = upload_res.get("errormessage") or "No se pudo subir la imagen a Astrometry.net."
            raise ValueError(mensaje)
        subid = int(upload_res["subid"])

        inicio = time.monotonic()
        job_id: int | None = None
        while time.monotonic() - inicio < self._timeout_astrometry:
            sub_info = self._astrometry_get_json(f"{base}/submissions/{subid}")
            jobs = [int(j) for j in (sub_info.get("jobs") or []) if j is not None]
            if jobs:
                job_id = jobs[0]
                break
            time.sleep(2.0)

        if job_id is None:
            raise TimeoutError("Astrometry.net tardó demasiado en asignar un trabajo de análisis.")

        while time.monotonic() - inicio < self._timeout_astrometry:
            job_status = self._astrometry_get_json(f"{base}/jobs/{job_id}")
            estado = str(job_status.get("status") or "").lower()
            if estado == "success":
                break
            if estado == "failure":
                raise ValueError(
                    "No se pudieron identificar estrellas suficientes en la fotografía. "
                    "Prueba con una imagen más nítida donde se distingan estrellas puntuales."
                )
            time.sleep(2.0)
        else:
            raise TimeoutError("Astrometry.net agotó el tiempo máximo intentando resolver la fotografía.")

        cal = self._astrometry_get_json(f"{base}/jobs/{job_id}/calibration/")
        ra_raw = cal.get("ra")
        dec_raw = cal.get("dec")
        if ra_raw is None or dec_raw is None:
            raise ErrorAstrometry("Astrometry.net completó el trabajo pero no devolvió coordenadas RA/Dec.")

        ra_deg = float(ra_raw) % 360.0
        dec_deg = float(dec_raw)
        radius_deg = float(cal.get("radius") or 0.0)
        fov_arcsec = round(radius_deg * 2.0 * 3600.0, 1) if radius_deg > 0 else 120.0
        radio_sugerido = int(max(60, min(600, round(radius_deg * 3600.0 if radius_deg > 0 else 120))))
        pixscale = cal.get("pixscale")
        orientacion = cal.get("orientation")

        objetos_en_campo: list[str] = []
        try:
            obj_res = self._astrometry_get_json(f"{base}/jobs/{job_id}/objects_in_field/")
            lista = obj_res.get("objects_in_field") or []
            objetos_en_campo = [str(item).strip() for item in lista if str(item).strip()][:12]
        except Exception:
            logger.debug("No se pudieron consultar objects_in_field para job %s.", job_id)

        return {
            "metodo": "astrometry.net",
            "ra_deg": round(ra_deg, 6),
            "dec_deg": round(dec_deg, 6),
            "fov_arcsec": fov_arcsec,
            "radio_sugerido_arcsec": radio_sugerido,
            "pixscale_arcsec": round(float(pixscale), 4) if pixscale is not None else None,
            "orientacion_deg": round(float(orientacion), 2) if orientacion is not None else None,
            "objeto_detectado": objetos_en_campo[0] if objetos_en_campo else None,
            "objetos_en_campo": objetos_en_campo,
            "job_id": job_id,
        }

    def _astrometry_post_json(self, url: str, payload: dict) -> dict:
        cuerpo = urlencode({"request-json": json.dumps(payload)}).encode("utf-8")
        req = Request(
            url,
            data=cuerpo,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "SPHEREx-Explorer/1.0",
            },
            method="POST",
        )
        return self._ejecutar_peticion_json(req)

    def _astrometry_get_json(self, url: str) -> dict:
        req = Request(
            url,
            headers={"User-Agent": "SPHEREx-Explorer/1.0"},
            method="GET",
        )
        return self._ejecutar_peticion_json(req)

    def _astrometry_subir_archivo(
        self,
        url: str,
        session: str,
        nombre_archivo: str,
        contenido: bytes
    ) -> dict:
        nombre_seguro = (
            Path(nombre_archivo or "cielo.png").name.replace('"', "").replace("\r", "").replace("\n", "")
            or "cielo.png"
        )
        limite = f"----SpherexBoundary{uuid.uuid4().hex}"
        cuerpo = BytesIO()
        cuerpo.write(f"--{limite}\r\n".encode("ascii"))
        cuerpo.write(b'Content-Disposition: form-data; name="request-json"\r\n\r\n')
        cuerpo.write(json.dumps({"session": session, "publicly_visible": "n"}).encode("utf-8"))
        cuerpo.write(b"\r\n")
        cuerpo.write(f"--{limite}\r\n".encode("ascii"))
        cuerpo.write(
            f'Content-Disposition: form-data; name="file"; filename="{nombre_seguro}"\r\n'.encode("utf-8")
        )
        cuerpo.write(b"Content-Type: application/octet-stream\r\n\r\n")
        cuerpo.write(contenido)
        cuerpo.write(f"\r\n--{limite}--\r\n".encode("ascii"))

        req = Request(
            url,
            data=cuerpo.getvalue(),
            headers={
                "Content-Type": f"multipart/form-data; boundary={limite}",
                "User-Agent": "SPHEREx-Explorer/1.0",
            },
            method="POST",
        )
        return self._ejecutar_peticion_json(req)

    def _ejecutar_peticion_json(self, req: Request) -> dict:
        contexto_ssl = ssl.create_default_context(cafile=certifi.where())
        try:
            with urlopen(req, context=contexto_ssl, timeout=30) as resp:
                datos = resp.read().decode("utf-8", errors="replace")
            return json.loads(datos)
        except urllib.error.HTTPError as error:
            raise ErrorAstrometry(f"Astrometry.net devolvió HTTP {error.code}.") from error
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
            raise ErrorAstrometry("No se pudo conectar con Astrometry.net.") from error
        except json.JSONDecodeError as error:
            raise ErrorAstrometry("Astrometry.net devolvió una respuesta JSON no válida.") from error

    def consultar_panstarrs(
        self,
        ascension_recta: float,
        declinacion: float,
        fov_arcsec: float = 60.0,
        tipo_archivo: str = "stack",
    ) -> dict:
        """Consulta recortes ópticos Pan-STARRS1 DR2 desde STScI sin exponer restricciones CORS."""
        if not np.isfinite([ascension_recta, declinacion, fov_arcsec]).all():
            raise ValueError("Las coordenadas y FOV de Pan-STARRS1 deben ser finitos.")
        if not 0 <= ascension_recta <= 360 or not -90 <= declinacion <= 90:
            raise ValueError("RA debe estar entre 0 y 360 y Dec entre -90 y 90 grados.")

        clamped_fov = max(15.0, min(600.0, float(fov_arcsec)))
        size_px = max(60, min(2400, int(round(clamped_fov / 0.25))))
        file_type = "warp" if str(tipo_archivo).strip().lower() == "warp" else "stack"

        ps1_url = (
            f"https://ps1images.stsci.edu/cgi-bin/ps1filenames.py?"
            f"ra={ascension_recta:.6f}&dec={declinacion:.6f}&filters=grizy&type={file_type}"
        )
        contexto_ssl = ssl.create_default_context(cafile=certifi.where())
        req = Request(ps1_url, headers={"User-Agent": "SPHEREx-Explorer/1.0"})
        try:
            with urlopen(req, context=contexto_ssl, timeout=15) as resp:
                raw_text = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            raise ErrorIRSA(f"Error de Pan-STARRS1 (HTTP {error.code}).") from error
        except (TimeoutError, urllib.error.URLError, http.client.HTTPException, OSError) as error:
            raise ErrorIRSA("No se pudo consultar el servicio de Pan-STARRS1.") from error

        lineas = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
        items: list[dict] = []
        if len(lineas) >= 2:
            cabecera = lineas[0].split()
            indices = {col: cabecera.index(col) if col in cabecera else -1 for col in (
                "projcell", "subcell", "ra", "dec", "filter", "mjd", "type", "filename", "shortname", "badflag"
            )}
            if indices["filename"] != -1 and indices["filter"] != -1:
                ra_str = f"{ascension_recta:.6f}"
                dec_str = f"{declinacion:.6f}"
                for linea in lineas[1:]:
                    cols = linea.split()
                    if len(cols) < len(cabecera):
                        continue
                    filename = cols[indices["filename"]]
                    filtro = cols[indices["filter"]]
                    if not filename or not filtro:
                        continue
                    encoded_file = quote(filename, safe="")
                    prefijo_ruta = "" if filename.startswith("/") else "/"
                    items.append({
                        "projcell": cols[indices["projcell"]] if indices["projcell"] >= 0 else "",
                        "subcell": cols[indices["subcell"]] if indices["subcell"] >= 0 else "",
                        "ra": float(cols[indices["ra"]]) if indices["ra"] >= 0 else float(ascension_recta),
                        "dec": float(cols[indices["dec"]]) if indices["dec"] >= 0 else float(declinacion),
                        "filter": filtro,
                        "mjd": float(cols[indices["mjd"]]) if indices["mjd"] >= 0 else 0.0,
                        "type": cols[indices["type"]] if indices["type"] >= 0 else "stack",
                        "filename": filename,
                        "shortname": cols[indices["shortname"]] if indices["shortname"] >= 0 else filename,
                        "badflag": int(cols[indices["badflag"]]) if indices["badflag"] >= 0 else 0,
                        "imageUrl": (
                            f"https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?"
                            f"ra={ra_str}&dec={dec_str}&size={size_px}&format=jpg&red={encoded_file}"
                        ),
                        "fitsUrl": f"https://ps1images.stsci.edu{prefijo_ruta}{filename}",
                        "fitsCutoutUrl": (
                            f"https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?"
                            f"ra={ra_str}&dec={dec_str}&size={size_px}&format=fits&red={encoded_file}"
                        ),
                    })

        por_filtro: dict[str, dict] = {}
        for item in items:
            por_filtro.setdefault(str(item["filter"]), item)

        y_item = por_filtro.get("y")
        i_item = por_filtro.get("i")
        g_item = por_filtro.get("g")
        color_url = None
        if y_item and i_item and g_item:
            color_url = (
                f"https://ps1images.stsci.edu/cgi-bin/fitscut.cgi?"
                f"ra={ascension_recta:.6f}&dec={declinacion:.6f}&size={size_px}&format=jpg"
                f"&red={quote(str(y_item['filename']), safe='')}"
                f"&green={quote(str(i_item['filename']), safe='')}"
                f"&blue={quote(str(g_item['filename']), safe='')}"
            )

        ps1_web_url = (
            f"https://ps1images.stsci.edu/cgi-bin/ps1cutouts?"
            f"pos={quote(f'{ascension_recta:.6f} {declinacion:.6f}', safe='')}"
            f"&filter=color&filter=g&filter=r&filter=i&filter=z&filter=y"
            f"&filetypes={file_type}&size={size_px}"
        )

        return {
            "ra": float(ascension_recta),
            "dec": float(declinacion),
            "fovArcsec": clamped_fov,
            "sizePx": size_px,
            "type": file_type,
            "colorUrl": color_url,
            "ps1CutoutsWebUrl": ps1_web_url,
            "items": items,
        }

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
