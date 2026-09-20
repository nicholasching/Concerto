# Accept valid optical IDs with non-collision warnings

Date: 2026-09-19. Owner: integration captain / OTC. Status: accepted under the user's explicit request during the five-phone investigation to broaden acceptance when a flash code identifies a valid device and there is no collision.

Decoder v1.5 found all five codes in the PXL recording but made two ambiguous because rolling color/exposure changes split a screen into small tracked fragments. These fragments competed with the same phone; they were not two independent devices. A changing component area was also a permanent veto even with two correct identity passes.

Decoder v1.6 retains exact preamble and run tag, bounded Hamming decoding, participant membership, phase consistency, duplicate identity rejection and contradictory cross-camera geometry rejection. One bounded identity pass is accepted when the repeat is unreadable; two readable but conflicting IDs remain ambiguous. Scores/reasons disclose reduced evidence. A size change or competition with a fragment born inside an already tracked screen is a warning, not a veto.

Record competing tracks and collision timestamps. Separate footprints at the competing track's birth, observed across at least three samples and 60 ms, are evidence of independent screens; a competing complete preamble is also collision evidence even with nested footprints. Only collision evidence during the verified packet vetoes the identity. Do not feed uncertain merged detections into a track or guess missing symbols. Duplicate decoded identities remain blocked as possible reflections, and candidates still require operator review before commit.

This supersedes the earlier strict two-pass-only and blanket tracking-warning veto policy for this demo. It does not change the transmitted OTC packet/codebook or claim a calibrated probability. Validate single-pass membership/tag behavior, conflicts, screen merges/crossings/reflections, original five-phone clip, and previous physical clips. No physical scale/venue acceptance is inferred from these tests.
