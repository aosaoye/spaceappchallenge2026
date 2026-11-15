"""Pruebas unitarias aisladas para la API y el backend SPHEREx."""

import io
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from dominio import Observacion
from infraestructura import ErrorIRSA, RepositorioIrsa
import infraestructura
import main


def _fits_bytes(incluir_calidad=True):
    """Construye un FITS pequeño y reproducible para las pruebas.
    Devuelve los bytes de un producto con IMAGE y, opcionalmente, VARIANCE y FLAGS.
    """
    cabecera = fits.Header()
    cabecera["BUNIT"] = "MJy/sr"
    cabecera["DATE-OBS"] = "2025-05-12T03:14:15.123"
    hdus = [fits.PrimaryHDU(), fits.ImageHDU(np.array([[1.0, np.nan], [3.0, 4.0]]), header=cabecera, name="IMAGE")]
    if incluir_calidad:
        hdus.extend([
            fits.ImageHDU(np.array([[1.0, -1.0], [np.inf, 4.0]]), name="VARIANCE"),
            fits.ImageHDU(np.array([[0, 1], [1, 3]], dtype=np.uint16), name="FLAGS"),
        ])
    salida = io.BytesIO()
    fits.HDUList(hdus).writeto(salida)
    return salida.getvalue()


def test_creacion_observacion_conserva_fecha_opcional():
    """Comprueba la entidad de dominio con una fecha real y opcional.
    Devuelve None cuando la construcción de la entidad es válida.
    """
    observacion = Observacion("id", 10.0, -2.0, "dr1", "1", "image", "https://irsa.ipac.caltech.edu/a.fits", None, fecha_observacion="2025-05-12")
    assert observacion.fecha_observacion == "2025-05-12"


def test_validacion_coordenadas_y_radio():
    """Comprueba que el repositorio rechaza coordenadas fuera de rango.
    Devuelve None cuando ambos casos producen ValueError.
    """
    repo = RepositorioIrsa()
    with pytest.raises(ValueError):
        repo.buscar_por_coordenadas(361, 0, 1)
    with pytest.raises(ValueError):
        repo.buscar_por_coordenadas(0, 0, 0)


def test_consulta_irsa_no_cambia_radio_ante_fallo(monkeypatch):
    """Comprueba que un fallo de IRSA no lanza una consulta con radio distinto.
    Devuelve None cuando se conserva el fallo y solo se intenta una consulta.
    """
    llamadas = []
    def fallar(*args, **kwargs):
        """Simula un fallo de red IRSA.
        Devuelve una excepción de conexión para activar el caso de error.
        """
        llamadas.append(kwargs)
        raise OSError("sin conexión")
    monkeypatch.setattr(infraestructura.Irsa, "query_sia", fallar)
    repo = RepositorioIrsa()
    with pytest.raises(ErrorIRSA):
        repo.buscar_por_coordenadas(10, 20, 30)
    assert len(llamadas) == 1


def test_resultados_vacios_y_fecha_mjd(monkeypatch):
    """Comprueba una búsqueda vacía y conversión de una fecha MJD explícita.
    Devuelve None cuando no se fabrican observaciones ni fechas sin metadatos temporales.
    """
    monkeypatch.setattr(infraestructura.Irsa, "query_sia", lambda *args, **kwargs: [])
    repo = RepositorioIrsa()
    assert repo.buscar_por_coordenadas(10, 20, 30) == []
    fecha = repo._fecha_fila({"MJD-OBS": 60000.25})
    assert fecha == "2023-02-25T06:00:00.000"
    assert repo._fecha_fila({"obs_id": "sin-fecha"}) is None
    assert repo._fecha_fila({"t_min": 60000.0, "t_max": 60000.5}) == "2023-02-25T00:00:00.000"
    assert repo._mjd_fila({"t_min": 60000.0, "t_max": 60000.5}, final=True) == 60000.5


