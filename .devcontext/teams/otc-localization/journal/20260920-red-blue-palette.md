# Red/blue calibration palette

Owner: integration captain, main. Baseline: `c758913`; clean working tree at start.

The user explicitly requests full red `#FF0000` instead of amber, retaining blue `#0066FF`. This supersedes the earlier masterplan palette preference. No additional confirmation is needed. Preserve the neutral guard color, 200 ms symbol timing, packet/codebook, membership/run-tag checks, and collision policy.

Plan: use one shared red/blue default for new admin/demo runs; teach the worker to use the run's recorded palette for its first-color pilot and phase checks while retaining old amber/blue recordings; render synthetic footage from the manifest colors rather than the generator's old hard-coded amber. Regress clean, dim/washed and invalid red pilots, real encoded MP4 detection/mapping and the legacy suite, then run OTC/admin/client gates and isolated HTTP/WebSocket/worker E2E. No live reset, flash, map commit or audio mutation is needed.

Initial inspection: candidate discovery already covers bright and dim red regions through the broad HSV masks. The blocking assumptions are in `sampling.py`: both the pilot validator and phase onset search require green as well as red above blue. The frontend renderer already reads exact colors from the frozen calibration plan. No wire schema or codeword migration is necessary.

Software verification is complete. New physical red/blue footage is not available; software/synthetic results must not be reported as physical camera validation.

## Implementation and experiments

- Three regression cases (pure, dim and washed red/blue pilots) failed before implementation and now pass. White/green/reversed pilots remain rejected. The old amber checks and measured-color margins are preserved; only the first-color profile comes from the manifest.
- New runs share `DEFAULT_CALIBRATION_PALETTE`, version `red-blue-v1`. Old plans are not mutated. The real client renderer now runs its golden-packet tests with red; a separate test proves that an amber plan cannot arm with changed colors and still renders amber when correctly armed.
- Fixed the synthetic generator's hidden hard-coded amber output: emitted pixels now follow its manifest. Independently inspected red pixels survive encoded MP4 output. Three-camera red/blue tests pass at 24/30/60 fps, plus washed/dim phones, reflected-motion scenes and wrong-run rejection: 16 focused Python checks pass.
- Initial TypeScript check caught an overly narrow literal type in the test palette after importing the shared default. It was corrected to the existing `Palette` type; production contracts stay unchanged.
- Full focused gates passed: OTC (130 Python tests in 154.60 s, plus shared checks), admin (22 admin/selection tests and production build, plus shared checks), client (144 client/audio tests and production build, plus shared checks). Each gate also passed the 14 contract tests, types, lint and ownership boundaries. Ruff for the fixture tools and `git diff --check` passed.
- Isolated `bun run test:e2e` passed in 20.6 s with actual red/blue MP4 uploads, Python decoding, reviewed coordinate maps, audio assignment, manual late join, scheduled playback/mix, panic and persisted restart. Evidence: `.devcontext/evidence/integration/local-e2e.md`; ignored artifacts: `runtime/e2e/007ef9d3-bf22-45bb-a6c2-5db240eb97c0/`. The recordings are generated and audio scheduling uses a recording double.
- Read-only live checks: local `/admin` returns 200 and its served JavaScript contains `red-blue-v1` / `#FF0000`. The backend retained its existing epoch, stopped transport, show revision 3, ten registered identities and processing calibration. No live process restart, reset or calibration action was performed. Refresh admin and create a new calibration to use red; existing plans retain their original colors.
- Separate environment issue observed during final read-only checks: the public `https://htn.nicholasching.ca/admin` returns HTTP 530 / Cloudflare error 1033. The public authorization/clock check therefore failed before opening a socket; local frontend and backend checks pass. No tunnel configuration or credentials were changed.
