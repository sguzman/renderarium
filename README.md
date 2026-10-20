# Renderarium

Renderarium is the **public CI and renderer-verification mirror** for the approved block-chibi environment campaign produced in Scenarium. It excludes discussion archives, internal review narratives, and historical issue/commit migration.

## Scope

This snapshot is sourced from `sguzman/scenarium` at commit `8023c11d20d56253628300871a7c8bf467cc1249` and includes the seven visually accepted environments: Living Room, Kitchen, Bathroom, Office, Backyard, Garage and Factory. The frozen acceptance record is `contracts/accepted-block-chibi-v1.json`. Production scene specifications and semantic decisions remain authoritative in Taria; this repository owns public implementation and test infrastructure only.

The accepted files and geometry hashes are preserved. **Visual acceptance is not equivalent to canonical Three.js, WebGL/GPU, or live ChatGPT-host verification.** These evidence classes are checked and reported separately.

## Verification

- Node.js 22 or newer; pnpm 10.15.1 via Corepack.
- Install: `corepack pnpm install --frozen-lockfile`.
- Canonical source-to-chat tests: `corepack pnpm verify:chat-preview-pipeline` (18 stages).
- Public content boundary: `node tools/publication-gate.mjs`.
- The public GitHub Actions workflow performs both canonical integration and Chromium/Three.js browser checks. A software WebGL fallback is not physical GPU evidence.
- The seven-scene Chromium matrix also records `artifacts/canonical-browser/<scene>.json` for each scene: frozen assembly/preview pins, canonical source census, fresh redraw/frame evidence, screenshot diagnostics, navigation-to-ready time, per-draw CPU submission measurements (not GPU frame time), Three.js draw calls/triangle counts, and WebGL renderer/framebuffer properties. Timings are runner-dependent; screenshot fingerprints are not golden-image approvals.

The source and tests are provided for agent-owned development and QA. Previously accepted creative work is not reopened automatically. Adding new content requires its own scoped review and an updated public file boundary.

## Backyard WebGL2 renderer experiments (2026-10-15)

These are separate diagnostics, **not changes to the accepted production renderer**:

- `experiments/diagnostics/backyard-renderer-webgl2-vs-threejs-baseline-benchmark-2026-10-15.html` is Renderer Benchmark v1. It compares custom WebGL2 and pinned Three.js r160 over identical 179-part geometry and GLSL material, with merged and per-part draw modes. It intentionally excludes environmental effects. Three.js requires a CDN connection for initial loading.
- `experiments/diagnostics/backyard-full-effects-pipeline-benchmark-v2-2026-10-15.html` is Renderer Benchmark v2. It forks the accepted Unified Backyard v1.1 experimental effects renderer and runs seven fixed-condition **within-custom-WebGL2** profiles: minimal pipeline, outlines, shafts, bloom, dust, FXAA and combined. The original shader strings, packed 179-part source and scene transforms are unchanged.
- V2 excludes 700 ms warmup, measures each profile for 2400 ms, then restores the original interactive controls and camera. CPU render-call p50/p95, rAF frame intervals, per-stage CPU cost, draw calls and optional asynchronous WebGL2 disjoint-query GPU elapsed times are recorded. The latter are **not available on every system**; missing/invalid measurements must not be guessed.
- A disabled effect may still incur an existing fullscreen bypass pass. V2 therefore describes *real incremental configuration cost* rather than perfectly isolated shader cost. No v2 Three.js effects parity is claimed; that requires independent implementation and pixel-parity testing.
- `node scripts/check-backyard-effects-benchmark-v2.mjs` checks the immutable scene payload, 13 unchanged GLSL/camera shader strings, all seven scenarios, profiler instrumentation and JavaScript syntax. It runs in the public CI canonical job. This structural check is **not** live hardware benchmarking, visual acceptance or proof that an in-chat renderer displayed.
- The public publication gate now pins every archived Backyard experiment path explicitly; additions are not automatically allowed. Accepted production scene geometry and immutable visual verdicts remain unaffected.

## Backyard acceptance amendment (2026-10-14)

The historical seven-scene visual-acceptance ledger at
`contracts/accepted-block-chibi-v1.json` is **immutable**. It records the
October 9 Backyard with **181 geometry parts**. A narrowly scoped fence-clearance correction was subsequently accepted with **179 geometry parts**, without
revoking acceptance of the other six scenes.

