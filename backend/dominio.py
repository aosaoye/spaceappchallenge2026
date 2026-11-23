from dataclasses import dataclass
from typing import Protocol


@dataclass
class Observacion:
    """
    Representa un producto científico de una observación de SPHEREx.
    Contiene sus coordenadas, información espectral y datos de acceso.
    """

    identificador: str
    ascension_recta: float
    declinacion: float
    coleccion: str
    banda_espectral: str
    tipo_producto: str
    url_acceso: str
    tamano_estimado: int | None
    url_imagen_png: str | None = None
    fecha_observacion: str | None = None
    fecha_fin_observacion: str | None = None
    mjd_inicio: float | None = None
    mjd_fin: float | None = None


class RepositorioObservaciones(Protocol):
    """
    Define las operaciones disponibles para consultar observaciones,
    inspeccionar extensiones/metadatos FITS (MEF) y generar imágenes PNG.
    """

    def buscar_por_coordenadas(
        self,
        ascension_recta: float,
        declinacion: float,
        radio: float
    ) -> list[Observacion]:
        """
        Busca productos de SPHEREx alrededor de unas coordenadas.
        Devuelve una lista de observaciones encontradas.
        """
        ...

    def buscar_cubo_hips5(
        self,
        ascension_recta: float,
        declinacion: float
    ) -> list[Observacion]:
        """
        Resuelve las bandas científicas disponibles en los cubos espectrales HiPS5 de SPHEREx DR1
        para una coordenada (RA, Dec) como respaldo directo ante indisponibilidad o vacío de SIA.
        """
        ...

    def obtener_estructura_fits(
        self,
        url_acceso: str
    ) -> list[dict]:
        """
        Inspecciona las extensiones de un archivo FITS Multi-Extensión (MEF).
        Devuelve una lista con la información de cada extensión.
        """
        ...

    def obtener_metadatos_fits(
        self,
        url_acceso: str
    ) -> dict:
        """
        Obtiene los metadatos científicos de las cabeceras FITS,
        incluyendo WCS espacial, WCS espectral (LVF) y banderas de calidad.
        """
        ...

    def analizar_imagen_fits(
        self,
        url_acceso: str
    ) -> dict:
        """
        Analiza estadísticamente los píxeles de la imagen científica.
        Devuelve las estadísticas y el recuento de píxeles válidos y no válidos.
        """
        ...

    def analizar_calidad_fits(
        self,
        url_acceso: str
    ) -> dict:
        """
        Analiza las extensiones VARIANCE y FLAGS de un archivo FITS.
        Devuelve estadísticas de varianza y frecuencias de los indicadores de calidad.
        """
        ...

    def convertir_fits_a_png(
        self,
        url_fits: str,
        modo: str = "flujo"
    ) -> bytes:
        """
        Descarga o lee un producto FITS de SPHEREx y lo convierte en PNG.
        Soporta modo 'flujo' (AsinhStretch) y 'longitud_onda' (mapa WCS-WAVE).
        """
        ...

    def resolver_coordenadas_imagen(
        self,
        contenido: bytes,
        nombre_archivo: str,
        astrometry_api_key: str | None = None
    ) -> dict:
        """
        Extrae coordenadas celestes (RA, Dec, FOV) a partir de una imagen del cielo.
        Utiliza cabecera WCS local en archivos FITS o plate solving mediante Astrometry.net.
        """
        ...

    def obtener_recorte_fits(
        self,
        url_fits: str,
        ascension_recta: float | None = None,
        declinacion: float | None = None,
        fov_arcsec: float = 600.0,
        tamano_px: int = 280
    ) -> dict:
        """
        Extrae un recorte numérico real de la extensión IMAGE de un archivo FITS,
        reproyectado al plano tangente celeste cuando el WCS cubre la región solicitada,
        y codificado en float32 base64 para el reproductor interactivo.
        """
        ...

    def consultar_panstarrs(
        self,
        ascension_recta: float,
        declinacion: float,
        fov_arcsec: float = 60.0,
        tipo_archivo: str = "stack"
    ) -> dict:
        """
        Consulta recortes ópticos Pan-STARRS1 DR2 en el servicio de STScI.
        Devuelve filtros disponibles y URLs de recorte FITS/JPG sin problemas CORS.
        """
        ...
