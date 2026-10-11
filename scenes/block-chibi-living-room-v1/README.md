# Block-Chibi Living Room v1

First environment specimen in the seven-scene expansion campaign.
**State: visually accepted and graduated (2026-10-08).**

## Authorities

- Taria specification:
  `taria/scenarium/specifications/block-chibi-living-room-v1.yml`
- Taria task queue:
  `taria/scenarium/queues/block-chibi-living-room-v1.yml`
- Campaign:
  `taria/scenarium/queues/block-chibi-environment-campaign-v1.yml`

## Scene

A character-free living room in the already accepted low-poly block-chibi
style. A two-seat sofa faces a low coffee table; a comfortable side chair
angles toward the conversation group. A rose rug organizes the center;
a floor lamp, low bookshelf, snake plant, framed wall art, and a real
four-pane window complete the scene. Front and right sides stay open
for toy-diorama presentation.

Source assembly: `room.assembly.yml`, nine instances.

### New reusable assets

- `assets/constructive-3d/sofas/block-chibi-two-seat-sofa-v1.sc3d.yml`
- `assets/constructive-3d/tables/block-chibi-coffee-table-v1.sc3d.yml`
- Local architectural shell:
  `components/living-room-shell.sc3d.yml`

### Reused components

- wide cute chair;
- wide area rug (scaled to the larger conversation zone);
- tall floor lamp;
- low wide bookshelf;
- medium snake plant;
- square four-pane window.

Each source file is versioned; the preview does not silently replace an
approved older living-room or Cozy Reader Room asset.

## First viewer

`preview-geometry.json` contains **87 source-derived cuboid/tapered
geometry parts** expanded from these nine live GitHub asset source files,
with component transforms and exact source blob identifiers.

The first in-chat viewer is a **standalone interactive WebGL composition
viewer** using that extracted source geometry. Its renderer/lighting
are NOT the canonical Three.js SC3D runtime. The canonical generated
SC3D scene and full Node/YAML/Ajv pipeline have not yet been executed
in the production repository. Do not confuse a successful chat visual
inspection with canonical renderer or release accreditation.

The human reviewed the **in-chat interactive WebGL model** and explicitly
accepted the living room's visual composition, furniture, proportions and
block-chibi style. The scene is frozen for this campaign; no changes are
required for the accepted scope.

Optional lighting investigation is recorded in Taria's deferred queue
`queues/environment-lighting-experiments.yml`. The current alternate viewer
has basic directional shading but no modeled room/window/lamp lighting.
That is **nonblocking**. Full Three.js runtime, canonical assembly, and
release accreditation remain separately unverified, not falsely accepted.

Visual acceptance record: `taria/scenarium/evaluations/block-chibi-living-room-v1-interactive-visual-review-2026-10-08.yml`.

## Completed campaign

Kitchen followed this first specimen, and the seven-scene block-chibi
campaign was completed on 2026-10-08. Living Room remains visually accepted
and frozen. Do not reopen the accepted scene, the Cozy Reader Room style
anchor, or unrelated renderer work without an explicit new request.
