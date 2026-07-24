# 03 — Project bootstrap + flagless CLI skeleton

**What to build:** The `@quantum-hub/relay` package skeleton and its flagless CLI. Running `npx @quantum-hub/relay` dispatches on a single positional: a work-item key runs a pass (stubbed for now), `doctor` runs the preflight (stubbed for now), no argument means auto-pick. The exit-code contract (0 success / 1 blocked / 2 error) is scaffolded end to end. Bootstrap via the `sandcastle` CLI (`init` + `docker build-image`), then build on the library API.

**Blocked by:** None — can start immediately.

**Status:** resolved

Landed on main in `64926a5 feat(relay): bootstrap package and flagless CLI skeleton`.

- [x] `package.json`: ESM, Node `>=20`, exact-pinned sandcastle + zod + jiti, `tsup` build, `files: ["dist"]`, no host `claude` dependency
- [x] Flagless CLI dispatches `[WORK-ITEM]` vs `doctor` vs no-arg
- [x] Exit codes 0 / 1 / 2 wired through the entry point
- [x] Prompts + orchestration ship as data files in `dist`, resolved via `import.meta.url`
