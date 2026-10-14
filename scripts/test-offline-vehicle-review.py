#!/usr/bin/env python3
"""Verify the exported offline HTML runs actual Three.js with SC3D versions."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def main():
  source=ROOT/"artifacts/vehicle-review-qa/renderarium-canonical-car-review.html"
  assert source.is_file() and source.stat().st_size>150_000
  with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,
      args=["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader"])
    try:
      page=browser.new_page(viewport={"width":1080,"height":760})
      errors=[]
      page.on("pageerror",lambda error:errors.append(str(error)))
      resp=page.goto(source.as_uri(),timeout=60000)
      assert resp and resp.ok
      page.wait_for_function("() => window.__SC3D_READY__===true && document.documentElement.dataset.sc3dReady==='true'",timeout=60000)
      v5=page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.()")
      assert v5 and v5["engine"]=="Three.js WebGLRenderer" and v5["source_part_count"]==80
      assert v5["asset_id"]=="block-chibi-compact-car-v5"
      assert "WebGL" in v5["renderer_context"]
      page.locator("#vehicle").select_option("v6")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v6'",timeout=30000)
      v6=page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.()")
      assert v6["source_part_count"]==96
      page.locator("#vehicle").select_option("v7")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v7'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==99
      page.locator("#vehicle").select_option("v8")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v8'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==149
      page.locator("#vehicle").select_option("v9")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v9'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==156
      page.locator("#vehicle").select_option("v10")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v10'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==167
      page.locator("#vehicle").select_option("v11r")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v11r'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==177
      page.locator("#vehicle").select_option("v11")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v11'",timeout=30000)
      assert page.evaluate("() => window.__SC3D_VEHICLE_REPORT__?.().source_part_count")==167
      page.locator("#vehicle").select_option("v4")
      page.wait_for_function("() => window.__SC3D_VEHICLE_REPORT__?.().asset_id==='block-chibi-compact-car-v4'",timeout=30000)
      assert page.locator("#viewport canvas").count()==1
      assert not errors,errors
      print("PASS offline canonical Three.js/WebGL SC3D vehicle viewer, v5/v6/v4 switch")
    finally:
      browser.close()
if __name__=="__main__":main()
