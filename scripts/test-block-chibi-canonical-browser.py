#!/usr/bin/env python3
"""Optional agent-run Chromium QA for the canonical SC3D/Three.js scene path.

This launches the existing Scenarium preview server directly from the
source assembly; it MUST NOT write a generated scene snapshot.

Requirements: the repo's yaml/ajv/three packages plus Python Playwright
and Chromium. Runs with no GitHub Actions and no manual human QA.

Examples:
  python3 scripts/test-block-chibi-canonical-browser.py --scene factory
  python3 scripts/test-block-chibi-canonical-browser.py --scene garage
  python3 scripts/test-block-chibi-canonical-browser.py --scene factory --allow-swiftshader

SwiftShader is NOT evidence of physical GPU execution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import subprocess
import time

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCENES = {
    "living-room": (87, 9), "kitchen": (149, 11), "bathroom": (139, 10),
    "office": (104, 12), "backyard": (181, 18), "garage": (112, 8),
    "factory": (209, 16),
}


def await_server(process: subprocess.Popen[str]) -> str:
    """Read the URL from the server's actual ready message (PORT=0)."""
    assert process.stdout is not None
    deadline = time.monotonic() + 30
    log: list[str] = []
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f"Canonical preview server exited {process.returncode}: {''.join(log)}"
                )
            if not selector.select(timeout=0.5):
                continue
            line = process.stdout.readline()
            if not line:
                continue
            log.append(line)
            match = re.search(r"SC3D preview: (http://127\.0\.0\.1:\d+/)", line)
            if match:
                return match.group(1)
    raise TimeoutError("Canonical preview server never became ready: " + "".join(log))


def git_blob_sha(path: Path) -> str:
    content = path.read_bytes()
    prefix = f"blob {len(content)}\0".encode("ascii")
    return hashlib.sha1(prefix + content).hexdigest()


