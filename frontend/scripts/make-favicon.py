"""Generate favicon + PWA icons (Android/iOS) from aerion_1000x1000.png.

Source is a transparent 1000×1000 wordmark. At favicon / home-screen sizes the
full wordmark is unreadable, so we crop the rocket mark (top of the asset) and
place it in a square with padding.

Outputs (frontend/public):
  favicon.ico, favicon-16.png, favicon-32.png
  logo192.png, logo512.png              — purpose "any" (transparent)
  logo192-maskable.png, logo512-maskable.png — Android adaptive (solid bg)
  apple-touch-icon.png                  — iOS home screen 180×180 (solid bg)
  logo_aerion.png                       — full source wordmark copy
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]  # repo root
PUBLIC = Path(__file__).resolve().parents[1] / "public"
SRC_CANDIDATES = [
    ROOT / "aerion_1000x1000.png",
    PUBLIC / "logo_aerion.png",
]

# Matches manifest theme_color / background_color
BG = (10, 13, 20, 255)  # #0a0d14


def load_source() -> Image.Image:
    for path in SRC_CANDIDATES:
        if path.is_file():
            print("source:", path)
            return Image.open(path).convert("RGBA")
    raise FileNotFoundError(
        "No source logo found. Expected one of:\n  "
        + "\n  ".join(str(p) for p in SRC_CANDIDATES)
    )


def extract_mark(im: Image.Image) -> Image.Image:
    """Crop only the rocket symbol (above the AERION wordmark).

    Layout of aerion_1000x1000.png (approx y ranges on 1000px canvas):
      rocket tip + body  ~200–360
      AERION             ~440–580
      TECHNOLOGIES       ~630–680
    We take content above the large wordmark band.
    """
    alpha = im.split()[-1]
    # Flattened export fallback
    if alpha.getextrema() == (255, 255):
        gray = im.convert("L")
        mask = gray.point(lambda p: 0 if p < 8 or p > 245 else 255)
        im = im.copy()
        im.putalpha(mask)
        alpha = im.split()[-1]

    w, h = im.size
    # Per-row alpha occupancy → find content rows
    # Rocket sits in the upper content; wordmark is much wider (many px/row).
    # Cut at the first large gap after a narrow-content band, or at 42% height.
    row_counts = []
    for y in range(h):
        # count non-transparent-ish pixels on this row
        row = alpha.crop((0, y, w, y + 1))
        # getbbox None => empty row
        row_counts.append(0 if row.getbbox() is None else 1)

    # Find first content row
    first = next((i for i, c in enumerate(row_counts) if c), 0)
    # Find first multi-row gap (empty run ≥ 20px) after some content
    cut = int(h * 0.42)
    empty_run = 0
    saw_content = False
    for y in range(first, h):
        if row_counts[y]:
            saw_content = True
            empty_run = 0
        else:
            empty_run += 1
            if saw_content and empty_run >= 20:
                cut = y - empty_run + 1  # end of content before gap
                break

    crop = im.crop((0, 0, w, max(first + 1, cut)))
    bbox = crop.split()[-1].getbbox()
    if bbox:
        crop = crop.crop(bbox)
    return crop


def fit_square(
    im: Image.Image,
    size: int,
    pad_ratio: float = 0.14,
    background: tuple | None = None,
) -> Image.Image:
    """Contain mark in size×size. Transparent by default; solid bg optional."""
    if background is None:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (size, size), background)
    max_inner = max(1, int(size * (1 - 2 * pad_ratio)))
    w, h = im.size
    scale = min(max_inner / w, max_inner / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    canvas.paste(resized, (x, y), resized)
    return canvas


def main() -> None:
    full = load_source()
    print("source size:", full.size)

    # Keep a canonical full logo in public/
    full_path = PUBLIC / "logo_aerion.png"
    full.save(full_path, format="PNG", optimize=True)
    print("wrote", full_path, full_path.stat().st_size, "bytes")

    mark = extract_mark(full)
    print("mark size:", mark.size)

    # Multi-size ICO
    master = fit_square(mark, 256, pad_ratio=0.12)
    ico_path = PUBLIC / "favicon.ico"
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)]
    master.save(ico_path, format="ICO", sizes=ico_sizes)
    print("wrote", ico_path, ico_path.stat().st_size, "bytes")

    fit_square(mark, 16, pad_ratio=0.10).save(
        PUBLIC / "favicon-16.png", format="PNG", optimize=True
    )
    fit_square(mark, 32, pad_ratio=0.12).save(
        PUBLIC / "favicon-32.png", format="PNG", optimize=True
    )
    print("wrote favicon-16.png, favicon-32.png")

    # PWA "any" — transparent (Android/Chrome, notifications)
    for size, name, pad in (
        (192, "logo192.png", 0.16),
        (512, "logo512.png", 0.16),
    ):
        path = PUBLIC / name
        fit_square(mark, size, pad_ratio=pad).save(path, format="PNG", optimize=True)
        print("wrote", path, path.stat().st_size)

    # Android adaptive / maskable — solid bg, mark inside safe zone (~80%)
    # pad_ratio 0.18 → mark within ~64% of canvas (inside 80% safe zone)
    for size, name in (
        (192, "logo192-maskable.png"),
        (512, "logo512-maskable.png"),
    ):
        path = PUBLIC / name
        fit_square(mark, size, pad_ratio=0.20, background=BG).save(
            path, format="PNG", optimize=True
        )
        print("wrote", path, path.stat().st_size)

    # iOS home screen — apple-touch-icon must be opaque (iOS ignores alpha)
    apple = PUBLIC / "apple-touch-icon.png"
    fit_square(mark, 180, pad_ratio=0.16, background=BG).save(
        apple, format="PNG", optimize=True
    )
    print("wrote", apple, apple.stat().st_size)

    ico = Image.open(ico_path)
    print("ico reported size:", ico.size, "frames:", getattr(ico, "n_frames", 1))
    print("done")


if __name__ == "__main__":
    main()