def test_busqueda_conserva_productos_compartiendo_identificador(monkeypatch):
    """Comprueba que se conservan productos distintos con un obs_id compartido.
    Devuelve None cuando cada producto mantiene su propia banda y sus fechas SIA.
    """
    fila_base = {
        "obs_id": "misma-observacion", "s_ra": 10.0, "s_dec": 20.0,
        "obs_collection": "spherex_dr1", "dataproduct_subtype": "image",
        "access_url": "https://irsa.ipac.caltech.edu/a.fits", "access_estsize": 100,
        "t_min": 60000.0, "t_max": 60000.5,
    }
    filas = [dict(fila_base, energy_bandpassname="Band 1"), dict(fila_base, energy_bandpassname="Band 2", access_url="https://irsa.ipac.caltech.edu/b.fits")]
    monkeypatch.setattr(infraestructura.Irsa, "query_sia", lambda *args, **kwargs: filas)
    observaciones = RepositorioIrsa().buscar_por_coordenadas(10, 20, 30)
    assert len(observaciones) == 2
    assert [item.banda_espectral for item in observaciones] == ["Band 1", "Band 2"]
    assert observaciones[0].mjd_inicio == 60000.0 and observaciones[0].mjd_fin == 60000.5


def test_cache_fits_reutiliza_bytes(monkeypatch):
    """Comprueba que los bytes descargados se reutilizan desde la caché.
    Devuelve None cuando dos lecturas consecutivas realizan una sola descarga.
    """
    repo = RepositorioIrsa(max_cache_fits=1)
    llamadas = []
    def descargar(url, ruta):
        """Simula la descarga de un FITS.
        Devuelve bytes constantes para comprobar la reutilización en caché.
        """
        llamadas.append(url)
        return b"SIMPLE  "
    monkeypatch.setattr(repo, "_descargar_bytes_fits_worker", descargar)
    url = "https://irsa.ipac.caltech.edu/cache.fits"
    assert repo._obtener_bytes_fits_con_deduplicacion(url) == repo._obtener_bytes_fits_con_deduplicacion(url)
    assert len(llamadas) == 1


def test_calidad_falla_si_faltan_extensiones(monkeypatch):
    """Comprueba el error controlado cuando no existen VARIANCE y FLAGS.
    Devuelve None cuando el FITS incompleto se rechaza con ValueError.
    """
    repo = RepositorioIrsa()
    monkeypatch.setattr(repo, "_obtener_bytes_fits_con_deduplicacion", lambda url: _fits_bytes(incluir_calidad=False))
    with pytest.raises(ValueError, match="VARIANCE o FLAGS"):
        repo.analizar_calidad_fits("https://irsa.ipac.caltech.edu/sin-calidad.fits")


def test_deduplicacion_concurrente_comparte_descarga(monkeypatch):
    """Comprueba que solicitudes simultáneas comparten una sola descarga.
    Devuelve None cuando todas las solicitudes reciben los mismos bytes.
    """
    repo = RepositorioIrsa()
    total = 0
    candado = threading.Lock()
    def descargar(url, ruta):
        """Simula una descarga FITS lenta.
        Devuelve los mismos bytes para cada participante del vuelo compartido.
        """
        nonlocal total
        with candado:
            total += 1
        time.sleep(0.08)
        return b"SIMPLE  "
    monkeypatch.setattr(repo, "_descargar_bytes_fits_worker", descargar)
    with ThreadPoolExecutor(max_workers=8) as pool:
        resultados = list(pool.map(lambda _: repo._obtener_bytes_fits_con_deduplicacion("https://irsa.ipac.caltech.edu/a.fits"), range(8)))
    assert resultados == [b"SIMPLE  "] * 8
    assert total == 1


def test_analisis_png_y_modo_longitud_onda(monkeypatch):
    """Comprueba lectura de FITS, métricas, PNG y control de WCS-WAVE ausente.
    Devuelve None cuando la imagen PNG es válida y el modo espectral falla claramente.
    """
    repo = RepositorioIrsa()
    datos = _fits_bytes()
    monkeypatch.setattr(repo, "_obtener_bytes_fits_con_deduplicacion", lambda url: datos)
    analisis = repo.analizar_imagen_fits("https://irsa.ipac.caltech.edu/a.fits")
    assert analisis["pixeles_validos"] == 3
    calidad = repo.analizar_calidad_fits("https://irsa.ipac.caltech.edu/a.fits")
    assert calidad["varianza"]["varianzas_negativas"] == 1
    assert repo.obtener_metadatos_fits("https://irsa.ipac.caltech.edu/a.fits")["fecha_observacion"] == "2025-05-12T03:14:15.123"
    png = repo.convertir_fits_a_png("https://irsa.ipac.caltech.edu/a.fits")
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    from matplotlib import image as imagen_matplotlib
    assert imagen_matplotlib.imread(io.BytesIO(png), format="png").ndim == 3
    with pytest.raises(ValueError, match="WCS-WAVE"):
        repo.convertir_fits_a_png("https://irsa.ipac.caltech.edu/a.fits", "longitud_onda")


