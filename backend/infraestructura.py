
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astroquery.ipac.irsa import Irsa

from dominio import Observacion


class RepositorioIrsa:
    """
    Conecta con IRSA para consultar productos científicos de SPHEREx.
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

    def _obtener_valor(self, fila, columna):
        """
        Obtiene un valor de una fila de resultados de IRSA.
        Devuelve None si el dato está vacío o enmascarado.
        """

        valor = fila[columna]

        if np.ma.is_masked(valor):
            return None

        return valor
