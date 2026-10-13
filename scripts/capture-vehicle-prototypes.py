#!/usr/bin/env python3
"""Render separate candidate prop models through canonical Three.js and Chromium."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import time
from io import BytesIO
from PIL import Image, ImageStat

ROOT=Path(__file__).resolve().parents[1]
MODELS=("bicycle","car","car_v5","car_v7","car_v8","car_v9","car_v10","car_v11")
VIEWS=("front-three-quarter","side","rear-three-quarter")

def server_url(proc):
    assert proc.stdout
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        deadline=time.monotonic()+40
        while time.monotonic()<deadline:
            if proc.poll() is not None:
                raise RuntimeError("Preview exited: "+str(proc.returncode))
            if selector.select(timeout=.5):
                line=proc.stdout.readline()
                if line.startswith("SC3D preview: "):
                    return line.split("SC3D preview: ",1)[1].strip()
    raise TimeoutError("Preview server did not become ready")

def main():
    from playwright.sync_api import sync_playwright
    destination=ROOT/"artifacts/vehicle-prototype-qa"
    destination.mkdir(parents=True, exist_ok=True)
    candidates=json.loads((ROOT/"runtime/sc3d/garage-vehicle-prototypes-v2.json").read_text())["entries"]
    report={}
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,args=["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader"])
        try:
            for name in MODELS:
                entry=candidates[name]
                proc=subprocess.Popen(
                    ["node","scripts/serve-sc3d-preview.mjs",entry["source"]],
                    cwd=ROOT,
                    env={**os.environ,"PORT":"0"},
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                    text=True,bufsize=1
                )
                try:
                    url=server_url(proc)
                    report[name]={"source":entry["source"],"views":{},"expected_parts":len(entry["parts"])}
                    for view in VIEWS:
                        page=browser.new_page(viewport={"width":780,"height":640},device_scale_factor=1)
                        errors=[]
                        page.on("pageerror",lambda error:errors.append(str(error)))
                        try:
                            response=page.goto(url+"?qa=1&projection=perspective&view="+view,timeout=45000)
                            assert response and response.ok
                            page.wait_for_function("() => window.__SC3D_READY__ === true && document.documentElement.dataset.sc3dReady === 'true'",timeout=45000)
                            assert not errors,errors
                            assert page.locator("#viewport canvas").count()==1
                            metrics=page.evaluate("() => window.__SC3D_QA_REPORT__?.()")
                            assert metrics and metrics[-1]["draw_calls"]>0
                            png=page.locator("#viewport canvas").screenshot()
                            with Image.open(BytesIO(png)) as image:
                                assert image.size[0]==780
                                assert max(ImageStat.Stat(image.convert("RGB")).stddev)>4
                            (destination/f"{name}-{view}.png").write_bytes(png)
                            report[name]["views"][view]=hashlib.sha256(png).hexdigest()
                        finally:
                            page.close()
                    assert len(set(report[name]["views"].values()))==3
                    print(f"PASS {name}: 3 real Three.js/WebGL views, all distinct",flush=True)
                finally:
                    proc.terminate()
                    try:proc.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill();proc.communicate(timeout=5)
        finally:
            browser.close()
    for view in VIEWS:
        assert report["car_v11"]["views"][view] != report["car_v10"]["views"][view], (
            f"v11 lowered roofline and longer nose produced no visible difference from v10 in {view}"
        )
    for view in VIEWS:
        assert report["car_v10"]["views"][view] != report["car_v9"]["views"][view], (
            f"v10 rake liftgate and fender geometry produced no visual change from v9 in {view}"
        )
    for view in VIEWS:
        assert report["car_v9"]["views"][view] != report["car_v8"]["views"][view], (
            f"v9 lofted hood/hatch produced no visible change from v8 in {view}"
        )
    for view in VIEWS:
        assert report["car_v8"]["views"][view] != report["car_v7"]["views"][view], (
            f"v8 articulated-door geometry produced no visible change from v7 in {view}"
        )
    for view in VIEWS:
        assert report["car_v7"]["views"][view] != report["car"]["views"][view], (
            f"v7 glazing/shell patch produced no visible change from v6 in {view}"
        )
    for view in VIEWS:
        assert report["car"]["views"][view] != report["car_v5"]["views"][view], (
            f"Car v6 rendered pixel-identically to v5 in {view}"
        )
    (destination/"report.json").write_text(json.dumps(report,indent=2)+"\n")

if __name__=="__main__":
    main()
