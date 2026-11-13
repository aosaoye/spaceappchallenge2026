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