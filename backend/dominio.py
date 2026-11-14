
from dataclasses import dataclass
from typing import Protocol


@dataclass

'''Dentro se encontrará la estructura de cada una de las observaciones que hay en los Infrarojos'''


class Observacion:
    identificador: str
    fecha: str
    ascension_recta: float
    declinacion: float


class RepositorioObservaciones(Protocol):

    def buscar_todas(self) -> list[Observacion]:
        ...
