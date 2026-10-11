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
import os
from pathlib import Path
import re
import selectors
import subprocess
import time

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCENES = {
    "living-room": 87, "kitchen": 149, "bathroom": 139,
    "office": 104, "backyard": 181, "garage": 112, "factory": 209,
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


def run(scene: str, allow_swiftshader: bool) -> None:
    assembly = f"scenes/block-chibi-{scene}-v1/room.assembly.yml"
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
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url + "?projection=perspective&view=front-three-quarter")
                page.wait_for_function(
                    "() => window.__SC3D_READY__ === true"
                    " && document.documentElement.dataset.sc3dReady === 'true'",
                    timeout=30000,
                )
                assert not errors, f"Canonical Three.js browser error: {errors}"
                status = page.locator("#status").inner_text()
                assert "validated" in status.lower(), status
                assert page.locator("#sc3d-preview-error").count() == 0
                canvas = page.locator("#viewport canvas")
                assert canvas.count() == 1, "Canonical WebGL canvas missing"
                original = canvas.screenshot()
                rect = canvas.bounding_box()
                assert rect is not None
                x, y = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2

                page.mouse.move(x, y)
                page.mouse.down()
                page.mouse.move(x + 150, y + 65, steps=8)
                page.mouse.up()
                page.wait_for_timeout(250)
                assert canvas.screenshot() != original, "Three.js orbit not drawn"

                page.locator("#structure").check()
                page.wait_for_timeout(250)
                assert canvas.screenshot() != original, "Wireframe control had no effect"

                page.locator("#structure").uncheck()
                page.locator("#reset").click()
                page.mouse.move(x, y)
                page.mouse.wheel(0, -500)
                page.wait_for_timeout(250)
                assert not errors, f"Browser errors after controls: {errors}"
                assert page.locator("#sc3d-preview-error").count() == 0

                renderer = page.evaluate("""
                    () => {
                      const canvas = document.querySelector('#viewport canvas');
                      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
                      if (!gl) return 'WEBGL_CONTEXT_NOT_EXPOSED';
                      const extension = gl.getExtension('WEBGL_debug_renderer_info');
                      return extension
                        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                        : gl.getParameter(gl.RENDERER);
                    }
                """)
                print(
                    f"PASS canonical Three.js {scene}: rendered frame, orbit, "
                    f"wireframe, zoom, reset, zero JS errors. Renderer: {renderer}"
                )
                print("WebGL renderer string is not proof of physical GPU acceleration.")
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
    values = parser.parse_args()
    run(values.scene, values.allow_swiftshader)
