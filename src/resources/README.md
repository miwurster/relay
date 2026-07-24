# relay resources

Prompts and orchestration data ship here as plain data files.
They are copied verbatim into `dist/resources` at build time and resolved at runtime via `import.meta.url` (see `src/resources.ts`).
They are data, not code: the harness reads them; it does not import them.
