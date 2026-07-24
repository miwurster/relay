# Packaging and distribution as an npx tool

Type: grilling
Status: resolved
Blocked by: 02

## Question

How does the tool become a distributable `@quantum-hub/relay` runnable via `npx` in any target repo — built from scratch on the author's templates?

The qc-catalog spike lived as a per-repo `.sandcastle/` copy run via `npx tsx`; the new tool inverts that into one published package. Build on the author's project structure + bootstrap, not the spike.

Decide:

- The `bin` entry and CLI contract: `npx @quantum-hub/relay [WORK-ITEM]`, no-param auto-pick, Task→`error`, exit codes.
- How prompts / Dockerfile / orchestration assets ship inside the package and resolve at runtime against the *target* repo's working directory (they are no longer co-located in the repo).
- Compiled `dist` vs shipped `tsx` sources; Node engine range; `@ai-hero/sandcastle` as dependency.
- What (if anything) must still be dropped into a target repo vs fully carried by the package.

Depends on ticket 02 (what the `sandcastle` CLI / templates provide).

## Answer

`@quantum-hub/relay` ships as one published npm package that inverts the spike's co-located `.sandcastle/` copy — orchestration + prompts ride *inside* the package, only config rides in the target repo.

**Distribution form.** Compiled `dist` (ESM, `tsup`), mirroring the author's `@ai-hero/sandcastle` build. `bin → dist/main.js`. Prompts / orchestration assets ship as **data files copied into `dist`** (the author's `postbuild` `cp src/templates dist/templates` pattern) and resolve at runtime via `import.meta.url` — never relative to the target repo's cwd. No shipped `tsx` sources; the assets are not meant to be edited in place, so a `tsx` runtime on every target repo buys nothing.

**Target-repo footprint — exactly two committed files.** `relay.config.ts` (repo root, ticket 06) + `docs/agents/issue-tracker.md` (ticket 03/06). No `.sandcastle/` dir, no committed prompts, no committed Dockerfile. Everything relay-authored is carried by the package; the repo contributes only its config, tracker doc, and its own source. Home carries `~/.config/relay/.env` (ticket 04). The **Dockerfile's home is deferred to ticket 09** — if 09 wants the repo to own/tune its image, that adds a third committed file; the two-file minimum is locked here.

**CLI — flagless, two shapes.** `npx @quantum-hub/relay [WORK-ITEM]` (no arg = auto-pick per ticket 03) and `npx @quantum-hub/relay doctor` (opt-in full check, ticket 06). `doctor` as a reserved first-arg keyword cannot collide with a Jira key (`QCCAT-123`). No flags — config path is fixed, secrets resolve from `~/.config/relay/.env` with env-var override (tickets 04/06), so nothing is left for a flag to carry. Exit codes 0/1/2 locked in ticket 05.

**Config loading.** The harness is compiled JS (per the distribution form) and cannot `import` a user-authored `.ts` natively, so it loads `relay.config.ts` via a **bundled TS-config loader** (`jiti` / `bundle-require`) — the pattern Vitest / Tailwind / ESLint-flat / Nuxt use. **This revises ticket 06's implicit "TS harness reads TS config" assumption**: the config stays authored TS (typed + zod), but a loader bridges compiled-JS → authored-TS.

**Manifest.** `dependencies` (all bundled — an `npx` tool has no peers): `@ai-hero/sandcastle` **pinned exact** (pre-1.0 churn, per ticket 02), `zod`, `jiti`. `"type": "module"` (ESM-only, matching sandcastle). `engines.node: ">=20"` (Node 20 LTS floor). `files: ["dist"]` is the whole tarball. devDeps: `tsup`, `typescript`, `vitest`. **No host `claude` dep** — `sandcastle.claudeCode()` runs `claude` *inside* the sandbox image (ticket 09); the host needs only Claude creds in `~/.config/relay/.env`.

**Publish target — public npmjs.** `publishConfig.access: "public"` (scoped package). Chosen over the private GitLab registry to avoid an `~/.npmrc` scope+token prerequisite — `npx @quantum-hub/relay` then resolves anywhere with no auth footprint. Safe because ticket 04 confirmed **no secrets in the package** (only orchestration + prompts). Registry / `publishConfig` / CI auth mechanics are **ticket 10's** job — and 10 must confirm the commons `publish-npm` component targets npmjs, not the GitLab registry.

**Deltas to other tickets:**
- Ticket 06: "TS harness reads TS config" → harness is compiled JS, loads authored `.ts` via a bundled `jiti`/`bundle-require` loader.
- Ticket 09: inherits the Dockerfile-home decision (ship-in-package vs repo-committed).
- Ticket 10: publish is **public npmjs** (`access: public`), not the GitLab registry — confirm the commons component supports that target.
