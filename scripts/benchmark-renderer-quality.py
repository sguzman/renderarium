#!/usr/bin/env python3
"""Source-pinned, QA-only SC3D warm redraw cost comparisons in Chromium.

Measurements are CPU-side synchronous renderer/composer submission durations
from performance.now(). They are not GPU timers, FPS, human visual judgments,
or portable promises of performance on any user's device.
"""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import selectors
import statistics
import subprocess
import time

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SCENES = (
    "living-room", "kitchen", "bathroom", "office",
    "backyard", "garage", "factory",
)
MODES = (
    "fog", "soft-light", "shadow-detail",
    "tone-map", "ambient-occlusion", "ambient-occlusion-half", "fxaa",
)
VIEWPORT = {"width": 512, "height": 384}
METRIC = "cpu_submit_ms"


def git_blob_sha(path: Path) -> str:
    raw = path.read_bytes()
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def summarize(samples: list[float]) -> dict:
    if not samples or any(
        isinstance(value, bool)
        or not isinstance(value, (float, int))
        or not math.isfinite(value)
        or value < 0
        for value in samples
    ):
        raise ValueError("Expected nonempty, finite, nonnegative render samples")
    ordered = sorted(samples)
    return {
        "count": len(samples),
        "median_ms": round(statistics.median(ordered), 4),
        "p90_ms": round(ordered[max(0, math.ceil(len(ordered) * 0.9) - 1)], 4),
        "min_ms": round(ordered[0], 4),
        "max_ms": round(ordered[-1], 4),
    }


def pixel_distance(first_png: bytes, second_png: bytes) -> dict:
    """Quantify pixel changes, without claiming subjective quality.

    MAE is measured in 8-bit sRGB values (0..255), not linear-light energy
    or a perceptual score. Transparent channels are intentionally excluded.
    """
    with Image.open(BytesIO(first_png)) as first_image, Image.open(
        BytesIO(second_png)
    ) as second_image:
        a = first_image.convert("RGB")
        b = second_image.convert("RGB")
    if a.size != b.size:
        raise ValueError(f"Image size changed: {a.size} != {b.size}")
    if a.width <= 0 or a.height <= 0:
        raise ValueError("Image must contain pixels")
    delta = ImageChops.difference(a, b)
    means = ImageStat.Stat(delta).mean
    r, g, blue = delta.split()
    mask = ImageChops.lighter(ImageChops.lighter(r, g), blue)
    changed_pixels = a.width * a.height - mask.histogram()[0]
    return {
        "mean_abs_rgb_channel_delta_255": round(sum(means) / 3, 4),
        "normalized_mean_abs_delta": round(sum(means) / (3 * 255), 6),
        "changed_pixel_fraction": round(
            changed_pixels / (a.width * a.height), 6
        ),
    }


def check_self_test() -> None:
    assert summarize([1.0, 3.0, 2.0, 5.0, 4.0]) == {
        "count": 5, "median_ms": 3.0, "p90_ms": 5.0,
        "min_ms": 1.0, "max_ms": 5.0,
    }
    for bad in ([], [-1], [float("nan")], [float("inf")], [True]):
        try:
            summarize(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid samples accepted: {bad}")
    blank = Image.new("RGB", (2, 1), (0, 0, 0))
    changed = blank.copy()
    changed.putpixel((0, 0), (255, 0, 0))

    def encode(im: Image.Image) -> bytes:
        buffer = BytesIO()
        im.save(buffer, format="PNG")
        return buffer.getvalue()

    before_png, after_png = encode(blank), encode(changed)
    assert pixel_distance(before_png, before_png) == {
        "mean_abs_rgb_channel_delta_255": 0,
        "normalized_mean_abs_delta": 0,
        "changed_pixel_fraction": 0,
    }
    assert pixel_distance(before_png, after_png) == {
        "mean_abs_rgb_channel_delta_255": 42.5,
        "normalized_mean_abs_delta": 0.166667,
        "changed_pixel_fraction": 0.5,
    }
    try:
        pixel_distance(before_png, encode(Image.new("RGB", (3, 1))))
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched image sizes must be rejected")
    print("PASS renderer cost and image-delta statistics self-test")


def await_server(proc: subprocess.Popen[str]) -> str:
    assert proc.stdout is not None
    deadline = time.monotonic() + 40
    collected = []
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"SC3D preview exited {proc.returncode}: {''.join(collected)}"
                )
            if not selector.select(timeout=0.5):
                continue
            line = proc.stdout.readline()
            if not line:
                continue
            collected.append(line)
            if line.startswith("SC3D preview: http://127.0.0.1:"):
                return line.split("SC3D preview: ", 1)[1].strip()
    raise TimeoutError("Source-derived SC3D server was not ready")


