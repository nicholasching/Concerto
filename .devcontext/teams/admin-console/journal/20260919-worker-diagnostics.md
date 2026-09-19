# Show actionable camera worker failures

Captain follow-up on main 6e1f4d4. The job resource already contained the structured Python error, but the panel displayed only its generic exit-code message. The panel now shows the actual error alongside the exit status, with expandable diagnostics. New formatting regressions and `gate:admin` passed (21 focused JS tests, 14 contracts, shared checks and production build).

Verified in the live console against the user's failed job without restarting the backend or discarding the run. Retrying with the corrected Python tracker completed in 53.5 seconds, but no phone IDs were accepted; the empty candidate stays uncommitted. See [investigation](../../integration/journal/20260919-camera-worker-failure.md). Existing uploads and geometry were preserved.
