# Scenarium production repository

Scenarium is the production repository for **scene experiments and implementations**.

## Canonical ontology lives in Taria

The canonical scene ontology is **not stored here**.

```text
sguzman/taria
  taria/scenarium/
  = scene ontology authority

sguzman/scenarium
  = production / implementation repository
```

Canonical Taria state includes:

- scene ontology and scene-specification theory;
- archetypes and candidate populations;
- cardinality / compatibility / spatial rules;
- concrete scene ontology records;
- audio ontology and reusable sound expectations;
- rigging ontology;
- canonical scene evaluations.

This repository may contain small pointer files to those objects, but it must not maintain
a competing ontology copy.

## Taria / production authority contract

Scenarium is now a sovereign active Tarium at `sguzman/taria :: taria/scenarium`.

This repository remains deliberately separate because its authority is different:

> **Taria owns what scenes mean. This repository owns how concrete implementations realize them.**

The canonical machine-readable boundary contract is:

`sguzman/taria :: taria/scenarium/ontology/implementation-boundary.yml`

This repository carries an operational mirror at `contracts/taria-boundary.yml` and a human-readable
copy at `docs/TARIA-BOUNDARY.md`. Those local copies are noncanonical.

General ontology, scene semantics, grammars, canonical schemas, exact semantic scene records,
evaluation meanings, and durable semantic decisions must be authored in Taria. HyperFrames,
Three.js, parsers, renderers, concrete SC3D assets, rigs, media, previews, tests, logs, and
renderer-specific implementation state belong here.

## What this repository owns

- HyperFrames HTML/SVG/JS compositions;
- actual production assets;
- concrete rig implementation files;
- implementation manifests;
- renderer-specific experiments;
- preview/render commands;
- production quality gates;
- generated outputs.

## Production stack

- **pnpm** is the canonical package manager.
- **HyperFrames** is the current HTML-native deterministic renderer.
- HTML / SVG / CSS / JavaScript are the initial scene substrate.
- GSAP-compatible seekable timelines are used where useful.

## Core doctrine

```text
concept art
!=
working asset

pretty still
!=
rig

rig ontology
!=
rig implementation

scene ontology
!=
renderer project
```

## Asset escalation rule

Use high-quality authored/generated art directly by default.

Only promote an asset into structured or procedural form when it needs independent motion,
deformation, interaction, semantic control, parameterization, reuse, physics, or
camera-sensitive compositing.

Static room art, props, furniture, and decoration are allowed to remain beautiful raster
assets indefinitely if the scene does not need more control.

See `docs/ASSET-POLICY.md`.

## Block-chibi 3D environment campaign

The seven-scene campaign is **complete for human visual acceptance**
(2026-10-08): Living Room, Kitchen, Bathroom, Office, Backyard, Garage,
and Factory v1. The original Cozy Reader Room remains the accepted
style anchor, not an open task.

Factory v1 freezes **16 SC3D components and 209 source-derived geometry
pieces**. The human accepted its composition and depth-corrected appearance.
The CPU software-depth viewer passed local Chromium checks; its WebGL
branch and the canonical Three.js runtime are not independently approved.
GitHub Actions jobs in private repositories currently fail before any
steps are recorded; see
`docs/incidents/2026-10-09-private-actions-runner-allocation.md`.
The Factory
press/conveyor internal overlap is tracked as a separate, nonblocking
geometry polish task.

The primary human-facing deliverable is a **source-derived interactive 3D
viewer inside the chat**. Orbit/zoom are mandatory. Standalone HTML is
a test/backup artifact; static images and code validators cannot substitute
for visual review. The Factory viewers are at
`scenes/block-chibi-factory-v1/review-depth-buffered.html` and
`scenes/block-chibi-factory-v1/review-depth-cpu-only.html`.
Do not resume the flawed painter-depth renderer.

