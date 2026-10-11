# Block-Chibi Office v1

**Status:** Visually accepted and graduated (2026-10-08), corrected lamp layout frozen.

Fourth new environment specimen in the block-chibi scene campaign. The
approved Cozy Reader Room, Living Room, Kitchen, and Bathroom remain frozen.

## What this scene tests

A believable personal workspace in the same cute chunky pastel style:
usable wood writing desk; seated computer monitor with keyboard and mouse;
pink-cushioned chair facing the desk; wall pinboard with notes; sage filing
cabinet; bookshelf; restrained pink rug; tall floor lamp; plant; true
four-pane window; open-front / open-right room shell with warm wood floor.

The monitor and keyboard rest on the desk worktop; the chair faces the desk;
the pinboard has a wall backing. This room tests furniture support and
functional orientation, **not** animation or working electronics.

## Source and implementation

- `room.assembly.yml` — **12 component instances**
- `components/office-shell.sc3d.yml` — structural shell with real window opening
- `assets/constructive-3d/offices/` — four new reusable props: monitor,
  keyboard/mouse, three-drawer filing cabinet, pinboard
- `preview-geometry.json` — **104 source-derived geometric pieces**, exact
  assembly source blob, asset blobs, parent hierarchy, transformations and colors
- `contracts/block-chibi-prop-ontology-bindings.yml` — source-to-Taria
  semantic and realization grammar pointers for new prop families

Reused prior SC3D props: writing desk, chair, bookshelf, pink rug, floor
lamp, snake plant and four-pane window. No accepted historical asset
geometry was changed.

## QA and creative review

Source material and parent references resolved. Programmatic checks passed
for desk contact of monitor and keyboard, chair orientation, and selected
room-object clearance. The primary creative review artifact is the
**interactive source-derived 3D model embedded directly in chat**.
That is a standalone alternate WebGL renderer, **not** the canonical
Three.js/SC3D runtime. Full Node/YAML/Ajv build, GPU implementation parity,
lighting, shadows, fog, shaders, and release readiness remain unverified or
deferred. The revised in-chat view was explicitly accepted by the human reviewer. Approval concerns scene composition, not canonical renderer validation.

## Ontology and task state

- `sguzman/taria :: taria/scenarium/specifications/block-chibi-office-v1.yml`
- `sguzman/taria :: taria/scenarium/queues/block-chibi-office-v1.yml`
- `sguzman/taria :: taria/scenarium/ontology/realizations/block-chibi-room-{computer-monitor,keyboard-mouse,filing-cabinet,pinboard}.yml`

The scene is classified as a **residential home office**. A commercial office is a separate possible future specimen, not a correction to this scene. The accepted floor lamp stands in the rear-left corner at [-2.22, 0.118, 1.50]. See the canonical acceptance record at `sguzman/taria :: taria/scenarium/evaluations/block-chibi-office-v1-interactive-visual-acceptance-2026-10-08.yml`.

The separate scene seed after Office is **Backyard**, not instantiated yet.
