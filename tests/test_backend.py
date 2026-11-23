"""Pruebas unitarias aisladas para la API y el backend SPHEREx."""

import base64
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


def _fits_con_wcs_bytes(ra: float = 133.795, dec: float = -7.245) -> bytes:
    """Construye un archivo FITS mínimo con cabecera WCS celestial válida para pruebas."""
    cabecera = fits.Header()
    cabecera["OBJECT"] = "WISE 0855"
    cabecera["CTYPE1"] = "RA---TAN"
    cabecera["CTYPE2"] = "DEC--TAN"
    cabecera["CRPIX1"] = 10.5
    cabecera["CRPIX2"] = 10.5
    cabecera["CRVAL1"] = ra
    cabecera["CRVAL2"] = dec
    cabecera["CDELT1"] = -2.0 / 3600.0
    cabecera["CDELT2"] = 2.0 / 3600.0
    hdu = fits.PrimaryHDU(np.ones((20, 20), dtype=np.float32), header=cabecera)
    salida = io.BytesIO()
    fits.HDUList([hdu]).writeto(salida)
    return salida.getvalue()


def test_resolver_coordenadas_fits_wcs_local():
    """Comprueba que un FITS con cabecera WCS se resuelve localmente sin API externa."""
    repo = RepositorioIrsa()
    res = repo.resolver_coordenadas_imagen(_fits_con_wcs_bytes(133.795, -7.245), "muestra.fits")
    assert res["metodo"] == "fits-wcs"
    assert abs(res["ra_deg"] - 133.795) < 0.01
    assert abs(res["dec_deg"] - (-7.245)) < 0.01
    assert res["pixscale_arcsec"] == pytest.approx(2.0, rel=1e-2)
    assert res["objeto_detectado"] == "WISE 0855"


def test_resolver_imagen_jpg_sin_clave_astrometry(monkeypatch):
    """Comprueba el mensaje claro cuando se sube JPG/PNG sin ASTROMETRY_API_KEY."""
    monkeypatch.delenv("ASTROMETRY_API_KEY", raising=False)
    monkeypatch.delenv("SPHEREX_ASTROMETRY_API_KEY", raising=False)
    cliente = TestClient(main.app)
    resp = cliente.post(
        "/api/v1/observaciones/resolver-imagen",
        json={
            "archivo_base64": base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode("ascii"),
            "nombre_archivo": "orion.png",
        },
    )
    assert resp.status_code == 400
    assert "ASTROMETRY_API_KEY" in resp.json()["detail"]


