# Launch visuals: design notes

Rules distilled for the share card (`src/report/card.ts`, 1200×630) and the repo social
preview (`docs/social-preview.svg`, 1280×640). Sources at the bottom.

## What the images are for

- **Share card** = a result screenshot, like a Speedtest or Lighthouse score card. People post
  it on X / V2EX / WeChat, where it is shown ~400 px wide (a third of its real size). In one glance
  a viewer must get *the verdict*; on a second look, *which model* and *the number that decided it*.
- **Social preview** = the repo's Open Graph image. It needs only the name, one line about what the
  tool does, and one recognisable ground/motif. The link card already shows the URL, stars, owner.

## Rules

1. **One dominant element.** The verdict (一致 / 不一致 / 存疑) is the hero, ≥ 3× the size of
   anything else (168 px on a 1200 px card → ~56 px at thumbnail size). Everything else is quieted
   ("emphasize by de-emphasizing", Refactoring UI).
2. **Three levels, no more.** 1: verdict. 2: claimed model + one decisive number
   (identity p-value, or `+512 tokens/请求`). 3: four status chips and a small footer.
   The old card gave every row equal weight; that is why nothing stood out.
3. **Labels are a last resort.** Values carry their own meaning (`+512 tokens/请求`); labels that
   remain are small and grey.
4. **Few colours, verdict drives the palette.** One neutral ground, 2–3 text greys, and a single
   verdict hue (green / red / amber). Status colour appears only where it is information
   (chips). No gradients-as-decoration, no neon.
5. **Extreme type-scale contrast, two weights.** 168 / 52 / 36 / 20 / 16 px; 400 and 700–800.
6. **Generous margins, one grid.** 72 px outer margin (≥ the 30–64 px that link previews crop or
   round off), one left edge, columns on an 8 px grid; nothing critical in the outer 5 %.
7. **Legible at thumbnail size.** Check every card downscaled to 400 px wide. Level-3 text may blur
   there, but its colour pattern (which chip is red) must still read.
8. **Bilingual without clutter.** The `--lang` language is primary; the other language appears
   once, small, under the verdict only. Chips and labels use the primary language only.
9. **Brand mark, minimal text.** A small 验 seal + `relaycheck` wordmark, date, "host hidden", repo
   path. No headline paragraph, no feature list, no screenshots of text.
10. **Robust rendering.** Pure SVG, explicit CJK font stack per platform, width-based (CJK = 1 em)
    truncation for every user-supplied string, no external fonts/images.
11. **Social preview safe area.** Content within x 80–1200, y 60–580 (2:1 shown in a 1.91:1 card
    loses ~30 px per side); solid ground (no transparency; chat apps flip light/dark).
12. **Avoid generated-design tells** (Anthropic frontend-design skill): no all-caps eyebrow labels
    on everything, no identical shadowed SaaS cards, no gradient washes; spend boldness in one place.

## Directions

- **A · Ink** (dark, terminal-adjacent): GitHub-dark ground `#0d1117` matching the demo GIF,
  JetBrains Mono for data, huge verdict word in the verdict hue, tinted status pills.
- **B · Stamp** (light, Swiss): white ground, a full-height verdict-colour block on the left holding
  a stamp glyph (✓ / ✕ / –) and the verdict word in white; Swiss grid on the right with a very large
  decisive number. Social preview uses a red 验货 seal as the motif.

## Sources

- GitHub Docs, social preview size (1280×640, < 1 MB, solid background advised):
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
- Gradiently, GitHub social preview safe area (2:1 → 1.91:1 crop, 64 px margins, name + one line):
  https://gradiently.design/guide/github-social-preview
- TechCompare, OG image design (judge at ~400 px; 40–60 px text stays legible):
  https://www.techcompare.app/open-graph-viewer/og-image-design-tips
- Refactoring UI, "Labels are a last resort", "Emphasize by de-emphasizing":
  https://refactoringui.com/previews/labels-are-a-last-resort
- Anthropic `frontend-design` skill (one bold element, restraint, avoid template tells):
  https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

## Decision (round 1, superseded by round 2 below)

- **Share card: B · Stamp was the default.** The full-height verdict block plus ✓/✕/– glyph is
  readable at 400 px even when the English word is long, and a white card with one solid colour
  block stands out in both light and dark feeds. A · Ink stays available for people who want it to
  match the terminal demo: `RELAYCHECK_CARD_STYLE=ink relaycheck … --card out.svg` (internal,
  undocumented switch; `stamp` is the default). The card follows `--lang` for its primary language.
- **Social preview: B · Stamp** (`docs/social-preview.svg`): Swiss wordmark + a red 验货 seal is the
  one memorable motif and ties to the card's stamp language. A (`docs/design/social-A.svg`) is kept.
- Regenerate everything with `bash scripts/cards.sh`.


---

# Round 2 (2026-10-31): from "template" to "object"

Feedback on B: "还行，但是还是有点丑". Critique we accepted: the card's left half was a flat slab
with a clip-art ✕-in-circle; the right half read as a default admin dashboard (grey chips, thin rule);
Inter + Noto mixed weights/baselines; `p = 9.1e-6` spacing was off; the social seal looked fake
(too clean, generic serif, a plain tilt), with dead whitespace and a cliché red bar.

## What the references actually do

Looked at (downloaded and viewed): Linear (`linear.app/api/og/main`), Linear changelog OG, Supabase
Launch Week 15 OG, Raycast OG, Vercel home OG, Next.js Conf 2025 OG, GitHub Universe 26 OG, Arc
farewell OG, Resend cover, Bun share card, PlanetScale and Warp OG; plus a Speedtest result screenshot
and modern 印章 branding (a China brand-design award entry, poster-style seal compositions, a real
wooden-seal impression photo, a hanko photo). Concrete takeaways:

