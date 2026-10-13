#!/usr/bin/env python3
"""Exercise the real canonical Three.js car comparison UI, not a lookalike renderer."""
from __future__ import annotations

import os
import selectors
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def server_url(process):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            if process.poll() is not None:
                raise RuntimeError("Canonical preview server exited: "+str(process.returncode))
            if selector.select(timeout=.3):
                line=process.stdout.readline()
                if line.startswith("SC3D preview: "):
                    return line.split("SC3D preview: ",1)[1].strip()
    raise RuntimeError("Canonical preview server never became ready")

def report(page):
    result=page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.()")
    assert result is not None, "Missing real canonical viewer instrumentation"
    assert result["engine"]=="Three.js WebGLRenderer"
    assert result["mesh_count"]>=30
    assert result["source_part_count"]>=30
    assert "WebGL" in result["renderer_context"]
    return result

def direction(snapshot):
    p=snapshot["camera_position"]
    c=snapshot["camera_target"]
    v=[x-y for x,y in zip(p,c)]
    length=sum(x*x for x in v)**.5
    return [x/length for x in v]

def near(a,b,tolerance=.0001):
    return all(abs(x-y)<tolerance for x,y in zip(a,b))

def main():
    server=subprocess.Popen(["node","scripts/serve-sc3d-preview.mjs","--vehicles"],
        cwd=ROOT,env={**os.environ,"PORT":"0"},stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,text=True,bufsize=1)
    try:
        url=server_url(server)
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True,
                args=["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader"])
            try:
                page=browser.new_page(viewport={"width":1000,"height":750})
                errors=[]
                page.on("pageerror",lambda error:errors.append(str(error)))
                response=page.goto(url+"?vehicle=v5&qa=1&view=front-three-quarter",timeout=45000)
                assert response and response.ok
                page.wait_for_function("() => window.__SC3D_READY__===true && document.documentElement.dataset.sc3dReady==='true'",timeout=45000)
                page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v5'")
                before=report(page)
                assert before["source_part_count"]==80
                assert page.locator("#viewport canvas").count()==1
                assert page.locator("#vehicle option").count()==6
                metrics=page.evaluate("() => window.__SC3D_QA_REPORT__?.()")
                assert metrics and metrics[-1]["draw_calls"]>0
                # Actual pointer events must change the perspective camera.
                canvas=page.locator("#viewport canvas")
                rect=canvas.bounding_box()
                assert rect and rect["width"]>300
                cx=rect["x"]+rect["width"]/2
                cy=rect["y"]+rect["height"]/2
                page.mouse.move(cx,cy)
                page.mouse.down()
                page.mouse.move(cx+100,cy+30,steps=9)
                page.mouse.up()
                page.wait_for_timeout(200)
                rotated=report(page)
                assert not near(direction(before),direction(rotated)),"Orbit did not move camera"
                page.locator("#vehicle").select_option("v6")
                page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v6'",timeout=45000)
                next_snapshot=report(page)
                assert next_snapshot["source_part_count"]==96
                assert near(direction(rotated),direction(next_snapshot),.001),"Model switch changed camera angle"
                assert page.locator("#vehicle").input_value()=="v6"
                page.locator("#vehicle").select_option("v7")
                page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v7'",timeout=45000)
                v7=report(page)
                assert v7["source_part_count"]==99
                assert near(direction(next_snapshot),direction(v7),.001),"v7 switch changed orbit angle"

                assert not errors,errors
                # Changing views and returning to v5 must stay on source-bound geometry.
                page.locator("#vehicle-side").click()
                page.wait_for_timeout(200)
                side=report(page)
                assert not near(direction(side),direction(next_snapshot))
                page.locator("#vehicle").select_option("v5")
                page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v5'",timeout=45000)
                again=report(page)
                assert again["source_part_count"]==80
                assert near(direction(side),direction(again),.001)
                assert not errors,errors
                # Never leak arbitrary repository paths through the selection parameter.
                invalid=page.request.get(url+"asset-ir.json?vehicle=../../private")
                assert invalid.status==400
                print("PASS: canonical Three.js vehicle gallery: five source-bound versions, v5 initial")
                print("PASS: WebGL draw calls, live orbit, camera-preserving swaps, view controls")
                print("PASS: exact v5/v6 mesh metadata, whitelist protection, no browser errors")
            finally:
                browser.close()
    finally:
        server.terminate()
        try:server.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.communicate(timeout=5)

if __name__=="__main__":
    main()
