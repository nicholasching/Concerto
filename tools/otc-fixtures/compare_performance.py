"""Sequential CPU-budget benchmarks on identical files; assert exact result equivalence."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import time

from benchmark import ProcessTreeMemory
from otc.pipeline import process_manifest
from otc.resources import cpu_capacity, worker_allocation


def semantic_result(result):
    return {key: value for key, value in result.items() if key != "processingMs"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--evidence", choices=("physical", "synthetic"), required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cpu-budgets", type=int, nargs="+", default=[1, 4, 8])
    parser.add_argument("--reference-result", type=Path)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    reference = (semantic_result(json.loads(args.reference_result.read_text(encoding="utf-8")))
                 if args.reference_result else None)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    runs = []
    for index, budget in enumerate(args.cpu_budgets):
        run_dir = args.output_dir / f"run-{index}-cpu-{budget}"
        run_dir.mkdir()
        with ProcessTreeMemory() as memory, (run_dir / "progress.ndjson").open("w") as progress:
            start = time.perf_counter()
            result = process_manifest(
                manifest, args.manifest.resolve().parent, args.evidence, cpu_budget=budget,
                debug_dir=run_dir / "debug" if args.debug else None,
                progress=lambda event: progress.write(json.dumps(event) + "\n"),
            )
            elapsed = time.perf_counter()-start
        (run_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
        actual = semantic_result(result)
        if reference is None:
            reference = actual
        if actual != reference:
            raise AssertionError(f"CPU budget {budget} changed observations, positions or diagnostics")
        concurrent, shares = worker_allocation(len(manifest["cameras"]), 3, budget)
        run = {"requestedCpuBudget": budget, "cameraConcurrency": concurrent,
               "frameWorkersPerCameraSlot": shares, "wallSeconds": elapsed,
               "exactResultMatch": True, **memory.metrics()}
        runs.append(run)
        print(json.dumps(run), flush=True)
    report = {"platform": platform.platform(), "cpuCapacity": cpu_capacity(),
              "evidence": args.evidence, "debugArtifactsEnabled": args.debug,
              "inputHashes": result["inputHashes"],
              "resultSha256ExcludingTiming": hashlib.sha256(json.dumps(reference, sort_keys=True,
                                                                         separators=(",", ":")).encode()).hexdigest(),
              "runs": runs}
    (args.output_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
