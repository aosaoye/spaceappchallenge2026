import logging
import os

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from aplicacion import BuscarObservaciones, ConvertirFitsAPng
from configuracion import obtener_origenes_cors
from infraestructura import ErrorIRSA, RepositorioIrsa

logger = logging.getLogger(__name__)
nivel_logging = getattr(logging, os.getenv("SPHEREX_LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(level=nivel_logging if isinstance(nivel_logging, int) else logging.INFO)

app = FastAPI(
    title="SPHEREx Explorer",
    description="API para explorar, inspeccionar y analizar observaciones astronómicas de SPHEREx",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=obtener_origenes_cors(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inyección de dependencias
repositorio = RepositorioIrsa()
buscar_observaciones = BuscarObservaciones(repositorio)
convertir_fits_a_png = ConvertirFitsAPng(repositorio)


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
        raise _http_error(error, "consultar IRSA") from error


@app.get("/api/v1/observaciones/estructura-fits")
def obtener_estructura_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Inspecciona la estructura de un archivo FITS Multi-Extensión (MEF) de SPHEREx.
    Devuelve información sobre sus extensiones (IMAGE, FLAGS, VARIANCE, ZODI, EPSF, WCS-WAVE),
    dimensiones y tipos de datos.
    """

    try:
        resultado = buscar_observaciones.inspeccionar_fits(url_acceso)

        return {
            "total_extensiones": len(resultado),
            "extensiones": resultado
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "inspeccionar el FITS") from error


@app.get("/api/v1/observaciones/metadatos-fits")
def obtener_metadatos_fits(
    url_acceso: str = Query(
        ...,
        description="URL de acceso al archivo FITS de IRSA"
    )
):
    """
    Obtiene los metadatos científicos de un archivo FITS de SPHEREx.
    Devuelve información de sus cabeceras, parámetros WCS espaciales,
    WCS espectral (LVF / WCS-WAVE) y banderas de procesamiento.
    """

    try:
        resultado = buscar_observaciones.inspeccionar_metadatos_fits(
            url_acceso
        )

        return resultado

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "obtener metadatos FITS") from error


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

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "analizar la imagen FITS") from error


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

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "analizar la calidad del FITS") from error


@app.get("/api/v1/observaciones/imagen")
def obtener_imagen_observacion(
    fits_url: str = Query(..., description="URL del archivo FITS de SPHEREx"),
    modo: str = Query("flujo", description="Modo de visualización: 'flujo' o 'longitud_onda'")
):
    """
    Descarga un producto FITS de SPHEREx, lo normaliza y devuelve la imagen en formato PNG.
    """

    try:
        png_bytes = convertir_fits_a_png.ejecutar(url_fits=fits_url, modo=modo)
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"}
        )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "convertir el FITS a PNG") from error


def _http_error(error: Exception, operacion: str) -> HTTPException:
    """Traduce errores de infraestructura a códigos HTTP adecuados.
    Devuelve una excepción HTTP con un estado que distingue validación, ausencia, servicio externo y fallo interno.
    """
    if isinstance(error, HTTPException):
        return error
    if isinstance(error, ValueError):
        return HTTPException(status_code=400, detail=str(error))
    if isinstance(error, FileNotFoundError):
        return HTTPException(status_code=404, detail="El recurso solicitado no existe.")
    if isinstance(error, TimeoutError):
        return HTTPException(status_code=504, detail=f"Tiempo agotado al {operacion}.")
    if isinstance(error, ErrorIRSA):
        return HTTPException(status_code=502, detail=str(error))
    logger.exception("Error interno al %s.", operacion, exc_info=error)
    return HTTPException(status_code=500, detail=f"Error interno al {operacion}.")
