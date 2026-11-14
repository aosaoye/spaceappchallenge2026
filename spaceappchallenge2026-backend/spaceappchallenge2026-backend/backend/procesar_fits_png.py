import shutil
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.io import fits
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize

conf.remote_timeout = 120

# Archivo FITS de SPHEREx
fits_url = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/"
    "level2/2025W41_2B/l2b-v27-2026-242/1/"
    "level2_2025W41_2B_0509_2D1_spx_l2b-v27-2026-242.fits"
)

# 1. Leer la imagen científica
with fits.open(fits_url, memmap=False) as hdul:
    image = np.array(
        hdul["IMAGE"].data,
        dtype=np.float32
    )
    header = hdul["IMAGE"].header.copy()

# 2. Comprobar los datos
valid_pixels = image[np.isfinite(image)]

if valid_pixels.size == 0:
    raise ValueError("La imagen no contiene píxeles válidos")

# 3. Calcular límites de visualización
vmin, vmax = np.percentile(
    valid_pixels,
    [1, 99.5]
)

# 4. Normalizar para visualización
norm = ImageNormalize(
    vmin=vmin,
    vmax=vmax,
    stretch=AsinhStretch()
)

# 5. Crear la imagen
fig, ax = plt.subplots(figsize=(10, 10))

im = ax.imshow(
    np.ma.masked_invalid(image),
    origin="lower",
    cmap="gray",
    norm=norm
)

# 6. Barra de intensidad
fig.colorbar(
    im,
    ax=ax,
    label=header.get("BUNIT", "Flux")
)

# 7. Información de la observación
detector = header.get("DETECTOR", "Unknown")
obsid = header.get("OBSID", "Unknown")

ax.set_title(
    f"SPHEREx | {obsid} | Detector {detector}"
)

ax.set_xlabel("X [pixels]")
ax.set_ylabel("Y [pixels]")

# 8. Exportar imagen
output_path = Path(__file__).resolve().parent / "spherex_D1_preview.png"
fig.savefig(
    output_path,
    dpi=160,
    bbox_inches="tight"
)
plt.close(fig)

# Copiar también a la raíz y a frontend/public para servirla en Next.js
repo_root = Path(__file__).resolve().parents[3]
shutil.copy2(output_path, repo_root / "spherex_D1_preview.png")
frontend_public = repo_root / "frontend" / "public" / "spherex_D1_preview.png"
if frontend_public.parent.exists():
    shutil.copy2(output_path, frontend_public)

print("Imagen generada correctamente")
print("Ruta:", output_path)
print("Dimensiones:", image.shape)
print("Detector:", detector)
print("OBSID:", obsid)
print("BUNIT:", header.get("BUNIT", "Flux"))
print("CRVAL (RA, DEC):", header.get("CRVAL1"), header.get("CRVAL2"))
print("Rango visual:", float(vmin), float(vmax))
