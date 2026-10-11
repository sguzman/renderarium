# Runtime Helpers

These helpers exist to remove renderer plumbing from individual scenes.

They are production infrastructure, not canonical ontology.

## asset-loader.js

Loads encoded binary-image transport files such as `*.webp.b64`, caches them, and binds
them to image elements.

The encoding workaround should never leak into scene semantics.

## reflection-compositor.js

Reusable DOM compositor for:

- high-quality raster mirror/frame art;
- a clipped mirrored subject;
- glass/highlight treatment;
- independently adjustable reflection pose.

It deliberately does **not** define scene composition, character motion, or canonical mirror
geometry. A scene provides those choices.

## Adoption rule

Do not refactor a frozen scene merely to use a new runtime helper before human QA.

New scenes and post-QA revisions may adopt these helpers when useful.
