
from dominio import Observacion


class BuscarObservaciones:

    '''Esta función devolverá una lista de todas las observaciones que tengamos registrada'''
    def ejecutar(self) -> list[Observacion]:
        return [
            Observacion(
                identificador="SPH-001",
                fecha="2026-11-14",
                ascension_recta=180.5,
                declinacion=45.2
            ),
            Observacion(
                identificador="SPH-002",
                fecha="2026-11-14",
                ascension_recta=181.2,
                declinacion=44.8
            )
        ]
