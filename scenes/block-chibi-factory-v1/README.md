# Block-Chibi Factory v1

A miniature pastel **light-industrial toy-block forming and packaging cell**.
It is not a warehouse dressed like a living room, nor a full-scale factory
simulation. The cell has a spatially legible process: materials enter from
the left, travel through forming and assembly, pass quality control, and
exit as boxed goods on the right.

**Status:** Visually accepted and graduated on 2026-10-08 after the depth-buffered rendering repair. The 16-instance, 209-piece scene composition is frozen for this campaign.

## Production story

1. **Stock input.** A sage metal bin holds pastel preformed stock.
2. **Feed.** A short guarded incline feeds the transport lane.
3. **Forming.** A pastel stamping press, supported on both sides *outside*
   the conveyor lane, applies a die above the belt.
4. **Assembly.** A supported rose-and-mint robot arm extends its gripper
   over the line. Several repeated toy blocks show different stations in
   one *static* snapshot, not simulated history.
5. **Inspection.** A sensor bridge spans the conveyor with mint/amber
   indicators and an accessible operator console.
6. **Output.** A freestanding wooden pallet holds finished cartons.
   A few additional labeled cartons and a supply shelf make shipping clear.

The process graph lives in Taria's
`taria/scenarium/ontology/industrial-production-cell-flow-v1.yml`.
Equipment is laid out along the positive X axis; the worker-access lane
lies along the front, distinct from the belt. The building itself has a
matte industrial floor, structural bays, tall rear windows, and an open
front/right cutaway. These are **industrial**, not residential motifs.

## Source and provenance

- `room.assembly.yml`: 16 real SC3D asset instances, placements, stages,
  process direction and functional zones.
- `components/factory-shell.sc3d.yml`: 58 chunky matte shell pieces.
- `assets/constructive-3d/factories/block-chibi-*.sc3d.yml`: ten new
  industrial asset families, including repeated products and cartons.
- `assets/constructive-3d/garages/block-chibi-garage-storage-shelf-v1.sc3d.yml`:
  deliberately reused supportable storage prop from the Garage scene.
- `preview-geometry.json`: **209 source-derived 3D parts** with exact source
  blob IDs, color, primitive type, dimensions, positions and rotations.
- `contracts/block-chibi-prop-ontology-bindings.yml`: paths from production
  assets to the style-independent and block-chibi realization grammars.

The production sources remain in `sguzman/scenarium`; Taria owns the
specification, task queues, functional grammar and human evaluation.

## Depth-buffered review viewer (camera-occlusion repair)

- `review-depth-buffered.html` is a **self-contained**, source-derived
  209-piece viewer with orbit, zoom, overhead, line view, and visibility
  controls. It does not use network calls or third-party rendering packages.
- `review-depth-cpu-only.html` forces the same independently tested CPU Z-buffer,
  useful when a browser exposes WebGL but the GPU-specific path still behaves badly.
- It replaces the flawed Canvas2D average-face-depth painter with
  **per-fragment depth**: native WebGL depth testing where available, or
  a CPU inverse-Z pixel buffer with near-plane triangle clipping.
- This is a **renderer-only change**. The committed 16-instance assembly,
  209-part preview JSON, asset blobs and source geometry remain unchanged.
- Headless Chromium exercised the **software fallback** on default, overhead,
  line view, hidden walls/products, and drag orbit. All executed controls
  completed with no browser JavaScript errors. The GPU/WebGL branch was
  not runnable in the test container and remains browser-dependent.
- If surfaces still genuinely intersect after depth-corrected occlusion,
  open a *specific source-geometry* defect; never infer that from artifacts
  created by the old painter algorithm.

### Regression gates

The review viewers are intentionally checked against the authoritative
`preview-geometry.json`, not treated as substitute geometry sources.

