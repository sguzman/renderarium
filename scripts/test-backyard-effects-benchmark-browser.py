#!/usr/bin/env python3
"""Agent-owned Chromium smoke and measured-profile QA for Backyard effects v2.

The WebGL timer may be unsupported under software rendering. This checks real
browser shader compilation, seven completed modes, framebuffer dimensions,
draw counts and CPU samples; it does not claim physical-GPU timing or visual
acceptance. Do not turn this into a user QA assignment.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = ROOT / "experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html"
EXPECTED = ["Minimal", "Outlines", "Shafts", "Bloom", "Dust", "FXAA", "Combined"]
EXPECTED_DRAWS = [5, 5, 6, 8, 6, 5, 10]


def run(allow_swiftshader: bool, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        flags = ["--no-sandbox", "--disable-dev-shm-usage"]
        if allow_swiftshader:
            flags.append("--enable-unsafe-swiftshader")
        browser = pw.chromium.launch(headless=True, args=flags)
        context = browser.new_context(viewport={"width": 620, "height": 860}, device_scale_factor=1)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.add_init_script("""
            window.__benchJson = null;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {writeText: async text => { window.__benchJson = text; }}
            });
        """)
        page.goto(BENCHMARK.resolve().as_uri(), wait_until="load", timeout=30000)
        page.wait_for_function(
            "() => document.querySelector('#status').textContent.includes('179-part source verified')",
            timeout=30000,
        )
        initial = page.evaluate("""() => ({
            time: document.querySelector('#time').value,
            weather: document.querySelector('#weather').value,
            bloom: document.querySelector('#bloom').value,
            outline: document.querySelector('#outline').checked,
            fxaa: document.querySelector('#fxaa').checked,
            pause: document.querySelector('#pause').checked
        })""")
        page.locator("#benchRun").click()
        page.wait_for_function(
            "() => document.querySelector('#benchStatus').textContent.startsWith('Complete:')",
            timeout=120000,
        )
        assert not errors, f"Browser JavaScript errors: {errors}"
        assert not page.locator("#error").inner_text().strip(), (
            f"WebGL runtime error: {page.locator('#error').inner_text()}"
        )
        page.locator("#benchCopy").click()
        page.wait_for_function("() => Boolean(window.__benchJson)", timeout=5000)
        data = json.loads(page.evaluate("window.__benchJson"))
        assert data["renderer"] == "custom-WebGL2"
        assert data["geometryParts"] == 179
        assert len(data["scenarios"]) == 7
        for i, item in enumerate(data["scenarios"]):
            assert item["scenario"] == EXPECTED[i], item
            assert item["frames"] >= 1, f"No frames sampled in {EXPECTED[i]}"
            assert item["resolution"] == "620x430", item
            assert item["drawCalls"] == EXPECTED_DRAWS[i], item
            assert item["cpuRenderMs"]["p50"] > 0, item
            assert item["cpuRenderMs"]["p95"] > 0, item
            assert item["frameIntervalMs"]["p50"] is not None, item
            if item["gpuPipelineMs"]["p50"] is not None:
                assert item["gpuPipelineMs"]["p50"] > 0, item
                assert item["gpuPipelineMs"]["samples"] > 0, item
            assert "mesh" in item["cpuStageP50Ms"], item
            assert "fxaa" in item["cpuStageP50Ms"], item
        restored = page.evaluate("""() => ({
            time: document.querySelector('#time').value,
            weather: document.querySelector('#weather').value,
            bloom: document.querySelector('#bloom').value,
            outline: document.querySelector('#outline').checked,
            fxaa: document.querySelector('#fxaa').checked,
            pause: document.querySelector('#pause').checked
        })""")
        assert restored == initial, (initial, restored)
        (output_dir / "benchmark.json").write_text(json.dumps(data, indent=2) + "\n")
        page.screenshot(path=str(output_dir / "benchmark.png"), full_page=True)
        print("PASS Backyard effects benchmark v2 browser: 7 scenarios, source-derived shaders, draw counts, CPU and optional GPU samples, original settings restored")
        print("GPU timer support:", data["gpuTimer"])
        context.close()
        browser.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--allow-swiftshader", action="store_true")
    p.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/backyard-effects-v2")
    args = p.parse_args()
    run(args.allow_swiftshader, args.output_dir)


if __name__ == "__main__":
    main()
