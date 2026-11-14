
from fastapi import FastAPI, HTTPException, Query

from aplicacion import BuscarObservaciones
from infraestructura import RepositorioIrsa


app = FastAPI(
    title="SPHEREx Explorer",
    description="API para explorar y analizar observaciones astronómicas",
    version="1.0.0"
)

# Inyección de dependencias
repositorio = RepositorioIrsa()
buscar_observaciones = BuscarObservaciones(repositorio)


@app.get("/api/v1/estado")
def obtener_estado():
    """
    Comprueba el estado de funcionamiento de la API.
    Devuelve un mensaje con el estado del servicio.
    """

    return {
        "estado": "funcionando",
        "proyecto": "SPHEREx Explorer"
    }


@app.get("/api/v1/observaciones")
def obtener_observaciones(
    ascension_recta: float = Query(..., ge=0, le=360),
    declinacion: float = Query(..., ge=-90, le=90),
    radio: float = Query(1, gt=0, le=3600)
):
    """
    Busca productos SPHEREx alrededor de unas coordenadas.
    Devuelve los productos encontrados o un error si falla la consulta.
    """

    try:
        resultados = buscar_observaciones.ejecutar(
            ascension_recta=ascension_recta,
            declinacion=declinacion,
            radio=radio
        )

        return {
            "total": len(resultados),
            "observaciones": resultados
        }

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error al consultar IRSA: {str(error)}"
        )


@app.get("/api/v1/observaciones/estructura-fits")
def obtener_estructura_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Inspecciona la estructura de un archivo FITS de SPHEREx.
    Devuelve información sobre sus extensiones, dimensiones y tipos de datos.
    """

    try:
        resultado = buscar_observaciones.inspeccionar_fits(url_acceso)

        return {
            "total_extensiones": len(resultado),
            "extensiones": resultado
        }

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error al inspeccionar el archivo FITS: {str(error)}"
        )



@app.get("/api/v1/observaciones/metadatos-fits")
def obtener_metadatos_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Obtiene los metadatos científicos de un archivo FITS.
    Devuelve información de sus cabeceras y parámetros WCS.
    """

    try:
        resultado = buscar_observaciones.inspeccionar_metadatos_fits(
            url_acceso
        )

        return resultado

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error al obtener los metadatos FITS: {str(error)}"
        )


@app.get("/api/v1/observaciones/analisis-fits")
def analizar_imagen_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Analiza estadísticamente los píxeles de una imagen FITS.
    Devuelve las estadísticas y el recuento de píxeles válidos y no válidos.
    """

    try:
        resultado = buscar_observaciones.analizar_imagen_fits(
            url_acceso
        )

        return resultado

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error al analizar la imagen FITS: {str(error)}"
        )


@app.get("/api/v1/observaciones/analisis-calidad-fits")
def analizar_calidad_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Analiza la calidad de los datos de un archivo FITS.
    Devuelve estadísticas de VARIANCE y la distribución de FLAGS.
    """

    try:
        resultado = buscar_observaciones.analizar_calidad_fits(
            url_acceso
        )

        return resultado

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Error al analizar la calidad del FITS: {str(error)}"
        )
