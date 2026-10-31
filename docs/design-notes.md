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

## Decision

- **Share card: B · Stamp is the default.** The full-height verdict block plus ✓/✕/– glyph is
  readable at 400 px even when the English word is long, and a white card with one solid colour
  block stands out in both light and dark feeds. A · Ink stays available for people who want it to
  match the terminal demo: `RELAYCHECK_CARD_STYLE=ink relaycheck … --card out.svg` (internal,
  undocumented switch; `stamp` is the default). The card follows `--lang` for its primary language.
- **Social preview: B · Stamp** (`docs/social-preview.svg`): Swiss wordmark + a red 验货 seal is the
  one memorable motif and ties to the card's stamp language. A (`docs/design/social-A.svg`) is kept.
- Regenerate everything with `bash scripts/cards.sh`.
