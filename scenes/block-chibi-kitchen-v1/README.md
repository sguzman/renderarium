# Block-Chibi Kitchen v1

**State:** visually accepted for scene composition/style, 2026-10-08; optional renderer capabilities deferred.

This is specimen two of the accepted block-chibi environment campaign.
Its scope is a cute and coherent **3D scene composition**, not finished
lighting, simulated kitchen physics or release-quality runtime accreditation.

## Canonical authorities

- Taria specification: `taria/scenarium/specifications/block-chibi-kitchen-v1.yml`
- Taria task graph: `taria/scenarium/queues/block-chibi-kitchen-v1.yml`
- Campaign: `taria/scenarium/queues/block-chibi-environment-campaign-v1.yml`

## Implementation

- `room.assembly.yml` — 11 source component instances.
- `components/kitchen-shell.sc3d.yml` — 30 checkerboard floor tiles,
  10 backsplash tiles, true window aperture and cutaway.
- `assets/constructive-3d/kitchens/` — seven reusable asset families:
  sink, cooking range, prep counter, refrigerator, high cupboard,
  breakfast table and stool (instanced twice).
- Existing source assets: four-pane window and medium snake plant.
- `preview-geometry.json` — source-grounded alternate viewer encoding:
  **149 geometric pieces**, asset path and Git blob for each instance.

The preview data was extracted from actual committed source files and
all color-material and part parent bindings resolved. Two initially
undefined cabinet material bindings were found and corrected in the
SC3D source before extraction.

## Visible scene

Sink and faucet beneath the real window (back-left), stove/oven in
the middle, prep counter and high cupboard adjacent, cream/green
refrigerator at right, compact breakfast table with two stools in the
front, snake plant at the left edge.

## Review

**Primary output is the chat-embedded interactive 3D model.** Its renderer
is an alternative self-contained WebGL implementation grounded in
`preview-geometry.json`; it is *not* the canonical Three.js runtime.
Canonical assembly, Node/Ajv validations and GPU rendering remain separate
and unexecuted, so no release-ready claim is being made.

Lighting is deferred and nonblocking under
`taria/scenarium/queues/environment-lighting-experiments.yml`.
The previous living room and reader room remain visually accepted and
are not reopened.

The in-chat source-derived model was reviewed very positively and is
**graduated for this scene's visual composition and block-chibi style**.
This is not a validation of every individual object grammar, lighting,
shadows, shader behavior, fog, physics or the canonical renderer.

The seven new kitchen fixture realization grammars, alongside two living-room
furniture realizations, are indexed in
`sguzman/taria :: taria/scenarium/ontology/block-chibi-prop-realizations-v1.yml`.
The production-to-ontology source mappings are in
`contracts/block-chibi-prop-ontology-bindings.yml`.

Future optional effects and rendering comparisons are queued under
`sguzman/taria :: taria/scenarium/queues/environment-rendering-experiments.yml`.
Bathroom was the next specimen in the original campaign sequence. All seven
environments subsequently graduated for visual composition on 2026-10-08.
Do not reopen this accepted kitchen unless explicitly requested.
