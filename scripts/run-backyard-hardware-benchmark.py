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
import math
import os
from pathlib import Path
import statistics
import tempfile
from types import SimpleNamespace
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
    assert report.get("format") == "scenarium-effects-matched-three-vs-webgl2-v3", "Unrecognized measurement format"
    assert report.get("pixel_comparison", {}).get("resolution") == [620, 295], "Unverified image resolution"
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
            if elapsed is not None:
                assert isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool), (backend, "non-numeric GPU timer")
                assert math.isfinite(elapsed) and elapsed > 0, (backend, "nonfinite GPU elapsed time")
            for metric in ("cpu_submit_p50_ms", "frame_interval_p50_ms"):
                value = scenario.get(f"{backend}_{metric}")
                assert isinstance(value, (int, float)) and not isinstance(value, bool), (backend, metric)
                assert math.isfinite(value) and value > 0, (backend, metric, "invalid measurement")
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
                measured = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)
                            and math.isfinite(v) and v > 0]
                row[f"{backend}_{metric}_median_over_runs"] = round(statistics.median(measured), 5) if measured else None
                row[f"{backend}_{metric}_valid_runs"] = len(measured)
        rows.append(row)
    return {"completed_runs": len(reports), "scenarios": rows}



def classify_failure(error: str, folder: Path, expected_gpu: str) -> tuple[str, str]:
    """Inspect saved WebGL GPU probes even if Chromium aborted before summary export."""
    for backend in ("three", "custom"):
        probe = folder / f"gpu-context-{backend}.json"
        if not probe.exists():
            continue
        try:
            context = json.loads(probe.read_text())
        except (OSError, ValueError):
            continue
        renderer = str(context.get("unmasked_renderer") or "")
        if not context.get("webgl2"):
            return "webgl2-unavailable", f"{backend}: WebGL2 context was not available"
        if not renderer:
            return "gpu-identity-unavailable", f"{backend}: unmasked GPU identity unavailable"
        if any(token in renderer.casefold() for token in BAD_GPU):
            return "software-renderer", f"{backend}: Chromium selected {renderer}"
        if expected_gpu.casefold() not in renderer.casefold():
            return "wrong-gpu", f"{backend}: Chromium selected {renderer}, not {expected_gpu}"
    lower = error.casefold()
    if "gpu" in lower and ("query" in lower or "timer" in lower or "elapsed" in lower):
        return "gpu-timer-unavailable", "Required GPU elapsed-time query was unavailable"
    if "timeout" in lower or "expired" in lower:
        return "benchmark-timeout", error
    if "chromium" in lower or "browser" in lower:
        return "browser-failure", error
    return "invalid-result", error


def render_summary(record: dict) -> str:
    """Readable digest generated only from verified attempt.json data."""
    lines = ["# Backyard physical-GPU benchmark attempt", "",
             f"**Result:** {record['result']}",
             f"**Requested GPU:** {record['expected_gpu']}",
             f"**Verified runs:** {record.get('aggregate', {}).get('completed_runs', 0)}/{record['requested_runs']}",
             f"**Revision:** {record.get('git_revision') or 'unavailable'}", ""]
    if record.get("preflight_error"):
        lines += [f"**Preflight blocker:** {record['preflight_error']}", ""]
    for run in record.get("runs", []):
        lines += [f"- Run {run['index']}: {run['status']}"]
        if run.get("failure_code"):
            lines += [f"  - Blocker: {run['failure_code']}: {run.get('diagnosis', '')}"]
        if run.get("gpu_contexts"):
            for backend, context in run["gpu_contexts"].items():
                lines += [f"  - {backend}: {context.get('unmasked_renderer') or 'unknown'}"]
    rows = record.get("aggregate", {}).get("scenarios", [])
    if rows:
        lines += ["", "## Verified medians across completed runs", "",
                  "| Scenario | Custom GPU ms | Three.js GPU ms | Custom CPU submit ms | Three.js CPU submit ms |",
                  "|---|---:|---:|---:|---:|"]
        def fmt(x):
            return f"{x:.3f}" if isinstance(x, (int, float)) else "N/A"
        for row in rows:
            values = [fmt(row.get(f"{b}_{m}_median_over_runs"))
                      for b, m in [("custom", "gpu_pipeline_p50_ms"),
                                   ("three", "gpu_pipeline_p50_ms"),
                                   ("custom", "cpu_submit_p50_ms"),
                                   ("three", "cpu_submit_p50_ms")]]
            lines += ["| " + row["name"] + " | " + " | ".join(values) + " |"]
    lines += ["", "GPU elapsed time comes from optional asynchronous queries, never FPS estimates.",
              "Unmasked WebGL identity is practical device evidence, not cryptographic attestation."]
    return "\n".join(lines) + "\n"