1. **Texture, not flat fills.** Supabase's grainy galaxy in the type, Raycast's glossy red ribbons,
   Linear's soft vertical gradient: every top card has *some* surface (grain, gloss, light falloff).
   A flat #fff or flat red block is what makes B look like a template. → paper grain / film grain via
   `feTurbulence`, always at low alpha (≈ 4–6 %).
2. **One object, one light source.** Raycast shows the product window lit from behind; Linear lights the
   mark from above. Depth comes from one soft shadow + one glow, not borders. → the slip floats on a
   ground with one soft drop shadow; night has one verdict-coloured bloom.
3. **Colour restraint.** Linear and Supabase are essentially monochrome + one accent; Raycast is red only.
   → each card uses neutrals + the verdict hue; status colours appear only in the four checks.
4. **Tight display tracking, generous body tracking.** Large words are tracked negative (Linear, Vercel
   wordmarks ≈ −3 to −5 %); small metadata is monospace and tracked open. → wordmark −5 px at 132 px,
   mono metadata +1.5–3 px.
5. **Craft details at the edges.** Universe/Next.js conf use frame lines, crosshair registration marks and
   tiny monospace metadata (version, date, serial) in the corners. They read as "made", and they cost
   nothing at thumbnail size because they vanish. → serial numbers, barcodes, `v0.2.0 · date`, crop marks.
6. **A real seal is not a clean vector.** Real impressions show ragged edges, uneven pressure (pale
   patches), tiny unprinted pinholes, slight transparency over the paper, and a heavy outer border with a
   thinner inner one; text is 白文 (knocked out) or 朱文 with strong, even strokes. → `inkFilter`:
   low-frequency displacement for edges + thresholded fine noise for pinholes + a slow blotch for
   pressure, `multiply` blend at ~0.9 opacity.
7. **Speedtest-style result = one number on a scale.** The value is meaningful because it sits on a
   gauge. → the p-value now sits on a log ruler (1 → 1e-8) with green/amber/red zones at 0.01/0.001.
8. **The hero must not depend on the viewer's fonts.** → verdict words and seal text are drawn as
   embedded glyph outlines (Noto Sans/Serif CJK SC, ZCOOL QingKe HuangYou, Inter Display Black, all OFL),
   generated at build time by `scripts/gen-glyphs.py` into `src/report/glyphs.ts` (~21 KB).

## Round-2 directions

- **slip · 验货单** (default): an inspection slip on a warm ground, perforated stub with punched notches,
  double rules, form checkboxes, slip number + decorative barcode, and the verdict as a real-ink
  rectangular chop that straddles the perforation like a 骑缝章. Social: wordmark on the slip + a
  白文 验货 seal in real ink on the perforation.
- **lab · 检测报告**: a test certificate: guilloché border (phase-shifted sine strands), fine-ruled table,
  Song-style drawn verdict, round inspection seal with arc lettering.
- **night**: GitHub-dark ground in the demo GIF's palette, verdict in a white→verdict gradient with bloom,
  frame lines with crosshair registration marks, status bar between the frame lines, film grain.

Rendered: `docs/design/round2/card-{slip,lab,night}-{fail,pass}.png`, `social-{slip,lab,night}.png`,
`contact-sheet.png` (references, round 1, round 2 side by side).

## Honest critique after two iterations

- **slip**: most distinctive and the only one that is *ours* (验货 is literally the product). The chop
  reads at 400 px as a red/green stamp even before the word is legible; numbers, model and checks keep
  a clear second level. Weakness: busier than night; the seal-script font was too thin at thumbnail
  size, so the chop uses heavy sans outlines (seal font stays in the brand mark and social seal).
- **lab**: the most "trustworthy" mood, but the guilloché is invisible at 400 px and the round seal
  competes with the verdict rather than adding to it. Kept as an option.
- **night**: the most immediately legible at 400 px and the most launch-like, but it is also the most
  generic (it looks like many dev-tool launch cards). Best fit when posting next to the terminal GIF.

## Decision (round 2)

- **Share card: slip** is the default (`RELAYCHECK_CARD_STYLE` accepts `slip` | `lab` | `night` | `ink` |
  `stamp`, legacy `a`/`b`). Why: the verdict reads as a physical stamp at a glance and the whole image is
  a 验货单, which is the product's own metaphor, so it looks like a brand rather than a template.
- **Social preview: slip** (`docs/social-preview.svg` = `docs/design/round2/social-slip.svg`). Why: the
  ink 验货 seal is the single memorable motif, and it matches the card people will share.
- Regenerate: `bash scripts/cards.sh` (cards + socials); glyph outlines: `python3 scripts/gen-glyphs.py
  <fonts-dir>`; contact sheet: `python3 scripts/contact-sheet.py <refs-dir>`.

Round-2 reference sources (OG images as served on 2026-10-31): https://linear.app, https://linear.app/changelog,
https://supabase.com/launch-week, https://www.raycast.com, https://vercel.com, https://nextjs.org/conf,
https://githubuniverse.com, https://arc.net, https://resend.com, https://bun.sh, https://planetscale.com,
https://warp.dev; seal references: https://www.ishejishi.com/awards/di-si-jie-zhong-guo-pin-pai-she-ji-da-sai-1.html,
https://www.designkit.cn/hot/11397, https://www.vecteezy.com/free-photos/chinese-stamp,
https://stockcake.com/i/traditional-japanese-seal_3759645_1764786. Fonts: Google Fonts OFL
(ZCOOL QingKe HuangYou), Noto CJK (OFL), Inter (OFL).
