# Handoff 2 — Grill: doctor checks that declare what they need

**Repo:** `/Users/michael.wurster/work/sandbox/relay` (branch `main`, GitHub `miwurster/relay`)
**Architecture review report:** `/var/folders/qz/4bc1jm096zx27l0rxdkygn040000gp/T/architecture-review-20260727-162134.html` (candidate 2, anchor `#c2`)
**Strength:** Strong.

## Where this came from

A `/kipu-all:improve-codebase-architecture` pass over relay's hot spots. Five candidates surfaced; this is one of five parallel handoffs. No code changed. Nothing decided.

## The candidate, in one paragraph

`runDoctorChecks` (`src/doctor.ts:66-154`) is one 88-line function that threads four intermediate values (`config`, `secrets`, `installedGh`, `image`) and writes every skip cascade out by hand: `if (!config) { skip×3; return }`, `if (!image) { skip×2; return }`, `if (secrets) … else skip`. Adding a check edits three places, and no skip rule is reachable without driving the whole chain — `tests/doctor.test.ts` is 538 lines against a 249-line module. Proposal: declare each check as data (name, what it needs, how to run it, how to grade its value) and let one runner resolve prerequisites, propagate skips and collect verdicts.

Read `src/doctor.ts` and `tests/doctor.test.ts` before trusting this summary.

## What the grilling must settle

- Eight checks, three cascades. Is a declared prerequisite graph earning its keep, or is this the abstraction `AGENTS.md` warns about? Argue it both ways.
- Prerequisites are *values*, not just booleans: the gate check needs `config` **and** `secrets`, the daemon check needs the resolved `image` **ref**. How does a declared check receive its prerequisites' values with types intact?
- Skip messages today are hand-written per cascade and are genuinely different (`no sandbox image to run the check in` vs `no credential to run the resolver's leg on`). Does the runner generate them, or does each check own its skip reason?
- `record`'s `statusOf` grading (`ok` vs `warning`, used only for `provenance === "inferred"`) — part of a check's declaration, or stays special?
- Ordering: today it is source order. Does the runner keep that, or topologically sort? Source order is readable; a sort is a thing to debug.
- What does the test file look like after? Target: one check testable alone, plus a small number of runner tests for propagation.
- The three injected seams (`docker`, `gh`, `probe` in `DoctorOptions`) — do they stay as they are? They each have two adapters (real + fake) so the seams are real.

## Constraints

- `AGENTS.md`: surgical, simplicity-first, no speculative flexibility. `npm run verify` must exit zero. Never silence a lint rule.
- Domain vocabulary from `CONTEXT.md`: **doctor**, **warning**, **gate probe**, **provenance**, **green gate**. A check whose prerequisite failed is *skipped*, not failed. Architecture vocabulary from `/codebase-design`: module, interface, depth, seam, adapter, leverage, locality.
- ADRs in `docs/adr/` — none governs the doctor's internals. 0009 (the repo's docs declare the green gate) explains why the gate check exists at all.
- Behaviour must not change: doctor reports every check, skips what it cannot reach, warns without failing, exits 2 on any failure.
- New term coined during the grilling → add it to `CONTEXT.md` as you go. Rejected with a load-bearing reason → offer an ADR.

## Suggested skills

1. `/kipu-all:grilling` — start here.
2. `/kipu-all:codebase-design` — vocabulary and depth test; design-it-twice if the declaration shape is contested.
3. `/kipu-all:domain-modeling` — inline `CONTEXT.md` upkeep.
4. `/kipu-platform:write-an-adr` — only on a load-bearing rejection.
5. `/kipu-all:tdd` then `/kipu-all:kipu-commit` — after the shape is settled.
