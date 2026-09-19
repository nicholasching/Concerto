# Playback contract

Source: `Show`, `Transport`, `Assignment`, `PendingAction`, and the ready/prepare/commit messages in `packages/contracts/src/`.

Track = immutable hashed audio asset; channel = logical lane; clip = source segment at a timeline position. A phone has one active assigned channel. Empty assignment is `channelId: null`. The backend validates clip references/source bounds, channel overlap rules, and show revisions before acceptance.

Transport uses `positionMs` (the position at `startServerMs` while playing, or the held position while paused). This is the concrete wire name for the original plan's conceptual position-at-start. When playing after the effective time: `positionMs + nowServerMs - startServerMs`. Before a pending change becomes effective, retain the previous state. Stopped has position zero and a null start time.

Pure sync maps server time to client performance time. Audio alone applies the output-clock mapping and any measured audio compensation; optical rendering must not use those adjustments. The foundation exposes clock/audio interfaces but does not implement an estimator or audio playback.

Each readiness acknowledgement binds its preparation ID and relevant revision/asset hashes. Unlocked audio is not the same as all assets decoded. Leases are renewed with `lease.renew`; Team 2 schedules their expiration on the audio timeline. An offline phone cannot receive an immediate panic.
