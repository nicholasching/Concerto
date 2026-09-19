# Subplan 04: channel playback, transport, mix, panic and lease
Status: implemented 2026-09-19; ready for integration (listening check pending, see status.md)
Owner / branch / baseline: Team 2 / feat/audio-client / aa4475a (slice 3 + unlock fix)
Source: masterplan §6 Team 2 steps 4-5, "Timeline and timing semantics", "Media, memory, and network budgets". Stage brief 02 slice 4. Contracts: `Show`/`Clip`/`Channel`, `Transport`, `Assignment`, `PendingAction`; messages `assets.*`, `assignment.*`, `transport.*`, `mix.commit`, `panic`, `lease.renew`.

## Goal

The phone plays only its assigned channel from the shared show timeline, starting at a common server time. It follows play, pause, seek and stop, and switches channel mid-song at the shared playhead. It mutes at once on panic and goes silent by itself if it stops hearing from the server. It never plays a stale or superseded command. All of this runs against Team 2's mock, with no other branch.

## Timeline rules (masterplan §6, schema/playback.md)

- Show playhead at server time `S` while playing: `showPositionMs = positionMs + (S - startServerMs)`. Paused holds `positionMs`. Stopped is 0 and silent.
- A clip sounds when `timelineStartMs <= showPositionMs < timelineStartMs + durationMs`. Its source offset is `sourceOffsetMs + (showPositionMs - timelineStartMs)`.
- Only clips on the assigned channel play. `channelId: null` is silent.
- Server time goes to the audio clock through slice 1's `serverMsToAudioTime` only. No second compensation.

## Behaviour

1. **Assets.** On `assets.prepare`, the phone preloads that show (slice 1 `preloadTracks`) and replies `assets.ready` with `preparationId`, `showRevision` and the hashes it actually verified. If audio is locked or any track fails, it replies `ready: false` with a reason.
2. **Assignment.**
   - On `assignment.prepare`, the phone checks that audio is running and that its target channel's tracks are decoded. It replies `assignment.ready` for that `assignmentRevision`.
   - On `assignment.commit`, it takes its own entry. At `effectiveServerMs` it:
     - schedules the new channel's sources at the shared playhead (never from zero)
     - ramps the old channel down and the new one up over 30 ms
     - stops the old sources
   - If the target isn't decoded, it goes silent rather than playing something wrong.
3. **Transport.**
   - `transport.prepare` asks "can you play show revision R, transport revision T?". The phone checks audio, decoded tracks for its channel, and a usable clock, and replies `transport.ready`.
   - On `transport.commit` the new state takes effect at `effectiveServerMs`, and the current state keeps playing until then.
   - Play and seek schedule every clip that overlaps from that moment on. Pause and stop ramp down and stop sources at that moment.
   - The page shows a countdown for a pending change.
4. **Mix.** `mix.commit` sets master gain and per-channel gain, mute and solo at `effectiveServerMs`, using gain automation. Asset timing never changes. Solo on any channel silences non-soloed channels.
5. **Revisions.** Every source belongs to one `(showRevision, transportRevision, assignmentRevision)`.
   - A commit with an older revision than the one already applied is ignored.
   - A replacement in the same domain cancels the pending one. A newer mix doesn't cancel a pending transport change.
   - Stale `onended` callbacks are ignored, so a finished source never moves the show on.
6. **Late join and reconnect.** A fresh `state.snapshot` rebuilds everything from `transport`, `assignment` and `pendingActions`.
   - If the show is already playing, the phone joins at a new rendezvous: `now + 1000 ms`, at the playhead for that moment.
   - If it can't make that in time, it stays silent and tries again at the next rendezvous.
7. **Panic.** `panic` stops every source and closes the output gate immediately on receipt.
   - The current `transportRevision` is marked invalid, so only a later transport commit or snapshot with a higher revision can play again.
   - Audio must still be running before it resumes.
8. **Lease.** `lease.renew { expiresServerMs }` keeps a separate output gate (a gain node after master) open, and the gate is scheduled to close at `expiresServerMs` on the audio clock.
   - Each renewal moves the close time.
   - A background-throttled timer never decides this; the audio clock does.
   - Without a valid lease the gate stays closed.
   - After an AudioContext interruption, the phone needs audio unlocked again before the gate reopens.

