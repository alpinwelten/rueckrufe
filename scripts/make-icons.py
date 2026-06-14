#!/usr/bin/env python3
"""Erzeugt App-Icons (Klar/Teal) für die PWA: Schild + Ausrufezeichen.
Aufruf: python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
os.makedirs(ICONS, exist_ok=True)

TEAL = (0, 96, 100, 255)          # #006064  (Klar/Teal Primär)
TEAL_DK = (0, 71, 75, 255)        # #00474B
WHITE = (255, 255, 255, 255)


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def draw_icon(size, pad_ratio=0.0, bg=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    inner = size - 2 * pad
    if bg:
        rounded(d, [pad, pad, pad + inner, pad + inner], int(inner * 0.22), TEAL)

    # Schild (Wappen) zentriert
    cx = size / 2
    top = pad + inner * 0.16
    bot = pad + inner * 0.86
    w = inner * 0.52
    shoulder = top + (bot - top) * 0.30
    pts = [
        (cx, top),
        (cx + w / 2, shoulder - (bot - top) * 0.12),
        (cx + w / 2, shoulder + (bot - top) * 0.18),
        (cx, bot),
        (cx - w / 2, shoulder + (bot - top) * 0.18),
        (cx - w / 2, shoulder - (bot - top) * 0.12),
    ]
    d.polygon(pts, fill=WHITE)

    # Ausrufezeichen (teal) im Schild
    bar_w = inner * 0.075
    bar_top = top + (bot - top) * 0.26
    bar_bot = top + (bot - top) * 0.60
    rounded(d, [cx - bar_w / 2, bar_top, cx + bar_w / 2, bar_bot], int(bar_w / 2), TEAL_DK)
    dot_r = bar_w * 0.72
    dot_cy = top + (bot - top) * 0.70
    d.ellipse([cx - dot_r, dot_cy - dot_r, cx + dot_r, dot_cy + dot_r], fill=TEAL_DK)
    return img


def main():
    specs = [
        ("icon-192.png", 192, 0.0, True),
        ("icon-512.png", 512, 0.0, True),
        ("icon-maskable-512.png", 512, 0.14, True),  # Safe-Zone für maskable
        ("apple-touch-icon.png", 180, 0.0, True),
        ("favicon-32.png", 32, 0.0, True),
    ]
    for name, size, pad, bg in specs:
        img = draw_icon(size, pad, bg)
        img.save(os.path.join(ICONS, name))
        print("wrote", name, f"{size}x{size}")


if __name__ == "__main__":
    main()
