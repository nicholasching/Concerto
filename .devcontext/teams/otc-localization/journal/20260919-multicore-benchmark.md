# Multicore benchmark instrumentation

Date: 2026-09-19. Branch: feat/otc-localization. Baseline: 49328c3a19025b4a389f36d92e012d9aa3829ad7.

## Assignment and assumptions

- Own only tools/otc-fixtures/benchmark.py and this journal; the lead owns multiprocessing, another agent owns perspective clips.
- The previous peakProcessResidentBytes is the Python parent's own lifetime peak. It cannot describe the concurrent camera workers' total memory.
- Use three workers by default and retain one as the serial comparison. Keep result schemas unchanged and add no dependencies.
- Sample the live parent-plus-descendant resident sets at 100 ms. Report the peak simultaneous sampled sum, method, interval, and measurement gaps separately from the parent's own lifetime peak. Resident sums may count shared pages more than once and can miss between-sample peaks.

## Plan and verification

1. Add explicit worker count and portable unsupported-platform reporting -> verify argument parsing and lint.
2. Implement current-process-tree sampling using Windows process snapshots and memory counters -> verify a controlled child allocation raises the sampled aggregate above the parent's resident memory.
3. Integrate the sampler around pipeline execution -> lead runs serial/parallel production benchmarks after implementation is ready. Do not run competing heavy jobs.

## Implementation

- Added --workers {1,3}, default 3, wired to the lead's process_manifest API. Metrics identify requested workers and spawned camera processes; the one-worker reference runs inline.
- Windows samples enumerate the current Python process and descendants with Toolhelp32, then sum their live WorkingSetSize values. Complete samples alone contribute to the reported peak; gaps/errors and maximum observed process count are exposed. No subprocess lifetime peak is added to another process's lifetime peak.
- Replaced the ambiguous previous peakProcessResidentBytes name with parentPeakResidentBytes. Added peakSampledProcessTreeResidentBytes, method, nominal 100 ms interval, sample count, incomplete count and caveats. Non-Windows aggregate memory is explicitly null/unavailable; the parent's existing platform-specific peak remains separately available.
- Perspective truth produces depth and visible-screen-size recall groups with actual width/height ranges. Missing expected-resolvable locations, unexpected acceptance of deliberate undersized screens and accepted observation errors of at least 2 px fail the benchmark. Final-map errors retain the existing 0.015 canonical tolerance. This catches an incorrect decoded observation even if geometry later rejects its location.

## Verification

- `python -m ruff check tools/otc-fixtures/benchmark.py`: passed.
- `python tools/otc-fixtures/benchmark.py --help`: accepts worker choices 1 and 3.
- Controlled spawned child allocates 96 MiB and retains it for one second: parent's initial resident set 54,059,008 bytes; sampled tree peak 171,499,520 bytes versus parent lifetime peak 55,603,200 bytes. Ten complete samples, no sampling errors; three processes include the child Python launcher. This verifies descendants are included, not just the launcher/parent.
- In-memory checks: incomplete samples excluded from peak; depth/size range counts; expected tiny screens produce null recall when no resolvable denominator; accepted undersized IDs, missing resolvable IDs and exactly 2 px observation error flagged. All passed.
- Actual pipeline smoke: `python tools/otc-fixtures/benchmark.py --manifest runtime/otc-fixtures/clean/manifest.json --truth runtime/otc-fixtures/clean/ground-truth.json --output-dir runtime/otc-fixtures/multicore-benchmark-smoke --workers 3`: exit 0, 30/30 localized, zero wrong locations, maximum error 0.002924551939034215, wall 2693.16 ms. Sampled aggregate peak 256,241,664 bytes across four processes versus parent-only peak 59,232,256 bytes. 23 complete samples, no errors. This is a smoke check, not the dense performance comparison.
- A lightweight check against the already-rendered 90-phone perspective result confirmed 100% recall in front (36), middle (24), back (30). It also exposed a truth mismatch: device 54 in camera-left has accepted position within 0.0593 px of truth, but truth marks it invisible. The fixture agent found a border-rounding discrepancy: the continuous ideal center calculation fails its bounds test while the exact rounded, rendered rectangle is fully in frame. The fixture agent corrected visibility from the actual rendered bounds and updated local truth without changing video bytes. Rechecking the existing result now passes: no missing resolvable IDs, wrong accepted observations or unexpectedly accepted undersized IDs. Strict benchmark behavior remained unchanged.

## Handoff

The lead is running the 1,500-ID serial/parallel benchmarks sequentially to avoid contention. No heavy jobs remain in this agent. The fixture agent owns README updates and has the new CLI and memory-field definitions. No shared schemas, dependency files or root configuration changed. Parent-only historical peaks cannot be compared to new aggregate peaks as if they measured the same scope; use fresh sampled serial and parallel metrics instead.
