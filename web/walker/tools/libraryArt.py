"""Generate plates for the maze gallery: the kind of thing that hangs in a
college library.

    python web/walker/tools/libraryArt.py [count]

Writes into web/walker/art/generated/, which is gitignored along with the rest
of the gallery. Nothing here is loaded from anywhere -- every plate is drawn
from scratch, so there is no licence attached to any of it and no file to
fetch.

Six kinds, all on aged paper in iron-gall ink:

    botanical   a specimen, stem and leaves, with a ruled label
    stellar     a star chart with constellation lines and a graticule
    elevation   an architectural front: columns, arches, entablature
    marbled     turbulent endpapers, the inside of an old binding
    geometric   a construction: circles, tangents, the working left in
    chart       a coastline with depth contours and a compass rose

Deterministic: plate N is always the same plate. Re-running does not reshuffle
the gallery, which matters because the maze hangs them in a seeded order and a
changing folder would change every wall.
"""

import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "art", "generated")

COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 24

# Aged paper, and three inks. Kept narrow on purpose: a library wall is not
# colourful, and the pictures have to read against dark panelling by lamplight.
PAPERS = [(232, 221, 196), (226, 214, 188), (238, 228, 206), (219, 206, 180)]
INK = (38, 30, 22)
INK_SOFT = (92, 76, 56)
ACCENT = [(122, 38, 30), (36, 62, 74), (96, 82, 36)]

# Portrait mostly, as plates are, with a few squares and one landscape shape.
SHAPES = [(760, 1080), (700, 1120), (900, 900), (1120, 760), (820, 1080), (960, 1000)]


def paper(w, h, rnd):
    """Sheet with a little tone variation and a darker edge."""
    base = PAPERS[rnd.randrange(len(PAPERS))]
    im = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(im, "RGBA")
    # Foxing: a few faint blooms, so it is not a flat rectangle of colour.
    for _ in range(rnd.randint(14, 26)):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r = rnd.randint(int(w * 0.02), int(w * 0.09))
        a = rnd.randint(6, 16)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(150, 120, 80, a))
    im = im.filter(ImageFilter.GaussianBlur(w * 0.006))
    # Plate mark: the pressed edge of an intaglio print.
    d2 = ImageDraw.Draw(im, "RGBA")
    m = int(min(w, h) * 0.055)
    d2.rectangle([m, m, w - m, h - m], outline=(120, 100, 74, 90), width=2)
    return im


def rule(d, w, h, rnd, title_room=True):
    """The ruled caption box plates carry along the bottom."""
    if not title_room:
        return h
    y = int(h * 0.88)
    m = int(min(w, h) * 0.10)
    d.line([m, y, w - m, y], fill=INK_SOFT, width=2)
    # A caption, drawn as ink strokes rather than text: real lettering at this
    # size turns to mush, and invented Latin would be a lie about what it is.
    x = m + int(w * 0.06)
    for _ in range(rnd.randint(3, 6)):
        seg = rnd.randint(int(w * 0.05), int(w * 0.14))
        d.line([x, y + int(h * 0.035), x + seg, y + int(h * 0.035)],
               fill=INK_SOFT, width=max(2, int(h * 0.006)))
        x += seg + int(w * 0.03)
        if x > w - m - int(w * 0.1):
            break
    return y


def botanical(im, d, w, h, rnd):
    top = rule(d, w, h, rnd)
    cx = w * rnd.uniform(0.42, 0.58)
    base_y = top * 0.96
    tip_y = h * rnd.uniform(0.12, 0.20)
    # Stem as a slight S, drawn in segments so it has a hand-drawn waver.
    pts = []
    n = 26
    for i in range(n + 1):
        t = i / n
        y = base_y + (tip_y - base_y) * t
        x = cx + math.sin(t * math.pi * rnd.uniform(0.8, 1.6)) * w * 0.06
        pts.append((x, y))
    d.line(pts, fill=INK, width=max(3, int(w * 0.006)), joint="curve")

    leaves = rnd.randint(5, 9)
    for i in range(leaves):
        t = 0.18 + 0.72 * (i / max(1, leaves - 1))
        idx = int(t * n)
        x, y = pts[idx]
        side = -1 if i % 2 else 1
        ln = w * rnd.uniform(0.13, 0.26)
        ang = math.radians(rnd.uniform(18, 52)) * side
        ex, ey = x + math.cos(ang) * ln * side * -1, y - math.sin(abs(ang)) * ln * 0.5
        # A leaf as two arcs meeting at the tip.
        mid1 = (x + (ex - x) * 0.5 + side * ln * 0.12, y + (ey - y) * 0.5 - ln * 0.18)
        mid2 = (x + (ex - x) * 0.5 - side * ln * 0.10, y + (ey - y) * 0.5 + ln * 0.16)
        d.line([(x, y), mid1, (ex, ey)], fill=INK, width=2, joint="curve")
        d.line([(x, y), mid2, (ex, ey)], fill=INK, width=2, joint="curve")
        d.line([(x, y), (ex, ey)], fill=INK_SOFT, width=1)

    # A flower or seed head at the tip.
    ax = ACCENT[rnd.randrange(len(ACCENT))]
    fx, fy = pts[-1]
    petals = rnd.randint(5, 9)
    pr = w * rnd.uniform(0.045, 0.075)
    for i in range(petals):
        a = (i / petals) * math.tau + rnd.uniform(-0.1, 0.1)
        px, py = fx + math.cos(a) * pr, fy + math.sin(a) * pr * 0.9
        d.ellipse([px - pr * 0.42, py - pr * 0.42, px + pr * 0.42, py + pr * 0.42],
                  fill=ax + (205,), outline=INK)
    d.ellipse([fx - pr * 0.3, fy - pr * 0.3, fx + pr * 0.3, fy + pr * 0.3],
              fill=INK_SOFT)


