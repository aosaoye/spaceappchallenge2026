from pathlib import Path
import sys

# Reutiliza el módulo principal en services/science-api/process_spherex.py
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "services" / "science-api"))

from process_spherex import DEFAULT_FITS_URL, OUTPUT_DIR, process_spherex  # noqa: E402

if __name__ == "__main__":
    result = process_spherex(DEFAULT_FITS_URL, output_dir=REPO_ROOT / "processed")
    print("Procesamiento completado con éxito:")
    for k, v in result.items():
        print(f"  {k}: {v}")
