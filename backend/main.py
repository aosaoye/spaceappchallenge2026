import base64
import binascii
import logging
import os

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from aplicacion import (
    BuscarCuboHips5,
    BuscarObservaciones,
    ConsultarPanStarrs,
    ConvertirFitsAPng,
    ExtraerRecorteFits,
    ResolverCoordenadasImagen,
)
from configuracion import obtener_origenes_cors
from infraestructura import ErrorAstrometry, ErrorIRSA, RepositorioIrsa

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
    allow_origin_regex=r"https://(aosaoye\.github\.io|spaceappchallenge2026(-[a-z0-9-]+)?\.vercel\.app)",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inyección de dependencias
repositorio = RepositorioIrsa()
buscar_observaciones = BuscarObservaciones(repositorio)
buscar_cubo_hips5 = BuscarCuboHips5(repositorio)
consultar_panstarrs = ConsultarPanStarrs(repositorio)
convertir_fits_a_png = ConvertirFitsAPng(repositorio)
extraer_recorte_fits = ExtraerRecorteFits(repositorio)
resolver_coordenadas_imagen = ResolverCoordenadasImagen(repositorio)


class ResolverImagenPayload(BaseModel):
    """Cuerpo JSON para resolver coordenadas a partir de una imagen en base64."""

    archivo_base64: str
    nombre_archivo: str = "cielo.png"
    astrometry_api_key: str | None = None


@app.api_route("/", methods=["GET", "HEAD"])
def raiz():
    """Responde en la raíz para verificaciones de salud por defecto (GET y HEAD /)."""
    return {
        "estado": "funcionando",
        "proyecto": "SPHEREx Explorer",
        "docs": "/docs",
    }


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
    radio: float = Query(1, gt=0, le=3600),
    respaldo_hips5: bool = Query(
        False,
        description="Si es true, recurre automáticamente a SPHEREx DR1 HiPS5 cuando SIA falla o devuelve vacío.",
    ),
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
        if respaldo_hips5 and not resultados:
            hips_resultados = buscar_cubo_hips5.ejecutar(
                ascension_recta=ascension_recta,
                declinacion=declinacion,
            )
            return {
                "total": len(hips_resultados),
                "fuente": "spherex_dr1_hips5",
                "observaciones": hips_resultados,
            }

        return {
            "total": len(resultados),
            "observaciones": resultados
        }

    except ErrorIRSA as error:
        if respaldo_hips5:
            try:
                hips_resultados = buscar_cubo_hips5.ejecutar(
                    ascension_recta=ascension_recta,
                    declinacion=declinacion,
                )
                return {
                    "total": len(hips_resultados),
                    "fuente": "spherex_dr1_hips5",
                    "observaciones": hips_resultados,
                }
            except Exception:
                pass
        raise _http_error(error, "consultar IRSA") from error
    except Exception as error:
        raise _http_error(error, "consultar IRSA") from error


@app.get("/api/v1/observaciones/hips5")
def obtener_observaciones_hips5(
    ascension_recta: float = Query(..., ge=0, le=360),
    declinacion: float = Query(..., ge=-90, le=90)
):
    """
    Resuelve directamente productos espectrales reales de SPHEREx DR1 (cubos HiPS5 Norder=5)
    para unas coordenadas (RA, Dec) mediante acceso directo IBE/S3 sin depender del proxy SIA/TAP.
    """

    try:
        resultados = buscar_cubo_hips5.ejecutar(
            ascension_recta=ascension_recta,
            declinacion=declinacion,
        )
        return {
            "total": len(resultados),
            "fuente": "spherex_dr1_hips5",
            "observaciones": resultados,
        }
    except Exception as error:
        raise _http_error(error, "consultar el archivo HiPS5 de SPHEREx DR1") from error


@app.get("/api/v1/observaciones/panstarrs")
def obtener_panstarrs(
    ra: float = Query(..., ge=0, le=360),
    dec: float = Query(..., ge=-90, le=90),
    fov_arcsec: float = Query(60.0, gt=0, le=3600),
    type: str = Query("stack", description="Tipo de producto Pan-STARRS1: 'stack' o 'warp'")
):
    """
    Consulta imágenes ópticas de comparación Pan-STARRS1 DR2 desde el backend.
    """

    try:
        return consultar_panstarrs.ejecutar(
            ascension_recta=ra,
            declinacion=dec,
            fov_arcsec=fov_arcsec,
            tipo_archivo=type,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise _http_error(error, "consultar Pan-STARRS1") from error


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


@app.get("/api/v1/observaciones/recorte-fits")
def obtener_recorte_fits(
    fits_url: str = Query(..., description="URL del archivo FITS de SPHEREx"),
    ra: float | None = Query(None, ge=0, le=360, description="Ascensión Recta central en grados"),
    dec: float | None = Query(None, ge=-90, le=90, description="Declinación central en grados"),
    fov_arcsec: float = Query(600.0, gt=10, le=14400, description="Campo de visión solicitado en arcosegundos"),
    tamano_px: int = Query(280, ge=64, le=384, description="Resolución máxima de la matriz de salida")
):
    """
    Extrae un recorte real en float32 desde la extensión IMAGE de un FITS,
    alineado al cielo mediante su WCS para alimentar el visor interactivo.
    """

    try:
        return extraer_recorte_fits.ejecutar(
            url_fits=fits_url,
            ascension_recta=ra,
            declinacion=dec,
            fov_arcsec=fov_arcsec,
            tamano_px=tamano_px,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "extraer el recorte FITS") from error


@app.post("/api/v1/observaciones/resolver-imagen")
def resolver_imagen_cielo(payload: ResolverImagenPayload):
    """
    Extrae coordenadas celestes (RA, Dec, FOV) a partir de una imagen FITS, JPG o PNG.
    """

    try:
        datos_b64 = payload.archivo_base64.strip()
        if "," in datos_b64 and datos_b64.startswith("data:"):
            datos_b64 = datos_b64.split(",", 1)[1]
        if len(datos_b64) > 36_000_000:
            raise ValueError("La imagen supera el tamaño máximo permitido (25 MB).")
        try:
            contenido = base64.b64decode(datos_b64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("El contenido de imagen base64 no es válido.") from error

        return resolver_coordenadas_imagen.ejecutar(
            contenido=contenido,
            nombre_archivo=payload.nombre_archivo,
            astrometry_api_key=payload.astrometry_api_key,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    except Exception as error:
        raise _http_error(error, "resolver las coordenadas de la imagen") from error


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
    if isinstance(error, (ErrorIRSA, ErrorAstrometry)):
        return HTTPException(status_code=502, detail=str(error))
    logger.exception("Error interno al %s.", operacion, exc_info=error)
    return HTTPException(status_code=500, detail=f"Error interno al {operacion}.")
