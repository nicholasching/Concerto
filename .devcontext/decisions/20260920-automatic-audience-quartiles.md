# Four automatic audience sections
Date: 2026-09-20. Status: accepted under the user's explicit integration request. Owner: integration captain; affected owners sync/control, contracts, audio/client, admin.

Replace manual spatial splits with balanced device-count quartiles: sort committed localized phones by x, then y, then device ID; distribute remainder phones left-to-right. Groups are left, center-left, center-right, right. Only localized coordinates establish automatic membership; coarse/unknown phones may choose one of these four sections explicitly. Camera columns remain left/center/right and optical geometry/contracts remain distinct from musical sections.

Add optional Show.sectionChannels (four section keys to channel IDs or null), AudienceMap.sections (device/section/source), and ParticipantSnapshot.audienceSection, plus participant.section message. Optional fields preserve existing checkpoints/fixtures; old clients must refresh because strict parsers reject new snapshot fields. Existing participant.column remains compatible. Regenerate shared JSON schemas; optical payloads are unchanged.

The current three musical lanes and saved tracks remain intact. Default routes by label are Left/Melody, Center left/Vocals, Center right/Vocals, Right/Percussion; each section may select any lane or silence in show configuration. These defaults are editable presets, not a fourth invented stem. A saved preset is authoritative.

Calibration retains its reviewed-map commit. Committing while stopped automatically recomputes all localized quartiles and applies their music routes, clearing assignments for targets that became unknown. Step 02 becomes a read-only automatic section overview with data-derived boundaries/counts. Saving a preset while stopped updates current section members; another calibration is unnecessary. Unknown positions are never invented. Tie-split groups may share a boundary x; section membership uses sorted rank and remains deterministic.

Preserve pending/cue/readiness safety, durable show/map/assignments, restart behavior and physical evidence distinctions. Backward compatibility for the old manual-column command remains; new participant UI uses four-section choices.