Canonical ontology, specifications, task queues and human evaluations
live in `sguzman/taria :: taria/scenarium/`. This repository owns the
production assets, scene compositions and renderers. Preserve graduated
scenes and create no new scene without an explicit request.
See `docs/SCENE-EXPANSION-PRODUCTION.md` and
`docs/FUTURE-SCENE-QUEUE.md`.

**Visual acceptance is already complete for the seven graduated block-chibi scenes.**
`contracts/accepted-block-chibi-v1.json` records those prior approvals
and pins their unchanged assembly/preview Git blobs. Verify using
`node scripts/check-block-chibi-visual-acceptance.mjs --self-test` as an
**agent-run** step. Old `review: pending` comments in frozen assembly
manifests are historical, not instructions to request review again.
This visual-approval ledger is distinct from canonical Three.js or
release validation. No accepted scene files should be edited merely
to synchronize their historical review fields.

**Chat-first interactive 3D delivery is mandatory.** See
`docs/CHAT-FIRST-CANONICAL-PREVIEW.md` and `docs/HUMAN-QA.md`.
The user reviews a working model **in this conversation**, never a
localhost server or manual terminal workflow. Source-derived and
canonical-IR-verified packets are *transport artifacts*, not the displayed
3D viewer; canonical Three.js rendering is a further independent claim.

`scripts/emit-chat-review-packet.mjs --scene factory` prepares
canonical-IR-checked scene data, and
`scripts/emit-chat-review-embed.mjs --scene factory` combines it with
the shared `runtime/chat/scene-preview-core.mjs` CPU-depth renderer
for embedding **directly inside the chat**. All seven accepted scenes
use the same pipeline, including hierarchy and component transforms.
The host supplies orbit/zoom/reset and visibility controls via state;
no scene-specific renderer forks are needed.

Packet schema and supporting source/renderer tests:
`contracts/chat-review-packet-v1.schema.json`,
`scripts/test-chat-review-packet.mjs`,
`scripts/test-chat-scene-preview-core.mjs`, and
`scripts/test-chat-review-embed.mjs`. The emitted fragment is
**presentation data/code, not proof that the user saw a viewer**, and
this CPU-depth backend is not canonical Three.js. The actual visible
in-chat model remains the deliverable; do not solicit repeat approval
of graduated scenes.

**Offline verification:** `node tools/verify-chibi-campaign.mjs` checks
all seven source-pinned scene snapshots (981 primitives, 76 per-scene
asset/assembly references) using only built-in Node APIs. The full
filesystem verifier requires agent-local execution; independent Git-tree
inspection confirmed all pins matched on 2026-10-09. GitHub-hosted Actions
credits for private repos are exhausted, per the repository owner.
See `docs/OFFLINE-VERIFICATION.md` for evidence classes and agent QA.

## Production workflow

```text
scene semantics
-> high-quality source art
-> explicit asset adoption
-> fidelity composition
-> agent-materialized in-chat human visual QA
-> selective promotion
-> rig/motion
-> integration
```

**Human QA delivery rule:** the production agent renders and surfaces review images and required 3D
previews in the current chat. Normal QA must never require the human to pull the repository, run
`pnpm`, start a local preview server, or otherwise manufacture the review artifact. Local execution
instructions are only appropriate when the human explicitly asks for local debugging/execution.

See:

- `docs/PRODUCTION-WORKFLOW.md`
- `docs/ASSET-ADOPTION-WORKFLOW.md`
- `docs/HUMAN-QA.md`

## Reusable production substrate

`assets/registry.yml` tracks adopted production assets and provenance.

`assets/catalog/` tracks reusable visual material without requiring every semantic object
to become its own file.

`runtime/` contains renderer-side helpers such as encoded-asset loading and reflection
composition. These helpers do not own scene semantics.

## Constructive SC3D track

Scenarium also owns a constructive 3D track rendered with Three.js from persistent SC3D assets.

Current accepted baselines:

- `assets/constructive-3d/quest-girl-v7.sc3d.yml` — accepted static block-chibi character;
- `assets/constructive-3d/cozy-block-room-v2.1.sc3d.yml` — accepted first room baseline;
- four accepted scene-composition proofs: cozy bedroom-study, study corner, sleep room, and reading corner.

