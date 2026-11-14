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

    def analizar_imagen_fits(self, url_acceso: str) -> dict:
        """
        Solicita el análisis estadístico de una imagen FITS al repositorio.
        Devuelve las estadísticas y el recuento de píxeles.
        """

        return self.repositorio.analizar_imagen_fits(url_acceso)

    def analizar_calidad_fits(self, url_acceso: str) -> dict:
        """
        Solicita el análisis de calidad de un archivo FITS al repositorio.
        Devuelve las estadísticas de VARIANCE y la distribución de FLAGS.
        """

        return self.repositorio.analizar_calidad_fits(url_acceso)


class ConvertirFitsAPng:
    """
    Gestiona la conversión de un archivo FITS de SPHEREx a imagen PNG.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio encargado de leer y renderizar el FITS.
        """

        self.repositorio = repositorio

    def ejecutar(self, url_fits: str, modo: str = "flujo") -> bytes:
        """
        Convierte el archivo FITS indicado en una imagen PNG en bytes.
        """

        return self.repositorio.convertir_fits_a_png(
            url_fits=url_fits,
            modo=modo
        )