The additive, separately pinned authority is
`contracts/accepted-backyard-geometry-amendment-2026-10-14.json`. It records
the accepted corrected preview and shell blob hashes and links to both archived
pre-correction sources under
`experiments/geometry-reviews/backyard-fence-clearance-2026-10-14/`.
Validators verify both the historical original and the newer approved correction;
they do **not** edit the October 9 acceptance ledger or infer a new human review.
The current production implementation and full seven-scene source census contain
**979 geometry parts** (historical snapshot: 981).

Historical CPU-depth raster fingerprints remain attached to the archived original
Backyard preview. Production source-to-chat packets instead cite the pinned new
amendment for the 179-part viewer. Acceptance remains a human visual verdict,
not evidence of canonical WebGL performance or delivery inside ChatGPT.

### Enforced backend-parity regression and GPU provenance

The seven-view Chromium matrix is an **enforced numerical regression gate**:
the per-view RGB-channel mean absolute delta must stay at most
**0.05/255**; at most **0.5%** of pixels may change; at most **0.1%**
may differ by three or more channel levels; and no channel may differ by
more than **32/255**. In addition, each non-baseline view must change at
least **0.5%** of pixels relative to the afternoon baseline *within each
renderer*. This catches a renderer that returns stale frames despite
passing backend equality. The observed baseline is significantly tighter,
but the relaxed guard allows normal rendering nondeterminism and is not
a substitute for visual approval. Failures still upload all screenshot
and JSON evidence before stopping CI. Both the positive and negative
threshold cases are exercised with synthetic pixels in `--self-test`.

The independent A/B script
`scripts/test-backyard-threejs-effects-browser.py` additionally has
an optional **`--require-hardware`** mode and **`--headed`** option.
It interrogates both real WebGL2 contexts through
`WEBGL_debug_renderer_info` and rejects SwiftShader, llvmpipe, lavapipe,
other recognized software renderers and unknown GPU identities. For a
Linux/Hyprland physical GPU environment with dependencies installed:

`python scripts/test-backyard-threejs-effects-browser.py --require-hardware --headed --output-dir artifacts/backyard-hardware-a-b`

This command is a reproducible **hardware measurement route**, not proof
that a hardware measurement was already taken. It records the actual
device string, CPU submission/frame intervals, and, **only if available**,
valid asynchronous `EXT_disjoint_timer_query_webgl2` GPU-pipeline timings.
Missing or disjoint GPU samples are reported as `null`, never inferred from
rAF or CPU submission times. Timer queries wrap the actual Three.js renders,
including the accepted shader passes, with results resolved asynchronously;
the custom WebGL2 profiler uses the same extension independently.
The run never infers that the device is an RTX 3090. To **require** that
the active GPU identifies as an RTX 3090 instead of the Linux display iGPU,
use `--require-hardware --expected-gpu "RTX 3090" --headed`. This only
checks the renderer identity reported by Chromium; it is not cryptographic
hardware attestation. In a Wayland/Hyprland environment, the Chromium display
must be available (usually via XWayland).

The two hardware contexts are validated separately, and the report includes
their unmasked GPU renderer/vendor strings, supported/disjoint timer status,
per-scenario GPU medians and sample counts, and exact output resolution.
Standard public GitHub runners continue to use SwiftShader and do not
execute the hardware-only gate. The browser QA is agent-owned; no manual
test is necessary for the existing software-renderer CI.

### Agent-run RTX 3090 hardware benchmark (Linux + Hyprland)

`scripts/run-backyard-hardware-benchmark.py` is a **fail-closed, agent-owned
launch wrapper** for the same approved-effects A/B browser benchmark. On a Linux
desktop with Playwright, Chromium, and Pillow installed, it launches **headed
Chromium via XWayland** and sets NVIDIA PRIME offload variables only in the
subprocess (no global changes to the compositor, driver, or system settings).
The offload variables follow NVIDIA's PRIME documentation; they are hints,
**not proof** that Chromium selected the discrete GPU.

Default single attempt:

`python scripts/run-backyard-hardware-benchmark.py --output-dir artifacts/backyard-hardware-a-b`

For three independent captures with GPU elapsed-time queries required:

