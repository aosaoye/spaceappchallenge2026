
from dominio import Observacion, RepositorioObservaciones


class BuscarObservaciones:
    """
    Gestiona la búsqueda de productos científicos de SPHEREx.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio que realizará las consultas.
        Guarda el repositorio para utilizarlo en las búsquedas.
        """

        self.repositorio = repositorio

    def ejecutar(self,ascension_recta: float, declinacion: float, radio: float ) -> list[Observacion]:
        """
        Solicita observaciones para unas coordenadas y un radio.
        Devuelve la lista de productos encontrados.
        """

        return self.repositorio.buscar_por_coordenadas(
            ascension_recta=ascension_recta,
            declinacion=declinacion,
            radio=radio
        )

    