- `node tools/verify-factory-preview.mjs` first checks the **Git blob
  hashes of the assembly and all 12 unique referenced SC3D assets** against
  the revisions frozen in `preview-geometry.json`. It then verifies that
  **all 16 group translations and 209 primitives, dimensions, colors,
  positions and rotations** agree between the source-bound preview and
  both depth viewers. It requires no external packages. The parity
  workflow is triggered by updates to the relevant pinned source files,
  the preview, both viewers, or the verifier.
- `python3 tools/test-factory-review-browser.py` runs the optional
  Chromium/Playwright regression on the **CPU depth renderer** by default:
  exact round-trip orbit pixels, overhead and line cameras, visibility
  toggles, zoom, and browser errors. The explicit `--renderer webgl`
  mode requires the real WebGL code path and fails if it falls back to CPU.
  `--renderer webgl --allow-swiftshader` can exercise software-backed
  WebGL, but **does not prove physical GPU acceleration**. These are agent
  QA commands, not manual user acceptance steps.
- The original software-depth browser regression passed locally. The
  new explicit WebGL browser test is committed but has not yet been executed;
  neither that test nor physical-GPU validation may be reported as passing.
- The first new Factory parity workflow run (ID `37860708516`) reported
  **failure with no exposed job steps/log URL**. Earlier Scenarium integrity
  runs exhibited the same pattern. This does **not** establish that parity
  tests ran on GitHub; only the local parity comparison and browser smoke
  are verified. CI remains an unresolved infrastructure/execution gate.

A separate **nonblocking** Taria queue,
`queues/block-chibi-factory-targeted-geometry-polish-v1.yml`, records
a genuine internal source overlap: the stamping press's unused work-base
piece sits inside the conveyor chassis. Other candidate contacts are
primarily the deliberate belt/product and supply-transfer interfaces.
These did **not** justify rearranging the user-approved composition or
modifying the scene to solve camera-dependent painter-order artifacts.

**Current visual review:** Factory v1 appearance and composition were accepted
on 2026-10-08. This remains a visual verdict, not a Three.js/WebGL validation.
Visual acceptance and scope are recorded in Taria's
`evaluations/block-chibi-factory-v1-interactive-visual-acceptance-2026-10-08.yml`.
The first accepted alternate artifact was the CPU depth-corrected
interactive viewer. On 2026-10-09 at 00:38 UTC, the source-derived Factory
viewer was also displayed interactively **inside the conversation**, and the
reviewer confirmed: "yup its really cute! good job". This completed the
preferred in-chat presentation review. Standalone HTML is an engineering
backup, not the primary showcase surface. The technical CI, canonical
renderer, and physical-GPU gates remain independent.

## Chat preview serialization incident

The first in-chat viewer failed with `Cannot read properties of undefined
(reading 'split')` during decoding of a custom LZW-packed geometry string.
The authoritative `preview-geometry.json` remained intact and contained
209 valid geometric parts in 16 source-pinned groups. The viewer fix uses
directly embedded geometry rows and validates field counts, dimensions,
colors and group transforms before assembling triangles. This is a display
repair, **not** a geometry or scene-composition revision.

The source-record decoder failures were superseded by the CPU depth-buffered viewer. Visual appearance was subsequently accepted via the standalone renderer. Direct in-chat 3D remains the preferred delivery surface.

## QA and acceptance boundaries

Source checks passed for all 16 components and 209 geometric pieces:
resolved materials, hierarchy, same-source revision mapping, 3D support
contacts, toy blocks seated on the conveyor, stamping-press uprights
straddling the conveyor, stage order along X, and no domestic floor tiling.

The primary output is a **source-derived orbitable 3D viewer**. The corrected appearance was accepted through the standalone software-depth viewer; in-chat delivery remains preferred,
not a static PNG. The alternate viewer is not a canonical Three.js
runtime test. Materials, shadows, machine motion, sound, lighting, fog,
postprocessing and industrial physics/safety engineering are not being
validated. The scene is a static toy-scale visualization, not a machine
design or operational safety plan.

**Graduated:** explicit human visual acceptance was received on 2026-10-08. All seven scenes are frozen for the closed block-chibi campaign. Separate renderer, CI and source-geometry follow-ups do not revoke the visual approval.