`python scripts/run-backyard-hardware-benchmark.py --repeat 3 --require-gpu-timers`

Both WebGL2 contexts must explicitly identify the **RTX 3090**, return the
complete 179-part / seven-case draw census, and not identify a software
rasterizer. Each verified measurement requires its renderer JSON, combined
framebuffer screenshots, and the combined cross-backend comparison. Invalid
GPU identities, nonfinite timings, missing evidence, missing draws, or missing
requested timer queries fail the run; the launcher does not silently retry
with the iGPU or a software rasterizer.

For each run the agent gets `comparison.json`, `three.json`, `custom.json`,
both actual framebuffer PNGs, `gpu-context-three.json`,
`gpu-context-custom.json`, `stdout.log`, and `stderr.log`. The run root
contains stable machine-readable `attempt.json` plus a concise `summary.md`
with hardware identities and observed CPU/GPU medians. On failure,
`attempt.json` records `failure_code` and `diagnosis`, with classifications
such as `wrong-gpu`, `software-renderer`, `gpu-identity-unavailable`,
`gpu-timer-unavailable`, `benchmark-timeout`, or `browser-failure`.
Missing display or invalid run count is recorded as a `preflight_error`.
The original renderer probe JSONs are saved before hardware selection is
enforced so the agent can diagnose a fallback without rerunning the full test.
No durations are invented when GPU timer results are missing.

Pass `--no-offload` to inherit GPU selection. Headless is opt-in via
`--headless`. The dependency-free `--self-test` now mocks a full two-run
success, rejected software fallback, and preflight failure, checking both
output files without launching Chromium.

`python scripts/run-backyard-hardware-benchmark.py --self-test` is dependency-
free and checks GPU rejection, timer reporting, and result aggregation in
public CI. **No RTX 3090 result has yet been observed from this environment**;
the wrapper is for an agent with access to a suitable Linux desktop.

### Multi-camera effects parity study (seven views)

`scripts/test-backyard-threejs-parity-matrix.py` runs both **real renderers**
against the same fixed full-effects settings in Chromium at 620×295. It
captures seven camera/time conditions: afternoon, morning, late day, night,
reverse angle, elevated angle, and near camera. It records exact camera/time
inputs, 179-part source count, expected draw counts (the night pass omits
sunshafts), raw screenshot pairs, color-image pixel metrics, and a contact
sheet with amplified pixel-difference maps. Diagnostic near-match thresholds
are recorded separately from human visual approval. `parity-matrix.json`
and `parity-contact-sheet.png` are CI artifacts.

The test uses **deterministic controls only inside diagnostic forks** of the
Three.js and custom WebGL2 benchmarks; the historically accepted visual
source and its original shader strings are not rewritten.

### Effects-matched Three.js versus custom WebGL2 (v3, experimental)

`experiments/diagnostics/backyard-threejs-full-effects-pipeline-benchmark-v3-2026-10-15.html`
is an independently rendered pipeline in **actual Three.js r160** using
`WebGLRenderer`, `RawShaderMaterial`, `WebGLRenderTarget`, a depth texture,
full-screen GLSL shaders, and source-derived particle geometry. It retains the
same packed 179-part Backyard, all original GLSL texts and seven effects
configurations as the custom WebGL2 benchmark v2. The two paths independently
run the fixed 700 ms warm-up plus 2400 ms measured windows.

`scripts/test-backyard-threejs-effects-browser.py` opens both renderers
over HTTP in Chromium, confirms the same geometry and draw counts, and records
measured render-submission durations, frame intervals and all-effects pixel
differences at matching 620×295 framebuffers. It saves source JSON results
and screenshots in CI. This is a **candidate for measured effects parity**,
not automatically a visually equivalent or physical-GPU benchmark: investigate
pixel differences before accepting any rendering or performance conclusions.
The approved v1.1/v2 implementation remains unchanged.

### Stylized sunshaft sample-count experiment (v2.1)

The verified v2 software Chromium artifact indicated much slower frame intervals
for the accepted stylized sunshaft pass (about 83 ms versus 17 ms for minimal
rendering at 620 × 295 on SwiftShader). The original shader integrates 40
raymarch samples per pixel, each iterating eight source beams; JavaScript render
submission times remained near 0.2 ms and GPU timer queries were unavailable.
These measurements identify a software-rendering performance concern, **not**
physical RTX 3090 performance.

