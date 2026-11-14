
"""
Representación y consulta de los datos astronómicos de SPHEREx.
"""

import numpy as np
import ssl
import certifi

from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits

from astroquery.ipac.irsa import Irsa

from urllib.request import urlopen
from urllib.parse import urlsplit
from io import BytesIO

from dominio import Observacion


class RepositorioIrsa:
    """
    Conecta con IRSA para consultar y descargar productos científicos de SPHEREx.
    """

    def buscar_por_coordenadas(
        self,
        ascension_recta: float,
        declinacion: float,
        radio: float
    ) -> list[Observacion]:
        """
        Consulta los productos SPHEREx cercanos a unas coordenadas.
        Devuelve una lista de observaciones obtenidas desde IRSA.
        """

        coordenadas = SkyCoord(
            ra=ascension_recta * u.deg,
            dec=declinacion * u.deg,
            frame="icrs"
        )

        resultados = Irsa.query_sia(
            pos=(coordenadas, radio * u.arcsec),
            collection=["spherex_dr1", "spherex_qr3"]
        )

        observaciones = []

        for fila in resultados:
            tamano = self._obtener_valor(fila, "access_estsize")

            observacion = Observacion(
                identificador=str(fila["obs_id"]),
                ascension_recta=float(fila["s_ra"]),
                declinacion=float(fila["s_dec"]),
                coleccion=str(fila["obs_collection"]),
                banda_espectral=str(fila["energy_bandpassname"]),
                tipo_producto=str(fila["dataproduct_subtype"]),
                url_acceso=str(fila["access_url"]),
                tamano_estimado=int(tamano) if tamano is not None else None
            )

            observaciones.append(observacion)

        return observaciones

    def descargar_fits(self, url_acceso: str) -> fits.HDUList:
        """
        Descarga un archivo FITS desde una URL de IRSA.
        Devuelve su contenido abierto como una estructura HDUList.
        """

        # Eliminar espacios y posibles comillas sobrantes.
        url_limpia = url_acceso.strip().strip('"').strip("'")

        # Analizar la dirección recibida.
        partes_url = urlsplit(url_limpia)

        # Validar el protocolo y el dominio de IRSA.
        if (
            partes_url.scheme != "https"
            or partes_url.hostname != "irsa.ipac.caltech.edu"
        ):
            raise ValueError(
                "La URL debe pertenecer al servicio HTTPS de IRSA."
            )

        # Crear un contexto SSL utilizando certificados de confianza.
        contexto_ssl = ssl.create_default_context(
            cafile=certifi.where()
        )

        # Descargar el archivo FITS validando el certificado HTTPS.
        with urlopen(
            url_limpia,
            timeout=60,
            context=contexto_ssl
        ) as respuesta:
            contenido = respuesta.read()

        # Abrir el archivo descargado con Astropy.
        archivo = fits.open(
            BytesIO(contenido),
            memmap=False
        )

        return archivo

    def obtener_estructura_fits(self, url_acceso: str) -> list[dict]:
        """
        Inspecciona las extensiones de un archivo FITS.
        Devuelve una lista con el nombre, las dimensiones y el tipo de datos de cada extensión.
        """

        archivo = self.descargar_fits(url_acceso)

        try:
            extensiones = []

            for indice, extension in enumerate(archivo):
                datos = extension.data

                informacion = {
                    "indice": indice,
                    "nombre": extension.name,
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
                    )
                }

                extensiones.append(informacion)

            return extensiones

        finally:
            archivo.close()

    def _obtener_valor(self, fila, columna):
        """
        Obtiene un valor de una fila de resultados de IRSA.
        Devuelve None si el dato está vacío o enmascarado.
        """

        valor = fila[columna]

        if np.ma.is_masked(valor):
            return None

        return valor

    
    def obtener_metadatos_fits(self, url_acceso: str) -> dict:
        """
        Extrae información científica de las cabeceras de un archivo FITS.
        Devuelve un diccionario con los metadatos principales y los parámetros WCS.
        """

        archivo = self.descargar_fits(url_acceso)

        try:
            # Obtener las cabeceras principal y de la imagen científica.
            cabecera_principal = archivo[0].header
            cabecera_imagen = archivo["IMAGE"].header

            # Campos generales que queremos consultar.
            campos_generales = [
                "TELESCOP",
                "INSTRUME",
                "OBJECT",
                "DATE-OBS",
                "MJD-OBS",
                "OBS_ID",
                "BUNIT",
                "EXPTIME"
            ]

            metadatos_principales = {
                clave: cabecera_principal[clave]
                for clave in campos_generales
                if clave in cabecera_principal
            }

            metadatos_imagen = {
                clave: cabecera_imagen[clave]
                for clave in campos_generales
                if clave in cabecera_imagen
            }

            # Identificar los parámetros de referencia espacial.
            claves_wcs = [
                "RADESYS",
                "EQUINOX",
                "WCSAXES",
                "LONPOLE",
                "LATPOLE"
            ]

            parametros_wcs = {
                clave: cabecera_imagen[clave]
                for clave in cabecera_imagen
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
                        "CROTA"
                    ))
                )
            }

            return {
                "cabecera_principal": metadatos_principales,
                "cabecera_imagen": metadatos_imagen,
                "parametros_wcs": parametros_wcs
            }

        finally:
            archivo.close()


    def analizar_imagen_fits(self, url_acceso: str) -> dict:
        """
        Analiza estadísticamente los píxeles de la imagen científica.
        Devuelve las estadísticas y el recuento de píxeles válidos y no válidos.
        """

        archivo = self.descargar_fits(url_acceso)

        try:
            extension_imagen = archivo["IMAGE"]
            datos = extension_imagen.data

            if datos is None:
                raise ValueError(
                    "La extensión IMAGE no contiene datos."
                )

            unidad = extension_imagen.header.get("BUNIT")

            # Identificar los píxeles válidos.
            mascara_validos = np.isfinite(datos)

            total_pixeles = int(datos.size)
            pixeles_validos = int(
                np.count_nonzero(mascara_validos)
            )
            pixeles_no_validos = (
                total_pixeles - pixeles_validos
            )

            valores_validos = datos[mascara_validos]

            if pixeles_validos == 0:
                raise ValueError(
                    "La extensión IMAGE no contiene píxeles válidos."
                )

            return {
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
                    "desviacion_estandar": float(
                        np.std(valores_validos)
                    )
                }
            }

        finally:
            archivo.close()



    def analizar_calidad_fits(self, url_acceso: str) -> dict:
        """
        Analiza las extensiones VARIANCE y FLAGS de un archivo FITS.
        Devuelve estadísticas de varianza y frecuencias de los indicadores de calidad.
        """

        archivo = self.descargar_fits(url_acceso)

        try:
            # Obtener las extensiones científicas.
            datos_varianza = archivo["VARIANCE"].data
            datos_flags = archivo["FLAGS"].data

            if datos_varianza is None or datos_flags is None:
                raise ValueError(
                    "Las extensiones VARIANCE o FLAGS no contienen datos."
                )

            # Analizar la varianza.
            mascara_finitos = np.isfinite(datos_varianza)
            mascara_validos = mascara_finitos & (datos_varianza >= 0)

            valores_varianza = datos_varianza[mascara_validos]

            total_varianza = int(datos_varianza.size)
            pixeles_validos = int(
                np.count_nonzero(mascara_validos)
            )
            pixeles_no_finitos = int(
                np.count_nonzero(~mascara_finitos)
            )
            varianzas_negativas = int(
                np.count_nonzero(
                    mascara_finitos & (datos_varianza < 0)
                )
            )

            if pixeles_validos > 0:
                estadisticas_varianza = {
                    "minimo": float(np.min(valores_varianza)),
                    "maximo": float(np.max(valores_varianza)),
                    "media": float(np.mean(valores_varianza)),
                    "mediana": float(np.median(valores_varianza)),
                    "desviacion_estandar": float(
                        np.std(valores_varianza)
                    )
                }
            else:
                estadisticas_varianza = {
                    "minimo": None,
                    "maximo": None,
                    "media": None,
                    "mediana": None,
                    "desviacion_estandar": None
                }

            # Analizar los indicadores FLAGS.
            mascara_flags = np.isfinite(datos_flags)
            valores_flags = datos_flags[mascara_flags]

            total_flags = int(datos_flags.size)
            flags_validos = int(valores_flags.size)
            flags_no_validos = total_flags - flags_validos

            valores_unicos, frecuencias = np.unique(
                valores_flags,
                return_counts=True
            )

            distribucion_flags = []

            for valor, frecuencia in zip(
                valores_unicos,
                frecuencias
            ):
                cantidad = int(frecuencia)

                distribucion_flags.append({
                    "valor": int(valor),
                    "cantidad": cantidad,
                    "porcentaje": round(
                        cantidad / flags_validos * 100,
                        4
                    )
                })

            return {
                "varianza": {
                    "dimensiones": list(datos_varianza.shape),
                    "total_pixeles": total_varianza,
                    "pixeles_validos": pixeles_validos,
                    "pixeles_no_finitos": pixeles_no_finitos,
                    "varianzas_negativas": varianzas_negativas,
                    "estadisticas": estadisticas_varianza
                },
                "flags": {
                    "dimensiones": list(datos_flags.shape),
                    "total_pixeles": total_flags,
                    "pixeles_validos": flags_validos,
                    "pixeles_no_validos": flags_no_validos,
                    "valores_distintos": len(valores_unicos),
                    "distribucion": distribucion_flags
                }
            }

        finally:
            archivo.close()
