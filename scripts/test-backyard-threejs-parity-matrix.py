#!/usr/bin/env python3
"""Measure true full-effects Three.js versus custom WebGL2 parity over fixed cameras and daylight.

Only diagnostics. Both HTML viewers embed the same 179-part accepted source and the
original GLSL shader texts. No screenshots are machine-approved as artwork.
"""
from __future__ import annotations
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from PIL import Image, ImageChops, ImageEnhance, ImageDraw, ImageStat
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
THREE="experiments/diagnostics/backyard-threejs-full-effects-pipeline-benchmark-v3-2026-10-15.html"
CUSTOM="experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html"
# Hours coincide with the diagnostic source slider's quarter-hour increments.
VIEWS=[
    {"name":"afternoon-baseline","clock":14.0,"yaw":0.7,"pitch":0.42,"distanceScale":1.0},
    {"name":"morning-east","clock":9.0,"yaw":0.7,"pitch":0.42,"distanceScale":1.0},
    {"name":"late-day","clock":17.5,"yaw":0.7,"pitch":0.42,"distanceScale":1.0},
    {"name":"night-shafts-off","clock":22.0,"yaw":0.7,"pitch":0.42,"distanceScale":1.0},
    {"name":"reverse-angle","clock":14.0,"yaw":-0.55,"pitch":0.46,"distanceScale":1.0},
    {"name":"high-angle","clock":14.0,"yaw":2.1,"pitch":0.93,"distanceScale":1.0},
    {"name":"near-camera","clock":14.0,"yaw":0.7,"pitch":0.42,"distanceScale":0.58},
]
SIZE=(620,295)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def read_capture(path:Path)->tuple[Image.Image,list[int]]:
    with Image.open(path) as pic: im=pic.convert("RGB")
    size=list(im.size)
    assert im.width==SIZE[0] and abs(im.height-SIZE[1])<=1,(path,size)
    return im.crop((0,0,*SIZE)),size

def compare(a:Image.Image,b:Image.Image)->dict:
    assert a.size==b.size==SIZE
    delta=ImageChops.difference(a,b)
    means=ImageStat.Stat(delta).mean[:3]
    rgb=delta.getdata()
    mask=[max(p) for p in rgb]
    return {
        "mean_abs_rgb_channel_delta_255":round(sum(means)/3,4),
        "changed_pixel_fraction":round(sum(x>0 for x in mask)/len(mask),6),
        "changed_pixel_fraction_ge3":round(sum(x>=3 for x in mask)/len(mask),6),
        "max_rgb_channel_delta":max(mask),
    }

def contact_sheet(rows:list[tuple[str,Image.Image,Image.Image]],output:Path)->None:
    gap=6;header=25;w=SIZE[0];h=SIZE[1]
    sheet=Image.new("RGB",(3*w+4*gap,len(rows)*(h+header+gap)+gap),(18,30,44))
    draw=ImageDraw.Draw(sheet)
    for i,(name,a,b) in enumerate(rows):
        y=gap+i*(h+header+gap);diff=ImageChops.difference(a,b)
        enhanced=ImageEnhance.Contrast(ImageEnhance.Brightness(diff).enhance(10)).enhance(2)
        for col,(label,im) in enumerate([("Custom",a),("Three.js",b),("10x diff (contrast boosted)",enhanced)]):
            x=gap+col*(w+gap)
            draw.text((x+6,y+5),f"{name} | {label}",fill=(235,240,250))
            sheet.paste(im,(x,y+header))
    sheet.save(output)