## Design

- `packages/audio/src/timeline.ts`: pure maths.
  - `showPositionAt(transport, serverMs)`
  - `clipStarts(show, channelId, transport, fromServerMs)`: returns each clip's server start time, source offset and duration from a given moment
  - `rendezvousMs(nowServerMs, leadMs)`
- `packages/audio/src/playback.ts`: `PlaybackEngine(ctx, output, clock, buffers)`. It builds the node graph `sources → channel gain → master gain → lease gate → destination`, and exposes:
  - `applyTransport(transport, effectiveServerMs)`
  - `applyAssignment(channelId, effectiveServerMs)`
  - `applyMix(mix, effectiveServerMs)`
  - `panic()`
  - `renewLease(expiresServerMs)`
  - `dispose()`

  Each source is tagged with its revisions, and superseded ones are stopped and disconnected.
- `client-frontend/src/lib/show-control.ts`: `ShowControl`, a message-to-engine and ready-reply state machine (the same pattern as `CalibrationSession`). It also rebuilds from a snapshot.
- `page.tsx`: shows the channel name and colour, the transport state with playhead, any pending change with countdown, and "Muted by operator" after panic. The slice 1 "Audio check" box is removed; this replaces it.
- Clock: the same rule as slice 3. Production has no clock yet, so it answers `transport.ready` with `ready: false, reason: "clock"`. Mock mode uses the labelled fixture clock.

## Mock scenario (`tools/client-demo/`)

The mock keeps authoritative `transport`, `assignment` and `pendingActions` in its snapshot, so reconnects are correct. Loopback test controls:

- `POST /__mock__/assign?deviceId=0&channelId=channel-1&leadMs=2000`
- `POST /__mock__/transport?action=play|pause|seek|stop&positionMs=0&leadMs=2000`
- `POST /__mock__/mix?masterGain=0.5&mute=channel-2`
- `POST /__mock__/panic`
- `POST /__mock__/lease?paused=1` stops the automatic `lease.renew` (every 3 s, 10 s expiry) so expiry can be tested
- each prepare step replies with ready counts at `GET /__mock__/playback`

## Tests

- timeline maths:
  - position while playing, paused and stopped
  - clips before, inside and after the playhead
  - clip source bounds
  - seeking into the middle of a clip
  - multiple successive clips on one channel
  - null channel
- engine (fake AudioContext with recorded `start`/`stop` and gain automation):
  - play schedules the right audio times and offsets
  - a channel switch starts the new channel at the playhead offset (not 0) with a ramp at `S`
  - pause and stop happen at `S`
  - seek cancels and reschedules
  - a superseded or stale revision is ignored
  - stale `onended` doesn't advance anything
  - mix gains, mute and solo
  - panic stops everything at once
  - lease gate closes at expiry, moves on renewal, and stays closed without a lease
  - a missing asset stays silent
- show-control: every prepare/ready pair (ids, revisions, reasons), pending vs effective, snapshot rebuild with pending actions, panic then only a newer transport plays
- mock end-to-end: join, assign, play, reconnect mid-song, and the client rebuilds the same playhead

## Verification

- `bun run gate:client`.
- Browser (you, since my automation window can't unlock audio): two tabs as two devices. Assign channel 0 to one and channel 1 to the other, then play. Each tab plays its own tone. Reassign mid-song, and the tone switches without restarting. Then check pause, seek, stop, mute and panic. Pausing the lease should make the sound stop within about 10 s.
- Unverified after this slice:
  - real phones
  - acoustic sync between devices (needs Team 1's clock and slice 5)
  - the real backend

## Review decisions (2026-09-19)

1. Master volume on reconnect: a phone keeps the last master gain it knew during this page load, and uses 1.0 on a fresh load. I'll draft a proposed ADR asking the captain to add `mix: { mixRevision, masterGain }` to the snapshot.
2. Lease: the phone stays silent until its first `lease.renew`. The mock sends one straight after connecting, and Team 1 is asked to do the same.
3. Late join: the phone rejoins a playing show 1 s ahead.
