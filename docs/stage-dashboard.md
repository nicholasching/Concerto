# Running the stage dashboard

Start `bun run dev:all` and the configured Cloudflare connector. One public hostname serves all four views:

| Page | Use |
| --- | --- |
| `/` | Audience phones: automatic join, clock sync and music verification |
| `/admin` | Password-protected Calibration, Assign and Performance controls |
| `/present` | Projector QR and live aggregate audience counts |
| `/upload` | Camera crew login and left/center/right video delivery |

Locally use `http://localhost:3000`; the configured public origin is `https://htn.nicholasching.ca`. Port 3001 is the internal admin Next process. `OPERATOR_SECRET` belongs in the ignored root `.env`, never a public environment variable or Git. Camera crew use the same configured password; their page receives a limited upload token that cannot operate the show. Changing backend configuration requires a restart, so finish or discard an active calibration before restarting.

## Before the audience arrives

1. Open `/admin`. In **Performance → Prepare show and stems**, save the desired Melody, Vocals and Percussion clips. Wait for phone asset verification after changes.
2. Open `/present` in the projector browser and enter browser full screen. The QR uses `NEXT_PUBLIC_PARTICIPANT_URL` when configured, otherwise the page's own origin. Configure this before starting Next or building production. Counts show connected phones, usable clocks and verified music; they are aggregate data without audience identities.
3. To start a fresh audience, choose **Reset**, then **Disconnect and reset**. This stops sound, cancels pending work, clears identities/positions/assignments/calibration, invalidates credentials and rotates the clock epoch. Saved show and audio remain. Existing audience pages stay disconnected until refreshed; old resume tokens cannot restore old devices. Calibration run tags keep increasing to reject old recordings.

## Capture and map

1. Audience phones open `/`, turn their volume up and keep the page visible. Asset downloads and clock synchronization begin automatically. Sound is attempted automatically, but browsers that require a gesture show **Tap to enable sound**. A successful tap removes that control; it does not falsely mark a suspended AudioContext as ready.
2. In **Calibration**, select **Prepare calibration**. Start the recording cameras, then select **Cameras recording — start pattern**. Phones receive the existing raise-phone instructions and eleven-second optical sequence. Keep leading/trailing recording margin.
3. On each recording phone, open `/upload`, sign in and choose its audience section **while facing the stage**. For stage-facing cameras, image-left/right is reversed relative to this audience convention; use the existing camera orientation controls to handle that geometry.
4. Select the original video (up to 1 GiB). After the pattern finishes, select **Upload recording** and keep the page open until **Recording delivered**. Eight-MiB chunks are SHA-256 verified; **Retry upload** skips completed chunks after a dropped connection. Page reload or server restart starts a new transfer. Only one completed clip per section is accepted. Desktop uploads remain available in Calibration.
5. Recordings appear in the admin camera slots automatically. Select one, two or three distinct views, specify the seating corners or explicitly use the approximate stage-facing frame preset, and process. Review the candidate and commit it before assigning parts. Geometry changes require reprocessing.
6. Successfully mapped phones display their section. Unmapped phones get only **left / center / right** choices after calibration is complete. These fallback choices have no invented seat coordinates.

## Assign and perform

Use **Assign** to click phones, draw a box/lasso, or move the two region dividers. Choose **Melody**, **Vocals** or **Percussion**, then assign the selection. Column buttons include manual choices. Selection always carries the current map revision.

Use **Performance → Prepare cue**, inspect readiness/exclusions, then **Start show**. The existing shared clock drives playback, pause, seek and channel changes. **MUTE ALL** remains visible in the command bar. Prepare-show editing and command history are collapsed when not needed.

## Checks and recovery

- Performance actions (play, pause, stop, seek, mute, solo and gain) take effect two seconds after the click. Assignment defaults to two seconds after preparation; calibration keeps its four-second camera countdown. Panic is immediate.
- Wait for **Show clock: In sync**, **Music: Verified**, and **Sound: Ready** before preparing the cue. Sound warms automatically after the browser permits playback. A reconnecting/backgrounded phone waits for fresh clock samples and audio readiness, then rejoins at the running show's position. No audience play/stop/play sequence is needed.

- A connection check, clock check and verified music are separate conditions. Keep phones visible and rehearse their actual audio output; software readiness does not measure speaker onset.
- Uploads reporting a missing progress route during an in-place frontend update can retry against the older server's idempotent chunk endpoint. If the phone retains old frontend code, refresh `/upload`, sign in and reselect its original file. Do not reset or restart the active calibration just to refresh the uploader.
- Backend restart preserves committed show/map/routing and identities, but an unfinished calibration must be repeated. Reset deliberately clears those audience identities and mappings.
- Physical iOS/Android autoplay, three-camera coverage, projector scanning distance and acoustic synchronization still require rehearsal at the venue.

## Isolated browser verification

After `bun run gate`, start the built frontends in separate terminals:

```sh
node client-frontend/node_modules/next/dist/bin/next start client-frontend --hostname 127.0.0.1 --port 13010
node admin-frontend/node_modules/next/dist/bin/next start admin-frontend --hostname 127.0.0.1 --port 13011
bun tools/e2e/ui-server.ts
```

Use `http://localhost:18090` and the test-only password `test-stage`. This harness uses production backend modules with disposable state and original test tones under `runtime/ui-test/`. Its initial run accepts a generated test video; `POST /__test__/complete-map` exposes the unlocated-phone fallback. It is bound to loopback and is never the event backend. Reset here does not touch the live concert. Production bundles are required; the extra proxy does not forward Next development HMR. Stop all three test processes afterward.