def sample_page(browser, url: str, mode: str | None, warmups: int, samples: int) -> dict:
    from urllib.parse import urlencode

    page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: errors.append(f"request failed: {request.url}"))
    page.on(
        "response",
        lambda response: errors.append(f"HTTP {response.status}: {response.url}")
        if response.status >= 400 else None,
    )
    query = {"diagnostic": "1", "qa": "1"}
    if mode is not None:
        query["quality_experiment"] = mode
    try:
        response = page.goto(url + "?" + urlencode(query), timeout=45000)
        assert response is not None and response.ok, f"Preview HTTP failure for {mode}"
        page.wait_for_function(
            "() => document.documentElement.dataset.sc3dReady === 'true' "
            "&& typeof window.__SC3D_QA_REQUEST_FRAME__ === 'function'",
            timeout=45000,
        )
        # Allow initial resize/first-frame requests to settle. Capture them
        # separately from warm frames so shader compilation is not averaged in.
        page.wait_for_timeout(80)
        cold = page.evaluate("() => window.__SC3D_QA_REPORT__()")
        assert isinstance(cold, list) and cold, "No initial render cost samples"

        def trigger() -> dict:
            target = page.evaluate("() => window.__SC3D_QA_REQUEST_FRAME__()")
            page.wait_for_function(
                "target => document.documentElement.dataset.sc3dReady === 'true' "
                "&& Number(document.documentElement.dataset.sc3dFrame) >= target",
                arg=target,
                timeout=45000,
            )
            frame = page.evaluate("() => window.__SC3D_QA_REPORT__().at(-1)")
            assert frame["frame"] == target, "Instrumentation missed requested frame"
            assert frame["draw_calls"] > 0, f"Invalid draw counts: {frame}"
            value = frame[METRIC]
            assert math.isfinite(value) and value >= 0, f"Invalid sample: {frame}"
            return frame

        warm = [trigger() for _ in range(warmups)]
        measured = [trigger() for _ in range(samples)]
        settings = page.evaluate("() => window.__SC3D_QUALITY_REPORT__()")
        assert settings["experiment"] == (mode or "none")
        backend = page.evaluate("""() => {
            const canvas = document.querySelector('#viewport canvas');
            const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
            if (!gl) throw new Error('Missing WebGL context');
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
                width: gl.drawingBufferWidth,
                height: gl.drawingBufferHeight
            };
        }""")
        assert backend["width"] > 0 and backend["height"] > 0
        if mode in ("ambient-occlusion", "ambient-occlusion-half", "fxaa"):
            assert measured[-1]["draw_calls"] > 1, (
                f"{mode}: missing expected multi-pass draw accounting"
            )
        assert not errors, f"Browser errors for {mode}: {errors}"
        image_png = page.locator("#viewport canvas").screenshot()
        image_hash = hashlib.sha256(image_png).hexdigest()
        return {
            "_image_png": image_png,
            "mode": mode or "default",
            "cold_draws": cold,
            "warmup_draws": warm,
            "measured_draws": measured,
            "warm_cost": summarize([x[METRIC] for x in measured]),
            "settings": settings,
            "backend": backend,
            "canvas_sha256": image_hash,
        }
    finally:
        page.close()


