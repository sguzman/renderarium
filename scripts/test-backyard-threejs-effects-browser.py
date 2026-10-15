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
    source_sizes = {"custom":list(left.size),"three":list(right.size)}
    # Both actual drawing buffers have separately been asserted 620x295.
    # Playwright's element screenshot may include one extra CSS layout pixel.
    expected = (620,295)
    for label, image in [("custom",left),("three",right)]:
        assert image.width == expected[0] and abs(image.height-expected[1]) <= 1, (
            label, "capture differs from verified framebuffer", image.size
        )
    left = left.crop((0,0,*expected))
    right = right.crop((0,0,*expected))
    diff = ImageChops.difference(left, right)
    rgb = ImageStat.Stat(diff).mean[:3]
    mask = diff.convert("RGB").getdata()
    return {
        "mean_abs_rgb_channel_delta_255": round(sum(rgb)/3, 4),
        "changed_pixel_fraction": round(
            sum(any(ch for ch in rgb_pixel) for rgb_pixel in mask)/(left.width*left.height), 6
        ),
        "resolution": list(left.size),
        "source_element_capture_pixels":source_sizes,
        "cropped_to_verified_gl_drawing_buffers":True,
    }


def validate(name: str, report: dict, expected_draws: list[int], expected_version: int) -> None:
    assert report["geometryParts"] == 179, report
    assert report["version"] == expected_version, report
    assert len(report["scenarios"]) == 7
    assert report["gpuTimer"] in (
        "unsupported", "disjoint-invalid", "partial", "supported"
    ), (name, report.get("gpuTimer"))
    for i, scenario in enumerate(report["scenarios"]):
        assert scenario["scenario"] == EXPECTED[i], scenario
        assert scenario["drawCalls"] == expected_draws[i], (
            name, scenario["scenario"],"measured",scenario["drawCalls"],"expected",expected_draws[i],
            scenario.get("drawsByStage")
        )
        if name == "Three.js":
            stages = scenario.get("drawsByStage") or {}
            assert stages.get("sky") == 1, (name,scenario["scenario"],stages)
            assert stages.get("mesh") == 2, (
                "Three.js skipped source geometry",scenario["scenario"],stages
            )
            if scenario["scenario"] in ("Dust", "Combined"):
                assert stages["weather"] == stages["grading"] + 1, (
                    "Three.js skipped particles",scenario["scenario"],stages
                )
        if "gpuPipelineMs" in scenario:
            gpu = scenario["gpuPipelineMs"]
            assert isinstance(gpu["samples"], int) and gpu["samples"] >= 0, scenario
            assert (gpu["p50"] is None) == (gpu["samples"] == 0), (
                name, scenario["scenario"], gpu
            )
        assert scenario["frames"] >= 1, scenario
        assert scenario["cpuRenderMs"]["p50"] > 0, scenario
        assert scenario["cpuRenderMs"]["p95"] > 0, scenario
        assert scenario["frameIntervalMs"]["p50"] is not None, scenario


def verify_device(device: dict, require_hardware: bool, expected_gpu: str | None = None) -> None:
    """Only identify actual hardware if Chromium exposes an unmasked GPU renderer."""
    assert isinstance(device.get("webgl2"), bool), device
    if not require_hardware:
        return
    assert device["webgl2"], "Hardware-required test received no WebGL2 context"
    assert device.get("unmasked_renderer"), (
        "Cannot verify physical GPU: WEBGL_debug_renderer_info unavailable",device
    )
    unsupported = ("swiftshader","llvmpipe","softpipe","lavapipe","software rasterizer","software renderer")
    renderer = device["unmasked_renderer"].lower()
    assert not any(x in renderer for x in unsupported), (
        "Software GPU cannot satisfy --require-hardware",device
    )
    known_hardware=("nvidia","geforce","quadro","radeon","amd","intel",
                    "iris","adreno","mali","apple gpu","powervr")
    assert any(x in renderer for x in known_hardware), (
        "Unknown GPU model is not proof of a physical renderer",device
    )
    if expected_gpu:
        assert expected_gpu.lower() in renderer, (
            "Selected physical GPU is not active in Chromium WebGL",expected_gpu,device
        )


