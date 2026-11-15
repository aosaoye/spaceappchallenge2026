# SPHEREx Explorer

Visor web para explorar productos públicos SPHEREx y comparar sus imágenes, bandas y metadatos. El backend principal es `backend/`; `data/spaceappchallenge2026-backend (1).zip` conserva una copia anterior con una implementación reducida y se mantiene sin extraer ni sobrescribir.

## Estructura principal

- `backend/dominio.py`: entidad `Observacion` y contrato del repositorio.
- `backend/aplicacion.py`: casos de uso.
- `backend/infraestructura.py`: consulta IRSA, descargas, lectura FITS y análisis.
- `backend/main.py`: aplicación FastAPI y endpoints.
- `backend/configuracion.py`: configuración desde variables de entorno.

## Ejecución local

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

La API queda en `http://localhost:8000` y OpenAPI en `/docs`. Para las pruebas, instala `pip install -r requirements-dev.txt` y ejecuta `python -m pytest ..\tests` desde `backend`.

## Interfaz web

```powershell
cd frontend
npm install
npm run dev
```

## Configuración

| Variable | Predeterminado | Uso |
|---|---|---|
| `SPHEREX_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Orígenes CORS separados por coma |
| `SPHEREX_TIMEOUT_DESCARGA` | `90` | Tiempo máximo por intento de descarga en segundos |
| `SPHEREX_MAX_FITS_BYTES` | `536870912` | Tamaño máximo permitido por archivo FITS |
| `SPHEREX_CACHE_FITS_BYTES` | `536870912` | Presupuesto aproximado de bytes para FITS en caché |
| `SPHEREX_CACHE_FITS` | `2` | Cantidad máxima de FITS en caché |
| `SPHEREX_CACHE_PNG` | `8` | Cantidad máxima de PNG en caché |
| `SPHEREX_FITS_LOCAL` | vacío | Ruta opcional a la muestra local conocida |
| `SPHEREX_PRECARGA_LOCAL` | `false` | Activa el procesamiento de la muestra local al arrancar |
| `SPHEREX_LOG_LEVEL` | `INFO` | Nivel de logging de Python |
| `SPHEREX_TRABAJADORES` | `1` en Docker | Procesos Uvicorn en el contenedor |

`GET /api/v1/observaciones` usa IRSA sin reducir el radio si la consulta falla. Las fechas ISO y límites `mjd_inicio`/`mjd_fin` se incluyen solo cuando IRSA proporciona metadatos temporales explícitos; de lo contrario son `null`. Los encabezados FITS se exponen en metadatos, incluido `DATE-OBS` cuando está disponible. Las imágenes están disponibles en `GET /api/v1/observaciones/imagen` con `modo=flujo` o `modo=longitud_onda` (este último requiere WCS-WAVE).

## Contenedor

```sh
docker build -t spherex-explorer-api backend
docker run --rm -p 8000:8000 -e SPHEREX_CORS_ORIGINS=http://localhost:3000 spherex-explorer-api
```

El contenedor ejecuta Uvicorn como usuario sin privilegios y comprueba `/api/v1/estado`.
