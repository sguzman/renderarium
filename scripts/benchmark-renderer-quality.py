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

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SCENES = (
    "living-room", "kitchen", "bathroom", "office",
    "backyard", "garage", "factory",
)
MODES = (
    "fog", "soft-light", "shadow-detail",
    "tone-map", "ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders", "ambient-occlusion-camera-occluders-75", "ambient-occlusion-camera-occluders-75-cached", "fxaa",
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


def render_ao_inspection_sheet(images: dict[str, bytes]) -> Image.Image:
    """Lay out authentic previews and contrast-amplified pixel differences.

    A visual diagnostic for later autonomous inspection, NOT a perceptual
    metric or an assertion that any occluder-pruning policy is acceptable.
    """
    modes = (
        "ambient-occlusion",
        "ambient-occlusion-camera-occluders",
        "ambient-occlusion-camera-occluders-75",
        "ambient-occlusion-camera-occluders-75-cached",
    )
    previews = []
    for mode in modes:
        with Image.open(BytesIO(images[mode])) as opened:
            previews.append(opened.convert("RGB"))
    sizes = {preview.size for preview in previews}
    if len(sizes) != 1:
        raise ValueError(f"SSAO inspection sheet images differ in dimensions: {sizes}")
    width, height = previews[0].size
    if width <= 0 or height <= 0:
        raise ValueError("SSAO inspection images must contain pixels")
    header = 28
    footer = 20
    sheet = Image.new(
        "RGB", (width * 4, (height + header) * 2 + footer), (18, 18, 18)
    )
    draw = ImageDraw.Draw(sheet)
    labels = ("Full SSAO", "Camera 50%", "Camera 75%", "Camera 75% cached")
    diff_labels = (
        "Unmodified reference",
        "Difference vs full (8x)",
        "Difference vs full (8x)",
        "Difference vs uncached (8x)",
    )
    # Preserve authentic pixels in the top row; do not contrast-enhance them.
    for column, (preview, label) in enumerate(zip(previews, labels)):
        x = width * column
        draw.text((x + 8, 8), label, fill=(240, 240, 240))
        sheet.paste(preview, (x, header))
    # Multiply each channel of the absolute difference by 8, clamping at 255.
    # This is intentionally only an inspection aid, not linear-light energy.
    black = Image.new("RGB", previews[0].size, (0, 0, 0))
    differences = (
        black,
        ImageChops.difference(previews[0], previews[1]),
        ImageChops.difference(previews[0], previews[2]),
        ImageChops.difference(previews[2], previews[3]),
    )
    for column, (difference, label) in enumerate(zip(differences, diff_labels)):
        x = width * column
        y = height + header
        draw.text((x + 8, y + 8), label, fill=(240, 240, 240))
        enhanced = difference.point(lambda value: min(255, value * 8))
        sheet.paste(enhanced, (x, y + header))
    draw.text(
        (8, 2 * (height + header) + 3),
        "Inspection-only sRGB differences, amplified 8x; not a visual acceptance verdict",
        fill=(240, 240, 240),
    )
    return sheet


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
    sheet = render_ao_inspection_sheet({
        "ambient-occlusion": before_png,
        "ambient-occlusion-camera-occluders": after_png,
        "ambient-occlusion-camera-occluders-75": before_png,
        "ambient-occlusion-camera-occluders-75-cached": before_png,
    })
    assert sheet.size == (8, (1 + 28) * 2 + 20)
    assert sheet.getpixel((0, 28)) == (0, 0, 0)
    assert sheet.getpixel((0, 1 + 28 + 28)) == (0, 0, 0)
    try:
        render_ao_inspection_sheet({
            "ambient-occlusion": before_png,
            "ambient-occlusion-camera-occluders": after_png,
            "ambient-occlusion-camera-occluders-75": encode(Image.new("RGB", (3, 1))),
            "ambient-occlusion-camera-occluders-75-cached": before_png,
        })
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched inspection sheet dimensions accepted")
    print("PASS renderer cost, image deltas and inspection-sheet self-test")


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
            for stage in ("primary_pipeline_cpu_ms", "ambient_occlusion_cpu_ms"):
                assert math.isfinite(frame[stage]) and frame[stage] >= 0, (
                    f"Invalid {stage} timing: {frame}"
                )
            assert (
                frame["primary_pipeline_cpu_ms"] +
                frame["ambient_occlusion_cpu_ms"] <= frame[METRIC] + 0.001
            ), f"Stage measurements exceed recorded frame cost: {frame}"
            value = frame[METRIC]
            assert math.isfinite(value) and value >= 0, f"Invalid sample: {frame}"
            return frame

        warm = [trigger() for _ in range(warmups)]
        measured = [trigger() for _ in range(samples)]
        resource_fields = (
            "resource_geometries", "resource_textures", "shader_programs"
        )
        for field in resource_fields:
            values = [row[field] for row in measured]
            assert all(
                isinstance(value, int) and not isinstance(value, bool) and value >= 0
                for value in values
            ), f"{mode}: invalid Three.js {field} counters: {values}"
            assert len(set(values)) == 1, (
                f"{mode}: {field} kept changing across warm redraws: {values}"
            )
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
        if mode in ("ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders", "ambient-occlusion-camera-occluders-75", "ambient-occlusion-camera-occluders-75-cached", "fxaa"):
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
            "stage_costs": {
                "primary_pipeline": summarize(
                    [x["primary_pipeline_cpu_ms"] for x in measured]
                ),
                "ambient_occlusion_post": summarize(
                    [x["ambient_occlusion_cpu_ms"] for x in measured]
                ),
            },
            "warm_resource_counts": {
                field: measured[-1][field]
                for field in resource_fields
            },
            "settings": settings,
            "backend": backend,
            "canvas_sha256": image_hash,
        }
    finally:
        page.close()


