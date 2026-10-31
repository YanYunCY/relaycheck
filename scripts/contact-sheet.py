#!/usr/bin/env python3
"""Build docs/design/round2/contact-sheet.png: references next to the round-2 directions.
  python3 scripts/contact-sheet.py <refs-dir>   (refs: linear.png supabase-lw15.png raycast.png; not committed)"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.join(os.path.dirname(__file__), '..')
R2 = os.path.join(ROOT, 'docs', 'design', 'round2')
refs = sys.argv[1] if len(sys.argv) > 1 else 'refs'
TW, TH, G = 600, 315, 24
font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 20, index=2)
small = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Regular.otf', 16)
rows = [
    ('References', [(f'{refs}/linear.png', 'Linear'), (f'{refs}/supabase-lw15.png', 'Supabase LW15'), (f'{refs}/raycast.png', 'Raycast')]),
    ('Round 1 (B · stamp, before)', [(f'{ROOT}/docs/design/card-B-fail.png', 'card B fail'), (f'{ROOT}/docs/design/card-B-pass.png', 'card B pass'), (f'{ROOT}/docs/design/social-B.png', 'social B')]),
]
for n, label in [('slip', 'slip · 验货单  (picked)'), ('lab', 'lab · 检测报告'), ('night', 'night · dark glow')]:
    rows.append((label, [(f'{R2}/card-{n}-fail.png', 'card fail'), (f'{R2}/card-{n}-pass.png', 'card pass'), (f'{R2}/social-{n}.png', 'social')]))
LH = 40
W = G + 3 * (TW + G)
H = G + len(rows) * (LH + TH + 28 + G)
sheet = Image.new('RGB', (W, H), '#f4f4f2')
d = ImageDraw.Draw(sheet)
y = G
for label, cells in rows:
    d.text((G, y + 8), label, fill='#111', font=font)
    y += LH
    for i, (path, cap) in enumerate(cells):
        x = G + i * (TW + G)
        im = Image.open(path).convert('RGB')
        im.thumbnail((TW, TH), Image.LANCZOS)
        sheet.paste(im, (x, y))
        d.text((x, y + TH + 6), cap, fill='#666', font=small)
    y += TH + 28 + G
sheet.save(os.path.join(R2, 'contact-sheet.png'), optimize=True)
print('ok', W, H)
