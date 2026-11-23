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


class BuscarCuboHips5:
    """
    Gestiona la resolución directa de bandas SPHEREx DR1 desde cubos espectrales HiPS5.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio encargado de consultar e inspeccionar los cubos HiPS5.
        """

        self.repositorio = repositorio

    def ejecutar(
        self,
        ascension_recta: float,
        declinacion: float
    ) -> list[Observacion]:
        """
        Obtiene observaciones SPHEREx DR1 (D1–D6) desde el mosaico HiPS5 para (RA, Dec).
        """

        return self.repositorio.buscar_cubo_hips5(
            ascension_recta=ascension_recta,
            declinacion=declinacion
        )


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


class ResolverCoordenadasImagen:
    """
    Gestiona la extracción automática de coordenadas del cielo a partir de una imagen subida.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio encargado del análisis WCS local o plate solving externo.
        """

        self.repositorio = repositorio

    def ejecutar(
        self,
        contenido: bytes,
        nombre_archivo: str,
        astrometry_api_key: str | None = None
    ) -> dict:
        """
        Resuelve las coordenadas celestes (RA, Dec, FOV) de la imagen proporcionada.
        """

        return self.repositorio.resolver_coordenadas_imagen(
            contenido=contenido,
            nombre_archivo=nombre_archivo,
            astrometry_api_key=astrometry_api_key
        )


class ExtraerRecorteFits:
    """
    Gestiona la extracción de recortes científicos numéricos reales desde archivos FITS.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """
        Recibe el repositorio encargado de leer, recortar y reproyectar la matriz FITS.
        """

        self.repositorio = repositorio

    def ejecutar(
        self,
        url_fits: str,
        ascension_recta: float | None = None,
        declinacion: float | None = None,
        fov_arcsec: float = 600.0,
        tamano_px: int = 280
    ) -> dict:
        """
        Extrae el recorte real de píxeles de la extensión IMAGE del archivo FITS indicado.
        """

        if not url_fits or not url_fits.strip():
            raise ValueError("Debes indicar la URL del archivo FITS a extraer.")

        return self.repositorio.obtener_recorte_fits(
            url_fits=url_fits,
            ascension_recta=ascension_recta,
            declinacion=declinacion,
            fov_arcsec=fov_arcsec,
            tamano_px=tamano_px
        )


class ConsultarPanStarrs:
    """
    Gestiona la consulta de imágenes ópticas de comparación Pan-STARRS1.
    """

    def __init__(self, repositorio: RepositorioObservaciones):
        """Recibe el repositorio encargado de consultar el servicio STScI Pan-STARRS1."""
        self.repositorio = repositorio

    def ejecutar(
        self,
        ascension_recta: float,
        declinacion: float,
        fov_arcsec: float = 60.0,
        tipo_archivo: str = "stack"
    ) -> dict:
        """Devuelve recortes ópticos y metadatos de Pan-STARRS1 para (RA, Dec)."""
        return self.repositorio.consultar_panstarrs(
            ascension_recta=ascension_recta,
            declinacion=declinacion,
            fov_arcsec=fov_arcsec,
            tipo_archivo=tipo_archivo,
        )