Current integration frontier:

`scenes/block-chibi-reading-corner-occupancy-v1.scene.yml`

This is the first dedicated character-occupancy proof. It freezes Quest Girl v7 and Reading Corner
v1.1 and tests support, scale, collision clearance, character-stage use, and room-level character
readability.

Preview:

```bash
pnpm preview:sc3d-reading-occupancy
```

Structural validation:

```bash
pnpm verify:sc3d-reading-occupancy
```

Canonical occupancy ontology and queue live in Taria.

## Current production focus: props and scenes

Scenarium's current priority is **stylized props, furniture, environment
composition, and character-free scenes**, using its already accepted block-chibi
object/room grammars and scene proofs.

**New queued specimen:** `scenes/cozy-reader-room-v1/`, a stylized
reading-room environment. Its canonical semantic specification and queue are
in Taria at `taria/scenarium/specifications/cozy-reader-room-v1.yml` and
`taria/scenarium/queues/cozy-reader-room-v1.yml`. This is a queued project,
**not yet a built or human-approved scene**.

**Failed/suspended production lane:** faithful humanoid reconstruction from
2D character references. The Cozy Reader Girl v3 and v4 specimens are both
**terminated and preserved as failures**. V3 lacked sufficient rear reference
authority; v4 used an approved eight-view turnaround and still failed visually
in both hair and body. Technical validation and extensive iteration did not
produce acceptable resemblance. Do not automatically resume the character
track or treat source-geometry checks as aesthetic acceptance.

- `reference-fit/cozy-reader-girl-v3/termination.yml`
- `reference-fit/cozy-reader-girl-v4/termination.yml`
- `reference-fit/cozy-reader-girl-v4/iterations/0037.yml`
- `docs/REFERENCE-FIT-CHARACTERS.md` (historical/research-only procedures)
- Canonical scope policy: `sguzman/taria :: taria/scenarium/ontology/PRODUCTION-CAPABILITY-SCOPE.md`

The agent remains responsible for producing review images and any required 3D
preview **in the conversation**; ordinary QA must not require the human to
pull source, run pnpm, or operate a renderer locally.

## Current implementations

`scenes/princess-mirror-001/`

The first HyperFrames mechanics prototype. It proved the pipeline and rig-control path,
but failed the visual-fidelity and organic-motion gates.

`scenes/princess-mirror-002/`

The fidelity-and-organicity rebuild. Its scene is fully resolved in Taria and now has a
high-fidelity composition prototype using the accepted Princess A, room, and illustrated
mirror source art. It is awaiting the first human visual QA before deeper rigging work.

Canonical record:

`sguzman/taria :: taria/scenarium/scene-records/princess-mirror-002/ontology.yml`

## Local structure

```text
docs/
  ASSET-POLICY.md
  ASSET-ADOPTION-WORKFLOW.md
  PRODUCTION-WORKFLOW.md
  HUMAN-QA.md
  VISUAL-QUALITY-GATES.md
  RIGGING.md                  # pointer to Taria ontology

assets/
  registry.yml
  reference-sources.yml
  catalog/

runtime/
  asset-loader.js
  reflection-compositor.js

rigs/
  tender-princess-v0/
    rig.yml                   # first mechanics rig
  tender-princess-v1/
    rig.yml                   # whole-body causal rig for Princess Mirror 002

scenes/
  princess-mirror-001/
    README.md
    scene.yml                 # implementation manifest
    index.html                # HyperFrames implementation
  princess-mirror-002/
    README.md
    scene.yml                 # fidelity prototype manifest
    index.html                # high-fidelity composition prototype

ontology/, archetypes/, populations/, specifications/, audio/, scene-records/
  # noncanonical pointers only; ontology authority is Taria

evaluations/
  # renderer/implementation evidence and convenience notes; durable semantic decisions are canonical in Taria
```
