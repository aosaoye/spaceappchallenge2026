
from fastapi import FastAPI
from aplicacion import BuscarObservaciones

app = FastAPI(
    title="SPHEREx Explorer",
    description="API para explorar y analizar observaciones astronómicas",
    version="1.0.0"
)

buscar_observaciones = BuscarObservaciones()


@app.get("/api/v1/estado")
async def obtener_estado():
    return {
        "estado": "funcionando",
        "proyecto": "SPHEREx Explorer"
    }


@app.get("/api/v1/observaciones")
async def obtener_observaciones():
    return buscar_observaciones.ejecutar()
