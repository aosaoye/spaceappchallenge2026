from pathlib import Path
import shutil

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.io import fits
from astropy.utils.data import conf
from astropy.visualization import AsinhStretch, ImageNormalize
from astropy.wcs import WCS

conf.remote_timeout = 120

OUTPUT_DIR = Path("processed")

DEFAULT_FITS_URL = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/"
    "level2/2025W41_2B/l2b-v27-2026-242/1/"
    "level2_2025W41_2B_0509_2D1_spx_l2b-v27-2026-242.fits"
)


def process_spherex(fits_url: str, output_dir: Path = OUTPUT_DIR) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Leer el MEF original
    with fits.open(fits_url, memmap=False) as hdul:
        image_hdu = hdul["IMAGE"]
        image = np.array(
            image_hdu.data,
            dtype=np.float32,
            copy=True
        )
        original_header = image_hdu.header.copy()

    if image.ndim != 2:
        raise ValueError("Se esperaba una imagen bidimensional")

    # 2. Extraer exclusivamente el WCS espacial
    spatial_wcs = WCS(
        original_header,
        relax=True
    ).celestial

    if not spatial_wcs.has_celestial:
        raise ValueError("El FITS no contiene un WCS celeste válido")

    output_header = spatial_wcs.to_header(relax=True)

    # 3. Conservar metadatos científicos relevantes
    for key in ("BUNIT", "OBSID", "DETECTOR"):
        if key in original_header:
            output_header[key] = original_header[key]

    if "DATE" in original_header:
        output_header["DATE-OBS"] = original_header["DATE"]

    obs_id = str(
        original_header.get("OBSID", "spherex")
    ).replace("/", "_")
    detector = str(
        original_header.get("DETECTOR", "unknown")
    )

    output_stem = f"{obs_id}_D{detector}"
    fits_path = output_dir / f"{output_stem}_aladin.fits"
    png_path = output_dir / f"{output_stem}_preview.png"

    # 4. Crear FITS de una sola imagen
    primary_hdu = fits.PrimaryHDU(
        data=image,
        header=output_header
    )
    primary_hdu.writeto(
        fits_path,
        overwrite=True,
        checksum=True
    )

    # 5. Preparar visualización
    valid_pixels = image[np.isfinite(image)]
    if valid_pixels.size == 0:
        raise ValueError("No hay píxeles válidos para visualizar")

    vmin, vmax = np.percentile(valid_pixels, [1, 99.5])
    norm = ImageNormalize(
        vmin=float(vmin),
        vmax=float(vmax),
        stretch=AsinhStretch()
    )

    fig, ax = plt.subplots(figsize=(10, 10))
    try:
        im = ax.imshow(
            np.ma.masked_invalid(image),
            origin="lower",
            cmap="gray",
            norm=norm
        )
        fig.colorbar(
            im,
            ax=ax,
            label=original_header.get("BUNIT", "Flux")
        )
        ax.set_title(f"SPHEREx | {obs_id} | Detector {detector}")
        ax.set_xlabel("X [pixels]")
        ax.set_ylabel("Y [pixels]")
        fig.savefig(
            png_path,
            dpi=160,
            bbox_inches="tight"
        )
    finally:
        plt.close(fig)

    # Verificar el FITS de una sola imagen generado
    with fits.open(fits_path, memmap=False) as verify_hdul:
        verify_wcs = WCS(verify_hdul[0].header, relax=True)
        crval = verify_wcs.wcs.crval
        n_hdus = len(verify_hdul)
        verified_shape = verify_hdul[0].data.shape

    return {
        "obs_id": obs_id,
        "detector": detector,
        "shape": verified_shape,
        "n_hdus": n_hdus,
        "bunit": original_header.get("BUNIT", "Flux"),
        "date_obs": output_header.get("DATE-OBS", ""),
        "ra": float(crval[0]),
        "dec": float(crval[1]),
        "vmin": float(vmin),
        "vmax": float(vmax),
        "has_celestial_wcs": bool(verify_wcs.has_celestial),
        "fits_path": str(fits_path.resolve()),
        "png_path": str(png_path.resolve()),
    }


if __name__ == "__main__":
    result = process_spherex(DEFAULT_FITS_URL)
    # Copiar también a frontend/public/processed para servir estáticamente si se requiere
    repo_root = Path(__file__).resolve().parents[2]
    public_processed = repo_root / "frontend" / "public" / "processed"
    if (repo_root / "frontend" / "public").exists():
        public_processed.mkdir(parents=True, exist_ok=True)
        shutil.copy2(result["png_path"], public_processed / Path(result["png_path"]).name)
        shutil.copy2(result["fits_path"], public_processed / Path(result["fits_path"]).name)

    print("Procesamiento completado con éxito:")
    for k, v in result.items():
        print(f"  {k}: {v}")
