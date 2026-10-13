#!/usr/bin/env python3
"""Actual Chromium/WebGL environment explorer orbit, zoom and source-fidelity QA."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from io import BytesIO
from pathlib import Path
import selectors
import subprocess
import time
from urllib.request import urlopen

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SCENES = (
    "living-room", "kitchen", "bathroom", "office",
    "backyard", "garage", "factory",
)


def server_url(process: subprocess.Popen[str]) -> str:
    assert process.stdout
    deadline = time.monotonic() + 60
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Explorer server exited: {process.returncode}")
            if selector.select(timeout=0.5):
                line = process.stdout.readline()
                if line.startswith("SC3D preview: "):
                    return line.removeprefix("SC3D preview: ").strip()
    raise TimeoutError("Seven-scene preview server never reached ready state")


def pixels_present(data: bytes) -> None:
    with Image.open(BytesIO(data)) as opened:
        image = opened.convert("RGB")
    assert image.size == (960, 640), image.size
    background = Image.new("RGB", image.size, (37, 35, 42))
    difference = ImageChops.difference(image, background)
    assert difference.getbbox(), "Blank framebuffer: only background color"
    assert max(ImageStat.Stat(image).stddev) > 2.0, (
        "No useful geometric contrast in WebGL framebuffer"
    )


def vector_distance(a: list[float], b: list[float]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def snapshot(page) -> tuple[dict, bytes]:
    data = page.evaluate("() => window.__SC3D_ENVIRONMENT_REPORT__?.()")
    assert data and data["engine"] == "Three.js WebGLRenderer", data
    assert data["renderer_context"] in ("WebGL2RenderingContext", "WebGLRenderingContext"), data
    assert data["mesh_count"] > 20, data
    assert max(abs(angle) for angle in data["presentation_rotation"]) < 1e-10, (
        "Scene geometry rotated instead of the real camera"
    )
    pixels = page.locator("#viewport canvas").screenshot()
    pixels_present(pixels)
    return data, pixels


def wait_frame(page, previous: int) -> None:
    page.wait_for_function(
        "(previous) => window.__SC3D_ENVIRONMENT_REPORT__().frame > previous",
        arg=previous, timeout=30000,
    )


def drag(page, rect: dict, dx: float, dy: float = 0, button="left") -> None:
    x = rect["x"] + rect["width"] * 0.5
    y = rect["y"] + rect["height"] * 0.5
    page.mouse.move(x, y)
    page.mouse.down(button=button)
    page.mouse.move(x + dx, y + dy, steps=7)
    page.mouse.up(button=button)


def test_scene(browser, url: str, scene_name: str, out: Path) -> dict:
    page = browser.new_page(viewport={"width":960, "height":640}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: errors.append("request failed " + request.url))
    try:
        response = page.goto(
            url + f"?scene={scene_name}&projection=perspective",
            timeout=60000,
        )
        assert response is not None and response.ok
        page.wait_for_function(
            "() => window.__SC3D_READY__ === true && "
            "document.documentElement.dataset.sc3dReady === 'true' && "
            "typeof window.__SC3D_ENVIRONMENT_REPORT__ === 'function'",
            timeout=60000,
        )
        assert page.locator("#environment").input_value() == scene_name
        assert page.locator("#projection").input_value() == "perspective"
        initial, first = snapshot(page)
        assert initial["scene"] == f"block-chibi-{scene_name}-v1"
        rect = page.locator("#viewport canvas").bounding_box()
        assert rect
        screenshots = {"initial": first}
        views = []
        for step in range(4):
            before, _ = snapshot(page)
            drag(page, rect, 175)
            wait_frame(page, before["frame"])
            after, png = snapshot(page)
            assert after["mesh_count"] == initial["mesh_count"]
            assert vector_distance(before["camera_position"], after["camera_position"]) > 0.05, (
                "Orbit did not move the camera"
            )
            views.append(after["camera_position"])
            screenshots[f"orbit-{step+1}"] = png
        assert len({hashlib.sha256(p).hexdigest() for p in screenshots.values()}) >= 4, (
            "Full camera orbit produced repeated/unvarying frames"
        )
        # 4 x 175 x 0.009 rad is approximately one full revolution.
        orbit_displacement = vector_distance(
            initial["camera_position"], views[-1]
        )
        orbit_radius = vector_distance(
            initial["camera_position"], initial["camera_target"]
        )
        assert orbit_radius > 0
        assert orbit_displacement / orbit_radius < 0.025, (
            "Four quarter-orbits did not return near the starting view"
        )
        before, _ = snapshot(page)
        page.mouse.wheel(0, -430)
        wait_frame(page, before["frame"])
        zoomed, zoom_png = snapshot(page)
        assert vector_distance(initial["camera_position"], zoomed["camera_position"]) > 0.02
        assert zoom_png != screenshots["orbit-4"]
        screenshots["zoomed"] = zoom_png
        # View presets move only the camera; they must not rotate the world.
        before, _ = snapshot(page)
        page.locator("#above").click()
        wait_frame(page, before["frame"])
        above, above_png = snapshot(page)
        assert above_png != first
        screenshots["above"] = above_png
        before, _ = snapshot(page)
        page.locator("#rear").click()
        wait_frame(page, before["frame"])
        rear, rear_png = snapshot(page)
        assert rear_png != first
        screenshots["rear"] = rear_png
        # Right-button camera pan translates the orbit target; geometry
        # and presentation rotation must remain stable.
        before, _ = snapshot(page)
        drag(page, rect, 52, -35, button="right")
        wait_frame(page, before["frame"])
        panned, _ = snapshot(page)
        assert vector_distance(before["camera_target"], panned["camera_target"]) > 0.01
        assert panned["mesh_count"] == initial["mesh_count"]
        before, _ = snapshot(page)
        page.locator("#reset").click()
        wait_frame(page, before["frame"])
        reset, reset_png = snapshot(page)
        assert vector_distance(reset["camera_position"], initial["camera_position"]) < 1e-6, (
            "Camera reset did not restore the exact starting pose"
        )
        assert reset["mesh_count"] == initial["mesh_count"]
        assert vector_distance(reset["camera_target"], initial["camera_target"]) < 1e-6
        # Static geometry and light configuration restored after camera movement.
        assert max(abs(v) for v in reset["presentation_rotation"]) < 1e-10
        assert not errors, errors
        if scene_name == "living-room":
            response = page.goto(
                url + "?scene=living-room&projection=orthographic", timeout=60000
            )
            assert response is not None and response.ok
            page.wait_for_function(
                "() => window.__SC3D_READY__ === true && "
                "window.__SC3D_ENVIRONMENT_REPORT__?.().camera_projection === 'orthographic'",
                timeout=60000,
            )
            ortho, ortho_png = snapshot(page)
            ortho_rect = page.locator("#viewport canvas").bounding_box()
            assert ortho_rect
            drag(page, ortho_rect, 115)
            wait_frame(page, ortho["frame"])
            orbited, _ = snapshot(page)
            assert vector_distance(ortho["camera_position"], orbited["camera_position"]) > 0.03
            before, _ = snapshot(page)
            page.mouse.wheel(0, -310)
            wait_frame(page, before["frame"])
            ortho_zoom, _ = snapshot(page)
            assert ortho_zoom["camera_zoom"] > before["camera_zoom"]
            assert ortho_zoom["mesh_count"] == initial["mesh_count"]
            screenshots["orthographic"] = ortho_png
            assert not errors, errors
        out.mkdir(parents=True, exist_ok=True)
        for name in ("initial", "orbit-2", "zoomed", "above"):
            (out / f"{scene_name}-{name}.png").write_bytes(screenshots[name])
        return {
            "scene": scene_name,
            "engine": initial["engine"],
            "renderer_context": initial["renderer_context"],
            "mesh_count": initial["mesh_count"],
            "orbited_frames": len(views),
            "start_camera_position": initial["camera_position"],
            "reset_camera_position": reset["camera_position"],
            "screenshots": {
                k: hashlib.sha256(v).hexdigest()
                for k, v in screenshots.items()
            },
            "status": "passed",
        }
    finally:
        page.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="artifacts/interactive-environments")
    parser.add_argument("--allow-swiftshader", action="store_true")
    args = parser.parse_args()
    out = ROOT / args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    generated_paths = [
        ROOT / f"scenes/block-chibi-{s}-v1/generated/block-chibi-{s}-v1.sc3d.yml"
        for s in SCENES
    ]
    before = [p.read_bytes() if p.exists() else None for p in generated_paths]
    proc = subprocess.Popen(
        ["node", "scripts/serve-sc3d-preview.mjs", "--environments"],
        cwd=ROOT,
        env={**os.environ, "PORT": "0"},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,
    )
    try:
        url = server_url(proc)
        with urlopen(url + "environment-list.json", timeout=20) as response:
            catalog = json.load(response)
        assert tuple(catalog["scenes"]) == SCENES
        try:
            with urlopen(url + "asset-ir.json?scene=not-approved", timeout=20):
                raise AssertionError("Unknown environment was accepted")
        except Exception as error:
            from urllib.error import HTTPError
            assert isinstance(error, HTTPError) and error.code == 400, str(error)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            flags = ["--no-sandbox", "--disable-dev-shm-usage"]
            if args.allow_swiftshader:
                flags.append("--enable-unsafe-swiftshader")
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=os.environ.get("SCENARIUM_CHROMIUM") or None,
                args=flags,
            )
            try:
                results = []
                for scene in SCENES:
                    result = test_scene(browser, url, scene, out)
                    results.append(result)
                    print(
                        f"PASS {scene}: WebGL orbit 360 / zoom / above / rear / reset",
                        flush=True,
                    )
                (out / "report.json").write_text(
                    json.dumps({
                        "source": "actual frozen SC3D assemblies via Three.js",
                        "engine": "THREE.WebGLRenderer",
                        "renderer": "SwiftShader only when explicitly enabled",
                        "scenes": results,
                        "note": "Raster QA, not physical GPU or human beauty acceptance",
                    }, indent=2) + "\n"
                )
            finally:
                browser.close()
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate(timeout=8)
        after = [p.read_bytes() if p.exists() else None for p in generated_paths]
        assert before == after, "Frozen generated scene snapshot changed"
        print("PASS seven frozen generated snapshots unchanged", flush=True)


if __name__ == "__main__":
    main()