def run_scene(
    browser, name: str, ledger: dict, warmups: int, samples: int, inspection_dir: Path
) -> dict:
    scene_id = f"block-chibi-{name}-v1"
    accepted = next(
        (v for v in ledger["recorded_scenes"] if v["scene"] == scene_id), None
    )
    assert accepted, f"Missing frozen source record for {scene_id}"
    assert git_blob_sha(ROOT / accepted["assembly_path"]) == accepted["assembly_git_blob"], (
        f"Frozen {scene_id} assembly source changed"
    )
    verified_preview_blob = accepted["preview_git_blob"]
    acceptance_authority = "contracts/accepted-block-chibi-v1.json"
    if scene == "backyard":
        amendment_path = "contracts/accepted-backyard-geometry-amendment-2026-10-14.json"
        assert git_blob_sha(ROOT / amendment_path) == "5c4c69a05743b84c793b80289ca7be441dce5b7a", (
            f"{scene_id}: corrected acceptance amendment drift"
        )
        amendment = json.loads((ROOT / amendment_path).read_text())
        assert amendment["scene"] == scene_id
        assert amendment["baseline"]["preview_blob"] == accepted["preview_git_blob"]
        assert amendment["baseline"]["parts"] == accepted["primitives"] == 181
        assert git_blob_sha(ROOT / amendment["baseline"]["historical_preview_path"]) == accepted["preview_git_blob"]
        assert git_blob_sha(ROOT / amendment["baseline"]["historical_shell_path"]) == amendment["baseline"]["shell_blob"]
        assert amendment["corrected"]["parts"] == 179
        assert amendment["corrected"]["preview_path"] == accepted["preview_path"]
        assert git_blob_sha(ROOT / amendment["corrected"]["shell_path"]) == amendment["corrected"]["shell_blob"]
        verified_preview_blob = amendment["corrected"]["preview_blob"]
        acceptance_authority = amendment_path
    assert git_blob_sha(ROOT / accepted["preview_path"]) == verified_preview_blob, (
        f"Frozen {scene_id} current accepted preview source changed"
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
        trials["ambient-occlusion-occluders"]["pixel_delta_from_full_ssao"] = pixel_distance(
            trial_images["ambient-occlusion"],
            trial_images["ambient-occlusion-occluders"],
        )
        trials["ambient-occlusion-camera-occluders"]["pixel_delta_from_full_ssao"] = pixel_distance(
            trial_images["ambient-occlusion"],
            trial_images["ambient-occlusion-camera-occluders"],
        )
        trials["ambient-occlusion-camera-occluders"]["pixel_delta_from_world_pruning"] = pixel_distance(
            trial_images["ambient-occlusion-occluders"],
            trial_images["ambient-occlusion-camera-occluders"],
        )
        trials["ambient-occlusion-camera-occluders-75"]["pixel_delta_from_full_ssao"] = pixel_distance(
            trial_images["ambient-occlusion"],
            trial_images["ambient-occlusion-camera-occluders-75"],
        )
        trials["ambient-occlusion-camera-occluders-75-cached"]["pixel_delta_from_uncached"] = pixel_distance(
            trial_images["ambient-occlusion-camera-occluders-75"],
            trial_images["ambient-occlusion-camera-occluders-75-cached"],
        )
        selection = trials["ambient-occlusion-occluders"]["settings"]["ambient_occlusion_occluders"]
        assert selection["visibility_restored"], f"{scene_id}: visibility not restored"
        assert selection["retained"] + selection["omitted"] == selection["total"]
        assert selection["omitted"] > 0
        full_calls = trials["ambient-occlusion"]["measured_draws"][-1]["draw_calls"]
        selected_calls = trials["ambient-occlusion-occluders"]["measured_draws"][-1]["draw_calls"]
        assert selected_calls < full_calls, (
            f"{scene_id}: pruned SSAO did not save geometry draws"
        )
        camera_selection = trials["ambient-occlusion-camera-occluders"]["settings"]["ambient_occlusion_occluders"]
        assert camera_selection["strategy"] == "top-half-by-projected-viewport-coverage"
        assert camera_selection["retained"] + camera_selection["omitted"] == camera_selection["total"]
        assert camera_selection["omitted"] > 0 and camera_selection["visibility_restored"]
        camera_calls = trials["ambient-occlusion-camera-occluders"]["measured_draws"][-1]["draw_calls"]
        assert camera_calls < full_calls, f"{scene_id}: camera pruning did not save draws"
        higher_retention = trials["ambient-occlusion-camera-occluders-75"]["settings"]["ambient_occlusion_occluders"]
        higher_draws = trials["ambient-occlusion-camera-occluders-75"]["measured_draws"][-1]["draw_calls"]
        assert higher_retention["retainedFraction"] == 0.75
        assert higher_retention["retained"] == math.ceil(higher_retention["total"] * 0.75)
        assert higher_retention["visibility_restored"]
        assert camera_calls <= higher_draws < full_calls, (
            f"{scene_id}: 50%, 75%, and full AO must have monotonic draw counts"
        )
        cached_trial = trials["ambient-occlusion-camera-occluders-75-cached"]
        cached_selection = cached_trial["settings"]["ambient_occlusion_occluders"]
        assert cached_selection["retainedFraction"] == 0.75
        assert cached_selection["cache_hits"] >= samples, (
            f"{scene_id}: selection was not reused during warm redraws"
        )
        assert cached_selection["evaluations"] < cached_selection["cache_hits"], (
            f"{scene_id}: cached ranking still recomputed on every redraw"
        )
        assert cached_trial["canvas_sha256"] == trials[
            "ambient-occlusion-camera-occluders-75"
        ]["canvas_sha256"], f"{scene_id}: cached vs uncached images differ"
        assert cached_trial["measured_draws"][-1]["draw_calls"] == higher_draws, (
            f"{scene_id}: cached vs uncached draw count differs"
        )
        assert cached_trial["pixel_delta_from_uncached"]["changed_pixel_fraction"] == 0
        inspection_dir.mkdir(parents=True, exist_ok=True)
        inspection_path = inspection_dir / f"{name}.png"
        inspection_sheet = render_ao_inspection_sheet(trial_images)
        inspection_sheet.save(inspection_path, format="PNG", optimize=True)
        all_modes = [baseline, *trials.values(), baseline_after]
        ref_backend = baseline["backend"]
        for row in all_modes:
            assert row["backend"] == ref_backend, (
                f"{scene_id}: backend/framebuffer changed during comparison"
            )
        baseline_before_ms = baseline["warm_cost"]["median_ms"]
        baseline_after_ms = baseline_after["warm_cost"]["median_ms"]
        reference_ms = statistics.median((baseline_before_ms, baseline_after_ms))
        assert baseline_before_ms > 0 and baseline_after_ms > 0, (
            f"{scene_id}: zero baseline cost; cannot compare"
        )
        baseline_drift_percent = round(
            100 * abs(baseline_after_ms - baseline_before_ms) / baseline_before_ms,
            2,
        )
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
            "inspection_sheet": {
                "artifact_path": f"inspection/{name}.png",
                "sha256": hashlib.sha256(inspection_path.read_bytes()).hexdigest(),
                "dimensions": [inspection_sheet.width, inspection_sheet.height],
                "diff_amplification": 8,
                "note": "Descriptive sRGB pixel differences only; not quality acceptance",
            },
            "frozen_source": {
                "authority": acceptance_authority,
                "assembly_blob": accepted["assembly_git_blob"],
                "preview_blob": verified_preview_blob,
                "historical_preview_blob": accepted["preview_git_blob"],
            },
            "backend": ref_backend,
            "default_before": baseline,
            "experiments": trials,
            "default_after": baseline_after,
            "reference_median_ms": round(reference_ms, 4),
            "baseline_drift_percent": baseline_drift_percent,
            "baseline_drift_warning": baseline_drift_percent > 20,
            "relative_cost": relative,
            "draw_calls": {
                "default_before": baseline["measured_draws"][-1]["draw_calls"],
                "default_after": baseline_after["measured_draws"][-1]["draw_calls"],
                **{mode: row["measured_draws"][-1]["draw_calls"] for mode, row in trials.items()},
            },
            "reduced_ssao_median_ratio_to_full_ssao": round(reduced_ms / full_ms, 4),
            "pruned_ssao_draw_call_savings": full_calls - selected_calls,
            "camera_pruned_ssao_draw_call_savings": full_calls - camera_calls,
            "camera_75_ssao_draw_call_savings": full_calls - higher_draws,
            "cached_75_ssao_ranking_hits": cached_selection["cache_hits"],
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
        "The before/after baseline drift is reported; changes above 20% flag",
        "a noisy comparison, not a failed correctness test.",
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
        "## Baseline drift and renderer resources",
        "",
        "| Scene | Baseline drift | Warning >20% | Default textures | Full SSAO textures | FXAA textures |",
        "| --- | ---: | :---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        base = row["default_before"]["warm_resource_counts"]["resource_textures"]
        ssao = row["experiments"]["ambient-occlusion"]["warm_resource_counts"]["resource_textures"]
        fxaa = row["experiments"]["fxaa"]["warm_resource_counts"]["resource_textures"]
        flag = "yes" if row["baseline_drift_warning"] else "no"
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f' | {row["baseline_drift_percent"]:.2f}% | {flag}'
            + f" | {base} | {ssao} | {fxaa} |"
        )
    table.extend([
        "",
        "## SSAO stage submission costs",
        "",
        "These are synchronous CPU-side submission times, not GPU pass timings.",
        "",
        "| Scene | Full SSAO primary ms | Full SSAO post ms | Half SSAO post ms |",
        "| --- | ---: | ---: | ---: |",
    ])
    for row in rows:
        full = row["experiments"]["ambient-occlusion"]["stage_costs"]
        half = row["experiments"]["ambient-occlusion-half"]["stage_costs"]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f' | {full["primary_pipeline"]["median_ms"]:.3f}'
            + f' | {full["ambient_occlusion_post"]["median_ms"]:.3f}'
            + f' | {half["ambient_occlusion_post"]["median_ms"]:.3f} |'
        )
    table.extend([
        "",
        "## Experimental SSAO occluder pruning",
        "",
        "Only AO depth/normal occluders are pruned; original scene geometry is intact.",
        "",
        "| Scene | Full AO draws | Pruned AO draws | Draws saved | Pruned/full CPU median | Pixel delta from full AO (0-255) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        full_calls = row["draw_calls"]["ambient-occlusion"]
        pruned_calls = row["draw_calls"]["ambient-occlusion-occluders"]
        full_ms = row["experiments"]["ambient-occlusion"]["warm_cost"]["median_ms"]
        pruned_ms = row["experiments"]["ambient-occlusion-occluders"]["warm_cost"]["median_ms"]
        pixel = row["experiments"]["ambient-occlusion-occluders"]["pixel_delta_from_full_ssao"]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f' | {full_calls} | {pruned_calls} | {full_calls-pruned_calls}'
            + f' | {pruned_ms/full_ms:.2f}x'
            + f' | {pixel["mean_abs_rgb_channel_delta_255"]:.4f} |'
        )
    table.extend([
        "",
        "## Viewport-aware AO selection compared with static world-space pruning",
        "",
        "Both select the largest half of ranked occluders, but the viewport-aware",
        "variant recalculates ranks after camera movement. Pixel deltas do not",
        "establish subjective quality.",
        "",
        "| Scene | World draws | Camera draws | World/full MAE | Camera/full MAE | Camera/world MAE | Camera/world CPU median |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        world = row["experiments"]["ambient-occlusion-occluders"]
        camera_row = row["experiments"]["ambient-occlusion-camera-occluders"]
        wd = world["pixel_delta_from_full_ssao"]["mean_abs_rgb_channel_delta_255"]
        cd = camera_row["pixel_delta_from_full_ssao"]["mean_abs_rgb_channel_delta_255"]
        between = camera_row["pixel_delta_from_world_pruning"]["mean_abs_rgb_channel_delta_255"]
        ratio = camera_row["warm_cost"]["median_ms"] / world["warm_cost"]["median_ms"]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f' | {row["draw_calls"]["ambient-occlusion-occluders"]}'
            + f' | {row["draw_calls"]["ambient-occlusion-camera-occluders"]}'
            + f" | {wd:.4f} | {cd:.4f} | {between:.4f} | {ratio:.2f}x |"
        )
    table.extend([
        "",
        "## Camera-aware 75% ranking cache",
        "",
        "Cache vs uncached must have identical pixels and geometry draw counts.",
        "Only ranked-occluder recomputation is elided on static redraws.",
        "",
        "| Scene | Uncached 75% ms | Cached 75% ms | Cached / uncached | Ranking recomputations | Cache hits |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        original = row["experiments"]["ambient-occlusion-camera-occluders-75"]
        cached_row = row["experiments"]["ambient-occlusion-camera-occluders-75-cached"]
        cached_selection = cached_row["settings"]["ambient_occlusion_occluders"]
        uncached_ms = original["warm_cost"]["median_ms"]
        cached_ms = cached_row["warm_cost"]["median_ms"]
        table.append(
            "| " + row["scene"].removeprefix("block-chibi-").removesuffix("-v1")
            + f" | {uncached_ms:.3f} | {cached_ms:.3f} | {cached_ms / uncached_ms:.2f}x"
            + f' | {cached_selection["evaluations"]} | {cached_selection["cache_hits"]} |'
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
                row = run_scene(
                    browser, name, ledger, args.warmups, args.samples,
                    out / "inspection",
                )
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
            "inspection_sheet_note": (
                "Seven 4-column, 2-row PNG sheets of actual previews and "
                "8x-amplified absolute RGB differences, not quality verdicts."
            ),
            "scenes": rows,
            "stage_measurement": (
                "primary_pipeline_cpu_ms times the default scene renderer or "
                "the FXAA EffectComposer; ambient_occlusion_cpu_ms separately "
                "times the depth/normal SSAO post-pass including resize checks. "
                "Their sum is the synchronous call duration, not GPU time."
            ),
            "resource_measurement": (
                "Three.js renderer.info resource counters are snapshots of this "
                "page's tracked WebGL objects; stable across measured warm draws. "
                "They are not process-wide GPU bytes or a VRAM measurement."
            ),
            "baseline_drift_warning_threshold_percent": 20,
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