def test_validacion_url_y_modo_png():
    """Comprueba que las URL no HTTPS ni los modos desconocidos se rechazan.
    Devuelve None cuando las entradas no autorizadas producen ValueError.
    """
    repo = RepositorioIrsa()
    with pytest.raises(ValueError):
        repo._descargar_bytes_fits_worker("http://127.0.0.1/secreto", None)
    with pytest.raises(ValueError):
        repo.convertir_fits_a_png("https://irsa.ipac.caltech.edu/a.fits", "inventado")


def test_api_estado_y_parametros_invalidos():
    """Comprueba el endpoint de estado y la validación automática de parámetros.
    Devuelve None cuando FastAPI responde 200 y 422 respectivamente.
    """
    cliente = TestClient(main.app)
    assert cliente.get("/api/v1/estado").status_code == 200
    assert cliente.get("/api/v1/observaciones?ascension_recta=400&declinacion=0").status_code == 422


def test_endpoints_api_con_respuestas_simuladas(monkeypatch):
    """Comprueba los endpoints de búsqueda e inspección con dependencias simuladas.
    Devuelve None cuando las respuestas conservan sus tipos JSON y de imagen.
    """
    cliente = TestClient(main.app)
    monkeypatch.setattr(main.buscar_observaciones, "ejecutar", lambda **kwargs: [])
    monkeypatch.setattr(main.buscar_observaciones, "inspeccionar_fits", lambda url: [{"nombre": "IMAGE"}])
    monkeypatch.setattr(main.buscar_observaciones, "inspeccionar_metadatos_fits", lambda url: {"fecha": None})
    monkeypatch.setattr(main.buscar_observaciones, "analizar_imagen_fits", lambda url: {"pixeles_validos": 1})
    monkeypatch.setattr(main.buscar_observaciones, "analizar_calidad_fits", lambda url: {"flags": []})
    monkeypatch.setattr(main.convertir_fits_a_png, "ejecutar", lambda **kwargs: b"\x89PNG\r\n\x1a\n")
    assert cliente.get("/api/v1/observaciones?ascension_recta=10&declinacion=0").json() == {"total": 0, "observaciones": []}
    parametros = "?url_acceso=https%3A%2F%2Firsa.ipac.caltech.edu%2Fa.fits"
    assert cliente.get("/api/v1/observaciones/estructura-fits" + parametros).status_code == 200
    assert cliente.get("/api/v1/observaciones/metadatos-fits" + parametros).json() == {"fecha": None}
    assert cliente.get("/api/v1/observaciones/analisis-fits" + parametros).status_code == 200
    assert cliente.get("/api/v1/observaciones/analisis-calidad-fits" + parametros).status_code == 200
    imagen = cliente.get("/api/v1/observaciones/imagen?fits_url=https%3A%2F%2Firsa.ipac.caltech.edu%2Fa.fits")
    assert imagen.status_code == 200 and imagen.headers["content-type"] == "image/png"


def test_error_irsa_devuelve_502(monkeypatch):
    """Comprueba que el fallo del servicio externo se traduce a HTTP 502.
    Devuelve None cuando la API informa del error externo con un estado específico.
    """
    cliente = TestClient(main.app)
    monkeypatch.setattr(main.buscar_observaciones, "ejecutar", lambda **kwargs: (_ for _ in ()).throw(ErrorIRSA("IRSA no disponible")))
    respuesta = cliente.get("/api/v1/observaciones?ascension_recta=10&declinacion=0")
    assert respuesta.status_code == 502
