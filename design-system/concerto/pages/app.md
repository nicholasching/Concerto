# Concerto — app UI overrides

Overrides `MASTER.md` for the four product surfaces (`/`, `/admin`, `/present`, `/upload`).
Generated from `ui-ux-pro-max --design-system --variance 3 --motion 2 --density 2`, with the
deliberate deviations below.

## Accepted from MASTER

- **Typography:** Playfair Display (display) / Source Serif 4 (body) / JetBrains Mono (labels,
  numbers, status). The pairing's rule is binding: **no UI sans-serif anywhere.**
- **Type scale:** 12 / 16 / 22 / 32 / 40 / 56 / 72.
- **Spacing:** the spacious 4 / 8 / 24 / 32 / 48 / 64 / 96 scale.
- **Style:** Minimalism & Swiss — grid, whitespace, no decoration, no shadows.
- **Motion:** subtle tier, 200–350ms, reduced-motion respected.

## Deviations, and why

- **Inverted to dark.** MASTER returns a light monochrome palette (`#FAFAFA` ground). The product
  runs in a darkened auditorium on hundreds of audience phones, so a light ground is a
  house-lighting problem. Minimalism & Swiss declares dark supported; the ramp is inverted, not
  re-hued.
- **No blue accent.** MASTER proposes `#2563EB` as accent. Rejected: the only chroma on screen is
  the device's own channel colour, from `packages/contracts/src/show-defaults.ts`
  (Melody `#38bdf8`, Vocals `#a78bfa`, Percussion `#f59e0b`). Colour therefore always *means*
  "this is your part" and never decorates. A second accent would compete with that signal.
- **Landing pattern rejected.** MASTER returns "Hero + Features + CTA" with a testimonials/CTA
  section list. These are four live operational surfaces, not a marketing page. Per the skill's
  own "verify fit for the user's product and platform" rule, the pattern is discarded; style,
  colour, typography and motion are kept.

## Binding rules for these surfaces

- The largest type on any view states the user's **current status and next action**. Never a
  tagline, never the brand.
- `.calibration` (optical flash surface) and `.projector-qr` take **no** gradient, tint, grain or
  radius. Both are colour- and contrast-critical to camera decoding and QR scanning.
- Muted body text uses `--fg-muted` (7.2:1). `--ink-400` is decorative/large-text only (4.0:1) and
  must never carry normal-size body copy.
