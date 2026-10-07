# Site icon (a dark bloon on the site's yellow): web/public/favicon.svg, favicon.ico (16/32/48) and
# apple-touch-icon.png (180). One 32x32 drawing, written as SVG and rasterised with Pillow (4x supersampled).
# Run with .venv-art/Scripts/python scripts/build_icons.py
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "web" / "public"
YELLOW, NAVY = "#ffd60a", "#0c111d"

# The drawing on a 32x32 grid.
BLOON = (16, 13.5, 9, 10)  # cx, cy, rx, ry
SHINE = (12.6, 9.6, 2, 3)
KNOT = [(14, 23), (18, 23), (16, 26.6)]

def bezier(p0, p1, p2, p3, n=16):
    return [
        tuple(round((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t**3 * e, 2) for a, b, c, e in zip(p0, p1, p2, p3))
        for t in (i / n for i in range(n + 1))
    ]


STRING = bezier((16, 26.6), (14.5, 28.1), (17.5, 29.1), (16, 30.6))  # a soft S under the knot
STRING_W = 1.4


def pts(p, k=1.0) -> str:
    return " ".join(f"{x * k:g},{y * k:g}" for x, y in p)


def svg() -> str:
    def ell(e, c):
        return f'<ellipse cx="{e[0]}" cy="{e[1]}" rx="{e[2]}" ry="{e[3]}" fill="{c}"/>'

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<rect width="32" height="32" fill="{YELLOW}"/>{ell(BLOON, NAVY)}'
        f'<polygon points="{pts(KNOT)}" fill="{NAVY}"/>'
        f'<polyline points="{pts(STRING)}" fill="none" stroke="{NAVY}" stroke-width="{STRING_W}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>{ell(SHINE, YELLOW)}</svg>\n'
    )


def png(px: int) -> Image.Image:
    k = px * 4 / 32
    img = Image.new("RGB", (px * 4, px * 4), YELLOW)
    d = ImageDraw.Draw(img)

    def ell(e, c):
        cx, cy, rx, ry = e
        d.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=c)

    ell(BLOON, NAVY)
    d.polygon([(x * k, y * k) for x, y in KNOT], fill=NAVY)
    d.line([(x * k, y * k) for x, y in STRING], fill=NAVY, width=max(1, round(STRING_W * k)), joint="curve")
    ell(SHINE, YELLOW)
    return img.resize((px, px), Image.LANCZOS)


(OUT / "favicon.svg").write_text(svg(), encoding="utf-8", newline="\n")
png(48).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[png(16), png(32)])
png(180).save(OUT / "apple-touch-icon.png", optimize=True)
print("wrote favicon.svg, favicon.ico, apple-touch-icon.png")
