# Site icon and the header logo's font, from the logo (docs/game-ui.md): "BTD6" in the game-logo style (Luckiest Guy,
# white, heavy dark-blue outline and drop, tilted) on a blue tile. Writes web/public/favicon.svg, favicon.ico
# (16/32/48), apple-touch-icon.png (180, "BTD6" over a yellow "DATA") and web/src/logo-font.css (the inlined subset).
# Run with .venv-art/Scripts/python scripts/build_icons.py
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageDraw

import logo_font as L

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public"
TOP, BOTTOM = (47, 111, 196), (18, 48, 102)  # the tile: lighter at the top, like the game's blue buttons
TILT = 5  # degrees, anticlockwise


def tile(px: int, rounded: bool) -> Image.Image:
    """The blue tile with a vertical gradient; rounded with transparent corners (favicon) or full bleed (iOS)."""
    img = Image.new("RGBA", (px, px))
    d = ImageDraw.Draw(img)
    for y in range(px):
        t = y / max(1, px - 1)
        d.line([(0, y), (px, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    if rounded:
        mask = Image.new("L", (px, px))
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=round(px * 0.22), fill=255)
        img.putalpha(mask)
    return img


def icon(px: int, rounded: bool, with_data: bool) -> Image.Image:
    k = 4  # supersampling
    s = px * k
    big = tile(s, rounded)
    lines = [L.word("BTD6", round(s * 0.36), L.WHITE, max(2, round(s * 0.045)))]
    if with_data:
        lines.append(L.word("DATA", round(s * 0.2), L.YELLOW, max(2, round(s * 0.032))))
    gap = round(s * 0.03) if with_data else 0
    w = max(i.width for i in lines)
    h = sum(i.height for i in lines) - gap * (len(lines) - 1)
    block = Image.new("RGBA", (w, h))
    y = 0
    for i in lines:
        block.alpha_composite(i, ((w - i.width) // 2, y))
        y += i.height - gap
    block = block.rotate(TILT, resample=Image.BICUBIC, expand=True)
    room = s * (0.84 if with_data else 0.92)  # fit inside the tile with a margin
    f = min(room / block.width, room / block.height, 1)
    block = block.resize((round(block.width * f), round(block.height * f)), Image.LANCZOS)
    big.alpha_composite(block, ((s - block.width) // 2, (s - block.height) // 2))
    return big.resize((px, px), Image.LANCZOS)


def svg() -> str:
    """favicon.svg: the 32 px drawing as vector, the letters as the font's own outlines (no font needed)."""
    f = L.font()
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    pen = SVGPathPen(gs)
    x = 0
    for ch in "BTD6":
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        x += gs[g].width
    d = pen.getCommands()
    cap = f["OS/2"].sCapHeight or f["hhea"].ascent
    scale = 25 / x  # 25 of 32 px wide
    tx, ty = 16 - x * scale / 2, 15.5 + cap * scale / 2
    sw = 3 / scale

    def path(dy: float, fill: str, stroke: str, extra: str = "") -> str:
        return (
            f'<path transform="rotate(-{TILT} 16 16) translate({tx:.2f} {ty + dy:.2f}) scale({scale:.5f})" d="{d}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw:.0f}" stroke-linejoin="round"{extra}/>'
        )

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="rgb{TOP}"/><stop offset="1" stop-color="rgb{BOTTOM}"/></linearGradient></defs>'
        '<rect width="32" height="32" rx="7" fill="url(#g)"/>'
        + path(1.4, L.DROP, L.DROP)
        + path(0, L.WHITE, L.OUTLINE, ' paint-order="stroke"')
        + "</svg>\n"
    )


(OUT / "favicon.svg").write_text(svg(), encoding="utf-8", newline="\n")
icon(48, True, False).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[icon(16, True, False), icon(32, True, False)])
icon(180, False, True).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
(ROOT / "web" / "src" / "logo-font.css").write_text(L.css(), encoding="utf-8", newline="\n")
print("wrote favicon.svg, favicon.ico, apple-touch-icon.png, web/src/logo-font.css")
