"""Configuración central del backend SPHEREx."""

import os


def obtener_entero(nombre: str, valor_predeterminado: int, minimo: int = 1) -> int:
    """Lee un entero positivo desde el entorno.
    Devuelve el valor configurado o el valor predeterminado validado.
    """
    try:
        valor = int(os.getenv(nombre, str(valor_predeterminado)))
    except ValueError:
        return valor_predeterminado
    return valor if valor >= minimo else valor_predeterminado


def obtener_origenes_cors() -> list[str]:
    """Lee los orígenes CORS permitidos desde el entorno.
    Devuelve una lista de orígenes sin espacios ni elementos vacíos.
    """
    valor = os.getenv(
        "SPHEREX_CORS_ORIGINS",
        "https://aosaoye.github.io,https://spaceappchallenge2026.vercel.app,http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origen.strip() for origen in valor.split(",") if origen.strip()]