def stellar(im, d, w, h, rnd):
    top = rule(d, w, h, rnd)
    cx, cy = w / 2, top * 0.52
    R = min(w, top) * 0.40
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=INK, width=3)
    d.ellipse([cx - R * 0.66, cy - R * 0.66, cx + R * 0.66, cy + R * 0.66],
              outline=INK_SOFT, width=1)
    for i in range(12):
        a = i * math.tau / 12
        d.line([cx + math.cos(a) * R * 0.1, cy + math.sin(a) * R * 0.1,
                cx + math.cos(a) * R, cy + math.sin(a) * R], fill=(140, 122, 96, 120), width=1)

    stars = []
    for _ in range(rnd.randint(55, 90)):
        a = rnd.uniform(0, math.tau)
        rr = R * math.sqrt(rnd.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        mag = rnd.choice([1, 1, 1, 2, 2, 3, 4])
        stars.append((x, y, mag))
        s = mag * max(1.5, w * 0.0035)
        d.ellipse([x - s, y - s, x + s, y + s], fill=INK)
    # Constellation: join a handful of the brightest into a figure.
    bright = sorted(stars, key=lambda s: -s[2])[:rnd.randint(5, 8)]
    rnd.shuffle(bright)
    d.line([(s[0], s[1]) for s in bright], fill=ACCENT[1] + (190,), width=2)


def elevation(im, d, w, h, rnd):
    top = rule(d, w, h, rnd)
    m = w * 0.14
    ground = top * 0.92
    cols = rnd.choice([4, 6, 8])
    span = (w - 2 * m) / cols
    cap = ground - (top * rnd.uniform(0.44, 0.58))

    # Stylobate
    d.rectangle([m * 0.7, ground, w - m * 0.7, ground + h * 0.018], outline=INK, width=2)
    for i in range(cols):
        x = m + span * (i + 0.5)
        cw = span * 0.22
        d.rectangle([x - cw, cap, x + cw, ground], outline=INK, width=2)
        # Fluting
        for f in range(3):
            fx = x - cw + cw * 2 * (f + 1) / 4
            d.line([fx, cap + h * 0.01, fx, ground - h * 0.01], fill=(150, 132, 104), width=1)
        # Capital
        d.rectangle([x - cw * 1.5, cap - h * 0.022, x + cw * 1.5, cap], outline=INK, width=2)

    # Entablature and pediment
    ent = cap - h * 0.022
    d.rectangle([m * 0.8, ent - h * 0.05, w - m * 0.8, ent], outline=INK, width=2)
    apex = ent - h * 0.12
    d.polygon([(m * 0.8, ent - h * 0.05), (w / 2, apex), (w - m * 0.8, ent - h * 0.05)],
              outline=INK)
    # Arches between columns, on some plates
    if rnd.random() < 0.5:
        for i in range(cols - 1):
            x0 = m + span * (i + 1) - span * 0.28
            x1 = m + span * (i + 1) + span * 0.28
            d.arc([x0, ground - span * 0.9, x1, ground + span * 0.2], 180, 360,
                  fill=INK_SOFT, width=2)


def marbled(im, d, w, h, rnd):
    # Combed marbling: bands pushed about by a few vortices.
    ax = [ACCENT[rnd.randrange(len(ACCENT))] for _ in range(3)]
    bands = rnd.randint(16, 26)
    vort = [(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(-1, 1) * w * 0.10)
            for _ in range(rnd.randint(3, 6))]
    for b in range(bands):
        y0 = h * (b + 0.5) / bands
        col = (ax[b % len(ax)] if b % 3 else INK_SOFT)
        pts = []
        for i in range(0, w + 1, 8):
            y = y0
            for (vx, vy, vs) in vort:
                dx, dy = i - vx, y0 - vy
                dist2 = dx * dx + dy * dy + 1
                y += vs * math.exp(-dist2 / (2 * (w * 0.22) ** 2)) * math.sin(dx * 0.01)
            pts.append((i, y))
        d.line(pts, fill=col + (150,), width=max(3, int(h / bands * 0.55)), joint="curve")
    im_blur = im.filter(ImageFilter.GaussianBlur(w * 0.002))
    im.paste(im_blur)
    rule(d, w, h, rnd, title_room=False)


def geometric(im, d, w, h, rnd):
    top = rule(d, w, h, rnd)
    cx, cy = w / 2, top * 0.52
    R = min(w, top) * 0.36
    # The construction, with the working left visible.
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=INK, width=3)
    n = rnd.choice([5, 6, 7, 8, 12])
    pts = [(cx + math.cos(i * math.tau / n - math.pi / 2) * R,
            cy + math.sin(i * math.tau / n - math.pi / 2) * R) for i in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            d.line([pts[i], pts[j]], fill=(150, 132, 104, 160), width=1)
    d.polygon(pts, outline=INK)
    # Inscribed circles at each vertex, the compass marks of the construction.
    for (x, y) in pts:
        r = R * 0.18
        d.ellipse([x - r, y - r, x + r, y + r], outline=(150, 132, 104), width=1)
    ax = ACCENT[rnd.randrange(len(ACCENT))]
    d.ellipse([cx - R * 0.26, cy - R * 0.26, cx + R * 0.26, cy + R * 0.26],
              outline=ax, width=3)


def chart(im, d, w, h, rnd):
    top = rule(d, w, h, rnd)
    # Graticule
    for i in range(1, 9):
        x = w * i / 9
        d.line([x, h * 0.06, x, top], fill=(160, 142, 112, 110), width=1)
    for i in range(1, 8):
        y = h * 0.06 + (top - h * 0.06) * i / 8
        d.line([w * 0.06, y, w * 0.94, y], fill=(160, 142, 112, 110), width=1)

    # A coastline: one wandering line, then contours inside it.
    base = []
    x = w * 0.08
    y = top * rnd.uniform(0.45, 0.65)
    while x < w * 0.92:
        y += rnd.uniform(-1, 1) * h * 0.035
        y = max(h * 0.18, min(top * 0.85, y))
        base.append((x, y))
        x += w * 0.035
    d.line(base, fill=INK, width=3, joint="curve")
    for k in range(1, rnd.randint(3, 6)):
        off = k * h * 0.028
        d.line([(px, py + off) for (px, py) in base], fill=(150, 132, 104, 150), width=1)
    # Hatching seaward
    for (px, py) in base[::2]:
        d.line([px, py, px, py - h * 0.016], fill=INK_SOFT, width=1)

    # Compass rose
    rx, ry = w * 0.78, top * 0.24
    rr = min(w, top) * 0.10
    d.ellipse([rx - rr, ry - rr, rx + rr, ry + rr], outline=INK, width=2)
    for i in range(8):
        a = i * math.tau / 8
        L = rr if i % 2 == 0 else rr * 0.6
        d.line([rx, ry, rx + math.cos(a) * L, ry + math.sin(a) * L], fill=INK, width=2)
    d.polygon([(rx, ry - rr), (rx - rr * 0.16, ry), (rx + rr * 0.16, ry)],
              fill=ACCENT[0])


KINDS = [botanical, stellar, elevation, marbled, geometric, chart]


def main():
    os.makedirs(OUT, exist_ok=True)
    made = 0
    for i in range(COUNT):
        rnd = random.Random(7700 + i * 13)
        w, h = SHAPES[i % len(SHAPES)]
        kind = KINDS[i % len(KINDS)]
        im = paper(w, h, rnd)
        d = ImageDraw.Draw(im, "RGBA")
        kind(im, d, w, h, rnd)
        name = f"plate-{i + 1:02d}-{kind.__name__}.jpg"
        im.save(os.path.join(OUT, name), quality=88)
        made += 1
    print(f"  {made} plates written to art/generated/")
    print("  now run: node web/walker/tools/artManifest.mjs")


if __name__ == "__main__":
    main()
