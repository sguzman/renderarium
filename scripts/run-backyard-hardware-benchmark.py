#!/usr/bin/env python3
"""Agent-owned Linux/Hyprland hardware run of the canonical Backyard A/B benchmark.

This script does not change desktop settings or install dependencies. It applies
NVIDIA PRIME variables ONLY to child Chromium processes; the WebGL identity
check inside the benchmark is authoritative and may still reject the offload.
Pure-standard-library --self-test never launches Chromium or requires Pillow.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / "scripts/test-backyard-threejs-effects-browser.py"
SCENARIOS = ("Minimal", "Outlines", "Shafts", "Bloom", "Dust", "FXAA", "Combined")
PRIME = {
    "__NV_PRIME_RENDER_OFFLOAD": "1",
    "__GLX_VENDOR_LIBRARY_NAME": "nvidia",
    "__VK_LAYER_NV_optimus": "NVIDIA_only",
}
BAD_GPU = ("swiftshader", "llvmpipe", "softpipe", "lavapipe", "software rasterizer", "software renderer")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def child_environment(offload: bool) -> dict[str, str]:
    env = dict(os.environ)
    if offload:
        env.update(PRIME)
    return env


def verify_comparison(report: dict, expected_gpu: str, require_timers: bool) -> None:
    """Check recorded browser measurements, never the subprocess exit code alone."""
    assert report.get("physical_gpu_verification_passed") is True, "No verified physical GPU result"
    assert report.get("physical_gpu_verification_required") is True, "Unrestricted result is not hardware QA"
    assert report.get("expected_gpu_identity", "").casefold() == expected_gpu.casefold(), "GPU identity check was not requested"
    contexts = report.get("gpu_contexts", {})
    for backend in ("three", "custom"):
        context = contexts.get(backend, {})
        model = str(context.get("unmasked_renderer") or "")
        assert context.get("webgl2") is True, f"{backend}: no WebGL2 context"
        assert expected_gpu.casefold() in model.casefold(), f"{backend}: expected {expected_gpu!r}, got {model!r}"
        assert not any(x in model.casefold() for x in BAD_GPU), f"{backend}: software device"
        assert context.get("drawing_buffer") == [620, 295], f"{backend}: wrong framebuffer"
    scenarios = report.get("scenarios", [])
    assert [x.get("name") for x in scenarios] == list(SCENARIOS), "Incomplete effects matrix"
    for i, scenario in enumerate(scenarios):
        expected_draws = (5, 5, 6, 8, 6, 5, 10)[i]
        for backend in ("three", "custom"):
            assert scenario.get(f"{backend}_draws") == expected_draws, (backend, scenario["name"], "draw mismatch")
            samples = scenario.get(f"{backend}_gpu_timer_samples", 0)
            elapsed = scenario.get(f"{backend}_gpu_pipeline_p50_ms")
            assert isinstance(samples, int) and samples >= 0, (backend, "invalid sample count")
            assert (elapsed is None) == (samples == 0), (backend, "inconsistent GPU timer")
            if require_timers:
                assert samples > 0 and isinstance(elapsed, (int, float)) and elapsed > 0, (
                    backend, scenario["name"], "no valid GPU elapsed-time query"
                )
    if require_timers:
        assert all(report.get("gpu_timer_status", {}).get(backend) == "supported"
                   for backend in ("three", "custom")), "GPU query status not fully supported"


def summarize(reports: list[dict]) -> dict:
    if not reports:
        return {"completed_runs": 0, "scenarios": []}
    rows = []
    for i, name in enumerate(SCENARIOS):
        row = {"name": name}
        for backend in ("three", "custom"):
            for metric in ("cpu_submit_p50_ms", "frame_interval_p50_ms", "gpu_pipeline_p50_ms"):
                values = [r["scenarios"][i].get(f"{backend}_{metric}") for r in reports]
                measured = [v for v in values if isinstance(v, (int, float)) and v > 0]
                row[f"{backend}_{metric}_median_over_runs"] = round(statistics.median(measured), 5) if measured else None
                row[f"{backend}_{metric}_valid_runs"] = len(measured)
        rows.append(row)
    return {"completed_runs": len(reports), "scenarios": rows}


def self_test() -> None:
    good = {
        "physical_gpu_verification_required": True,
        "physical_gpu_verification_passed": True,
        "expected_gpu_identity": "RTX 3090",
        "gpu_contexts": {
            name: {"webgl2": True, "unmasked_renderer": "NVIDIA GeForce RTX 3090",
                   "drawing_buffer": [620, 295]} for name in ("three", "custom")
        },
        "gpu_timer_status": {"three": "supported", "custom": "supported"},
        "scenarios": [
            {"name": name, "three_draws": draws, "custom_draws": draws,
             "three_gpu_timer_samples": 3, "custom_gpu_timer_samples": 3,
             "three_gpu_pipeline_p50_ms": 2.1, "custom_gpu_pipeline_p50_ms": 1.5,
             "three_cpu_submit_p50_ms": 0.7, "custom_cpu_submit_p50_ms": 0.2}
            for name, draws in zip(SCENARIOS, (5, 5, 6, 8, 6, 5, 10))
        ],
    }
    verify_comparison(good, "RTX 3090", True)
    assert summarize([good, good])["completed_runs"] == 2
    assert summarize([good])["scenarios"][-1]["three_gpu_pipeline_p50_ms_median_over_runs"] == 2.1
    import copy
    mutants = []
    wrong = copy.deepcopy(good)
    wrong["gpu_contexts"]["custom"]["unmasked_renderer"] = "Intel UHD Graphics"
    mutants.append((wrong, False))
    software = copy.deepcopy(good)
    software["gpu_contexts"]["three"]["unmasked_renderer"] = "NVIDIA SwiftShader RTX 3090"
    mutants.append((software, False))
    missing = copy.deepcopy(good)
    missing["scenarios"].pop()
    mutants.append((missing, False))
    no_timer = copy.deepcopy(good)
    no_timer["scenarios"][6]["custom_gpu_pipeline_p50_ms"] = None
    no_timer["scenarios"][6]["custom_gpu_timer_samples"] = 0
    mutants.append((no_timer, True))
    for report, strict in mutants:
        try:
            verify_comparison(report, "RTX 3090", strict)
        except (AssertionError, KeyError, TypeError):
            continue
        raise AssertionError("Corrupted/mismatched hardware result was incorrectly accepted")
    assert not child_environment(False).get("_nonexistent_expected_key_")
    for key, value in PRIME.items():
        assert child_environment(True)[key] == value
    print("PASS hardware orchestrator: matching NVIDIA context, timer samples, multi-run median, "
          "wrong GPU, software fallback, missing scenarios and absent timers")


def run(args: argparse.Namespace) -> int:
    if sys.platform != "linux":
        raise RuntimeError("Physical-GPU launcher requires Linux")
    if not args.headless and not os.environ.get("DISPLAY"):
        raise RuntimeError("Headed Chromium requires DISPLAY/XWayland; no default GPU settings were changed")
    if not 1 <= args.repeat <= 5:
        raise ValueError("--repeat must be 1..5")
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=False)
    record: dict = {
        "format": "backyard-physical-gpu-attempt-v1",
        "started_at_utc": utc_now(),
        "finished_at_utc": None,
        "git_revision": revision.stdout.strip() if revision.returncode == 0 else None,
        "expected_gpu": args.expected_gpu,
        "offload_requested": not args.no_offload,
        "offload_environment": PRIME if not args.no_offload else {},
        "headed": not args.headless,
        "require_gpu_timers": args.require_gpu_timers,
        "requested_runs": args.repeat,
        "runs": [],
        "result": "incomplete",
        "explanation": "Browser GPU identities, not PRIME flags, decide hardware verification",
    }
    successes: list[dict] = []
    destination = out / "attempt.json"
    try:
        for index in range(1, args.repeat + 1):
            folder = out / f"run-{index:02d}"
            folder.mkdir(exist_ok=True)
            command = [sys.executable, str(BENCH), "--require-hardware",
                       "--expected-gpu", args.expected_gpu, "--output-dir", str(folder)]
            if not args.headless:
                command.append("--headed")
            attempt = {"index": index, "status": "failed", "exit_code": None,
                       "output": folder.name, "error": None}
            record["runs"].append(attempt)
            try:
                result = subprocess.run(command, cwd=ROOT,
                                        env=child_environment(not args.no_offload),
                                        text=True, capture_output=True, timeout=360,
                                        check=False)
                (folder / "stdout.log").write_text(result.stdout[-65536:])
                (folder / "stderr.log").write_text(result.stderr[-65536:])
                attempt["exit_code"] = result.returncode
                if result.returncode != 0:
                    raise RuntimeError(f"Browser measurement failed (code {result.returncode}); "
                                       f"see {folder.name}/stderr.log")
                report_path = folder / "comparison.json"
                if not report_path.exists():
                    raise RuntimeError(f"Browser returned success without {report_path.name}")
                report = json.loads(report_path.read_text())
                verify_comparison(report, args.expected_gpu, args.require_gpu_timers)
                attempt["gpu_contexts"] = report["gpu_contexts"]
                attempt["gpu_timer_status"] = report["gpu_timer_status"]
                attempt["status"] = "passed"
                successes.append(report)
            except (RuntimeError, AssertionError, ValueError, OSError, subprocess.TimeoutExpired) as exc:
                attempt["error"] = str(exc)
                print(f"Hardware attempt {index} failed: {exc}", file=sys.stderr)
                break
        record["result"] = "passed" if len(successes) == args.repeat else "failed"
        record["aggregate"] = summarize(successes)
        record["finished_at_utc"] = utc_now()
        destination.write_text(json.dumps(record, indent=2) + "\n")
        print(f"Hardware A/B attempt: {record['result']}; verified {len(successes)}/{args.repeat} "
              f"runs; evidence: {destination}")
        return 0 if record["result"] == "passed" else 1
    finally:
        # Preserve an explicit incomplete manifest even for unexpected exceptions.
        if not destination.exists():
            record["finished_at_utc"] = utc_now()
            record["result"] = "failed"
            destination.write_text(json.dumps(record, indent=2) + "\n")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--self-test", action="store_true", help="No Chromium or GPU needed")
    p.add_argument("--expected-gpu", default="RTX 3090", help="Exact substring required in both WebGL GPU identities")
    p.add_argument("--repeat", type=int, default=1, help="Independent complete A/B measurements, 1..5")
    p.add_argument("--require-gpu-timers", action="store_true", help="Reject valid hardware output if both GPU timer series are unavailable")
    p.add_argument("--no-offload", action="store_true", help="Inherit GPU selection without NVIDIA PRIME hints")
    p.add_argument("--headless", action="store_true", help="Opt into headless Chromium instead of XWayland")
    p.add_argument("--output-dir", type=Path, default=ROOT/"artifacts/backyard-hardware-a-b")
    a = p.parse_args()
    if a.self_test:
        self_test()
    else:
        sys.exit(run(a))