def write_manifest(record: dict, path: Path) -> None:
    path.write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
    (path.parent / "summary.md").write_text(render_summary(record))


def self_test() -> None:
    good = {
        "format": "scenarium-effects-matched-three-vs-webgl2-v3",
        "pixel_comparison": {"resolution": [620, 295]},
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
             "three_cpu_submit_p50_ms": 0.7, "custom_cpu_submit_p50_ms": 0.2,
             "three_frame_interval_p50_ms": 16.7, "custom_frame_interval_p50_ms": 16.7}
            for name, draws in zip(SCENARIOS, (5, 5, 6, 8, 6, 5, 10))
        ],
    }
    verify_comparison(good, "RTX 3090", True)
    assert summarize([good, good])["completed_runs"] == 2
    assert "| Combined |" in render_summary({
        "result": "passed", "expected_gpu": "RTX 3090", "requested_runs": 1,
        "aggregate": summarize([good]), "runs": [], "git_revision": "test",
    })
    with tempfile.TemporaryDirectory() as temp:
        folder = Path(temp)
        (folder/"gpu-context-custom.json").write_text(json.dumps({
            "webgl2": True, "unmasked_renderer": "Intel UHD Graphics"}))
        assert classify_failure("Browser assertion", folder, "RTX 3090")[0] == "wrong-gpu"
        (folder/"gpu-context-custom.json").write_text(json.dumps({
            "webgl2": True, "unmasked_renderer": "Google SwiftShader"}))
        assert classify_failure("Browser assertion", folder, "RTX 3090")[0] == "software-renderer"
        (folder/"gpu-context-custom.json").unlink()
        assert classify_failure("Timeout expired", folder, "RTX 3090")[0] == "benchmark-timeout"
        failed = {"result": "failed", "expected_gpu": "RTX 3090", "requested_runs": 1,
                  "runs": [{"index": 1, "status": "failed", "failure_code": "wrong-gpu",
                            "diagnosis": "Intel UHD Graphics"}]}
        write_manifest(failed, folder/"attempt.json")
        assert (folder/"summary.md").exists() and "wrong-gpu" in (folder/"summary.md").read_text()
        assert json.loads((folder/"attempt.json").read_text())["result"] == "failed"
    if sys.platform == "linux":
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            args = SimpleNamespace(output_dir=temp_path / "success", expected_gpu="RTX 3090",
                                   repeat=2, no_offload=False, headless=True,
                                   require_gpu_timers=True)
            called = []
            def fake_success(command, **kwargs):
                assert "--require-hardware" in command
                assert command[command.index("--expected-gpu")+1] == "RTX 3090"
                assert kwargs["env"]["__NV_PRIME_RENDER_OFFLOAD"] == "1"
                output = Path(command[command.index("--output-dir")+1])
                output.mkdir(parents=True, exist_ok=True)
                (output / "comparison.json").write_text(json.dumps(good))
                for backend, version in (("three", 3), ("custom", 2)):
                    (output / f"{backend}.json").write_text(json.dumps({
                        "version": version, "geometryParts": 179}))
                    (output / f"{backend}-combined.png").write_bytes(
                        b"\x89PNG\r\n\x1a\n" + bytes(32))
                called.append(command)
                return subprocess.CompletedProcess(command, 0, "PASS mock Chromium", "")
            assert run(args, bench_runner=fake_success) == 0
            manifest = json.loads((args.output_dir/"attempt.json").read_text())
            assert manifest["result"] == "passed"
            assert manifest["aggregate"]["completed_runs"] == 2 and len(called) == 2
            assert "| Combined |" in (args.output_dir/"summary.md").read_text()
            args.output_dir = temp_path / "fallback"
            args.repeat = 1
            def fake_software(command, **kwargs):
                output = Path(command[command.index("--output-dir")+1])
                output.mkdir(parents=True, exist_ok=True)
                (output/"gpu-context-three.json").write_text(json.dumps({
                    "webgl2": True, "unmasked_renderer": "Google SwiftShader"}))
                return subprocess.CompletedProcess(command, 1, "", "wrong GPU")
            assert run(args, bench_runner=fake_software) == 1
            manifest = json.loads((args.output_dir/"attempt.json").read_text())
            assert manifest["result"] == "failed"
            assert manifest["runs"][0]["failure_code"] == "software-renderer"
            assert "software-renderer" in (args.output_dir/"summary.md").read_text()
            args.output_dir = temp_path / "preflight"
            args.repeat = 0
            assert run(args, bench_runner=fake_software) == 1
            assert json.loads((args.output_dir/"attempt.json").read_text())["result"] == "failed"
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
    assert preflight_error("linux", ":0", False, 1) is None
    assert "DISPLAY" in preflight_error("linux", None, False, 1)
    assert "Linux" in preflight_error("darwin", ":0", False, 1)
    assert preflight_error("linux", None, True, 1) is None
    assert "1..5" in preflight_error("linux", ":0", False, 0)
    assert not child_environment(False).get("_nonexistent_expected_key_")
    for key, value in PRIME.items():
        assert child_environment(True)[key] == value
    print("PASS hardware orchestrator: matching NVIDIA context, timer samples, multi-run median, "
          "wrong GPU, software fallback, missing scenarios and absent timers")


