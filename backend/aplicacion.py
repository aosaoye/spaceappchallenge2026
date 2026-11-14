
from dominio import Observacion, RepositorioObservaciones


class BuscarObservaciones:
    """
    Gestiona la búsqueda y la inspección de productos científicos SPHEREx.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio que realizará las consultas.
        Guarda el repositorio para utilizarlo en las operaciones.
        """

        self.repositorio = repositorio

    def ejecutar(
        self,
        ascension_recta: float,
        declinacion: float,
        radio: float
    ) -> list[Observacion]:
        """
        Solicita observaciones para unas coordenadas y un radio.
        Devuelve la lista de productos encontrados.
        """

        return self.repositorio.buscar_por_coordenadas(
            ascension_recta=ascension_recta,
            declinacion=declinacion,
            radio=radio
        )

    def inspeccionar_fits(self, url_acceso: str) -> list[dict]:
        """
        Solicita la inspección de un archivo FITS al repositorio.
        Devuelve la información de sus extensiones científicas.
        """

        return self.repositorio.obtener_estructura_fits(url_acceso)


    def inspeccionar_metadatos_fits(self, url_acceso: str) -> dict:
        """
        Solicita la extracción de metadatos de un archivo FITS al repositorio.
        Devuelve un diccionario con la información científica obtenida.
        """

        return self.repositorio.obtener_metadatos_fits(url_acceso)