The isolated `experiments/diagnostics/backyard-sunshaft-raymarch-sample-sweep-v2-1-2026-10-15.html`
compiles trial shaders with 20 and 10 samples as alternatives to the original
40-sample shader. It measures minimal, shaft-only and all-effects configurations
with fixed camera/time/weather parameters. Default remains the original
40-sample shader; no accepted geometry, unified baseline or production GLSL
is overwritten. Chromium QA records actual timings and color-image differences
to the 40-sample output. Pixel differences do not imply artistic approval.
No shader quality reduction is promoted automatically.

## Optional renderer-quality experiments

The production preview keeps its approved defaults. Diagnostic URLs may explicitly request
`?diagnostic=1&quality_experiment=fog`,
`?diagnostic=1&quality_experiment=soft-light`,
`?diagnostic=1&quality_experiment=shadow-detail`,
`?diagnostic=1&quality_experiment=tone-map`,
`?diagnostic=1&quality_experiment=ambient-occlusion`,
`?diagnostic=1&quality_experiment=ambient-occlusion-half`,
`?diagnostic=1&quality_experiment=ambient-occlusion-occluders`,
`?diagnostic=1&quality_experiment=ambient-occlusion-camera-occluders`,
`?diagnostic=1&quality_experiment=ambient-occlusion-camera-occluders-75`,
`?diagnostic=1&quality_experiment=ambient-occlusion-camera-occluders-75-cached`, or
`?diagnostic=1&quality_experiment=fxaa`.
Unsupported, repeated, or non-diagnostic experiment requests fail closed.
These trials change only runtime lighting, fog, shadow-map settings, tone mapping or
a depth/normal-buffer screen-space ambient-occlusion (SSAO) pass with explicit
orthographic and perspective depth reconstruction, or an FXAA color-space-aware
post-processing composer. None changes
SC3D source, geometry, materials or accepted camera presets. They are not new
visual-acceptance verdicts.

The factory Chromium regression checks all eleven experiments against the
default diagnostic renderer, including changed pixels for fog/lighting,
actual shadow-map settings, tone-mapped pixels, real SSAO pass allocation
and changed framebuffer pixels in both camera projections, FXAA pixels and
resolution settings, CPU-side draw
submission samples for each experiment, three rejected invalid URLs,
and repeatability of the untouched default.
Its experiment evidence is included in the factory browser JSON artifact.

SSAO is deliberately imported only for its explicit diagnostic URL. The local
preview server allowlists the pinned Three.js addon modules; no remote CDN or
broad static-file access is required. The pass uses 16 depth/normal samples and
renders on demand. As with other trials, changing pixels is evidence of an
effect, **not** a new artistic approval or proof of physical GPU speed.

The QA timing samples include first-frame shader compilation and render-on-demand
work on the runner; they are not GPU timings or cross-machine performance budgets.

FXAA runs in its own three-stage Three.js EffectComposer chain
(RenderPass -> OutputPass -> FXAA ShaderPass) because FXAA expects sRGB input.
It is never activated during ordinary rendering. The existing default renderer
retains its original drawing path and output settings.

## Renderer-cost comparisons

The public Chromium job runs `scripts/benchmark-renderer-quality.py` after the
existing seven-scene correctness matrix. It compares **all eleven optional modes**
against the same-scene default, including a second unchanged default check,
using a fixed 512 × 384 viewport, three uncounted warmup draws and seven warm
redraw samples per mode. Each mode uses a separate browser page but the same
scene server and browser instance.

The `renderer-costs` CI artifact includes per-scene JSON, an aggregate JSON
and a Markdown table of within-scene median ratios. Every sample is an
instrumented synchronous CPU-side renderer/composer submission, **not** GPU
execution time, FPS, or a stable performance budget. Shader compilation during
initial draws is excluded. Small differences are noisy, particularly on
SwiftShader, and relative cost does not measure visual quality. The benchmark
does not promote any trial to a default.

Individual scene source blobs and default screenshots are checked before and
after trial execution; no accepted scene files are changed. The QA-only
redraw trigger is unavailable outside explicit diagnostic test mode.

### Reduced-resolution SSAO comparison

