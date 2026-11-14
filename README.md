<<<<<<< HEAD
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
=======
# spaceappchallenge2026
spherex-explorer/
│
├── backend/
│   ├── src/
│   │   └── spherex/
│   │       │
│   │       ├── domain/
│   │       │   ├── entities/
│   │       │   │   ├── observation.py
│   │       │   │   └── candidate.py
│   │       │   │
│   │       │   ├── value_objects/
│   │       │   │   ├── coordinates.py
│   │       │   │   └── sky_region.py
│   │       │   │
│   │       │   └── exceptions/
│   │       │       └── domain_exceptions.py
│   │       │
│   │       ├── application/
│   │       │   ├── ports/
│   │       │   │   ├── input/
│   │       │   │   │   ├── search_observations.py
│   │       │   │   │   └── detect_candidates.py
│   │       │   │   │
│   │       │   │   └── output/
│   │       │   │       ├── observation_repository.py
│   │       │   │       └── image_processor.py
│   │       │   │
│   │       │   └── use_cases/
│   │       │       ├── search_observations_use_case.py
│   │       │       └── detect_candidates_use_case.py
│   │       │
│   │       ├── infrastructure/
│   │       │   ├── adapters/
│   │       │   │   ├── input/
│   │       │   │   │   └── api/
│   │       │   │   │       ├── routes/
│   │       │   │   │       │   ├── observations.py
│   │       │   │   │       │   └── candidates.py
│   │       │   │   │       └── schemas/
│   │       │   │   │           └── observation_schema.py
│   │       │   │   │
│   │       │   │   └── output/
│   │       │   │       ├── irsa/
│   │       │   │       │   └── irsa_adapter.py
│   │       │   │       │
│   │       │   │       └── scientific/
│   │       │   │           ├── fits_adapter.py
│   │       │   │           └── image_processing_adapter.py
│   │       │   │
│   │       │   └── config/
│   │       │       └── settings.py
│   │       │
│   │       └── main.py
│   │
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   │
│   ├── requirements.txt
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── SkyViewer/
│   │   │   ├── ImageComparator/
│   │   │   ├── CandidateList/
│   │   │   └── CandidateDetails/
│   │   │
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── App.tsx
│   │
│   └── package.json
│
├── docs/
│   ├── architecture.md
│   └── api.md
│
├── .gitignore
└── README.md
>>>>>>> cd48368 (Primer commit)
