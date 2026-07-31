# relay resources

Prompts and orchestration data ship here as plain data files.
They are copied verbatim into `dist/resources` at build time and resolved at runtime via `import.meta.url` (see `src/resources.ts`).
They are data, not code: the harness reads them; it does not import them.

`skills/` holds rubrics relay vendors rather than authors.
They are inlined into a prompt as an argument — nothing here is visible from inside the sandbox, whose worktree is the target repo's.
Each carries a provenance header naming its source, its licence and the commit it was taken at, and its body is never edited: an upstream change is taken by re-vendoring.
