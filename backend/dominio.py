
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


class RepositorioObservaciones(Protocol):
    """
    Define las operaciones disponibles para consultar observaciones.
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

    def obtener_estructura_fits(
        self,
        url_acceso: str
    ) -> list[dict]:
        """
        Inspecciona las extensiones de un archivo FITS.
        Devuelve una lista con la información de cada extensión.
        """
        ...

    
    def obtener_metadatos_fits(
        self,
        url_acceso: str
    ) -> dict:
        """
        Obtiene los metadatos científicos de las cabeceras FITS.
        Devuelve un diccionario con la información de las cabeceras.
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
