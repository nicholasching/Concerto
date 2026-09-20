# Concerto design direction

Author: Hansen Cheng. Transcribed 2026-09-20. This file is direction, not instructions to an agent.
`antislop.md` is applied as a filter on top of it.

## Who this is for

A stranger standing in a darkened auditorium, holding their own phone, who has never seen this
app before and will look at it for about two seconds at a time. They are not a user of a product.
They are an audience member who needs to be told what to do.

The projector view leads with the live joined count, set large, with the QR beneath it. The number
is real data from the session and climbs as people join, so the screen is worth a second look and
the room can see itself filling up. Nothing is shown when no count exists yet.

Priority order: the audience view (`/`) first, the projector view (`/present`) second. The camera
crew view (`/upload`) and the operator console (`/admin`) inherit the same system but are not the
priority, because their users are briefed beforehand and are not in the dark.

## Where direction lives

Two files. This one holds what the owner said out loud. `design-system/concerto/MASTER.md` and
`design-system/concerto/pages/app.md` hold the generated system and its overrides. Typography,
type scale, spacing and the no-sans rule come from `pages/app.md`. Two things below contradict `pages/app.md`, both on the owner's
later instruction, both recorded here rather than resolved quietly:

1. **Palette.** That file asks for a neutral inverted ramp with the channel colour as the only
   chroma. The owner asked for a warm ramp on 2026-09-20, so the warm ramp wins.
2. **Label face.** That file makes "no UI sans-serif anywhere" binding. The owner asked for Arial
   on the label face on 2026-09-20, so the small text is sans. Display and body stay serif, so
   the rule still holds everywhere else.

## Direction, in the owner's words

- As minimal, straightforward and easy to follow as possible.
- Keep only what is necessary. Fewer words.
- The most visible line of text is the person's current status and what they need to do next.
- Dark, because there will be less light pollution.

## Dials

ENERGY 2 / RHYTHM 1 / MOTION 1.

Energy was raised from 1 to 2 on 2026-09-20: the owner asked for personality after the first
build read as sterile. Rhythm stays uniform, because an audience reading the same screen at four
different moments should not have to relearn the layout each time. Motion stays at 1, because
anything that moves on its own competes with the stage.

## Identity motif

**The instruction is the only large thing on the screen.** One sentence, set large, alone, with
empty space on every side. Every view repeats that same gesture: the audience phone, the projector,
the camera-crew page. Whatever the person must do next is the biggest object in front of them, and
nothing else is allowed to compete with it.

## The one accent

Orange, `#d97a34`, at one moment per screen: the thing you press, or nothing.

The three channel colours in `packages/contracts/src/show-defaults.ts` are product data, not a
design choice, and they are cool (sky, violet, amber) against this warm ground. So the part name
is set in cream and the channel colour appears only as a small marker beside it. If those values
are ever reopened, warm equivalents would suit this palette better; that is the captain's call.

## Palette

Two core values plus neutrals, plus the single accent above.

| Token | Value | Reason |
| --- | --- | --- |
| `--bg` | `#16110d` | Near black with a warm brown cast. Dark for the auditorium, warm because the owner asked for cream, orange and dirt rather than neutral. |
| `--surface` | `#1f1812` | Raised panels in the console. |
| `--ink` | `#ece0cb` | Dark cream. Primary text. |
| `--muted` | `#a3907a` | Dirt. Secondary text only. |
| `--accent` | `#d97a34` | Orange. The one accent. |

No photographic backgrounds and no texture: the owner asked for solid colour. The theme is fixed
dark for the auditorium reason above, not because dark reads as technical.

## Typography

Taken from `design-system/concerto/pages/app.md`, which the owner generated and edited in the
repo: **Playfair Display** for display type, **Source Serif 4** for the rare line of body text,
**Arial** for every label, number and status value. Its display and body faces are taken as given; its no-sans rule is overridden for the
label face only, as recorded above.

Playfair Display is a high-contrast serif, which is the direction the owner chose. Concert
programmes and classical music bills have set their type this way for two hundred years, which is
the tradition this product sits in, and the instruction is never more than a few words, so the
stroke contrast costs nothing in reading speed.

Arial carries every label, number and status value, on the owner's instruction. It is a system
face, so it needs no webfont request and renders identically without a network. Its digits are
uniform width by default, which is what the counts, device numbers and clock values actually need,
so replacing the monospace face costs nothing in column alignment. The CSS variable is `--label`
rather than `--mono`, because the name should not outlive the face.

No uppercase with wide letter-spacing anywhere. Hierarchy comes from size, weight and space.

Type scale, from `pages/app.md`: 12 / 16 / 22 / 32 / 40 / 56 / 72.
Spacing scale, from `pages/app.md`: 4 / 8 / 24 / 32 / 48 / 64 / 96.

## Shape and space

- Minimalism and Swiss, per `pages/app.md`: grid, whitespace, no decoration, no shadows.
- Radius 0 on surfaces, 4px on interactive controls only. The rule: things you can press are
  rounded, things you cannot are not. That is the only job radius does here.
- No shadow, no glow, no blur, no gradient, no texture, no background pattern. There is no
  hierarchy problem on these screens that needs any of them.
- Spacing on a 4px scale. Vertical rhythm tiers: 8 / 16 / 24 / 40 / 64.

## Things this direction rules out

Named so they do not reappear: the pill label above a headline, uppercase micro-labels with wide
tracking, a status dot that marks nothing, a full-page coloured glow, arrows on buttons as
decoration, and any tagline. If a line of text is not a status, an instruction, or a real number,
it does not ship.