def preflight_error(platform: str, display: str | None, headless: bool, repeat: int) -> str | None:
    if platform != "linux":
        return "Physical-GPU launcher requires Linux"
    if not headless and not display:
        return "Headed Chromium requires DISPLAY/XWayland; no default GPU settings were changed"
    if not 1 <= repeat <= 5:
        return "--repeat must be 1..5"
    return None


def run(args: argparse.Namespace, *, bench_runner=None) -> int:
    if bench_runner is None:
        bench_runner = subprocess.run
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
        problem = preflight_error(sys.platform, os.environ.get("DISPLAY"), args.headless, args.repeat)
        if problem:
            record["result"] = "failed"
            record["preflight_error"] = problem
            record["finished_at_utc"] = utc_now()
            write_manifest(record, destination)
            print(f"Hardware benchmark preflight: {problem}; evidence: {destination}", file=sys.stderr)
            return 1
        for index in range(1, args.repeat + 1):
            folder = out / f"run-{index:02d}"
            folder.mkdir(exist_ok=True)
            command = [sys.executable, str(BENCH), "--require-hardware",
                       "--expected-gpu", args.expected_gpu, "--output-dir", str(folder)]
            if not args.headless:
                command.append("--headed")
            attempt = {"index": index, "status": "failed", "exit_code": None,
                       "output": folder.name, "error": None, "failure_code": None,
                       "diagnosis": None}
            record["runs"].append(attempt)
            try:
                result = bench_runner(command, cwd=ROOT,
                                      env=child_environment(not args.no_offload),
                                        text=True, capture_output=True, timeout=360,
                                        check=False)
                (folder / "stdout.log").write_text(result.stdout[-65536:])
                (folder / "stderr.log").write_text(result.stderr[-65536:])
                attempt["exit_code"] = result.returncode
                if result.returncode != 0:
                    raise RuntimeError(f"Browser measurement failed (code {result.returncode}); "
                                       f"see {folder.name}/stderr.log")
                for filename in ("three-combined.png", "custom-combined.png"):
                    image_path = folder / filename
                    if not image_path.exists() or image_path.stat().st_size < 24:
                        raise RuntimeError(f"Missing rendered framebuffer evidence: {filename}")
                    if image_path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                        raise RuntimeError(f"Invalid rendered screenshot signature: {filename}")
                for backend in ("three", "custom"):
                    profile_path = folder / f"{backend}.json"
                    if not profile_path.exists():
                        raise RuntimeError(f"Missing renderer benchmark profile: {profile_path.name}")
                    profile = json.loads(profile_path.read_text())
                    assert profile.get("geometryParts") == 179, (backend, "scene source drift")
                    assert profile.get("version") == (3 if backend == "three" else 2), (backend, "unknown profile")
                report_path = folder / "comparison.json"
                if not report_path.exists():
                    raise RuntimeError(f"Browser returned success without {report_path.name}")
                report = json.loads(report_path.read_text())
                verify_comparison(report, args.expected_gpu, args.require_gpu_timers)
                attempt["gpu_contexts"] = report["gpu_contexts"]
                attempt["gpu_timer_status"] = report["gpu_timer_status"]
                attempt["status"] = "passed"
                successes.append(report)
            except (RuntimeError, AssertionError, ValueError, TypeError, KeyError,
                    OSError, subprocess.TimeoutExpired) as exc:
                attempt["error"] = str(exc)
                attempt["failure_code"], attempt["diagnosis"] = classify_failure(
                    str(exc), folder, args.expected_gpu
                )
                print(f"Hardware attempt {index} failed [{attempt['failure_code']}]: {attempt['diagnosis']}",
                      file=sys.stderr)
                break
        record["result"] = "passed" if len(successes) == args.repeat else "failed"
        record["aggregate"] = summarize(successes)
        record["finished_at_utc"] = utc_now()
        write_manifest(record, destination)
        print(f"Hardware A/B attempt: {record['result']}; verified {len(successes)}/{args.repeat} "
              f"runs; evidence: {destination}")
        return 0 if record["result"] == "passed" else 1
    finally:
        # Preserve an explicit incomplete manifest even for unexpected exceptions.
        if not destination.exists():
            record["finished_at_utc"] = utc_now()
            record["result"] = "failed"
            write_manifest(record, destination)


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