The separate `ambient-occlusion-half` diagnostic variant runs eight depth
samples at half-width and half-height internal resolution. It may have more
visible edge artifacts, and does not replace the full 16-sample SSAO trial
or the approved renderer. Browser QA verifies its internal dimensions and
changed pixels. Cost artifacts compare its warm median against both the
same-scene default and original SSAO. CPU-side timings are not physical GPU
performance or a new visual acceptance decision.

All per-frame Three.js draw-call and primitive counters in diagnostic QA use
explicit reset boundaries, so multi-pass FXAA and SSAO reports reflect the
complete draw chain instead of just the last internal pass. This does not
change ordinary preview rendering or imply GPU execution time.

### Image-change diagnostics

The benchmark also computes per-mode 8-bit sRGB pixel differences from
the matching unchanged default screenshot. For full versus reduced SSAO,
it records the mean absolute RGB channel delta (0–255) and fraction of
different pixels, alongside their relative warm CPU submission costs.
These **describe image differences**, not objective artistic quality:
a larger pixel delta is not proof of a worse or better render. CI installs
Pillow exclusively for these diagnostic calculations; no new SC3D
runtime dependency or ordinary rendering work is introduced.

### Resource stability and timing drift

During seven measured warm redraws, the QA harness asserts that Three.js
geometries, textures, and compiled program counts do not continuously increase.
Per-mode counters are included in each scene's JSON artifact. These are
renderer-managed WebGL object counts, not VRAM byte measurements.

Each scene also records the percentage drift between its before/after
default-render CPU medians; drift above 20% is flagged as a noisy
comparison rather than an automatic correctness failure. No SwiftShader
measurement alone authorizes a production effect or quality promotion.

### Per-stage renderer costs

Diagnostic QA frames distinguish the primary renderer/compositor CPU submission
from the additional SSAO depth/normal pass. Per-stage warm medians appear in
the benchmark JSON and Markdown artifact. FXAA's primary stage includes its
entire EffectComposer chain; the separate ambient-occlusion stage is zero
when no SSAO pass runs. This is a bounded synchronous JavaScript/WebGL
submission measurement, **not** GPU stage timing or a frame-rate claim.

### Diagnostic-only occluder pruning

`ambient-occlusion-occluders` selects the largest half of currently visible
meshes by world-space bounding-sphere radius (stable traversal-order ties)
for the SSAO depth/normal pass only. The ordinary beauty pass retains every
mesh and all initial visibility states are restored. The full SSAO experiment
and accepted default appearance are unchanged. This trial can omit small but
visually important contact shadows; it is not an approved quality policy.

The seven-scene benchmark compares per-frame draw calls, warmed CPU
submission, pixel differences from full SSAO, and stability in separate
diagnostic pages; Factory QA also checks orthographic/perspective variants.

### Reproducible SSAO sampling

The optional SSAO diagnostics now construct their kernels and noise textures
with a fixed pseudorandom seed. Only the synchronous SSAO construction
temporarily substitutes `Math.random`; it is always restored, including on
exceptions. Node entrypoint tests verify stable streams and restoration, and
the Factory Chromium test compares repeated identical SSAO screenshots.
The full/pruned SSAO comparison therefore uses an identical 16-sample
kernel/noise sequence rather than reporting randomized differences as
occlusion-fidelity changes. The default renderer never uses this test hook.

### Viewport-aware occluder selection

`ambient-occlusion-camera-occluders` is a separate diagnostic trial that
ranks mesh bounding spheres by approximate visible screen-space coverage.
It recalculates the top half on every AO redraw with the current camera,
for both perspective and orthographic projections. The world-radius
reference remains unchanged, as does the full beauty render and the
canonical scene data. Pixel and CPU comparisons are research diagnostics,
not permission to promote the effect or discard small contact occluders.

The Factory Chromium correctness test additionally performs real mouse-orbit
and wheel-zoom interactions in both camera projections. It verifies that
occluder ranking is reevaluated after each redraw, hidden mesh visibility
is restored, and the beauty pixels react to the interaction. The QA artifact
records whether the retained indices changed; the test does not invent
a requirement that every camera movement must change the winning occluders.

### 75% camera-aware occluder retention