def run(scene: str, allow_swiftshader: bool, report_json: Path | None = None) -> None:
    assembly = f"scenes/block-chibi-{scene}-v1/room.assembly.yml"
    scene_id = f"block-chibi-{scene}-v1"
    expected_parts, expected_components = SCENES[scene]
    ledger = json.loads((ROOT / "contracts/accepted-block-chibi-v1.json").read_text())
    accepted = next(item for item in ledger["recorded_scenes"] if item["scene"] == scene_id)
    for kind in ("assembly", "preview"):
        path = ROOT / accepted[f"{kind}_path"]
        assert git_blob_sha(path) == accepted[f"{kind}_git_blob"], (
            f"{scene_id}: frozen {kind} source changed"
        )
    generated = ROOT / f"scenes/block-chibi-{scene}-v1/generated/block-chibi-{scene}-v1.sc3d.yml"
    initial = generated.read_bytes() if generated.exists() else None
    server_env = {**os.environ, "PORT": "0", "SC3D_SOFTWARE_PREVIEW": "0"}

    process = subprocess.Popen(
        ["node", "scripts/serve-sc3d-preview.mjs", assembly],
        cwd=ROOT,
        env=server_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        url = await_server(process)
        args = ["--no-sandbox", "--disable-dev-shm-usage"]
        if allow_swiftshader:
            args.append("--enable-unsafe-swiftshader")
        with sync_playwright() as pw:
            binary = os.environ.get("SCENARIUM_CHROMIUM")
            browser = pw.chromium.launch(
                executable_path=binary if binary else None,
                headless=True,
                args=args,
            )
            try:
                page = browser.new_page(viewport={"width": 1140, "height": 760})
                ir_response = page.request.get(url + "asset-ir.json", timeout=12000)
                assert ir_response.ok, f"Source IR endpoint failed: {ir_response.status}"
                ir = ir_response.json()
                assert ir["ir_kind"] == "Constructive3DIR"
                assert ir["asset"]["id"] == scene_id
                parts = ir["parts"]
                geometry_parts = sum(part.get("geometry") is not None for part in parts.values())
                component_roots = sum(
                    part.get("role") == "component-root" for part in parts.values()
                )
                assert (geometry_parts, component_roots) == (
                    expected_parts, expected_components
                ), f"{scene_id}: canonical source census drifted"
                for part_id, part in parts.items():
                    parent = part.get("parent")
                    assert parent is None or parent in parts, (
                        f"{scene_id}: missing parent for {part_id}"
                    )
                    transform = part.get("transform") or {}
                    for key in ("translate", "rotate_deg", "scale"):
                        values = transform.get(key)
                        if values is None:
                            continue
                        assert isinstance(values, list) and len(values) == 3 and all(
                            isinstance(value, (int, float))
                            and math.isfinite(value)
                            and (key != "scale" or value > 0)
                            for value in values
                        ), f"{scene_id}: invalid {key} on {part_id}"
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                network_errors: list[str] = []
                page.on("response", lambda response: network_errors.append(
                    f"HTTP {response.status} {response.url}") if response.status >= 400 else None)
                page.on("requestfailed", lambda request: network_errors.append(
                    f"Request failed: {request.url}"))
                navigation_start = time.perf_counter()
                response = page.goto(url + "?projection=perspective&view=front-three-quarter&qa=1")
                assert response is not None and response.ok, (
                    f"Preview entrypoint failed: HTTP {response.status if response else 'none'}; "
                    f"network={network_errors}; page_errors={errors}")
                assert page.locator("#viewport").count() == 1, (
                    f"Expected SC3D viewport missing; network={network_errors}; page_errors={errors}")
                try:
                    page.wait_for_function(
                        "() => window.__SC3D_READY__ === true"
                        " && document.documentElement.dataset.sc3dReady === 'true'",
                        timeout=30000,
                    )
                except Exception as exc:
                    state = page.evaluate("""() => ({
                        ready: window.__SC3D_READY__,
                        error: window.__SC3D_ERROR__,
                        status: document.querySelector('#status')?.textContent,
                        data: {...document.documentElement.dataset}
                    })""")
                    raise AssertionError(
                        f"SC3D render readiness failed: state={state}; "
                        f"network={network_errors}; page_errors={errors}") from exc
                ready_ms = round((time.perf_counter() - navigation_start) * 1000, 2)
                assert not errors, f"Canonical Three.js browser error: {errors}"
                status = page.locator("#status").inner_text()
                assert "validated" in status.lower(), status
                assert page.locator("#sc3d-preview-error").count() == 0
                canvas = page.locator("#viewport canvas")
                assert canvas.count() == 1, "Canonical WebGL canvas missing"
                original = canvas.screenshot()
                initial_frame = int(page.locator("html").get_attribute("data-sc3d-frame") or "0")
                assert initial_frame >= 1, "No initial Three.js draw was recorded"
                rect = canvas.bounding_box()
                assert rect is not None
                x, y = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2

                page.mouse.move(x, y)
                page.mouse.down()
                page.mouse.move(x + 150, y + 65, steps=8)
                page.mouse.up()
                page.wait_for_timeout(250)
                orbit_png = canvas.screenshot()
                orbit_frame = int(page.locator("html").get_attribute("data-sc3d-frame") or "0")
                assert orbit_png != original and orbit_frame > initial_frame, (
                    "Three.js orbit did not produce a fresh changed frame"
                )

                page.locator("#structure").check()
                page.wait_for_timeout(250)
                wire_png = canvas.screenshot()
                wire_frame = int(page.locator("html").get_attribute("data-sc3d-frame") or "0")
                assert wire_png != orbit_png and wire_frame > orbit_frame, (
                    "Wireframe control did not produce a fresh changed frame"
                )

                page.locator("#structure").uncheck()
                page.locator("#reset").click()
                page.wait_for_timeout(250)
                reset_png = canvas.screenshot()
                reset_frame = int(page.locator("html").get_attribute("data-sc3d-frame") or "0")
                assert reset_frame > wire_frame, "Reset did not produce a fresh frame"
                assert reset_png == original, "Reset did not restore initial render"

                page.mouse.move(x, y)
                page.mouse.wheel(0, -500)
                page.wait_for_timeout(250)
                zoom_png = canvas.screenshot()
                zoom_frame = int(page.locator("html").get_attribute("data-sc3d-frame") or "0")
                assert zoom_frame > reset_frame and zoom_png != reset_png, (
                    "Zoom did not produce a fresh changed frame"
                )
                assert not errors, f"Browser errors after controls: {errors}"
                assert page.locator("#sc3d-preview-error").count() == 0

                webgl = page.evaluate("""
                    () => {
                      const canvas = document.querySelector('#viewport canvas');
                      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
                      if (!gl) return null;
                      const extension = gl.getExtension('WEBGL_debug_renderer_info');
                      return {
                        renderer: extension
                          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                          : gl.getParameter(gl.RENDERER),
                        vendor: extension
                          ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
                          : gl.getParameter(gl.VENDOR),
                        version: gl.getParameter(gl.VERSION),
                        drawing_buffer_width: gl.drawingBufferWidth,
                        drawing_buffer_height: gl.drawingBufferHeight,
                        max_texture_size: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                      };
                    }
                """)
                assert webgl is not None, "No observable WebGL context"
                assert webgl["drawing_buffer_width"] > 0
                assert webgl["drawing_buffer_height"] > 0
                renderer_name = str(webgl["renderer"])
                likely_software = any(
                    token in renderer_name.lower()
                    for token in ("swiftshader", "llvmpipe", "softpipe", "software rasterizer")
                )
                qa_frames = page.evaluate("() => window.__SC3D_QA_REPORT__?.()")
                assert isinstance(qa_frames, list), "QA draw instrumentation unavailable"
                assert len(qa_frames) == zoom_frame, (
                    f"Instrumentation missed draws: {len(qa_frames)} vs {zoom_frame}"
                )
                for frame in qa_frames:
                    assert (
                        math.isfinite(frame["cpu_submit_ms"])
                        and frame["cpu_submit_ms"] >= 0
                        and frame["draw_calls"] > 0
                        and frame["triangles"] + frame["lines"] + frame["points"] > 0
                    ), f"Invalid Three.js draw metrics: {frame}"
                screenshots = {
                    "initial": original, "orbit": orbit_png, "wireframe": wire_png,
                    "reset": reset_png, "zoom": zoom_png,
                }
                report = {
                    "schema": "renderarium-renderer-baseline-v1",
                    "scene": scene_id,
                    "accepted_source": {
                        "assembly_blob": accepted["assembly_git_blob"],
                        "preview_blob": accepted["preview_git_blob"],
                    },
                    "canonical_ir": {
                        "total_parts": len(parts),
                        "geometry_parts": geometry_parts,
                        "component_roots": component_roots,
                        "materials": len(ir["materials"]),
                    },
                    "browser": {
                        "navigation_to_ready_ms": ready_ms,
                        "draw_samples": qa_frames,
                        "draw_metric_note": (
                            "cpu_submit_ms measures the blocking renderer.render() call, "
                            "not asynchronous GPU frame time. Samples include interaction "
                            "and redraw work on this runner."
                        ),
                        "frame_numbers": {
                            "initial": initial_frame, "orbit": orbit_frame,
                            "wireframe": wire_frame, "reset": reset_frame,
                            "zoom": zoom_frame,
                        },
                        "canvas_sha256": {
                            name: hashlib.sha256(data).hexdigest()
                            for name, data in screenshots.items()
                        },
                        "page_errors": errors,
                        "network_errors": network_errors,
                    },
                    "webgl": webgl,
                    "backend_class": "software-webgl" if likely_software
                        else "unverified-webgl",
                    "measurement_note": (
                        "Navigation-to-ready is a wall-clock measurement in this "
                        "runner, not a frame-time or GPU benchmark. Screenshot hashes "
                        "are run-local diagnostics, not visual acceptance hashes. "
                        "The renderer string does not prove physical GPU use."
                    ),
                }
                if scene == "factory":
                    # Quality trials share the real Three.js path, but never
                    # edit accepted source or activate on an ordinary preview.
                    def sample_quality(query: str) -> tuple[dict, str, list[dict]]:
                        trial = browser.new_page(viewport={"width": 960, "height": 640})
                        trial_errors: list[str] = []
                        trial.on("pageerror", lambda error: trial_errors.append(str(error)))
                        trial.on("requestfailed", lambda request: trial_errors.append(
                            f"Request failed: {request.url}"))
                        try:
                            result = trial.goto(url + query)
                            assert result is not None and result.ok
                            trial.wait_for_function(
                                "() => window.__SC3D_READY__ === true "
                                "&& document.documentElement.dataset.sc3dReady === 'true'",
                                timeout=30000,
                            )
                            settings = trial.evaluate(
                                "() => window.__SC3D_QUALITY_REPORT__?.()"
                            )
                            assert isinstance(settings, dict), "Quality QA settings missing"
                            image = trial.locator("#viewport canvas").screenshot()
                            measurements = trial.evaluate(
                                "() => window.__SC3D_QA_REPORT__?.()"
                            )
                            assert isinstance(measurements, list) and measurements
                            assert all(
                                math.isfinite(sample["cpu_submit_ms"])
                                and sample["cpu_submit_ms"] >= 0
                                and sample["draw_calls"] > 0
                                for sample in measurements
                            ), f"Invalid quality draw measurements: {measurements}"
                            assert not trial_errors, f"Quality trial browser errors: {trial_errors}"
                            return (
                                settings,
                                hashlib.sha256(image).hexdigest(),
                                measurements,
                            )
                        finally:
                            trial.close()

                    ordinary_settings, ordinary_hash, ordinary_metrics = sample_quality(
                        "?diagnostic=1&qa=1"
                    )
                    assert ordinary_settings["experiment"] == "none"
                    assert ordinary_settings["fog_near"] is None
                    assert ordinary_settings["shadow_map_size"] == [1024, 1024]
                    assert ordinary_settings["key_intensity"] == 3.1
                    assert ordinary_settings["ambient_occlusion_enabled"] is False
                    assert ordinary_settings["ambient_occlusion_depth_texture"] is False
                    assert ordinary_settings["fxaa_enabled"] is False

                    quality_results = {}
                    for experiment in ("fog", "soft-light", "shadow-detail", "tone-map", "ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders", "fxaa"):
                        settings, image_hash, draw_metrics = sample_quality(
                            "?diagnostic=1&qa=1&quality_experiment=" + experiment
                        )
                        assert settings["experiment"] == experiment
                        if experiment == "fog":
                            assert settings["fog_near"] == 6
                            assert settings["fog_far"] == 15
                            assert image_hash != ordinary_hash, (
                                "Fog experiment did not alter the diagnostic render"
                            )
                        elif experiment == "soft-light":
                            assert settings["key_intensity"] == 2.2
                            assert settings["fill_intensity"] == 0.75
                            assert image_hash != ordinary_hash, (
                                "Lighting experiment did not alter the diagnostic render"
                            )
                        elif experiment == "shadow-detail":
                            assert settings["shadow_map_size"] == [2048, 2048]
                            assert settings["shadow_normal_bias"] == 0.015
                        elif experiment == "tone-map":
                            assert settings["tone_mapping"] != ordinary_settings["tone_mapping"]
                            assert settings["tone_mapping_exposure"] == 1.15
                            assert image_hash != ordinary_hash, (
                                "Tone-mapping trial did not alter the diagnostic render"
                            )
                        elif experiment in ("ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders"):
                            reduced = experiment == "ambient-occlusion-half"
                            assert settings["ambient_occlusion_enabled"] is True
                            assert isinstance(settings["ambient_occlusion_sampling_seed"], int)
                            assert settings["ambient_occlusion_sampling_seed"] > 0
                            assert settings["ambient_occlusion_random_restored"] is True
                            assert settings["ambient_occlusion_samples"] == (8 if reduced else 16)
                            assert settings["ambient_occlusion_resolution_scale"] == (
                                0.5 if reduced else 1
                            )
                            assert settings["ambient_occlusion_radius"] == 0.65
                            assert settings["ambient_occlusion_projection_define"] == 0
                            assert settings["ambient_occlusion_depth_texture"] is True
                            if experiment in ("ambient-occlusion-occluders", "ambient-occlusion-camera-occluders"):
                                selection = settings["ambient_occlusion_occluders"]
                                assert selection["strategy"] == (
                                    "top-half-by-projected-viewport-coverage"
                                    if experiment == "ambient-occlusion-camera-occluders"
                                    else "largest-half-by-world-radius"
                                )
                                assert selection["evaluations"] >= 1
                                assert len(selection["selected_indices"]) == selection["retained"]
                                assert len(set(selection["selected_indices"])) == selection["retained"]
                                assert selection["retained"] == math.ceil(selection["total"] / 2)
                                assert selection["omitted"] + selection["retained"] == selection["total"]
                                assert selection["omitted"] > 0
                                assert selection["visibility_restored"] is True
                                assert draw_metrics[-1]["draw_calls"] < (
                                    quality_results["ambient-occlusion"]["draw_samples"][-1]["draw_calls"]
                                ), "Pruned SSAO did not reduce draw calls"
                                assert image_hash != quality_results["ambient-occlusion"]["canvas_sha256"]
                            else:
                                assert settings["ambient_occlusion_occluders"] is None
                            if reduced:
                                w, h = settings["ambient_occlusion_render_size"]
                                assert 0 < w < 960 and 0 < h < 640
                                assert image_hash != quality_results["ambient-occlusion"]["canvas_sha256"], (
                                    "Reduced SSAO should differ from full-resolution SSAO"
                                )
                            assert image_hash != ordinary_hash, (
                                "SSAO depth/normal post-pass produced unchanged pixels"
                            )
                        else:
                            assert settings["fxaa_enabled"] is True
                            assert settings["fxaa_pass_count"] == 3
                            assert settings["ambient_occlusion_enabled"] is False
                            assert all(
                                math.isfinite(value) and value > 0
                                for value in settings["fxaa_resolution"]
                            )
                            assert image_hash != ordinary_hash, (
                                "FXAA compositor produced unchanged pixels"
                            )
                        if experiment in ("ambient-occlusion", "ambient-occlusion-half", "ambient-occlusion-occluders", "ambient-occlusion-camera-occluders", "fxaa"):
                            assert draw_metrics[-1]["draw_calls"] > ordinary_metrics[-1]["draw_calls"], (
                                f"{experiment} multi-pass draw count did not exceed the default"
                            )
                        quality_results[experiment] = {
                            "settings": settings,
                            "canvas_sha256": image_hash,
                            "different_from_default": image_hash != ordinary_hash,
                            "draw_samples": draw_metrics,
                        }
                    # The identical full SSAO trial must have identical
                    # pixels across fresh browser pages. Otherwise comparing
                    # pruned vs full AO screenshots mixes RNG with geometry.
                    stable_settings, stable_hash, stable_metrics = sample_quality(
                        "?diagnostic=1&qa=1&quality_experiment=ambient-occlusion"
                    )
                    assert stable_settings == quality_results["ambient-occlusion"]["settings"]
                    assert stable_hash == quality_results["ambient-occlusion"]["canvas_sha256"], (
                        "Full SSAO differs between runs; sampling noise is not reproducible"
                    )
                    quality_results["ambient-occlusion"]["repeated_canvas_sha256"] = stable_hash
                    quality_results["ambient-occlusion"]["repeated_draw_samples"] = stable_metrics
                    # A fresh canonical diagnostic render remains unchanged
                    # after running the trials in separate browser pages.
                    # Perspective depth reconstruction is a separate shader
                    # variant, tested against its own matching-camera baseline.
                    perspective_default, perspective_hash, perspective_metrics = sample_quality(
                        "?diagnostic=1&qa=1&projection=perspective"
                    )
                    perspective_ssao, perspective_ao_hash, perspective_ao_metrics = sample_quality(
                        "?diagnostic=1&qa=1&projection=perspective"
                        "&quality_experiment=ambient-occlusion"
                    )
                    assert perspective_default["ambient_occlusion_enabled"] is False
                    assert perspective_ssao["ambient_occlusion_enabled"] is True
                    assert perspective_ssao["ambient_occlusion_projection_define"] == 1
                    assert perspective_ao_hash != perspective_hash, (
                        "Perspective SSAO did not alter the rendered scene"
                    )
                    perspective_pruned, perspective_pruned_hash, perspective_pruned_metrics = sample_quality(
                        "?diagnostic=1&qa=1&projection=perspective"
                        "&quality_experiment=ambient-occlusion-occluders"
                    )
                    assert perspective_pruned["ambient_occlusion_projection_define"] == 1
                    assert perspective_pruned["ambient_occlusion_occluders"]["omitted"] > 0
                    assert perspective_pruned["ambient_occlusion_occluders"]["visibility_restored"]
                    assert perspective_pruned_metrics[-1]["draw_calls"] < perspective_ao_metrics[-1]["draw_calls"]
                    assert perspective_pruned_hash != perspective_hash
                    quality_results["ambient-occlusion"]["perspective"] = {
                        "default_canvas_sha256": perspective_hash,
                        "ssao_canvas_sha256": perspective_ao_hash,
                        "default_draw_samples": perspective_metrics,
                        "ssao_draw_samples": perspective_ao_metrics,
                    }

                    camera_pruned, camera_hash, camera_metrics = sample_quality(
                        "?diagnostic=1&qa=1&projection=perspective"
                        "&quality_experiment=ambient-occlusion-camera-occluders"
                    )
                    camera_selection = camera_pruned["ambient_occlusion_occluders"]
                    assert camera_pruned["ambient_occlusion_projection_define"] == 1
                    assert camera_selection["omitted"] > 0
                    assert camera_selection["visibility_restored"]
                    assert camera_selection["evaluations"] >= 1
                    assert camera_metrics[-1]["draw_calls"] < perspective_ao_metrics[-1]["draw_calls"]
                    assert camera_hash != perspective_hash
                    quality_results["ambient-occlusion-camera-occluders"]["perspective"] = {
                        "canvas_sha256": camera_hash,
                        "draw_samples": camera_metrics,
                        "settings": camera_pruned,
                    }
                    quality_results["ambient-occlusion-occluders"]["perspective"] = {
                        "canvas_sha256": perspective_pruned_hash,
                        "draw_samples": perspective_pruned_metrics,
                        "settings": perspective_pruned,
                    }
                    after_settings, after_hash, after_metrics = sample_quality(
                        "?diagnostic=1&qa=1"
                    )
                    assert after_settings == ordinary_settings
                    assert after_hash == ordinary_hash, (
                        "Quality trials changed the default renderer image"
                    )
                    def assert_quality_url_rejected(query: str) -> None:
                        trial = browser.new_page(viewport={"width": 960, "height": 640})
                        try:
                            result = trial.goto(url + query)
                            assert result is not None and result.ok
                            trial.wait_for_function(
                                "() => document.documentElement.dataset.sc3dError === 'true'",
                                timeout=10000,
                            )
                            assert trial.locator("#sc3d-preview-error").count() == 1
                            assert trial.evaluate(
                                "() => window.__SC3D_READY__ !== true"
                            ), "Invalid quality request rendered successfully"
                        finally:
                            trial.close()

                    assert_quality_url_rejected("?quality_experiment=fog")
                    assert_quality_url_rejected(
                        "?diagnostic=1&quality_experiment=unsupported"
                    )
                    assert_quality_url_rejected(
                        "?diagnostic=1&quality_experiment=fog&quality_experiment=soft-light"
                    )

                    report["quality_experiments"] = {
                        "rejected_invalid_requests": 3,
                        "default_canvas_sha256": ordinary_hash,
                        "default_draw_samples": ordinary_metrics,
                        "default_after_draw_samples": after_metrics,
                        "trials": quality_results,
                        "note": "Diagnostic experiments only, not new visual acceptance",
                    }
                    print("PASS nine diagnostic quality experiments, camera-based pruning in both projections, unchanged defaults")

                if report_json is not None:
                    destination = report_json if report_json.is_absolute() else ROOT / report_json
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
                print(
                    f"PASS canonical Three.js {scene}: {geometry_parts} geometries, "
                    f"{component_roots} components; orbit, wireframe, reset, zoom; "
                    f"ready {ready_ms}ms; {len(qa_frames)} measured draws; "
                    f"backend {report['backend_class']} "
                    f"({renderer_name})"
                )
                print("Timing is runner-specific; WebGL renderer identity is not physical GPU proof.")
            finally:
                browser.close()
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)
        current = generated.read_bytes() if generated.exists() else None
        assert current == initial, "Canonical browser preview mutated generated snapshot"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", choices=tuple(SCENES), default="factory")
    parser.add_argument("--allow-swiftshader", action="store_true")
    parser.add_argument(
        "--report-json", type=Path,
        help="Write per-scene machine-readable source, browser and WebGL diagnostics",
    )
    values = parser.parse_args()
    run(values.scene, values.allow_swiftshader, values.report_json)