def run_scene(browser, name: str, ledger: dict, warmups: int, samples: int) -> dict:
    scene_id = f"block-chibi-{name}-v1"
    accepted = next(
        (v for v in ledger["recorded_scenes"] if v["scene"] == scene_id), None
    )
    assert accepted, f"Missing frozen source record for {scene_id}"
    for field in ("assembly", "preview"):
        path = ROOT / accepted[f"{field}_path"]
        assert git_blob_sha(path) == accepted[f"{field}_git_blob"], (
            f"Frozen {scene_id} {field} source changed"
        )

    generated = ROOT / f"scenes/{scene_id}/generated/{scene_id}.sc3d.yml"
    before = generated.read_bytes() if generated.exists() else None
    env = {**os.environ, "PORT": "0", "SC3D_SOFTWARE_PREVIEW": "0"}
    proc = subprocess.Popen(
        ["node", "scripts/serve-sc3d-preview.mjs", accepted["assembly_path"]],
        cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,
    )
    try:
        url = await_server(proc)
        baseline = sample_page(browser, url, None, warmups, samples)
        trials = {
            mode: sample_page(browser, url, mode, warmups, samples)
            for mode in MODES
        }
        baseline_after = sample_page(browser, url, None, warmups, samples)
        assert baseline["canvas_sha256"] == baseline_after["canvas_sha256"], (
            f"{scene_id}: diagnostic default changed during experiment comparison"
        )
        # Remove binary screenshots from machine-readable results while
        # retaining quantitative image differences for every experiment.
        baseline_png = baseline.pop("_image_png")
        after_png = baseline_after.pop("_image_png")
        assert pixel_distance(baseline_png, after_png)["changed_pixel_fraction"] == 0, (
            f"{scene_id}: default changed pixel values"
        )
        trial_images = {
            mode: row.pop("_image_png")
            for mode, row in trials.items()
        }
        for mode, row in trials.items():
            row["pixel_delta_from_default"] = pixel_distance(
                baseline_png, trial_images[mode]
            )
        trials["ambient-occlusion-half"]["pixel_delta_from_full_ssao"] = pixel_distance(
            trial_images["ambient-occlusion"],
            trial_images["ambient-occlusion-half"],
        )
        all_modes = [baseline, *trials.values(), baseline_after]
        ref_backend = baseline["backend"]
        for row in all_modes:
            assert row["backend"] == ref_backend, (
                f"{scene_id}: backend/framebuffer changed during comparison"
            )
        reference_ms = statistics.median((
            baseline["warm_cost"]["median_ms"],
            baseline_after["warm_cost"]["median_ms"],
        ))
        assert reference_ms > 0, f"{scene_id}: zero baseline cost; cannot divide"
        relative = {}
        for mode, row in trials.items():
            relative[mode] = {
                "median_relative_to_default": round(
                    row["warm_cost"]["median_ms"] / reference_ms, 4
                ),
                "median_delta_ms": round(
                    row["warm_cost"]["median_ms"] - reference_ms, 4
                ),
            }
        reduced_ms = trials["ambient-occlusion-half"]["warm_cost"]["median_ms"]
        full_ms = trials["ambient-occlusion"]["warm_cost"]["median_ms"]
        assert full_ms > 0, f"{scene_id}: invalid full SSAO reference"
        return {
            "scene": scene_id,
            "frozen_source": {
                "assembly_blob": accepted["assembly_git_blob"],
                "preview_blob": accepted["preview_git_blob"],
            },
            "backend": ref_backend,
            "default_before": baseline,
            "experiments": trials,
            "default_after": baseline_after,
            "reference_median_ms": round(reference_ms, 4),
            "relative_cost": relative,
            "draw_calls": {
                "default_before": baseline["measured_draws"][-1]["draw_calls"],
                "default_after": baseline_after["measured_draws"][-1]["draw_calls"],
                **{mode: row["measured_draws"][-1]["draw_calls"] for mode, row in trials.items()},
            },
            "reduced_ssao_median_ratio_to_full_ssao": round(reduced_ms / full_ms, 4),
        }
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate(timeout=5)
        after = generated.read_bytes() if generated.exists() else None
        assert after == before, f"{scene_id}: benchmark mutated scene snapshot"


