# Handoff 3 — Grill: a seam where the sandbox's host facts are resolved

**Repo:** `/Users/michael.wurster/work/sandbox/relay` (branch `main`, GitHub `miwurster/relay`)
**Architecture review report:** `/var/folders/qz/4bc1jm096zx27l0rxdkygn040000gp/T/architecture-review-20260727-162134.html` (candidate 3, anchor `#c3`)
**Strength:** Strong.

## Where this came from

A `/kipu-all:improve-codebase-architecture` pass over relay's hot spots. Five candidates surfaced; this is one of five parallel handoffs. No code changed. Nothing decided.

## The candidate, in one paragraph

`src/sandbox.ts` exports three pure functions — `sandboxMounts`, `sandboxEnv`, `sandboxOptions` — which `tests/sandbox.test.ts` covers directly. The module's real risk is elsewhere: `openSandbox` (`src/sandbox.ts:166-198`) creates all its own dependencies and encodes an ordering that exists for stated reasons — plugins first (an uninstalled plugin must not cost an image build), then image ‖ testcontainers host, then `assertGhInSandbox` (a tracker-less image must not cost a whole pass), then the socket gid. It accepts no dependencies and no test exercises it: `tests/pass.test.ts` replaces the whole `open` seam instead. This is pure functions extracted for testability while the bugs live in how they are called. Proposal: `openSandbox` accepts a host-facts resolver (default the real one) — the `HostFacts` type already exists at `src/sandbox.ts:28` — and the three helpers stop being exported.

Read `src/sandbox.ts`, `src/docker-host.ts`, `src/sandbox-image.ts`, `src/skills.ts`, `tests/sandbox.test.ts`.

## What the grilling must settle

- Where exactly does the seam go: one `resolveHostFacts` dependency, or does `openSandbox` take `HostFacts` already-resolved and the composition moves up to `pass.ts`/`gate-probe.ts`? The second is simpler but duplicates the call at two call sites (`pass.ts:83`, `gate-probe.ts:53`).
- Two adapters or one? Real host resolver + fake host resolver in tests = real seam. Confirm the test would actually assert the ordering rules, otherwise the seam is hypothetical.
- `createSandbox` itself (sandcastle) — stays created inside, or becomes the seam? Note `pass.ts` and `gate-probe.ts` already inject `open`.
- Do `sandboxMounts` / `sandboxEnv` / `sandboxOptions` stop being exported, and do their current tests move to going through `sandboxOptions` alone — or through `openSandbox`? "The interface is the test surface" says the latter.
- Does `HostFacts` stay the right name and shape (`image`, `socketGid`, `testcontainersHost`, `plugins`)?
- Anything in this that also cleans up `gate-probe.ts`'s duplicated open/dispose dance?

## Constraints

- `AGENTS.md`: surgical, simplicity-first. `npm run verify` must exit zero. Never silence a lint rule.
- Relevant ADRs in `docs/adr/`: 0004 (skills are mounted, not baked into the image), 0005 (secrets travel with the machine), 0010 (the sandbox shares the host's worktree and git directory), 0002 (one sandbox, one branch, sequential legs). None forbids this seam — but the ordering rules the seam makes testable are these ADRs' consequences, so cite them rather than re-deciding them.
- Domain vocabulary from `CONTEXT.md`: **sandbox**, **pass**, **leg**, **skill plugin**, **sandbox recipe**, **gate probe**. Architecture vocabulary from `/codebase-design`: module, interface, depth, seam, adapter, leverage, locality.
- Behaviour must not change: the fail-early order is load-bearing and the point is to make it assertable, not to alter it.
- New term coined → `CONTEXT.md`. Rejected with a load-bearing reason → offer an ADR.

## Suggested skills

1. `/kipu-all:grilling` — start here.
2. `/kipu-all:codebase-design` — seam placement and the deletion test; design-it-twice for the two seam positions above.
3. `/kipu-all:domain-modeling` — inline `CONTEXT.md` upkeep.
4. `/kipu-platform:write-an-adr` — only on a load-bearing rejection.
5. `/kipu-all:tdd` then `/kipu-all:kipu-commit` — after the shape is settled. The first test written should be the one that does not exist today: `openSandbox`'s ordering.