The diagnostic `ambient-occlusion-camera-occluders-75` mode retains
three quarters of ranked meshes instead of half. All seven scenes are
benchmarked against 50% retention and full SSAO, with fixed sampling seeds,
draw-count monotonicity checks, separate pixel deltas and warm CPU samples.
The source assets and production renderer remain unchanged.

### Measured occluder tradeoff (public CI, 12 October 2026)

[CI 38255297986](https://github.com/sguzman/renderarium/actions/runs/38255297986)
passed the canonical and ten-mode Chromium tests. At fixed diagnostic
resolution on SwiftShader, the camera-aware 50% retention trial reduced
full-SSAO draw calls by about 23–25%, with per-scene mean absolute sRGB
pixel differences of 1.35–2.80 (0–255). Keeping 75% reduced draw calls by
roughly 9–12%, and image differences fell to 0.007–0.59 across all seven
scenes. More retained meshes improved this *descriptive pixel similarity*
in every scene; it does not establish perceptual superiority. Neither
trial consistently improved synchronous CPU submission duration, and
these software-renderer figures are not physical GPU measurements.

### Cached 75% camera-aware AO ranking

`ambient-occlusion-camera-occluders-75-cached` is an **additional opt-in
diagnostic mode**, not a replacement for the original 75% experiment.
It caches the exact selected occluder set while camera pose, projection,
and the scene presentation matrix remain unchanged, avoiding repeated
mesh scoring and sorting on static redraws. Dynamic orbit/zoom modifies
those transforms and forces fresh selection. Per-scene Chromium QA
requires identical images and draw counts between cached and uncached
75% rendering, tracks cache hits, and compares CPU-side timing.
Because this is an experimental matrix-scoped cache, arbitrary external
changes to descendant mesh transforms must explicitly invalidate it
before any future production use.

The Factory Chromium correctness suite confirms a static redraw reuses the
cached ranking, while real orbit and wheel-zoom changes invalidate it
for both orthographic and perspective cameras. The cache key uses copied
numeric matrix elements (camera world, projection and scene presentation);
holding references to mutable matrices would not detect movement.

### Automated SSAO comparison sheets

The `renderer-costs` GitHub Actions artifact now contains
`inspection/<scene>.png` for all seven accepted environments.
Each sheet includes authentic diagnostic screenshots of full SSAO,
camera-ranked 50%, camera-ranked 75%, and the cached 75% variant.
The second row shows RGB difference maps amplified **8×** (clamped
per RGB component, range 0–255). The cached-vs-uncached difference should be black
because the benchmark requires pixel identity.

The JSON records each sheet's SHA-256, dimensions, and amplification.
These sheets locate visual changes for agent-assisted review; they
are neither artistic acceptance nor physical GPU benchmarks. No scene
source, approved snapshot or default renderer is touched.

### Environment lighting and shadow visual comparisons

The diagnostic-only modes `warm-light`, `cool-light`, `no-shadow`,
`hard-shadow`, and `soft-shadow-vsm` change only the Three.js preview's
lights or shadow-map behavior. Warm and cool trials alter directional
light colors and intensities; shadow trials compare disabled shadows,
unfiltered BasicShadowMap, blurred VSMShadowMap, and the existing
`shadow-detail` option. The original `soft-light` trial and unchanged
default remain available.

The Chromium workflow saves real, matched-camera visual contact sheets
for all seven accepted environments under the `lighting-shadow-gallery`
artifact. Each scene's sheet compares the default, soft/warm/cool
lighting, and four shadow configurations. These are screenshots of
the actual browser scene, not illustrations or new 3D assets.
Publication and frozen-source checks run before the capture; none of
these modes is promoted to production without separate visual review.

### Shadow bias and filter study (diagnostic only)

The `shadow-study` Chromium artifact contains matching, authentic
camera views of the seven approved environments. Each sheet compares
the unchanged default, hard shadows, increased resolution, moderate
and strong normal-depth bias, and tight/default/wide VSM filtering.
All changes are to Three.js preview lights and shadow settings only.

A deliberately strong bias helps expose lost contact shading; broader
VSM blur can reduce stair-stepped edges but may wash out small shadows.
This study does not approve either effect for the production renderer.
The gallery records settings and pixel differences to enable visual
review of bias artifacts and shadow-edge softness across environments.

### Accepted Backyard day/night cycle (14 October 2026)

The corrected in-chat day/night demonstration received a positive visual review. Its standalone WebGL2 HTML
implementation is preserved at
`experiments/interactive-weather/backyard-daynight-2026-10-14.html`,
with byte-exact GitHub readback.

The demo uses **the approved 181-part/18-group Backyard source geometry**,
packed reversibly without remote fetches, and exposes one 24-hour slider
controlling sun angle, moving directional shadow map, sunlight temperature
and brightness, ambient color, sunrise/sunset sky gradients, moonlight and
stars. Orbit and zoom remain available.

Earlier attempted chat transports failed source checksum and GLSL shader
parsing (reserved identifier); those defects were repaired before positive
review. The 06:00 sunrise and 18:00 sunset are **stylized** rather than
astronomically/geographically accurate. This file is a demonstration,
not a production Three.js integration or an authorization to change
any approved environment source.

Canonical semantic review:
`sguzman/taria/taria/scenarium/evaluations/interactive-daynight-backyard-2026-10-14.yml`.

### Positively reviewed in-chat Backyard snow (14 October 2026)

The source-derived in-chat WebGL2 snow demonstration received a positive visual review.
The exact standalone HTML source corresponding to that reviewed viewer is
preserved at
`experiments/interactive-weather/backyard-snow-2026-10-14.html` and was
read back byte-for-byte from GitHub.

It uses the original accepted 181-part / 18-group Backyard (offline RB01
payload, decoded 3,265 bytes, FNV1a32 `2710925923`) and supports snowfall
amount, fall speed, signed horizontal wind, flake size/visibility, haze,
brightness, pause, flurries/steady/heavy/blizzard presets, orbit/zoom, and
a **nonphysical visual-only snow accumulation tint**. This experiment did
not modify the frozen scene or become a production default.

Taria's canonical review is
`sguzman/taria/taria/scenarium/evaluations/interactive-snow-backyard-2026-10-14.yml`.
The first raw-HTML-in-chat delivery was rejected for not being interactive;
a real embedded AppBlock was positively reviewed afterward. This source
archive is not proof of broad renderer/Three.js parity or physics correctness.

### Preserved in-chat Backyard rain and wind demonstration (13 October 2026)

The visually accepted source-derived WebGL2 rain study is archived as
`experiments/interactive-weather/backyard-rain-wind-2026-10-13.html`.
This is the locally verified standalone HTML source corresponding to the
working in-chat experiment (with chat-specific wrapper differences), not a
claim of independent headless GPU QA.

The offline model payload is a compact copy of the **unchanged approved
181-part / 18-group Backyard**. Its 3,265 decoded bytes have FNV1a32
`2710925923`. The demo exposes amount, speed, signed wind, streak length,
opacity, haze, brightness, splashes, pause, presets and orbit/zoom. The
initial wind bug (angled streaks without sideways travel) was repaired so
velocity and streak angle agree; a separate malformed Base64 transfer was
repaired before human acceptance. No source-scene geometry or production
default is changed.

Canonical human-review and effect-admission status live in private
`sguzman/taria/taria/scenarium/evaluations/interactive-rain-backyard-2026-10-13.yml`.
The separate Living Room fog experiment also worked for one scene but retained
density-slider and remote-scene-fetch defects; see the corresponding private
Taria evaluation. This README does not claim the rain feature has been
integrated into the production Three.js preview or independently
benchmark-tested on physical GPU hardware.

## Interactive environment exploration

Start the actual Three.js/WebGL seven-environment preview with
`corepack pnpm preview:environments` after installing dependencies.
On Linux, this starts the local server and opens the Living Room in
the default browser automatically via `xdg-open`. If desktop opening
is unavailable, navigate to the printed local address, normally
`http://127.0.0.1:4177/?scene=living-room`. For headless QA use
`corepack pnpm preview:environments:server` or
`node scripts/launch-environments.mjs --no-open`.
Select Living Room, Kitchen, Bathroom, Office, Backyard, Garage or
Factory from the environment menu. Drag to **orbit the camera** around
fixed, source-authored geometry; wheel to zoom, right-drag or Shift-drag
to pan, and use view above, view rear, or reset to navigate.
Perspective and orthographic camera choices use the same WebGL renderer.

The launcher serves only an explicit seven-name allowlist. Assemblies
are resolved in memory through the same canonical assembler; no accepted
mesh, scene specification, or generated snapshot is rewritten. This is
a local browser server, not a public hosted deployment. Automated Chromium
tests verify camera motion, stable scene transform and mesh count,
nonempty 3D output at multiple angles, and WebGL context health.
The legacy single-asset static turntable preview stays compatible.

The independent CI job `Interactive seven-environment Three.js WebGL QA`
tests genuine pointer orbiting, four quarter-turns through a full camera
revolution, scroll zoom, view above and rear, and precise camera reset.
It rejects blank framebuffers, unexpected mesh-count changes, wrong
scene identifiers, errors, and geometry/presentation rotation. Source
snapshots remain byte-identical. Each environment gets genuine Chromium
screenshots and JSON QA evidence; this is browser correctness, not a
guarantee of physical GPU speed or subjective visual quality.

The browser matrix also checks right-button panning and resetting the orbit
target, plus an orthographic orbit/zoom regression on the Living Room.
The 360-degree test compares its final camera position using a ratio
relative to orbit distance rather than an arbitrary world-space tolerance.

### High-sun shadow artifact regression (diagnostic only)

The dedicated `floor-artifact-study` Chromium job reproduces a near-vertical
key light, 2048px VSM shadow map, and wide blur. Real, identical-angle
environment screenshots vary only the normal-depth bias or use PCF as
a control. It includes zero bias intentionally to reveal speckled
self-shadowing, moderate bias, stronger bias, and a guarded
normal/depth bias candidate. Changes are **never** applied to accepted
source geometry or the default renderer. Visual review remains
necessary before treating any specific bias as an improvement.

### Final disposition of compact-car variants (2026-10-13)

**FAILED — not accepted; development closed.** The independent compact-car
geometry iteration sequence v2-v11r did not meet visual-quality requirements.
The in-chat preview delivery path also failed repeatedly. This car effort was closed following visual rejection rather than continued revisions.

All historical SC3D versions, associated preview manifests, and verification
code are retained for provenance and audit. No candidate is promoted into
the already accepted Garage scene, and no new compact-car work is queued.
The separate bicycle candidate is not covered by this decision.
Reopening requires an explicit new request.

### Separate Garage vehicle candidates (not accepted)

SC3D v2 candidate bicycle and car assets live alongside the untouched v1
source vehicles under `assets/constructive-3d/garages/`. The bicycle uses
a tubular triangular frame, 20-segment tires and spoke assemblies rather
than rectangular wheels; the car uses cylindrical tires and a revised
body/cabin silhouette. The candidate JSON geometry record in
`runtime/sc3d/garage-vehicle-prototypes-v2.json` is kept in SC3D
part parity for in-chat experimental previews.

The `vehicle-prototype-qa` CI artifact tests schema/semantic validity
and captures genuine Three.js Chromium perspective views. **Neither
candidate is installed into the approved Garage**, and neither is
visually accepted. Any replacement requires a separate comparison
and explicit approval of the revised scene.

### Vehicle geometry revision after interactive review

The bicycle v2 keeps its circular wheels but replaces center-plane fork,
seat-stay, chain-stay and rack-support members with **paired lateral
supports**. All supports adjacent to tires now run outside the tire
plane, with a CI geometric clearance assertion. It remains a candidate
until reviewed inside the conversation.

The car v3 is a separately authored experimental revision with distinct
hood, cabin and rear deck, two side windows separated by a B pillar,
door panels, and visible wheel-arch outlines. The earlier car v2 is
retained for comparison. The accepted garage assembly, preview,
vehicle v1 assets and frozen scene signatures are unchanged.

### Independent compact car v4 silhouette study

The car v4 candidate removes v3's raised rectangular side doors, lowers and
reproportions the hood, extends the main cabin into the beltline, and aligns
its roof/windshield/rear glazing. Its new subtle pillars and rocker detail
remain authored SC3D geometry. It retains the existing car v3 and v2 records
for side-by-side inspection from identical camera views in the chat.

Automated candidate QA now validates v4 cabin/body overlap, omission of
v3's raised door slabs, wheel count, all candidate SC3D source parity,
and distinct real Chromium/Three.js raster views for v3 versus v4.
The accepted Garage scene and the approved bicycle remain unchanged.
