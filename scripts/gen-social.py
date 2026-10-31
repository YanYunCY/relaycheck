#!/usr/bin/env python3
"""Generate the repo social preview directions (1280x640 SVG) into docs/design/round2/.

  python3 scripts/gen-social.py            # writes docs/design/round2/social-{slip,lab,night}.svg

Seal and verdict glyphs come from the embedded outlines in src/report/glyphs.ts (no seal font needed
to render). Wordmark and taglines use Inter / Inter Display, JetBrains Mono and Noto Sans CJK SC,
which must be installed where the SVG is rasterised (scripts/cards.sh does that with rsvg-convert).
"""
import json, math, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'docs', 'design', 'round2')
src = open(os.path.join(ROOT, 'src', 'report', 'glyphs.ts'), encoding='utf-8').read()
def table(name):
    return json.loads(re.search(rf'export const {name}[^=]*= (\{{.*\}});', src).group(1))
SEAL, HEI, SONG, CAPS = table('SEAL_GLYPHS'), table('HEI_GLYPHS'), table('SONG_GLYPHS'), table('CAPS_GLYPHS')

W, H = 1280, 640
CJK = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC'"
SANS = f"Inter, system-ui, -apple-system, 'Segoe UI', {CJK}, sans-serif"
DISPLAY = f"'Inter Display', {SANS}"
MONO = f"'JetBrains Mono', 'SF Mono', Menlo, Consolas, {CJK}, monospace"
TITLE = 'relaycheck: Is your relay serving the real model? 你的中转站是真模型吗？'

def head(bg):
    return [f'<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{SANS}">',
            f'<title>{TITLE}</title>', f'<rect width="{W}" height="{H}" fill="{bg}"/>']

def ink_filter(fid, seed, rough=5.0):
    return f'''<filter id="{fid}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="{seed}" result="warp"/>
  <feDisplacementMap in="SourceGraphic" in2="warp" scale="{rough}" xChannelSelector="R" yChannelSelector="G" result="edge"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.2" numOctaves="3" seed="{seed+1}" result="fine"/>
  <feColorMatrix in="fine" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -14 0 0 0 9.6" result="speck"/>
  <feComposite in="edge" in2="speck" operator="in" result="specked"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="2" seed="{seed+2}" result="blot"/>
  <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 0.05" result="press"/>
  <feComposite in="specked" in2="press" operator="in"/>
</filter>'''

def grain(fid, light, amount, freq=0.9):
    c = '1' if light else '0'
    return f'''<filter id="{fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="2" seed="4" stitchTiles="stitch" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 {c}  0 0 0 0 {c}  0 0 0 0 {c}  {amount*2.4:.3f} 0 0 0 {-amount*0.9:.3f}"/>
</filter>'''

def glyph(table_, ch, x, y, size, extra=''):
    return f'<path transform="translate({x:.1f} {y:.1f}) scale({size/1000:.4f})" d="{table_[ch]}"{extra}/>'

def seal_square(cx, cy, size, angle, color, fid, mid):
    """白文 square seal: red block, 验货 knocked out (stacked), double inner line. Real-ink filter."""
    s = size
    g = s * 0.40
    m = [f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="{-s}" y="{-s}" width="{2*s}" height="{2*s}"><rect x="{-s}" y="{-s}" width="{2*s}" height="{2*s}" fill="#fff"/>',
         f'<g fill="#000" stroke="#000" stroke-width="{g*0.03:.1f}" stroke-linejoin="round">',
         glyph(SEAL, '验', -g/2, -s/2 + s*0.07, g), glyph(SEAL, '货', -g/2, s*0.03, g), '</g>',
         f'<rect x="{-s/2+s*0.075:.1f}" y="{-s/2+s*0.075:.1f}" width="{s*0.85:.1f}" height="{s*0.85:.1f}" fill="none" stroke="#000" stroke-width="{s*0.012:.1f}"/></mask>']
    body = f'<rect x="{-s/2*0.62:.1f}" y="{-s/2:.1f}" width="{s*0.62:.1f}" height="{s:.1f}" rx="{s*0.035:.1f}" fill="{color}" mask="url(#{mid})"/>'
    # narrow vertical block suits the stacked pair
    m[0] = m[0]
    m[-1] = f'<rect x="{-s*0.31+s*0.05:.1f}" y="{-s/2+s*0.05:.1f}" width="{s*0.52:.1f}" height="{s*0.9:.1f}" fill="none" stroke="#000" stroke-width="{s*0.012:.1f}"/></mask>'
    return ''.join(m), f'<g transform="translate({cx} {cy}) rotate({angle})"><g filter="url(#{fid})" opacity="0.93" style="mix-blend-mode:multiply">{body}</g></g>'

