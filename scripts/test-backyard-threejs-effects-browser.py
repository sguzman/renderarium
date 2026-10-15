#!/usr/bin/env python3
"""Agent-owned Chromium integration: real Three.js full-effects pipeline vs custom WebGL2.

Both viewers read byte-identical packed 179-part Backyard geometry and unmodified
GLSL shaders. Same viewport, camera, time of day and seven effects configurations.
Report browser/CPU/rendered image evidence without assuming visual/GPU parity.
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
THREE = "experiments/diagnostics/backyard-threejs-full-effects-pipeline-benchmark-v3-2026-10-15.html"
CUSTOM = "experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html"
EXPECTED = ["Minimal", "Outlines", "Shafts", "Bloom", "Dust", "FXAA", "Combined"]
DRAWS = [5, 5, 6, 8, 6, 5, 10]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def image_delta(path_a: Path, path_b: Path) -> dict:
    with Image.open(path_a) as a, Image.open(path_b) as b:
        left, right = a.convert("RGB"), b.convert("RGB")
    assert left.size == right.size, (left.size, right.size)
    diff = ImageChops.difference(left, right)
    rgb = ImageStat.Stat(diff).mean[:3]
    mask = diff.convert("RGB").getdata()
    return {
        "mean_abs_rgb_channel_delta_255": round(sum(rgb)/3, 4),
        "changed_pixel_fraction": round(
            sum(any(ch for ch in rgb_pixel) for rgb_pixel in mask)/(left.width*left.height), 6
        ),
        "resolution": list(left.size),
    }


def validate(name: str, report: dict, expected_draws: list[int], expected_version: int) -> None:
    assert report["geometryParts"] == 179, report
    assert report["version"] == expected_version, report
    assert len(report["scenarios"]) == 7
    for i, scenario in enumerate(report["scenarios"]):
        assert scenario["scenario"] == EXPECTED[i], scenario
        assert scenario["drawCalls"] == expected_draws[i], (
            name, scenario["scenario"],"measured",scenario["drawCalls"],"expected",expected_draws[i],
            scenario.get("drawsByStage")
        )
        assert scenario["frames"] >= 1, scenario
        assert scenario["cpuRenderMs"]["p50"] > 0, scenario
        assert scenario["cpuRenderMs"]["p95"] > 0, scenario
        assert scenario["frameIntervalMs"]["p50"] is not None, scenario


def run(swiftshader: bool, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    handler = partial(Handler, directory=str(ROOT))
    http = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=http.serve_forever, daemon=True)
    server_thread.start()
    base = f"http://127.0.0.1:{http.server_port}/"
    try:
        with sync_playwright() as pw:
            args = ["--no-sandbox", "--disable-dev-shm-usage"]
            if swiftshader:
                args.append("--enable-unsafe-swiftshader")
            browser = pw.chromium.launch(headless=True, args=args)
            ctx = browser.new_context(viewport={"width":620, "height":860}, device_scale_factor=1)
            page = ctx.new_page()
            problems: list[str] = []
            page.on("pageerror", lambda e: problems.append(str(e)))
            page.goto(base + THREE, wait_until="load", timeout=45000)
            page.wait_for_function(
                "() => window.__THREE_EFFECTS_READY__ === true || Boolean(window.__THREE_EFFECTS_ERROR__)",
                timeout=45000,
            )
            err = page.evaluate("window.__THREE_EFFECTS_ERROR__ || null")
            assert not err, f"Three.js initialization: {err}"
            page.locator("#run").click()
            page.wait_for_function(
                "() => Boolean(window.__THREE_EFFECTS_REPORT__) || Boolean(window.__THREE_EFFECTS_ERROR__)",
                timeout=180000,
            )
            err = page.evaluate("window.__THREE_EFFECTS_ERROR__ || null")
            assert not err, f"Three.js effects render: {err}"
            assert not problems, problems
            three = page.evaluate("window.__THREE_EFFECTS_REPORT__")
            assert three["renderer"] == "Three.js-r160-WebGL2"
            page.locator("#view").screenshot(path=str(out/"three-combined.png"))
            (out/"three.json").write_text(json.dumps(three,indent=2)+"\n")
            print("Three.js measured stage draws:", [(row["scenario"],row.get("drawsByStage")) for row in three["scenarios"]])
            validate("Three.js", three, DRAWS, 3)
            three_px = page.evaluate("() => [document.querySelector('#view').width, document.querySelector('#view').height]")
            assert three_px == [620,295], three_px
            print("PASS Three.js full-effects: seven cases, measured draw counts, real GL shaders, 179 canonical parts")

            # Custom benchmark: independently execute same seven cases and compare
            # a final all-effects rendered screenshot at matching viewport/camera.
            page.goto(base + CUSTOM,wait_until="load",timeout=45000)
            page.wait_for_function(
                "() => document.querySelector('#status').textContent.includes('179-part source verified')",
                timeout=45000,
            )
            page.locator("#benchRun").click()
            page.wait_for_function(
                "() => document.querySelector('#benchStatus').textContent.startsWith('Complete:')",
                timeout=180000,
            )
            page.add_init_script("""
                Object.defineProperty(navigator,'clipboard',{configurable:true,
                    value:{writeText: async s => window.__COPIED_BENCHMARK__=s}});
            """)
            # Clipboard shim applied to this page explicitly as init scripts apply on next navigation.
            page.evaluate("""() => Object.defineProperty(navigator,'clipboard',
                {configurable:true,value:{writeText: async s => window.__COPIED_BENCHMARK__=s}})""")
            page.locator("#benchCopy").click()
            page.wait_for_function("() => Boolean(window.__COPIED_BENCHMARK__)")
            custom = json.loads(page.evaluate("window.__COPIED_BENCHMARK__"))
            validate("Custom WebGL2", custom, DRAWS, 2)
            # Fixed Combined: clock 14, beams 85, bloom 25, dust 55, FXAA/outlines.
            page.evaluate("""() => {
                const set = (id,value) => {
                    const x=document.getElementById(id);x.value=value;
                    x.dispatchEvent(new Event('input',{bubbles:true}));
                };
                set('time','14');set('beam','85');set('bloom','25');set('exposure','100');
                set('weather','dust');set('particle','55');set('wind','.3');set('width','100');
                for(const id of ['outline','fxaa','shafts','pause']){
                    const el=document.getElementById(id);el.checked=true;
                    el.dispatchEvent(new Event('input',{bubbles:true}));
                }
            }""")
            page.wait_for_timeout(250)
            assert not page.locator("#error").inner_text().strip(), page.locator("#error").inner_text()
            page.locator("#view").screenshot(path=str(out/"custom-combined.png"))
            custom_px=page.evaluate("() => [document.querySelector('#view').width, document.querySelector('#view').height]")
            assert custom_px == three_px, (three_px,custom_px)
            (out/"custom.json").write_text(json.dumps(custom,indent=2)+"\n")
            summary={
                "format":"scenarium-effects-matched-three-vs-webgl2-v3",
                "claim":"same packed parts, original shader texts, camera, viewport and effects configuration; different renderer state and pipeline",
                "renderer_backends":{
                    "three":"Three.js r160 RawShaderMaterial/real WebGLRenderer",
                    "custom":"Original custom WebGL2 programs",
                },
                "pixel_comparison":image_delta(out/"custom-combined.png",out/"three-combined.png"),
                "scenarios": [
                    {
                        "name":EXPECTED[i],
                        "three_frames":three["scenarios"][i]["frames"],
                        "custom_frames":custom["scenarios"][i]["frames"],
                        "three_cpu_submit_p50_ms":three["scenarios"][i]["cpuRenderMs"]["p50"],
                        "custom_cpu_submit_p50_ms":custom["scenarios"][i]["cpuRenderMs"]["p50"],
                        "three_frame_interval_p50_ms":three["scenarios"][i]["frameIntervalMs"]["p50"],
                        "custom_frame_interval_p50_ms":custom["scenarios"][i]["frameIntervalMs"]["p50"],
                        "three_draws":three["scenarios"][i]["drawCalls"],
                        "custom_draws":custom["scenarios"][i]["drawCalls"],
                    } for i in range(7)
                ],
                "limits":["SwiftShader is software rendering, not RTX 3090 benchmarking",
                          "GPU timer query unavailable or not instrumented",
                          "Screenshot differences are observed, not auto-approved",
                          "Submission times may differ due to Three.js state/composer overhead",
                          "Separate serial runs may differ due to thermal/scheduler effects"],
            }
            (out/"comparison.json").write_text(json.dumps(summary,indent=2)+"\n")
            print("PASS same-configuration effects A/B measurements; pixel delta:",
                  json.dumps(summary["pixel_comparison"]))
            ctx.close()
            browser.close()
    finally:
        http.shutdown()
        http.server_close()
        server_thread.join(timeout=5)


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--allow-swiftshader",action="store_true")
    parser.add_argument("--output-dir",type=Path,default=ROOT/"artifacts/backyard-three-effects-v3")
    args=parser.parse_args()
    run(args.allow_swiftshader,args.output_dir)
