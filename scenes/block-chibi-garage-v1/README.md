# Block-Chibi Garage v1

**Status:** Visually accepted and graduated on 2026-10-08; revised 112-piece source scene frozen for this campaign.

This is a **residential hobby garage** specimen in the accepted block-chibi
style, not an industrial shop and not another domestic sitting room.

The floor is now a **single uninterrupted matte-concrete slab**, retaining only the entrance threshold. A first-look review found seven parallel seams and six decorative parking/workshop overlays tile-like or inappropriate. They were removed, not replaced with domestic floor tiles.
The front has an open garage door header and posts, the back/left walls are
painted masonry, and the right face and roof are cut away for inspection.

## Production scene

- `room.assembly.yml`: eight component instances in functional garage zones.
- `components/garage-shell.sc3d.yml`: garage structure, continuous concrete floor and open entry.
- `assets/constructive-3d/garages/`: seven reusable families — compact car,
  maintenance workbench, tool pegboard, rolling tool chest, spare tire stack,
  open storage shelving, and utility bicycle.
- `preview-geometry.json`: **112 source-derived parts**, exact Git source
  blob identity, colors, dimensions, local rotation and component transforms.
- `contracts/block-chibi-prop-ontology-bindings.yml`: source-to-Taria
  mapping for style-independent object grammars and style realizations.

These seven objects now have provisional Taria grammar and realization
records. The SC3D production sources are not copied into Taria.

## Placement and review

The car occupies the left parking bay, tires at the back-left, maintenance
bench and wall tools at the rear-right, shelf and bicycle along the right,
pink chest against the rear wall between tires and bench, and bicycle near the open entrance. The design retains approachable
workbench and drawer faces.

Source checks passed for eight asset groups and 112 current parts, material/parent
bindings, tires/car/bicycle/workbench/shelf/casters grounded on concrete,
wall-mounted pegboard, and lateral/longitudinal clearance between vehicle,
bench, shelving, chest and bicycle.

## First human review and follow-up

Reviewer liked the garage and called it cute. The compact car and bicycle
look somewhat off, but that is **explicitly nonblocking** for this scene.
Two future source-versioned visual quality tasks are registered in
`sguzman/taria :: taria/scenarium/queues/block-chibi-garage-vehicle-refinement.yml`:
car silhouette/wheels, and bicycle frame/wheels. Neither v1 prop is replaced.

The only requested near-term adjustment is to remove the tiled-looking floor
seams. Revised source shell and preview remove 13 decorative elements:
7 long seam strips; 3 parking guides; a colored work-zone patch and its
edge; and a floor grate inset. The concrete slab, threshold, walls, fixtures,
and every furniture/vehicle asset remain unchanged. **The revised plain-concrete floor was accepted.**

The chest is now at **[-1.10, 0.126, 2.60]**: 0.005 m from the back wall's interior face, 0.845 m laterally from the workbench and 1.11 m from the tire stack. Drawers face the garage entry. A previous attempt moved it to [3.22, 0.126, 0.44] on the right-side cutaway, which **has no wall**; this was incorrect. The assembly and source-derived preview have been updated consistently. The human reviewer confirmed the rear-wall correction with: "Much better! Looks good. Good job." Visual scene acceptance is recorded in Taria.

The **interactive viewer in chat** is the primary visual review artifact.
It uses an alternate WebGL renderer to display committed source geometry.
Canonical Three.js SC3D runtime, automated build/validation and advanced
lighting/shadows/shaders/fog are **not represented as tested**.

**Garage has graduated for interactive visual appearance and composition only.** The canonical renderer is still unverified and the separate vehicle refinement tasks remain queued.
**Factory** is the final queued environment seed but is not instantiated.