def barcode(x, y, w, h, seed, color):
    units = [2, 1, 1, 1]
    for ch in seed:
        c = ord(ch)
        units += [1 + c % 3, 1 + (c >> 2) % 2, 1 + (c >> 3) % 3, 1 + (c >> 1) % 2]
    units += [1, 1, 2, 1]
    u = w / sum(units)
    out, cx = [], x
    for i, n in enumerate(units):
        if i % 2 == 0:
            out.append(f'<rect x="{cx:.1f}" y="{y}" width="{n*u:.1f}" height="{h}"/>')
        cx += n * u
    return f'<g fill="{color}">{"".join(out)}</g>'

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# ------------------------------------------------------------------ slip
def slip():
    paper, ink, grey, faint, red = '#fbf9f4', '#1c1b18', '#6f6a60', '#9d978b', '#cf3a2b'
    o = head('#e4dfd4')
    D = 920
    x0, y0, x1, y1, nr = 40, 40, W - 40, H - 40, 16
    mask, seal = seal_square(D + 2, 300, 300, -6, red, 'ink', 'sealmask')
    o.append(f'''<defs>{ink_filter('ink', 11, 5)}{grain('grain', False, 0.06, 0.85)}
<filter id="lift" x="-5%" y="-5%" width="110%" height="115%"><feGaussianBlur in="SourceAlpha" stdDeviation="12"/><feOffset dy="10"/><feColorMatrix type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.16  0 0 0 0 0.1  0 0 0 0.22 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>{mask}</defs>''')
    p = (f'M{x0+12} {y0}H{D-nr}A{nr} {nr} 0 0 0 {D+nr} {y0}H{x1-12}Q{x1} {y0} {x1} {y0+12}V{y1-12}Q{x1} {y1} {x1-12} {y1}'
         f'H{D+nr}A{nr} {nr} 0 0 0 {D-nr} {y1}H{x0+12}Q{x0} {y1} {x0} {y1-12}V{y0+12}Q{x0} {y0} {x0+12} {y0}Z')
    o.append(f'<path d="{p}" fill="{paper}" filter="url(#lift)"/><path d="{p}" fill="#000" filter="url(#grain)"/>')
    o.append(f'<path d="M{D} {y0+nr+12}V{y1-nr-12}" stroke="{faint}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>')
    L, R = 96, D - 56
    o.append(f'<text x="{L}" y="104" font-size="16" fill="{grey}" font-family="{MONO}" letter-spacing="1.5">验货单  INSPECTION SLIP</text>')
    o.append(f'<text x="{R}" y="104" font-size="16" fill="{grey}" font-family="{MONO}" text-anchor="end">No. RC-020</text>')
    o.append(f'<rect x="{L}" y="124" width="{R-L}" height="2" fill="{ink}"/><rect x="{L}" y="130" width="{R-L}" height="1" fill="{ink}"/>')
    o.append(f'<text x="{L-6}" y="280" font-size="132" font-weight="800" fill="{ink}" letter-spacing="-5" font-family="{DISPLAY}">relaycheck</text>')
    o.append(f'<text x="{L}" y="352" font-size="38" font-weight="600" fill="{ink}" letter-spacing="-0.5">Is your relay serving the real model?</text>')
    o.append(f'<text x="{L}" y="404" font-size="30" fill="{grey}">你的中转站是真模型吗？一行命令验货。</text>')
    o.append(f'<path d="M{L} 456H{R}" stroke="#d9d3c6" stroke-width="1.5" stroke-dasharray="1 5" stroke-linecap="round"/>')
    o.append(f'<text x="{L}" y="512" font-size="26" fill="{ink}" font-family="{MONO}"><tspan fill="{faint}">$</tspan> npx relaycheck <tspan fill="{grey}">&lt;url&gt; --model &lt;name&gt;</tspan></text>')
    items = [('身份', 'identity'), ('协议', 'protocol'), ('计费', 'billing'), ('上下文', 'context')]
    x = L
    for zh, _ in items:
        o.append(f'<rect x="{x+0.75}" y="545.75" width="18.5" height="18.5" rx="2.5" fill="none" stroke="{ink}" stroke-width="1.5"/>')
        o.append(f'<path d="M{x+4} {556}L{x+8.5} {560.5}L{x+16} {550}" fill="none" stroke="#1f7a4c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
        o.append(f'<text x="{x+28}" y="561" font-size="18" font-weight="600" fill="{ink}">{zh}</text>')
        x += 28 + 18 * len(zh) + 34
    o.append(f'<text x="{R}" y="561" font-size="15" fill="{faint}" font-family="{MONO}" text-anchor="end">open source · MIT · zero deps</text>')
    SL, SR = D + 44, x1 - 44
    o.append(barcode(SL, 496, SR - SL, 46, 'relaycheck', ink))
    o.append(f'<text x="{(SL+SR)/2}" y="566" font-size="13" fill="{faint}" font-family="{MONO}" text-anchor="middle" letter-spacing="2">YANYUNCY/RELAYCHECK</text>')
    o.append(seal)
    o.append('</svg>\n')
    return '\n'.join(o)

# ------------------------------------------------------------------ lab
def guilloche(x, y, w, h, amp, color):
    per = 2 * (w + h)
    def at(s):
        s %= per
        if s < w: return x + s, y, 0, 1
        if s < w + h: return x + w, y + s - w, -1, 0
        if s < 2 * w + h: return x + w - (s - w - h), y + h, 0, -1
        return x, y + h - (s - 2 * w - h), 1, 0
    cyc = round(per / 26); lam = per / cyc
    out = []
    for k in range(4):
        ph = k * math.pi / 2; a = amp if k % 2 == 0 else amp * 0.62
        d = []
        s = 0
        while s <= per:
            px, py, nx, ny = at(s); off = a * math.sin(2 * math.pi * s / lam + ph)
            d.append(f'{"M" if s == 0 else "L"}{px+nx*off:.1f} {py+ny*off:.1f}')
            s += 4
        out.append(f'<path d="{"".join(d)}Z"/>')
    return f'<g fill="none" stroke="{color}" stroke-width="0.8">{"".join(out)}</g>'

def round_seal(cx, cy, R, color, angle, footer):
    p = [f'<circle r="{R-5}" fill="none" stroke="{color}" stroke-width="9"/>', f'<circle r="{R-18}" fill="none" stroke="{color}" stroke-width="2"/>']
    word = 'RELAYCHECK'
    cap = R * 0.17; em = cap / 0.727; rr = R - 28 - cap; track = em * 0.22
    def ww(ch): return em * 0.28 if ch == ' ' else CAPS[ch]['w'] / 1000 * em
    total = sum(ww(c) for c in word) + track * (len(word) - 1)
    a = -total / 2 / rr
    for ch in word:
        gw = ww(ch)
        if ch != ' ':
            mid = a + gw / 2 / rr
            p.append(f'<g transform="rotate({math.degrees(mid):.1f}) translate({-gw/2:.1f} {-rr:.1f}) scale({em/1000:.4f})"><path d="{CAPS[ch]["d"]}"/></g>')
        a += (gw + track) / rr
    gs = R * 0.44
    p.append(glyph(SEAL, '验', -gs - 2, -gs * 0.62, gs, f' stroke="{color}" stroke-width="12"') + glyph(SEAL, '货', 2, -gs * 0.62, gs, f' stroke="{color}" stroke-width="12"'))
    sr = R * 0.09; pts = []
    for i in range(10):
        an = -math.pi / 2 + i * math.pi / 5; rad = sr if i % 2 == 0 else sr * 0.4
        pts.append(f'{math.cos(an)*rad:.1f} {math.sin(an)*rad + R*0.56:.1f}')
    p.append(f'<path d="M{"L".join(pts)}Z"/>')
    return f'<g transform="translate({cx} {cy}) rotate({angle})"><g fill="{color}" filter="url(#ink)" opacity="0.9" style="mix-blend-mode:multiply">{"".join(p)}</g></g>'

def lab():
    paper, ink, grey, faint, g = '#fbfaf6', '#16181d', '#5f636c', '#979ba3', '#9fb3c8'
    o = head(paper)
    o.append(f'<defs>{ink_filter("ink", 5, 4)}{grain("grain", False, 0.045)}</defs>')
    o.append(f'<rect width="{W}" height="{H}" fill="#000" filter="url(#grain)"/>')
    o.append(guilloche(40, 40, W - 80, H - 80, 8, g))
    o.append(f'<rect x="58.5" y="58.5" width="{W-117}" height="{H-117}" fill="none" stroke="{g}"/>')
    L, R = 112, W - 112
    o.append(f'<text x="{L}" y="124" font-size="17" fill="{grey}" letter-spacing="2">检测报告 · LLM RELAY TEST REPORT</text>')
    o.append(f'<text x="{R}" y="124" font-size="16" fill="{grey}" font-family="{MONO}" text-anchor="end">No. RC-020</text>')
    o.append(f'<rect x="{L}" y="144" width="{R-L}" height="1" fill="{ink}"/>')
    o.append(f'<text x="{L-6}" y="290" font-size="128" font-weight="800" fill="{ink}" letter-spacing="-5" font-family="{DISPLAY}">relaycheck</text>')
    o.append(f'<text x="{L}" y="358" font-size="36" font-weight="600" fill="{ink}" letter-spacing="-0.5">Is your relay serving the real model?</text>')
    o.append(f'<text x="{L}" y="408" font-size="29" fill="{grey}">你的中转站是真模型吗？</text>')
    rows = [('身份 identity', 'p-value'), ('协议 protocol', 'tools · SSE'), ('计费 billing', 'hidden tokens'), ('上下文 context', '2k–100k')]
    y = 456
    for i, (a, b) in enumerate(rows):
        x = L + (i % 2) * 400; yy = y + (i // 2) * 40
        o.append(f'<path d="M{x+2} {yy-6}L{x+8} {yy}L{x+18} {yy-13}" fill="none" stroke="#17663f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
        o.append(f'<text x="{x+32}" y="{yy}" font-size="18" font-weight="600" fill="{ink}">{a}</text><text x="{x+190}" y="{yy}" font-size="15" fill="{faint}" font-family="{MONO}">{b}</text>')
        o.append(f'<rect x="{x+32}" y="{yy+12}" width="340" height="1" fill="#d8d9dc"/>')
    o.append(f'<text x="{L}" y="566" font-size="16" fill="{ink}" font-family="{MONO}"><tspan fill="{faint}">$</tspan> npx relaycheck &lt;url&gt;</text>')
    o.append(f'<text x="{L+330}" y="566" font-size="14" fill="{faint}" font-family="{MONO}">open source · MIT · zero deps</text>')
    o.append(round_seal(1012, 410, 132, '#c8352b', -12, ''))
    o.append('</svg>\n')
    return '\n'.join(o)

# ------------------------------------------------------------------ night
def night():
    bg, text, muted, faint = '#0a0d12', '#eef2f6', '#8b949e', '#5b6470'
    green, red, amber = '#3fdc7a', '#ff5d57', '#f2c14c'
    o = head(bg)
    o.append(f'''<defs>
<radialGradient id="g1" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{green}" stop-opacity="0.30"/><stop offset="0.6" stop-color="{green}" stop-opacity="0.05"/><stop offset="1" stop-color="{green}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#58a6ff" stop-opacity="0.18"/><stop offset="1" stop-color="#58a6ff" stop-opacity="0"/></radialGradient>
<linearGradient id="word" x1="0" y1="0" x2="0" y2="1"><stop offset="0.1" stop-color="#ffffff"/><stop offset="1" stop-color="#9fb0c2"/></linearGradient>
<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161b22" stop-opacity="0.92"/><stop offset="1" stop-color="#0d1117" stop-opacity="0.92"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0.04"/></linearGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="24"/><feOffset dy="18"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
{grain('grain', True, 0.05, 0.95)}</defs>''')
    o.append(f'<ellipse cx="1010" cy="330" rx="420" ry="300" fill="url(#g1)"/><ellipse cx="260" cy="120" rx="420" ry="260" fill="url(#g2)"/>')
    T, B, Lf, Rf = 80, 560, 80, W - 80
    ln = lambda d: f'<path d="{d}" stroke="#fff" stroke-opacity="0.08"/>'
    o.append(ln(f'M0 {T+.5}H{W}M0 {B+.5}H{W}M{Lf+.5} 0V{H}M{Rf+.5} 0V{H}'))
    for x, y in [(Lf, T), (Rf, T), (Lf, B), (Rf, B)]:
        o.append(f'<path d="M{x-8+.5} {y+.5}H{x+8.5}M{x+.5} {y-8+.5}V{y+8.5}" stroke="{text}" stroke-opacity="0.55"/>')
    o.append(f'<text x="{Lf}" y="56" font-size="15" fill="{muted}" font-family="{MONO}">relaycheck · 验货</text>')
    o.append(f'<text x="{Rf}" y="56" font-size="15" fill="{muted}" font-family="{MONO}" text-anchor="end">open source · MIT · zero deps</text>')
    o.append(f'<text x="{Lf}" y="{B+44}" font-size="15" fill="{faint}" font-family="{MONO}">github.com/YanYunCY/relaycheck</text>')
    o.append(f'<text x="{Rf}" y="{B+44}" font-size="15" fill="{faint}" font-family="{MONO}" text-anchor="end">identity · protocol · billing · context</text>')
    L = 128
    o.append(f'<text x="{L-6}" y="262" font-size="112" font-weight="800" fill="url(#word)" letter-spacing="-4.5" font-family="{DISPLAY}">relaycheck</text>')
    o.append(f'<text x="{L}" y="330" font-size="32" font-weight="600" fill="{text}" letter-spacing="-0.3">Is your relay serving the real model?</text>')
    o.append(f'<text x="{L}" y="378" font-size="26" fill="{muted}">你的中转站是真模型吗？</text>')
    o.append(f'<g transform="translate({L} 426)"><rect width="392" height="58" rx="10" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.14"/>'
             f'<text x="22" y="37" font-size="22" fill="{text}" font-family="{MONO}"><tspan fill="{green}">$</tspan> npx relaycheck &lt;url&gt;</text></g>')
    # terminal result panel
    px, py, pw, ph = 772, 150, 400, 330
    o.append(f'<g transform="translate({px} {py})" filter="url(#shadow)"><rect width="{pw}" height="{ph}" rx="14" fill="url(#panel)"/><rect x=".5" y=".5" width="{pw-1}" height="{ph-1}" rx="14" fill="none" stroke="url(#edge)"/>')
    for i, c in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        o.append(f'<circle cx="{24+i*18}" cy="24" r="5.5" fill="{c}" fill-opacity="0.85"/>')
    o.append(f'<rect y="47" width="{pw}" height="1" fill="#fff" fill-opacity="0.08"/>')
    lines = [(green, '✔', 'IDENTITY', 'p = 0.105'), (green, '✔', 'PROTOCOL', 'intact'), (green, '✔', 'BILLING', '+0 tokens'), (green, '✔', 'CONTEXT', '32k ok')]
    for i, (c, m, a, b) in enumerate(lines):
        y = 92 + i * 36
        o.append(f'<text x="24" y="{y}" font-size="17" font-family="{MONO}"><tspan fill="{c}">{m}</tspan><tspan dx="10" fill="{text}" font-weight="700">{a}</tspan></text><text x="{pw-24}" y="{y}" font-size="16" fill="{muted}" font-family="{MONO}" text-anchor="end">{b}</text>')
    o.append(f'<rect x="24" y="238" width="{pw-48}" height="1" fill="#fff" fill-opacity="0.08"/>')
    o.append(f'<circle cx="34" cy="281" r="12" fill="{green}" fill-opacity="0.4" filter="url(#soft)"/><circle cx="34" cy="281" r="6" fill="{green}"/>')
    hx = 56
    o.append(f'<g fill="{green}">' + glyph(HEI, '一', hx, 262, 40) + glyph(HEI, '致', hx + 42, 262, 40) + '</g>')
    o.append(f'<text x="{hx+96}" y="292" font-size="18" fill="{green}" font-weight="700" letter-spacing="3" font-family="{MONO}">CONSISTENT</text>')
    o.append('</g>')
    o.append(f'<rect width="{W}" height="{H}" fill="#fff" filter="url(#grain)"/>')
    o.append('</svg>\n')
    return '\n'.join(o)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in [('slip', slip), ('lab', lab), ('night', night)]:
        open(os.path.join(OUT, f'social-{name}.svg'), 'w', encoding='utf-8').write(fn())
    print('wrote', OUT)
