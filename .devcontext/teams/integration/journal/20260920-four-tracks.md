# Four musical tracks

Owner: integration captain, main at fab411e14b503eaa501ac7c97c3dcbfbc75b55e1. Clean starting worktree; foundation-v1 is ab59c27105627977ee52dc2bcd4276b4532b9e2a.

User request: add a fourth musical lane called Percussion 2. Assumption: retain Melody, Vocals, Percussion, existing assets and saved section presets. No new audio was supplied. The fourth lane starts empty in existing shows; synthetic demos receive an original fourth tone.

Integration scope: shared show defaults/generated fixtures, admin existing-show addition, focused backend/audio/admin verification and current docs. Generic wire schemas already support this; no protocol or optical change. This is captain integration on merged main, with no parallel file owners active.

Plan: add the default and a non-destructive existing-show editor action; regenerate fixtures; exercise fourth-channel routing/playback and draft preservation; run root sync/client/admin gates. Inspect the live show and add the empty lane through the guarded save API only while stopped, preserving uploaded assets and routing. Record software versus physical evidence separately.

Checks planned: bundled Bun `fixtures:generate`, `gate:sync`, `gate:client`, `gate:admin`, targeted fourth-lane tests. Physical phone sound remains unverified.