def write_summary(rows: list[dict], path: Path) -> None:
    headers = ["Scene", "Default CPU ms", *MODES]
    columns = ["---"] * len(headers)
    table = [
        "# Renderarium diagnostic renderer cost comparison",
        "",
        "CPU-side synchronous render submission costs from one Chromium run.",
        "This is NOT GPU execution time, FPS, perceptual quality scoring, a",
        "portable benchmark, or evidence of physical GPU acceleration.",
        "Initial shader compilation/resize draws and warmups were excluded.",
        "Values are per-scene warm median ratios; smaller is less CPU submission",
        "time in this runner, not necessarily better artistic output.",
        "",
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(columns) + " |",
    ]
    for row in rows:
        ratios = [
            f'{row["relative_cost"][mode]["median_relative_to_default"]:.2f}x'
            for mode in MODES
        ]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + " | " + f'{row["reference_median_ms"]:.3f}'
            + " | " + " | ".join(ratios) + " |"
        )
    table.extend([
        "",
        "## SSAO image-change and warm-cost comparison",
        "",
        "Pixel changes are descriptive, not a perceptual quality rating.",
        "",
        "| Scene | Full SSAO vs default | Half SSAO vs default | Half / full cost | Half vs full pixel delta (0-255) |",
        "| --- | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        full = row["relative_cost"]["ambient-occlusion"]["median_relative_to_default"]
        half = row["relative_cost"]["ambient-occlusion-half"]["median_relative_to_default"]
        mae = row["experiments"]["ambient-occlusion-half"]["pixel_delta_from_full_ssao"][
            "mean_abs_rgb_channel_delta_255"
        ]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f" | {full:.2f}x | {half:.2f}x | "
            + f'{row["reduced_ssao_median_ratio_to_full_ssao"]:.2f}x'
            + f" | {mae:.4f} |"
        )
    table.extend([
        "",
        "Source geometry and accepted appearances were not modified.",
        "Software WebGL/SwiftShader is a regression environment, not a GPU benchmark.",
        "See individual scene JSON for per-draw samples, backend, image fingerprints,",
        "before/after baselines, and experiment settings.",
        "",
    ])
    path.write_text("\n".join(table), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--scene", choices=SCENES)
    parser.add_argument("--allow-swiftshader", action="store_true")
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--samples", type=int, default=7)
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/renderer-costs"))
    args = parser.parse_args()
    if args.self_test:
        check_self_test()
        return
    if not 1 <= args.warmups <= 6 or not 2 <= args.samples <= 8:
        parser.error("Require 1-6 warmups and 2-8 measured draws")
    from playwright.sync_api import sync_playwright
    out = args.output_dir
    if not out.is_absolute():
        out = ROOT / out
    out.mkdir(parents=True, exist_ok=True)
    ledger = json.loads((ROOT / "contracts/accepted-block-chibi-v1.json").read_text())
    chosen = (args.scene,) if args.scene else SCENES
    rows: list[dict] = []
    with sync_playwright() as pw:
        browser_args = ["--no-sandbox", "--disable-dev-shm-usage"]
        if args.allow_swiftshader:
            browser_args.append("--enable-unsafe-swiftshader")
        browser = pw.chromium.launch(
            headless=True,
            executable_path=os.environ.get("SCENARIUM_CHROMIUM") or None,
            args=browser_args,
        )
        try:
            for name in chosen:
                row = run_scene(browser, name, ledger, args.warmups, args.samples)
                rows.append(row)
                (out / f"{name}.json").write_text(
                    json.dumps(row, indent=2) + "\n", encoding="utf-8"
                )
                print(
                    "PASS " + name + ": default warm CPU median "
                    + f'{row["reference_median_ms"]:.3f} ms, '
                    + ", ".join(
                        mode + "="
                        + f'{row["relative_cost"][mode]["median_relative_to_default"]:.2f}x'
                        for mode in MODES
                    ),
                    flush=True,
                )
        finally:
            browser.close()
    (out / "summary.json").write_text(
        json.dumps({
            "schema": "renderarium-renderer-cost-v1",
            "metric": "warm_cpu_submit_ms_not_gpu_time",
            "sample_count": args.samples,
            "warmup_count": args.warmups,
            "viewport": VIEWPORT,
            "scene_count": len(rows),
            "modes": MODES,
            "scenes": rows,
            "image_delta_measurement": (
                "Mean absolute 8-bit sRGB channel difference and changed-pixel "
                "fraction, never a perceptual quality or correctness score."
            ),
            "draw_call_measurement": (
                "Three.js renderer.info counts all submission passes after disabling "
                "automatic reset in diagnostic QA; not unique scene meshes or GPU time."
            ),
            "caveat": (
                "Runner-dependent CPU-side render() duration, not GPU time or FPS. "
                "No default change or artistic quality approval implied."
            ),
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    write_summary(rows, out / "summary.md")
    print(f"PASS {len(rows)} scenes: warm renderer-cost diagnostics saved to {out}")


if __name__ == "__main__":
    main()
