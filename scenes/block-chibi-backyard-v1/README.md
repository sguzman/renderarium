# Block-Chibi Backyard v1

**Status:** visually accepted and graduated (2026-10-08). The 18-instance, 181-piece visual composition is frozen.

The fifth new scene in the coherent block-chibi environment campaign is
the first **outdoor** specimen. It is explicitly a **residential spring
backyard**, not an indoor room with its furniture swapped out.

## Scene identity

A 6.4 m × 5.2 m grassy ground cutaway, cream open-to-sky rear and side
picket fencing, warm tiled patio on the right, two raised garden beds,
a blocky shade tree on the left, pastel flower clusters, five
tapered stepping stones leading to patio seating, a pastel two-person
garden bench, tiny patio table with plant, and an elevated birdhouse.

No house walls, indoor floor, roof, window, or light simulation are copied
from previously accepted rooms.

## Versioned production

- `room.assembly.yml`: 18 component instances and semantic zones.
- `components/backyard-shell.sc3d.yml`: grassy site, six patio pavers,
  two rear/side fence rails per edge, discrete pickets, and posts.
- `assets/constructive-3d/gardens/`: seven source SC3D prop families.
- `preview-geometry.json`: **181 source-derived parts** with exact
  component paths, source Git blob IDs, material colors, geometry and
  instance positions.
- `contracts/block-chibi-prop-ontology-bindings.yml`: production sources
  linked to Taria's semantic and style-realization grammar records.

The seven garden families now have style-independent semantic definitions
(or a patio-table named subtype of table) and block-chibi appearance
realizations at `sguzman/taria :: taria/scenarium/ontology/`.

## First-look QA

All named material references and source part parent links were resolved.
The first pass revealed six fence rails with IDs that the preview extractor
skipped; those part IDs were normalized and the 181-piece preview was
regenerated from the updated shell. Planted flowers were lowered into
planter soil or ground to remove tiny support gaps.

Targeted source-bound checks confirmed: six fence rails present, flower
soil/ground contact, bench/table clearance, path-to-bed separation,
support of tree and garden furniture, and real exterior-site geometry.

The primary visual review artifact is the **interactive in-chat WebGL
model**, not PNG-only output. Its renderer is an alternate source-grounded
implementation, *not* the canonical Three.js production renderer.
Shadows, sunlight, wind, fog, post effects, audio, physics and canonical
CI/Three.js tests are separate and **not claimed to have passed**.

**Campaign outcome:** the required human interactive-visual approval was subsequently received, so Backyard graduated for composition and block-chibi style. Garage was later instantiated and graduated; the seven-scene campaign completed on 2026-10-08. Canonical renderer, GPU, effects and release gates remain independent. Do not reopen the accepted Backyard without an explicit new task.
