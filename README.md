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

## Optional renderer-quality experiments

The production preview keeps its approved defaults. Diagnostic URLs may explicitly request
`?diagnostic=1&quality_experiment=fog`,
`?diagnostic=1&quality_experiment=soft-light`,
`?diagnostic=1&quality_experiment=shadow-detail`,
`?diagnostic=1&quality_experiment=tone-map`,
`?diagnostic=1&quality_experiment=ambient-occlusion`,
`?diagnostic=1&quality_experiment=ambient-occlusion-half`, or
`?diagnostic=1&quality_experiment=fxaa`.
Unsupported, repeated, or non-diagnostic experiment requests fail closed.
These trials change only runtime lighting, fog, shadow-map settings, tone mapping or
a depth/normal-buffer screen-space ambient-occlusion (SSAO) pass with explicit
orthographic and perspective depth reconstruction, or an FXAA color-space-aware
post-processing composer. None changes
SC3D source, geometry, materials or accepted camera presets. They are not new
visual-acceptance verdicts.

The factory Chromium regression checks all seven experiments against the
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
existing seven-scene correctness matrix. It compares **all seven optional modes**
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
