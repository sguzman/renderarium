#!/usr/bin/env python3
"""Agent-owned Chromium smoke and measured-profile QA for Backyard raymarch sample sweep v2.1.

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
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = ROOT / "experiments/diagnostics/backyard-sunshaft-raymarch-sample-sweep-v2-1-2026-10-15.html"
EXPECTED = ["Minimal", "Shafts 40", "Shafts 20", "Shafts 10", "Combined 40", "Combined 20", "Combined 10"]
EXPECTED_DRAWS = [5, 6, 6, 6, 10, 10, 10]


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
            pause: document.querySelector('#pause').checked,
            shaftSamples: document.querySelector('#shaftSamples').value
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
        assert data["version"] == 2.1
        assert data["experiment"] == "sunshaft-raymarch-step-sweep"
        assert data["geometryParts"] == 179
        assert len(data["scenarios"]) == 7
        actual_size = page.evaluate("() => [document.querySelector(\'#view\').width, document.querySelector(\'#view\').height]")
        assert actual_size[0] >= 500 and actual_size[1] >= 280, actual_size
        expected_resolution = f"{actual_size[0]}x{actual_size[1]}"
        for i, item in enumerate(data["scenarios"]):
            assert item["scenario"] == EXPECTED[i], item
            assert item["sunshaftSamples"] == [40, 40, 20, 10, 40, 20, 10][i], item
            assert item["frames"] >= 1, f"No frames sampled in {EXPECTED[i]}"
            assert item["resolution"] == expected_resolution, item
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
            pause: document.querySelector('#pause').checked,
            shaftSamples: document.querySelector('#shaftSamples').value
        })""")
        assert restored == initial, (initial, restored)
        (output_dir / "benchmark.json").write_text(json.dumps(data, indent=2) + "\n")
        # Agent-owned pixel-change diagnostics, not a new human visual verdict.
        page.evaluate("""() => {
            const $ = id => document.querySelector('#'+id);
            const values = {time:'14',beam:'85',bloom:'0',exposure:'100',
                weather:'none',particle:'55',wind:'.3',width:'100'};
            for (const [id,v] of Object.entries(values)) $(id).value=v;
            for (const [id,checked] of Object.entries(
                {shafts:true,outline:false,fxaa:false,pause:true}))
                $(id).checked=checked;
            for (const id of ['time','beam','bloom','weather','shafts','pause'])
                $(id).dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        pictures = {}
        for steps in (40, 20, 10):
            page.locator("#shaftSamples").select_option(str(steps))
            page.wait_for_timeout(150)
            filename = output_dir / f"shaft-samples-{steps}.png"
            page.locator("#view").screenshot(path=str(filename))
            pictures[steps] = Image.open(filename).convert("RGB")
        def pixel_delta(a: Image.Image, b: Image.Image) -> dict:
            diff = ImageChops.difference(a, b)
            width, height = diff.size
            changed = sum(any(v for v in pixel) for pixel in diff.getdata())
            return {
                "mean_absolute_rgb_0_255": sum(ImageStat.Stat(diff).mean[:3]) / 3,
                "fraction_pixels_changed": changed / (width * height)
            }
        data["visual_differences_from_40"] = {
            "20_samples": pixel_delta(pictures[40], pictures[20]),
            "10_samples": pixel_delta(pictures[40], pictures[10])
        }
        (output_dir / "benchmark.json").write_text(json.dumps(data, indent=2) + "\n")
        page.screenshot(path=str(output_dir / "benchmark.png"), full_page=True)
        print("PASS Backyard sunshaft sweep v2.1 browser: 7 scenarios, 40/20/10 raymarch loops, pixel difference capture, accepted baseline unchanged")
        print("GPU timer support:", data["gpuTimer"])
        context.close()
        browser.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--allow-swiftshader", action="store_true")
    p.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/backyard-sunshaft-v2-1")
    args = p.parse_args()
    run(args.allow_swiftshader, args.output_dir)


if __name__ == "__main__":
    main()