def run(allow_swiftshader:bool,out:Path)->None:
    out.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(("127.0.0.1",0),partial(Handler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    base=f"http://127.0.0.1:{server.server_port}/"
    observed={}
    captures={}
    try:
        with sync_playwright() as pw:
            args=["--no-sandbox","--disable-dev-shm-usage"]
            if allow_swiftshader:args.append("--enable-unsafe-swiftshader")
            browser=pw.chromium.launch(headless=True,args=args)
            context=browser.new_context(viewport={"width":620,"height":860},device_scale_factor=1)
            page=context.new_page()
            errors=[]
            page.on("pageerror",lambda error:errors.append(str(error)))
            for label,path,ready,fn in [
                ("three",THREE,"window.__THREE_EFFECTS_READY__===true","__THREE_EFFECTS_DIAGNOSTIC__"),
                ("custom",CUSTOM,"document.querySelector('#status')?.textContent.includes('179-part source verified')","__CUSTOM_EFFECTS_DIAGNOSTIC__"),
            ]:
                page.goto(base+path,wait_until="load",timeout=45000)
                page.wait_for_function(f"() => ({ready}) && typeof window.{fn} === 'function'",timeout=45000)
                assert not errors,errors
                if label=="three":
                    assert not page.evaluate("window.__THREE_EFFECTS_ERROR__ || null"),page.evaluate("window.__THREE_EFFECTS_ERROR__")
                observed[label]={}
                for view in VIEWS:
                    state=page.evaluate(f"(view) => window.{fn}(view)",view)
                    assert state["geometryParts"]==179,state
                    assert all(state["view"][key] == view[key] for key in (
                        "clock","yaw","pitch","distanceScale"
                    )), (label,view["name"],state)
                    assert state["drawingBuffer"]==list(SIZE),state
                    expected_draws=9 if view["clock"]==22 else 10
                    assert state["drawCalls"]==expected_draws,(label,view["name"],state)
                    err=page.locator("#error").inner_text().strip()
                    assert not err,(label,view["name"],err)
                    filename=out/f'{view["name"]}-{label}.png'
                    page.locator("#view").screenshot(path=str(filename))
                    observed[label][view["name"]]=state
            assert not errors,errors
            context.close();browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
    rows=[];measurements=[]
    for view in VIEWS:
        name=view["name"]
        a,a_size=read_capture(out/f"{name}-custom.png")
        b,b_size=read_capture(out/f"{name}-three.png")
        metric=compare(a,b)
        # Changes under camera/lighting can reveal backend mismatches. Report
        # thresholds as diagnostic flags, NOT subjective approval conditions.
        flag=metric["mean_abs_rgb_channel_delta_255"]<=1.0 and metric["changed_pixel_fraction"]<=0.05
        measurements.append({
            "name":name,"view":view,"custom":observed["custom"][name],"three":observed["three"][name],
            "custom_capture_css_size":a_size,"three_capture_css_size":b_size,
            "pixel_metrics":metric,"near_match_diagnostic_threshold":flag
        })
        rows.append((name,a,b))
        print(f'{name}: MAE={metric["mean_abs_rgb_channel_delta_255"]:.4f}/255 '
              f'changed={metric["changed_pixel_fraction"]*100:.3f}% near_match={flag}')
    result={
        "format":"scenarium-effects-matched-camera-daylight-parity-v1",
        "scene":"block-chibi-backyard-v1","geometryParts":179,
        "renderers":["custom WebGL2","Three.js r160 WebGLRenderer"],
        "framebuffer_pixels":list(SIZE),
        "samples":measurements,
        "near_match_count":sum(x["near_match_diagnostic_threshold"] for x in measurements),
        "evaluated_count":len(measurements),
        "limits":["Software Chromium rendering, not physical RTX 3090 measurements",
                  "Only Combined effects settings; camera, clock and sample state pinned",
                  "Image thresholds flag discrepancies, do not certify visual acceptance",
                  "The approved 40-step shader and scene geometry were not changed"],
    }
    (out/"parity-matrix.json").write_text(json.dumps(result,indent=2)+"\n")
    contact_sheet(rows,out/"parity-contact-sheet.png")
    print(f'PASS seven fixed camera and lighting comparisons; {result["near_match_count"]}/7 diagnostic near matches; all 179-source and draw-count checks passed')

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--allow-swiftshader",action="store_true")
    p.add_argument("--output-dir",type=Path,default=ROOT/"artifacts/backyard-parity-matrix-v1")
    args=p.parse_args()
    run(args.allow_swiftshader,args.output_dir)
