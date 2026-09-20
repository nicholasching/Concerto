# Full red and existing blue for new calibration runs

Date / owner: 2026-09-20, integration captain.
Status: accepted by explicit user request after discussion of the prior amber choice.
Affected teams: admin-console, audio-client, otc-localization. Supersedes the masterplan's preference for amber instead of saturated red; packet/codebook and protocol v1 remain unchanged.

## Decision

New admin and demo calibrations use `red-blue-v1`: zero = `#FF0000`, one = `#0066FF`, neutral = `#111111`. `DEFAULT_CALIBRATION_PALETTE` in the shared contracts package is the single default. Each created plan freezes its own colors and version. Existing prepared/recorded amber runs keep their original palette; start a new run to use red.

The worker uses the manifest's zero color to select pilot and phase-onset evidence. Red requires normalized red above green and blue; legacy amber retains its red/green-above-blue checks. Existing blue evidence, pilot separation, sample-distance margins, frame votes, exact header/tag, bounded ID decoding, collision and duplicate checks remain. The existing broad bright/dim candidate masks already find red; no extra hue segmentation pass is needed. Decoder version is `otc-v1.7`.

Only the requested red/current-blue pair and the legacy amber/current-blue pair are supported; unsupported pairs fail explicitly. The exact emitted colors are recorded in the manifest, while measured pilot colors account for exposure and white balance. This is not an arbitrary-palette tuning interface.

Synthetic capture now reads its emitted colors from the input manifest. Existing committed amber fixtures remain as compatibility regressions. New red footage tests inspect the encoded red pixels independently and validate decoded identities/positions, including dim and washed screens.

## Verification / handoff

See the [journal](../teams/otc-localization/journal/20260920-red-blue-palette.md). This color change requires a fresh physical recording to evaluate camera performance. No live calibration, reset or map mutation is part of the implementation checks.