def gpu_provenance(page) -> dict:
    return page.evaluate("""() => {
        const c=document.getElementById('view');
        const gl=c?.getContext('webgl2');
        if (!gl) return {webgl2:false, unmasked_renderer:null, unmasked_vendor:null};
        const info=gl.getExtension('WEBGL_debug_renderer_info');
        return {
            webgl2:true,
            renderer:String(gl.getParameter(gl.RENDERER)||''),
            vendor:String(gl.getParameter(gl.VENDOR)||''),
            unmasked_renderer:info?String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)||''):null,
            unmasked_vendor:info?String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)||''):null,
            drawing_buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]
        };
    }""")


def self_test() -> None:
    verify_device({"webgl2":True,"unmasked_renderer":"NVIDIA GeForce RTX 3090"},True,"RTX 3090")
    try:
        verify_device({"webgl2":True,"unmasked_renderer":"Intel UHD Graphics"},True,"RTX 3090")
    except AssertionError:
        pass
    else:
        raise AssertionError("Wrong physical GPU matched --expected-gpu")
    verify_device({"webgl2":True,"unmasked_renderer":None},False)
    for software in ("Google SwiftShader","Mesa llvmpipe","lavapipe","software renderer","Generic WebGL",None):
        try:
            verify_device({"webgl2":True,"unmasked_renderer":software},True)
        except AssertionError:
            continue
        raise AssertionError(f"Software or unknown GPU passed hardware gate: {software}")
    print("PASS hardware provenance gate: real identified GPU accepted; software and unknown devices rejected")


def run(swiftshader: bool, out: Path, require_hardware: bool = False, headed: bool = False, expected_gpu: str | None = None) -> None:
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
            if require_hardware and swiftshader:
                raise ValueError("--require-hardware conflicts with --allow-swiftshader")
            browser = pw.chromium.launch(headless=not headed, args=args)
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
            three_device = gpu_provenance(page)
            verify_device(three_device, require_hardware, expected_gpu)
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
            custom_device = gpu_provenance(page)
            verify_device(custom_device, require_hardware, expected_gpu)
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
                "gpu_contexts":{"three":three_device,"custom":custom_device},
                "physical_gpu_verification_required":require_hardware,
                "expected_gpu_identity":expected_gpu,
                "physical_gpu_verification_passed":require_hardware,
                "browser_mode":"headed" if headed else "headless",
                "gpu_timer_status":{"three":three["gpuTimer"],"custom":custom["gpuTimer"]},
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
                        "three_gpu_pipeline_p50_ms":three["scenarios"][i]["gpuPipelineMs"]["p50"],
                        "three_gpu_timer_samples":three["scenarios"][i]["gpuPipelineMs"]["samples"],
                        "custom_gpu_pipeline_p50_ms":custom["scenarios"][i]["gpuPipelineMs"]["p50"],
                        "custom_gpu_timer_samples":custom["scenarios"][i]["gpuPipelineMs"]["samples"],
                        "three_frame_interval_p50_ms":three["scenarios"][i]["frameIntervalMs"]["p50"],
                        "custom_frame_interval_p50_ms":custom["scenarios"][i]["frameIntervalMs"]["p50"],
                        "three_draws":three["scenarios"][i]["drawCalls"],
                        "custom_draws":custom["scenarios"][i]["drawCalls"],
                    } for i in range(7)
                ],
                "limits":["Software CI is not an RTX 3090 benchmark",
                          "GPU elapsed time is absent unless a valid disjoint timer query completes",
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
    parser.add_argument("--self-test",action="store_true")
    parser.add_argument("--allow-swiftshader",action="store_true")
    parser.add_argument("--require-hardware",action="store_true",
        help="Fail unless both actual WebGL2 contexts identify a non-software physical GPU")
    parser.add_argument("--expected-gpu",default=None,
        help="Require this case-insensitive substring of BOTH reported unmasked GPU models, e.g. RTX 3090")
    parser.add_argument("--headed",action="store_true",
        help="Run browser with the Linux compositor for opt-in physical GPU measurement")
    parser.add_argument("--output-dir",type=Path,default=ROOT/"artifacts/backyard-three-effects-v3")
    args=parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if args.expected_gpu and not args.require_hardware:
            parser.error("--expected-gpu requires --require-hardware")
        run(args.allow_swiftshader,args.output_dir,args.require_hardware,args.headed,args.expected_gpu)
