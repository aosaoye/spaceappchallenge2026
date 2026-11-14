# SPHEREx Time Viewer

Visor web para explorar una región del cielo y comparar observaciones de SPHEREx en distintas fechas y bandas, inspirado en el flujo de uso de WiseView.

## Estructura

```text
.
├── data/                 # Datos FITS originales y muestras pequeñas
├── backend/              # API Python (FastAPI)
├── frontend/             # Interfaz React + TypeScript
├── notebooks/            # Exploración y preparación de datos
└── index.ipynb           # Notebook existente del equipo
```

## Requisitos

- Node.js 20 o superior
- Python 3.11 o superior

## Arranque

### API

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

La API queda en `http://localhost:8000`; la documentación interactiva en `/docs`.

### Interfaz

```powershell
cd frontend
npm install
npm run dev
```

## Datos

El FITS de `data/` se conserva como dato local del equipo y no se incluye en Git. Consultad su licencia, procedencia y metadatos antes de redistribuirlo. La interfaz inicial puede trabajar con imágenes de muestra; indicad siempre si una imagen o candidato es simulado.

## Flujo previsto

1. Seleccionar una región del cielo.
2. Elegir dos épocas y una banda.
3. Comparar las imágenes y revisar posibles objetos móviles.
4. Mostrar metadatos y etiquetar hallazgos como candidatos, no como descubrimientos confirmados.
