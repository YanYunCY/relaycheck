# Renders captured stdout of REAL runs (calib/e2e, calib/val) as terminal screenshots. Text is not edited,
# only soft-wrapped and coloured by line prefix. Usage: python3 scripts/real-run-shot.py
import textwrap
from PIL import Image, ImageDraw, ImageFont
F = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
SZ, COLS, LH, PAD = 26, 104, 36, 40
INFO = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', SZ)
font, bold = ImageFont.truetype(F, SZ), ImageFont.truetype(FB, SZ)
BG, FG, DIM = '#0d1117', '#e6edf3', '#8b949e'
GREEN, RED, YEL, BLUE = '#3fdc7a', '#ff6b6b', '#f2c94c', '#58a6ff'

def lines_for(cmd, path):
    out = [('# captured stdout: ' + path, DIM, False), ('', FG, False)]
    for raw in open(path, encoding='utf-8').read().rstrip('\n').split('\n'):
        s = raw.strip()
        if not s: out.append(('', FG, False)); continue
        if s.startswith('CONSISTENT'): col, b = GREEN, True
        elif s.startswith('INCONSISTENT'): col, b = RED, True
        elif s.startswith('target:'): col, b = DIM, False
        elif s.startswith('✔'): col, b = GREEN, raw[0] != ' '
        elif s.startswith('✖'): col, b = RED, raw[0] != ' '
        elif s.startswith('ℹ') or s.startswith('○'): col, b = DIM, False
        else: col, b = FG, False
        ind = len(raw) - len(raw.lstrip())
        for i, w in enumerate(textwrap.wrap(s, COLS - ind - (2 if raw[0] == ' ' else 0))):
            out.append(((' ' * ind if i == 0 else ' ' * (ind + 2)) + w, col, b))
    return out

def shot(title, cmd, path, dst):
    L = lines_for(cmd, path)
    cw = font.getlength('M')
    W = int(PAD * 2 + cw * COLS); H = 56 + PAD + LH * len(L) + PAD
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 56], fill='#161b22')
    for i, c in enumerate(['#ff5f56', '#ffbd2e', '#27c93f']): d.ellipse([24 + i * 30, 19, 42 + i * 30, 37], fill=c)
    d.text((W / 2, 28), title, font=ImageFont.truetype(F, 20), fill=DIM, anchor='mm')
    y = 56 + PAD
    for t, c, b in L:
        x = PAD
        for ch in t:  # DejaVu Sans Mono lacks U+2139; borrow it from DejaVu Sans
            f = INFO if ch == 'ℹ' else (bold if b else font)
            d.text((x, y), ch, font=f, fill=BLUE if ch == 'ℹ' else c); x += cw
        y += LH
    im.save(dst, optimize=True); print(dst, im.size)

shot('real run · official OpenAI API · 2026-10-31',
     'npx relaycheck https://api.openai.com/v1 --model gpt-6-luna --api responses --deep',
     'calib/e2e/official-full.txt', 'docs/real-run-official.png')
shot('real run · local swap proxy: asks gpt-6.1-sol, serves gpt-6.1-terra · 2026-10-31',
     'npx relaycheck http://127.0.0.1:18993/v1 --model gpt-6.1-sol --api responses --probes identity',
     'calib/val/sol-swap-terra-1.txt', 'docs/real-run-swap.png')
