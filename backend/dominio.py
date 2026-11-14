
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
