# Block-Chibi Bathroom v1

**State: visually accepted and graduated (2026-10-08), corrected layout frozen.**

The third specimen in the seven-scene campaign (following the visually
accepted living room and kitchen). Approved style family: block-chibi-room.

## Scene

Source of truth: `room.assembly.yml` (10 instances) plus concrete
SC3D assets. The layout includes:

- true-window cutaway shell with cream/mint checker floor and backsplash;
- cream and pastel-blue soaking tub with a visible inner basin, water,
  wide lips and a chunky bath tap;
- separate cream ceramic toilet with cistern, seat, flush and support;
- sage bathroom sink vanity, wall-framed mirror, and faucet;
- left-wall towel rail with blush hanging towel;
- tapered wicker laundry hamper with folded cloth;
- thin rose bath mat (not a futon or seating object);
- reused four-pane window and snake plant.

New component assets live in `assets/constructive-3d/bathrooms/`.
The 7 new semantic object/visual realization grammars are recorded in
`sguzman/taria :: taria/scenarium/ontology/objects` and
`ontology/realizations`, indexed by
`ontology/block-chibi-prop-realizations-v1.yml` with concrete source
blob references in `contracts/block-chibi-prop-ontology-bindings.yml`.

## First interactive preview

`preview-geometry.json` contains **139 source-derived geometric pieces**
expanded from the actual assembly and source assets, with each instance's
path, exact Git blob, part hierarchy, transforms and colors.

The embedded chat viewer is an **alternate source-grounded WebGL geometry
renderer**, not the production Three.js SC3D pipeline. Full canonical
Node/YAML/Ajv rendering, local light simulation, shadows, fog, effects,
interactions and release admission are **not** claimed.

The viewer is presented directly in the chat with orbit, zoom, reset,
and wall/tile inspection. Human approved the corrected bathroom in chat on 2026-10-08. The environment
rendering experiment queue remains separate and deferred.

## Placement review revision 2 (2026-10-08)

Initial human feedback: **everything about the room was liked except three
placements**. The brown woven basket was identified as a **laundry hamper**,
not a trash basket. The requested spatial corrections are now committed to
`room.assembly.yml` and `preview-geometry.json`:

| Object | Previous (x, y, z) | Revised (x, y, z) | Spatial requirement |
|---|---|---|---|
| Toilet | (1.72, .118, .42) | (1.72, .118, 1.53) | Rear cistern next to back wall |
| Laundry hamper | (2.15, .118, -1.38) | (-2.31, .118, -.55) | Left wall beside tub |
| Pink bath mat | (-1.45, .118, -.16) | (-1.35, .118, .21) | Adjacent to tub exit |

Clearance checks on revised source geometry: toilet/rear wall ~4cm,
hamper/left wall ~3.5cm, mat/tub front ~4.5cm; hamper doesn't overlap
mat or snake plant. Geometry remains 139 pieces and all props keep the
same shapes and materials. No new lights, effects or rendering research
were brought into this revision.

**Graduated for visual composition and block-chibi style:** the reviewer saw the revised interactive 3D model and approved it as cute and great.
Durable evaluation: `taria/scenarium/evaluations/block-chibi-bathroom-v1-interactive-visual-acceptance-2026-10-08.yml`.
This does not constitute canonical Three.js release validation.

## Boundaries

Taria owns the scene specification, task state, object grammars, style
realizations and human decision. Scenarium owns this geometry, asset files,
assembly and viewer provenance. Do not prestart Office before bathroom
review, and do not reopen accepted previous scenes.
