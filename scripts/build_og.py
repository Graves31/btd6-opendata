# Link-preview image (web/public/og.jpg, 1200x630) from the game's boss portraits. Run with .venv-art/Scripts/python.
import sys, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.chdir(ROOT)
import build_art as B
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
img = Image.new("RGB", (W, H), (12, 17, 29))
# soft diagonal wash
wash = Image.new("RGB", (W, H), (0, 0, 0))
d = ImageDraw.Draw(wash)
for x in range(W):
    t = x / W
    d.line([(x, 0), (x, H)], fill=(int(20 + 30 * t), int(27 + 10 * t), int(42 + 40 * t)))
img = Image.blend(img, wash, 0.9)

src = B.Source()
bosses = ["bloonarius", "lych", "vortex", "dreadbloon", "phayze", "blastapopoulos"]
size = 250
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pos = [(560, 40), (800, 20), (1000, 120), (620, 300), (860, 300), (1040, 380)]
for b, (x, y) in zip(bosses, pos):
    p = B.fit(B.trim(src.get("ref/%sPortrait" % b.capitalize()).convert("RGBA")), size)
    layer.alpha_composite(p, (x - 40, y))
shadow = layer.split()[3].filter(ImageFilter.GaussianBlur(18))
g = Image.new("RGBA", (W, H), (120, 170, 255, 0)); g.putalpha(shadow.point(lambda v: v * 0.5))
base = img.convert("RGBA"); base.alpha_composite(g); base.alpha_composite(layer)

dr = ImageDraw.Draw(base)
F = lambda n, s: ImageFont.truetype(n, s)
black = "C:/Windows/Fonts/seguibl.ttf" if Path("C:/Windows/Fonts/seguibl.ttf").exists() else "C:/Windows/Fonts/ariblk.ttf"
bold = "C:/Windows/Fonts/segoeuib.ttf"
dr.text((64, 180), "BTD6", font=F(black, 132), fill=(255, 214, 64))
dr.text((64, 330), "OPEN DATA", font=F(black, 84), fill=(245, 247, 250))
dr.text((68, 450), "Boss, race & CT leaderboards,", font=F(bold, 34), fill=(190, 200, 220))
dr.text((68, 494), "player profiles and event rules", font=F(bold, 34), fill=(190, 200, 220))
dr.rectangle([64, 150, 184, 158], fill=(255, 214, 64))
out = ROOT / "web/public/og.jpg"
base.convert("RGB").save(out, quality=86, optimize=True, progressive=True)
print(out, out.stat().st_size)
