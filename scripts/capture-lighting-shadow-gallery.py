#!/usr/bin/env python3
"""Capture actual matched-camera Three.js lighting and shadow comparisons.

Only the seven frozen environment assemblies are used. No scene source,
mesh, camera preset, or accepted visual contract is rewritten.
"""
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

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SCENES = ("living-room", "kitchen", "bathroom", "office", "backyard", "garage", "factory")
LIGHTING_MODES = (
    ("default", None, "APPROVED DEFAULT"),
    ("soft-light", "soft-light", "SOFT LIGHT"),
    ("warm-light", "warm-light", "WARM KEY"),
    ("cool-light", "cool-light", "COOL KEY"),
    ("no-shadow", "no-shadow", "NO SHADOWS"),
    ("hard-shadow", "hard-shadow", "HARD SHADOWS"),
    ("soft-shadow-vsm", "soft-shadow-vsm", "SOFT SHADOWS / VSM"),
    ("shadow-detail", "shadow-detail", "SHADOW DETAIL"),
)
SHADOW_MODES = (
    ("default", None, "APPROVED DEFAULT"),
    ("hard-shadow", "hard-shadow", "HARD SHADOWS"),
    ("shadow-detail", "shadow-detail", "HIGH RES + BIAS"),
    ("shadow-bias-moderate", "shadow-bias-moderate", "MODERATE BIAS"),
    ("shadow-bias-strong", "shadow-bias-strong", "STRONG BIAS"),
    ("shadow-vsm-tight", "shadow-vsm-tight", "VSM TIGHT"),
    ("soft-shadow-vsm", "soft-shadow-vsm", "VSM DEFAULT BLUR"),
    ("shadow-vsm-wide", "shadow-vsm-wide", "VSM WIDE BLUR"),
)
WIDTH, HEIGHT, HEADER = 512, 384, 32


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_sheet(images: dict[str, bytes], modes=LIGHTING_MODES) -> Image.Image:
    if set(images) != {entry[0] for entry in modes}:
        raise ValueError("Exactly eight source screenshots required")
    sheet = Image.new(
        "RGB", (WIDTH * 4, (HEIGHT + HEADER) * 2),
        (21, 23, 29),
    )
    draw = ImageDraw.Draw(sheet)
    for i, (mode, _, label) in enumerate(modes):
        with Image.open(BytesIO(images[mode])) as opened:
            rgb = opened.convert("RGB")
        if rgb.size != (WIDTH, HEIGHT):
            raise ValueError(f"{mode}: expected {WIDTH}x{HEIGHT}, got {rgb.size}")
        x = (i % 4) * WIDTH
        y = (i // 4) * (HEIGHT + HEADER)
        draw.text((x + 10, y + 10), label, fill=(238, 240, 246))
        sheet.paste(rgb, (x, y + HEADER))
    return sheet


def self_test() -> None:
    images = {}
    for mode, _, _ in LIGHTING_MODES:
        im = Image.new("RGB", (WIDTH, HEIGHT), (130, 140, 150))
        blob = BytesIO()
        im.save(blob, format="PNG")
        images[mode] = blob.getvalue()
    result = make_sheet(images)
    assert result.size == (2048, 832), result.size
    assert result.getpixel((256, HEADER + 220)) == (130, 140, 150)
    assert result.getpixel((3 * WIDTH + 256, HEIGHT + 2 * HEADER + 220)) == (
        130, 140, 150
    )
    try:
        make_sheet({k: v for k, v in images.items() if k != "default"})
    except ValueError:
        pass
    else:
        raise AssertionError("Incomplete comparison accepted")
    shadow_images = {
        mode: images[LIGHTING_MODES[i][0]]
        for i, (mode, _, _) in enumerate(SHADOW_MODES)
    }
    shadow_sheet = make_sheet(shadow_images, SHADOW_MODES)
    assert shadow_sheet.size == result.size
    print("PASS lighting and shadow-only gallery layout self-tests")


def await_server(process: subprocess.Popen[str]) -> str:
    assert process.stdout is not None
    deadline = time.monotonic() + 45
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Preview process ended: {process.returncode}")
            if not selector.select(timeout=0.5):
                continue
            line = process.stdout.readline()
            if line.startswith("SC3D preview: http://127.0.0.1:"):
                return line.split("SC3D preview: ", 1)[1].strip()
    raise TimeoutError("Source-pinned preview server not ready")


def render_one(browser, url: str, experiment: str | None) -> tuple[bytes, dict]:
    from urllib.parse import urlencode

    page = browser.new_page(
        viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: errors.append(
        f"Network request failed: {request.url}"
    ))
    params = {"diagnostic": "1", "qa": "1", "view": "front-three-quarter"}
    if experiment is not None:
        params["quality_experiment"] = experiment
    try:
        response = page.goto(url + "?" + urlencode(params), timeout=45000)
        assert response is not None and response.ok
        page.wait_for_function(
            "() => window.__SC3D_READY__ === true && "
            "document.documentElement.dataset.sc3dReady === 'true'",
            timeout=45000,
        )
        assert not errors, f"Preview errors: {errors}"
        settings = page.evaluate("() => window.__SC3D_QUALITY_REPORT__()")
        assert settings["experiment"] == (experiment or "none"), settings
        frames = page.evaluate("() => window.__SC3D_QA_REPORT__()")
        assert frames and frames[-1]["draw_calls"] > 0
        png = page.locator("#viewport canvas").screenshot()
        with Image.open(BytesIO(png)) as im:
            assert im.size == (WIDTH, HEIGHT)
        return png, settings
    finally:
        page.close()


def compare(a: bytes, b: bytes) -> dict:
    with Image.open(BytesIO(a)) as im:
        left = im.convert("RGB")
    with Image.open(BytesIO(b)) as im:
        right = im.convert("RGB")
    delta = ImageChops.difference(left, right)
    mean = sum(ImageStat.Stat(delta).mean) / 3
    mask = delta.convert("L").point(lambda value: 255 if value else 0)
    bbox = mask.getbbox()
    return {
        "mean_abs_rgb_delta_255": round(mean, 4),
        "changed_bounds": list(bbox) if bbox else None,
        "identical": bbox is None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--allow-swiftshader", action="store_true")
    parser.add_argument("--scene", choices=SCENES)
    parser.add_argument("--study", choices=("lighting", "shadow"), default="lighting")
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/lighting-shadow-gallery"))
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    from playwright.sync_api import sync_playwright

    modes = SHADOW_MODES if args.study == "shadow" else LIGHTING_MODES
    destination = args.output_dir if args.output_dir.is_absolute() else ROOT / args.output_dir
    destination.mkdir(parents=True, exist_ok=True)
    ledger = json.loads((ROOT / "contracts/accepted-block-chibi-v1.json").read_text())
    scenes = (args.scene,) if args.scene else SCENES
    results = []
    with sync_playwright() as playwright:
        browser_args = ["--no-sandbox", "--disable-dev-shm-usage"]
        if args.allow_swiftshader:
            browser_args.append("--enable-unsafe-swiftshader")
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("SCENARIUM_CHROMIUM") or None,
            args=browser_args,
        )
        try:
            for scene_name in scenes:
                scene_id = f"block-chibi-{scene_name}-v1"
                accepted = next(
                    r for r in ledger["recorded_scenes"] if r["scene"] == scene_id
                )
                assembly = ROOT / accepted["assembly_path"]
                content = assembly.read_bytes()
                blob_id = hashlib.sha1(
                    f"blob {len(content)}\0".encode() + content
                ).hexdigest()
                assert blob_id == accepted["assembly_git_blob"]
                generated = ROOT / f"scenes/{scene_id}/generated/{scene_id}.sc3d.yml"
                previous = generated.read_bytes() if generated.exists() else None
                proc = subprocess.Popen(
                    ["node", "scripts/serve-sc3d-preview.mjs", accepted["assembly_path"]],
                    cwd=ROOT,
                    env={**os.environ, "PORT": "0", "SC3D_SOFTWARE_PREVIEW": "0"},
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
                try:
                    url = await_server(proc)
                    images = {}
                    settings = {}
                    for slug, experiment, _ in modes:
                        png, parameters = render_one(browser, url, experiment)
                        images[slug] = png
                        settings[slug] = parameters
                    default = images["default"]
                    changed = {
                        slug: compare(default, images[slug])
                        for slug, _, _ in modes if slug != "default"
                    }
                    # Lighting comparisons include large color changes;
                    # bias adjustments can be intentionally subtle. Do not
                    # reject a shadow trial just for pixel identity at one
                    # view: record its pixels and settings for review.
                    if args.study == "lighting":
                        for mode in ("warm-light", "cool-light", "no-shadow",
                                     "hard-shadow", "soft-shadow-vsm"):
                            assert not changed[mode]["identical"], (
                                f"{scene_id}: {mode} has no measurable effect"
                            )
                    if args.study == "shadow":
                        assert settings["shadow-vsm-tight"]["shadow_radius"] == 1
                        assert settings["shadow-vsm-wide"]["shadow_radius"] == 6
                        assert settings["shadow-bias-strong"]["shadow_normal_bias"] == 0.045
                    final_sheet = make_sheet(images, modes)
                    file_path = destination / f"{scene_name}.png"
                    final_sheet.save(file_path, format="PNG", optimize=True)
                    record = {
                        "scene": scene_id,
                        "source_assembly_blob": blob_id,
                        "sheet_file": file_path.name,
                        "sheet_sha256": sha256(file_path.read_bytes()),
                        "dimensions": list(final_sheet.size),
                        "study": args.study,
                        "render_order": [x[0] for x in modes],
                        "screenshot_sha256": {
                            k: sha256(v) for k, v in images.items()
                        },
                        "settings": settings,
                        "difference_from_default": changed,
                        "disclaimer": "Real Chromium scene images; unapproved diagnostic rendering",
                    }
                    (destination / f"{scene_name}.json").write_text(
                        json.dumps(record, indent=2) + "\n", encoding="utf-8"
                    )
                    results.append({
                        "scene": scene_id,
                        "sheet": file_path.name,
                        "sha256": record["sheet_sha256"],
                    })
                    print(f"PASS {scene_name}: {args.study} 8 matched-camera renders and sheet", flush=True)
                finally:
                    proc.terminate()
                    try:
                        proc.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.communicate(timeout=5)
                    after = generated.read_bytes() if generated.exists() else None
                    assert after == previous, f"{scene_id}: source snapshot mutated"
        finally:
            browser.close()
    (destination / "index.json").write_text(
        json.dumps({
            "schema": "renderarium-lighting-shadow-gallery-v1",
            "study": args.study,
            "scene_count": len(results),
            "viewport": [WIDTH, HEIGHT],
            "experiments": [mode for mode, _, _ in modes],
            "scenes": results,
            "note": "Screenshots from actual frozen scene sources, not quality approval",
        }, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
