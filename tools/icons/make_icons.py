"""สร้างไอคอน/โลโก้ SLTS ทั้งชุดจากไฟล์โลโก้ต้นฉบับ (พื้นใส) — python3 make_icons.py <source.png> <repo>"""
import sys, glob
from PIL import Image, ImageDraw
src_path, repo = sys.argv[1], sys.argv[2]
src = Image.open(src_path).convert('RGBA')
A = lambda im: im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
sym = src.crop((0, 0, src.width, 783)); sym = sym.crop(A(sym))   # สัญลักษณ์ (หมุด+ศาล+เอกสาร)
full = src.crop(A(src))                                            # โลโก้เต็มพร้อมชื่อระบบ
def fit(img, box):
    w, h = img.size; s = min(box / w, box / h); return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
def canvas(size, img, frac, bg=None, shape='square', radius=0.22):
    c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if bg:
        m = Image.new('L', (size, size), 0); d = ImageDraw.Draw(m)
        if shape == 'circle': d.ellipse((0, 0, size - 1, size - 1), fill=255)
        elif shape == 'round': d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius), fill=255)
        else: d.rectangle((0, 0, size, size), fill=255)
        c.paste(Image.new('RGBA', (size, size), bg), (0, 0), m)
    f = fit(img, int(size * frac)); c.alpha_composite(f, ((size - f.width) // 2, (size - f.height) // 2)); return c
W = (255, 255, 255, 255)
o = lambda p: f'{repo}/{p}'
canvas(320, sym, 0.96).quantize(256, method=Image.FASTOCTREE).save(o('img/logo.png'), optimize=True)
fit(full, 900).save(o('tools/icons/slts-logo-full.png'), optimize=True)
canvas(192, sym, 0.80, W).save(o('img/icon-192.png'), optimize=True)
canvas(512, sym, 0.80, W).save(o('img/icon-512.png'), optimize=True)
canvas(512, sym, 0.64, W).save(o('img/icon-maskable-512.png'), optimize=True)
canvas(180, sym, 0.82, W).save(o('img/apple-touch-icon.png'), optimize=True)
canvas(32, sym, 1.0).save(o('img/favicon-32.png')); canvas(16, sym, 1.0).save(o('img/favicon-16.png'))
canvas(256, sym, 1.0).save(o('favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
res = o('android/app/src/main/res')
for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    canvas(px, sym, 0.76, W, 'round', 0.2).save(f'{res}/mipmap-{d}/ic_launcher.png', optimize=True)
    canvas(px, sym, 0.66, W, 'circle').save(f'{res}/mipmap-{d}/ic_launcher_round.png', optimize=True)
    canvas(px * 108 // 48, sym, 0.58).save(f'{res}/mipmap-{d}/ic_launcher_foreground.png', optimize=True)  # adaptive: safe zone 66/108
for f in glob.glob(f'{res}/drawable*/splash.png'):
    w, h = Image.open(f).size
    c = Image.new('RGBA', (w, h), W); lg = fit(full, int(min(w, h) * 0.62)); c.alpha_composite(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
    c.convert('RGB').save(f, optimize=True)
print('sym', sym.size, 'full', full.size)