def test_resolver_imagen_astrometry_simulado(monkeypatch):
    """Comprueba el flujo completo de plate solving con Astrometry.net simulado."""
    repo = RepositorioIrsa()
    monkeypatch.setattr(repo, "_astrometry_post_json", lambda url, payload: {"status": "success", "session": "ses-1"})
    monkeypatch.setattr(repo, "_astrometry_subir_archivo", lambda *args, **kwargs: {"status": "success", "subid": 42})

    def fake_get(url: str) -> dict:
        if url.endswith("/submissions/42"):
            return {"jobs": [777]}
        if url.endswith("/jobs/777"):
            return {"status": "success"}
        if url.endswith("/jobs/777/calibration/"):
            return {"ra": 83.822, "dec": -5.391, "radius": 0.05, "pixscale": 1.2, "orientation": 15.0}
        if url.endswith("/jobs/777/objects_in_field/"):
            return {"objects_in_field": ["M 42", "NGC 1976"]}
        return {}

    monkeypatch.setattr(repo, "_astrometry_get_json", fake_get)
    res = repo.resolver_coordenadas_imagen(b"fake-jpg", "orion.jpg", astrometry_api_key="test-key")
    assert res["metodo"] == "astrometry.net"
    assert res["ra_deg"] == pytest.approx(83.822, abs=1e-4)
    assert res["dec_deg"] == pytest.approx(-5.391, abs=1e-4)
    assert res["fov_arcsec"] == pytest.approx(360.0, rel=1e-2)
    assert res["objetos_en_campo"] == ["M 42", "NGC 1976"]

    cliente = TestClient(main.app)
    monkeypatch.setattr(main.resolver_coordenadas_imagen, "ejecutar", lambda **kwargs: res)
    resp = cliente.post(
        "/api/v1/observaciones/resolver-imagen",
        json={
            "archivo_base64": base64.b64encode(_fits_con_wcs_bytes()).decode("ascii"),
            "nombre_archivo": "orion.fits",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["metodo"] == "astrometry.net"


def test_obtener_recorte_fits_wcs_real(monkeypatch):
    """Verifica que obtener_recorte_fits extrae flujo real centrado por WCS desde IMAGE."""
    cabecera = fits.Header()
    cabecera["OBSID"] = "2025W19_TEST"
    cabecera["DETECTOR"] = 2
    cabecera["BUNIT"] = "MJy/sr"
    cabecera["CTYPE1"] = "RA---TAN"
    cabecera["CTYPE2"] = "DEC--TAN"
    cabecera["CRPIX1"] = 41.0
    cabecera["CRPIX2"] = 41.0
    cabecera["CRVAL1"] = 133.795
    cabecera["CRVAL2"] = -7.245
    cabecera["CDELT1"] = -6.0 / 3600.0
    cabecera["CDELT2"] = 6.0 / 3600.0

    imagen = np.ones((81, 81), dtype=np.float32)
    imagen[40, 40] = 120.0
    imagen[39:42, 39:42] = np.maximum(imagen[39:42, 39:42], 40.0)

    repo = RepositorioIrsa()
    monkeypatch.setattr(repo, "descargar_fits", lambda url: fits.HDUList([fits.PrimaryHDU(imagen.copy(), header=cabecera.copy())]))

    res = repo.obtener_recorte_fits(
        url_fits="https://irsa.test/spherex.fits",
        ascension_recta=133.795,
        declinacion=-7.245,
        fov_arcsec=180.0,
        tamano_px=64,
    )
    assert res["cobertura_wcs"] is True
    assert res["ancho"] == 64
    assert res["alto"] == 64
    assert res["unidad"] == "MJy/sr"
    arr = np.frombuffer(base64.b64decode(res["datos_f32_b64"]), dtype="<f4").reshape(res["alto"], res["ancho"])
    assert float(arr[32, 32]) > 35.0
    assert float(arr[2, 2]) == pytest.approx(1.0, abs=0.05)


def test_obtener_recorte_fits_sin_solapamiento_y_endpoint(monkeypatch):
    """Comprueba respaldo de cuadro completo cuando WCS no solapa y el endpoint HTTP."""
    repo = RepositorioIrsa()
    monkeypatch.setattr(repo, "descargar_fits", lambda url: fits.open(io.BytesIO(_fits_con_wcs_bytes(133.795, -7.245)), memmap=False))

    res = repo.obtener_recorte_fits(
        url_fits="https://irsa.test/lejano.fits",
        ascension_recta=10.0,
        declinacion=45.0,
        fov_arcsec=120.0,
        tamano_px=64,
    )
    assert res["cobertura_wcs"] is False
    assert res["pixeles_validos"] == 400

    cliente = TestClient(main.app)
    monkeypatch.setattr(main.extraer_recorte_fits, "ejecutar", lambda **kwargs: res)
    resp = cliente.get(
        "/api/v1/observaciones/recorte-fits",
        params={"fits_url": "https://irsa.test/lejano.fits", "ra": 133.795, "dec": -7.245},
    )
    assert resp.status_code == 200
    assert resp.json()["pixeles_validos"] == 400


def _cubo_hips5_bytes() -> bytes:
    """Construye un cubo HiPS5 3D (2 planos x 8 x 8) compatible con Range FITS en pruebas."""
    hdr0 = fits.Header()
    hdr0["TELESCOP"] = "SPHEREx"
    hdr0["DATE-BEG"] = "2025-08-05T06:05:48.769"
    hdr0["DATE-END"] = "2026-02-18T04:49:11.887"
    hdr0["MJD-BEG"] = 60892.25
    hdr0["MJD-END"] = 61089.20
    hdr0["BLANKCH"] = "D3:17,D4:01"

    hdr1 = fits.Header()
    hdr1["CTYPE1"] = "RA---HPX"
    hdr1["CTYPE2"] = "DEC--HPX"
    hdr1["CRPIX1"] = 4.5
    hdr1["CRPIX2"] = 4.5
    hdr1["PC1_1"] = -0.01
    hdr1["PC1_2"] = -0.01
    hdr1["PC2_1"] = 0.01
    hdr1["PC2_2"] = -0.01
    hdr1["CDELT1"] = 1.0
    hdr1["CDELT2"] = 1.0
    hdr1["CUNIT1"] = "deg"
    hdr1["CUNIT2"] = "deg"
    hdr1["CRVAL1"] = 0.0
    hdr1["CRVAL2"] = 0.0
    hdr1["PV2_1"] = 4.0
    hdr1["PV2_2"] = 3.0
    hdr1["LONPOLE"] = 0.0
    hdr1["LATPOLE"] = 90.0
    hdr1["NPIX"] = 10226
    hdr1["BUNIT"] = "MJy/sr"

    cubo = np.full((2, 8, 8), 1.5, dtype=np.float32)
    cubo[1, 3, 4] = 42.0
    salida = io.BytesIO()
    fits.HDUList([fits.PrimaryHDU(header=hdr0), fits.ImageHDU(cubo, header=hdr1, name="IMAGE")]).writeto(salida)
    return salida.getvalue()


def test_healpix_nest_5_y_hips5_range(monkeypatch):
    """Comprueba cálculo HEALPix orden 5, extracción por Range y endpoint /hips5."""
    repo = RepositorioIrsa()
    assert repo._radec_a_healpix_nest_5(133.795129, -7.245147) == 10226
    assert repo._radec_a_healpix_nest_5(248.167625, 66.754972) == 2928
    assert 0 <= repo._radec_a_healpix_nest_5(359.99, -89.9) < 12288

    datos_cubo = _cubo_hips5_bytes()
    monkeypatch.setattr(repo, "_descargar_rango_http", lambda url, ini, fin: datos_cubo[ini : fin + 1])

    obs_hips = repo.buscar_cubo_hips5(133.795129, -7.245147)
    assert len(obs_hips) == 6
    assert obs_hips[0].coleccion == "spherex_dr1_hips5"
    assert "#plane=" in obs_hips[0].url_acceso

    url_p1 = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026/Norder5/Dir10000/Npix10226_cube.fits#plane=1"
    fits_2d = repo._descargar_bytes_fits_worker(url_p1, None)
    with fits.open(io.BytesIO(fits_2d), memmap=False) as hdul:
        assert "IMAGE" in hdul
        assert hdul["IMAGE"].data.shape == (8, 8)
        assert float(hdul["IMAGE"].data[3, 4]) == pytest.approx(42.0)
        assert "CTYPE3" not in hdul["IMAGE"].header

    cliente = TestClient(main.app)
    monkeypatch.setattr(main.buscar_cubo_hips5, "ejecutar", lambda **kwargs: obs_hips)
    resp = cliente.get("/api/v1/observaciones/hips5", params={"ascension_recta": 133.795, "declinacion": -7.245})
    assert resp.status_code == 200
    assert resp.json()["fuente"] == "spherex_dr1_hips5"
    assert resp.json()["total"] == 6

    monkeypatch.setattr(
        main.buscar_observaciones,
        "ejecutar",
        lambda **kwargs: (_ for _ in ()).throw(ErrorIRSA("SIA 502")),
    )
    resp_auto = cliente.get(
        "/api/v1/observaciones",
        params={"ascension_recta": 133.795, "declinacion": -7.245, "radio": 60, "respaldo_hips5": "true"},
    )
    assert resp_auto.status_code == 200
    assert resp_auto.json()["fuente"] == "spherex_dr1_hips5"

    ps1_mock = {"ra": 133.795, "dec": -7.245, "fovArcsec": 60.0, "sizePx": 240, "type": "stack", "colorUrl": None, "ps1CutoutsWebUrl": "https://ps1images.stsci.edu/", "items": []}
    monkeypatch.setattr(main.consultar_panstarrs, "ejecutar", lambda **kwargs: ps1_mock)
    resp_ps1 = cliente.get("/api/v1/observaciones/panstarrs", params={"ra": 133.795, "dec": -7.245})
    assert resp_ps1.status_code == 200
    assert resp_ps1.json()["sizePx"] == 240
