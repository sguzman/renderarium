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
`?diagnostic=1&quality_experiment=soft-light`, or
`?diagnostic=1&quality_experiment=shadow-detail`.
Unsupported, repeated, or non-diagnostic experiment requests fail closed.
These trials change only runtime lighting, fog or shadow-map settings; none changes
SC3D source, geometry, materials or accepted camera presets. They are not new
visual-acceptance verdicts.

The factory Chromium regression checks all three experiments against the
default diagnostic renderer, including changed pixels for fog/lighting,
actual shadow-map settings, and repeatability of the untouched default.
Its experiment evidence is included in the factory browser JSON artifact.
