# SC3D runtime

Production implementation for Taria's canonical
`Scenarium Constructive 3D Asset Format (SC3D) v0.1`.

Ontology authority:

`sguzman/taria :: incubator/scenarium/ontology/CONSTRUCTIVE-3D-ASSET-FORMAT.md`

This directory is not an ontology fork.

Current execution path:

```text
.sc3d.yml
-> YAML parser
-> mirrored/pinned v0.1 JSON Schema
-> semantic validator
-> Constructive3DIR
-> Three.js browser adapter
```

The first renderer intentionally supports only the geometry needed by the minimal proof:

- cuboid;
- tapered_box;
- wedge;
- renderer-independent materials;
- hierarchy;
- pivots;
- named anchors and rigid attachments.

The schema and semantic IR already admit broader SC3D v0.1 constructs. Unsupported realization
features fail explicitly rather than being silently approximated.

`schema-v0.1.json` is a production mirror of the canonical Taria schema so local/offline
validation does not depend on fetching Taria at runtime.


## Hair-grammar geometry note

SC3D v0.1 already defines `wedge`, so the Three.js adapter now realizes it directly.

The hair ontology also names general `prism` as a preferred future primitive. General prism is
not part of SC3D v0.1, so it is not being smuggled into the renderer as an undocumented extension.
Current hair assets may use `wedge` and `tapered_box` until a later SC3D version formally adds a
general prism expression.
