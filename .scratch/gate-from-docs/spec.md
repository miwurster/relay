# Spec: the repo's docs declare the green gate

Status: resolved

Vocabulary: `CONTEXT.md` — **Gate resolver**, **Provenance**, **Green gate**, **Role**, **Crew**, **Leg**, **Cold session**, **Pass**, **Handover**, **Doctor**, **Init**, **Sandbox**, **Pass branch**, **Tagged block**.
Architecture it rests on: [ADR-0009](../../docs/adr/0009-the-repos-docs-declare-the-green-gate.md) (this decision), [ADR-0006](../../docs/adr/0006-static-analysis-is-part-of-green.md) (static analysis is part of green), [ADR-0002](../../docs/adr/0002-one-sandbox-one-branch-sequential-legs.md) (sequential legs in one sandbox).
Work it reverses: commit `a268934 feat(config): refuse a green gate init left unset`, and the gate half of `.scratch/relay-init/`.

## Problem Statement

An operator has to tell relay how to verify their repo, in a config file, in a repo whose docs already say it.

This repo is the example. Its `AGENTS.md` carries the sentence "`npm run verify` — typecheck, ESLint, Prettier, tests. It is the green gate for this repo", because every contributor — human and **cold session** alike — needs to know it. And its `relay.config.ts` sets `greenGate: "npm run verify"` again, because that is where relay looks.

Two places, one fact, and only one of them is obeyed:

- Edit the docs and relay keeps running the old command, silently, as the sole evidence for calling a branch green.
- Edit the config and the docs now lie to every contributor and every **leg** that reads them.
- Nothing anywhere reports the disagreement, because nothing compares them.

The duplication also forces work onto setup. **Init** has to detect the gate from the build manifest, and when it cannot, write a sentinel value the config schema refuses by name — a whole mechanism whose only job is to stop a repo running on a command nobody chose.

And the config is the wrong place for the fact in the first place. Every other repo-specific convention relay needs is read from a document: tracker conventions come from the **tracker doc**, and which repo the issues live in comes from the git remote. The gate is the outlier.

## Solution

The **green gate** command leaves `relay.config.ts` entirely. A new **gate resolver** **role** reads the repo's own docs at the start of every **pass** and answers with the command.

The operator's experience:

- Declare the gate once, in `AGENTS.md`, where contributors read it. Nothing to configure.
- Every **pass** names the command it verified with, and where it read it, in the tracker comment and the pull request.
- `relay doctor` says up front which command relay will use, and warns when it had to guess.
- `relay init` stops asking about the gate at all — it writes `defaultBranch` and tells the operator to declare the gate in their docs.

The resolver never blocks a pass. A repo whose docs declare nothing gets a gate inferred from its build manifest, marked `inferred` — the same inference init used to make, moved to where it can be reported. That is the accepted risk of this design, and the **provenance** on every handover plus doctor's warning are its mitigation.

## User Stories

1. As an operator, I want relay to read my green gate from my repo's docs, so that the command my contributors are told to run is the command relay verifies with.
2. As an operator, I want no gate field in `relay.config.ts`, so that there is no second place for the fact to drift out of.
3. As an operator who edits the gate sentence in `AGENTS.md`, I want the next pass to use the new command, so that changing how my repo is verified is a one-line docs edit.
4. As an operator whose `CLAUDE.md` only `@`-includes `AGENTS.md`, I want the resolver to follow the include, so that the indirection every Claude repo uses does not hide my declaration.
5. As an operator, I want a documented precedence — `AGENTS.md`, then `CLAUDE.md`, then `README.md` — so that I know which file wins when more than one mentions a command.
6. As an operator, I want the first explicit declaration to win rather than the resolver reconciling contradictions silently, so that a stale README cannot quietly change what relay runs.
7. As an operator with per-directory `AGENTS.md` files, I want only the root doc graph consulted, so that a package-local instruction cannot become the whole repo's gate.
8. As an operator, I want the resolver to confirm the declared command's target actually exists before returning it, so that a renamed script does not cost me two **fixer** legs and a misdescribed block.
9. As an operator whose declared command no longer exists, I want the resolver to fall back to inference and say so, so that the pass still runs and the report tells me my docs are stale.
10. As an operator whose docs declare no gate, I want a gate inferred from my build manifest rather than a refusal, so that relay can run over a repo it can plainly verify.
11. As an operator, I want an inferred gate marked as inferred, so that I can tell relay guessed from relay knowing.
12. As an operator, I want the resolver's answer to name the file or manifest key it came from, so that I can check its reasoning without reading a log.
13. As an operator, I want the gate resolved once per pass, so that the three runs of a red-gate loop cannot disagree about what they are running.
14. As an operator, I want the resolver to run before the planner, so that a pass's very first leg establishes how it will be judged.
15. As an operator, I want the resolver to change nothing on the branch, so that no commit reaches me from a leg whose only job is to read.
16. As an operator, I want the resolved command named in the pull request and the tracker comment of a successful pass, so that what relay accepted as evidence for green is on the record.
17. As an operator, I want the provenance in that same report, so that a green pass on an inferred gate is not indistinguishable from one on a declared gate.
18. As an operator whose pass was blocked by a red gate, I want the failing command named, so that I can reproduce the failure myself in one paste.
19. As an operator, I want `relay doctor` to tell me which command relay will run, so that I find out before a pass rather than during one.
20. As an operator, I want doctor to warn — not fail — on an inferred gate, so that an imperfectly documented repo is not reported as a broken one.
21. As an operator, I want doctor's gate check skipped rather than crashed when my image or secrets checks already failed, so that one broken thing does not hide the rest of my setup.
22. As an operator, I want doctor's probe to clean up the branch it used, so that running doctor twice does not collide with itself or litter my repo.
23. As an operator, I want `relay init` to stop detecting my gate, so that setup no longer asks me to confirm a guess about a fact my docs already state.
24. As an operator, I want init's written config to carry `defaultBranch` and nothing else, so that the file it hands me has no value in it that could be wrong.
25. As an operator, I want init's report to tell me to declare the gate in my docs and then run `relay doctor`, so that the one manual step it created is the next thing I do.
26. As an operator, I want the sentinel gone, so that there is no value in my config whose only purpose is to be refused.
27. As an operator, I want no e2e rule imposed on my gate, so that what my gate covers stays my repo's decision, stated in my repo's docs.
28. As an operator on a cheap budget, I want the resolver to run on its own configured model, so that reading three files does not cost what planning costs.
29. As an operator, I want the resolver's model overridable like every other role's, so that I can move it if my repo's docs turn out to need a stronger read.
30. As a maintainer, I want the resolver to be a real **role** rather than a setup step, so that the invariant "every cold session is a role" keeps holding.
31. As a maintainer, I want the resolver wired through the **crew** like every other role, so that there is one place a pass's legs are assembled.
32. As a maintainer, I want the resolved gate threaded from the harness into the gate role rather than held as role state, so that resolve-once is visible in the topology instead of hidden in a closure.
33. As a maintainer, I want the resolver's answer schema-validated from a **tagged block** like every other role's, so that a malformed answer fails as a role error rather than as a bad command.
34. As a maintainer, I want doctor's gate probe injectable, so that no doctor test opens a sandbox or spends a session.
35. As a maintainer, I want `greenGate` simply absent from the strict config schema, so that there is no migration code for repos that do not exist.
36. As a maintainer, I want the sentinel commit reverted rather than left dormant, so that the codebase carries no mechanism nothing uses.
37. As a maintainer, I want the migration checklist rewritten around declaring the gate in docs, so that the doc and the tool do not disagree about how a repo is set up.
38. As a contributor to a repo relay runs over, I want the gate stated in the docs I already read, so that I run the same command relay does before I open a pull request.

## Implementation Decisions

### The new role

One new module for the **gate resolver**, shaped after the existing single-role modules: a factory taking the sandbox, config and output directory, returning the crew's `resolveGate` function. It owns its prompt resource, its tag, its schema, and nothing else — `runRole` already owns the session, the timeout, the tagged-block read and the branch rule.

Its branch rule is `no-commits`. The leg only reads, but the worktree may already be dirty from earlier legs, so `read-only` would fail it for someone else's mess.

The answer:

```ts
interface ResolvedGate {
  /** The command whose exit code decides green. */
  command: string;
  provenance: "declared" | "inferred";
  /** One line naming where it came from, for a human to read. */
  source: string;
}
```

Two states and no more: the enum is what doctor and the handover switch on, and every nuance — including "declared but its target was missing, so inferred" — lives in `source` as prose.

### The prompt

The resolver's prompt instructs the **cold session** to:

1. Read the root doc graph in order — `AGENTS.md`, `CLAUDE.md`, `README.md` — following `@`-includes, and stop at the first explicit statement of the command that must pass before a change is considered done. Directory-scoped `AGENTS.md` files are not read.
2. Confirm that command's target exists, statically — a script in `package.json`, a target in the `Makefile`, a wrapper on disk. Never by running it.
3. When no doc declares one, or the declared one does not check out, infer from the build manifest, and say in `source` what happened.
4. Return the **tagged block**.

Inference is the agent's judgement inside that one session, not relay code and not a shared detector. The detection ladder init carries today (`pom.xml` → Maven, `pyproject.toml` → `uv`, `package.json` scripts preferring `verify`, `ci`, `test`) is worth keeping as guidance *in the prompt*, and is deleted as code.

### Crew and harness

`Crew` gains `resolveGate(): Promise<ResolvedGate>`, and the resolver joins `createCrew`.

The harness calls it as the pass's first leg, before `plan`, and passes the result into the gate: `greenGate(attempt, gate)`. Threading it rather than closing over it is deliberate — resolve-once becomes a property of the topology a stub-crew test can see.

Ordering is fixed and load-bearing: resolution precedes the planner, so it precedes the **held** label the planner applies.

### The green gate role

`createGreenGate` stops reading `config.greenGate` and runs the command it is handed. Its green detail names that command; its triage prompt argument does too. Nothing else about it changes — relay still never parses the output.

### The success outcome and the handover

The `success` outcome grows the gate's detail, which today is discarded on green. `describeLeg`'s hardcoded `"The green gate is green."` is replaced by a line naming the command and its provenance, so the tracker comment and pull request body carry it:

- `` `npm run verify` exited 0 — declared in AGENTS.md ``
- `` `npm test` exited 0 — inferred from package.json (no doc declares a gate) ``

A `mid-block` from a red gate already carries the gate's triage detail; that detail names the command as it does today.

### Config

`greenGate` is deleted from the schema. `UNSET_GREEN_GATE` and its `refine` are deleted with it — the revert of `a268934`. The schema stays strict, and no targeted message is added for a leftover `greenGate` key: no repo has one.

`models` gains `gateResolver`, defaulting to `claude-sonnet-5`. Reading three files and a manifest is not opus work.

### Doctor

The config check stops naming the gate, since the config no longer knows it.

A new `gate` check runs after the sandbox image check and reports the resolver's answer: `ok` for `declared`, `warning` for `inferred`, and `skipped` when the config, secrets or image check already failed — resolution needs all three.

`DoctorCheck.status` gains `"warning"`. A warning prints distinctly and does **not** contribute to doctor's exit code: an undeclared gate is imperfect, not broken.

The check runs through an injectable `GateProbe` on `DoctorOptions`, alongside the existing docker and `gh` runners. The default implementation opens a sandbox, runs the resolver leg, closes the sandbox, and deletes the branch it used — named off `branchPrefix` (`agent/doctor`) rather than any **pass branch**.

That deletion is a stated exception to relay's never-delete rule, and the reasoning belongs in a comment: the rule protects a **pass branch**, which may carry commits worth a human's time. Doctor's probe branch carries none — its one leg is forbidden from committing — so reusing it across runs would be the actual hazard.

### Init

Init loses `detectGreenGate` entirely, and writes `relay.config.ts` with `defaultBranch` alone. Its report replaces "confirm the green gate" with "declare your green gate in `AGENTS.md` — relay reads it from there", still ending on `relay doctor` as the next command.

Note the sequencing: init is being built in the working tree right now, with gate detection in it. Whichever lands second removes it.

### Documentation

- `docs/migrating-a-repo-to-relay.md` — the "confirm the detected green gate" step becomes "declare your green gate in `AGENTS.md`", and the config section drops the field.
- `.scratch/relay-init/issues/01-green-gate-sentinel.md` → `wontfix`, with a comment pointing at ADR-0009.
- `.scratch/relay-init/issues/02-init-writes-the-config.md` — the gate criteria (detection for three languages, the sentinel case, the confirm-me comment) are struck, and the config-contents criterion becomes `defaultBranch` only.
- `CONTEXT.md` and ADR-0009 are already written and are not part of this work.

## Testing Decisions

A good test here asserts what an operator observes: which command relay ran, what the report said, what verdict doctor returned, what the config accepts. None of them assert how the resolver decided — that is a prompt, and prompts are not unit-testable. What *is* tested is the contract around it: a command plus a provenance comes back, is validated, is used once, and is reported.

Seams, agreed with the operator, and what each owns:

- **`tests/harness.test.ts`** (existing, the highest seam) — through the stub crew, with no sandbox: the resolver runs before `plan`; its answer reaches the gate; it is called exactly once across a three-attempt red-gate loop; an `early-bail` pass still resolved first.
- **`tests/gate-resolver.test.ts`** (new suite, shaped exactly like `tests/planner.test.ts`) — a fake `Sandbox` returning a tagged block: both provenance values parse; a missing or malformed block is a role error; the configured `gateResolver` model is the one used; the branch rule is `no-commits`; the prompt names the three docs.
- **`tests/green-gate.test.ts`** (existing) — the gate runs the command it was handed rather than anything from config; the green detail names it; the triage leg is passed it; exit 0 still costs no session.
- **`tests/handover.test.ts`** (existing) — a successful pass's `REASON` names both the command and its provenance, for a declared and an inferred gate.
- **`tests/doctor.test.ts`** (existing) — with a faked `GateProbe`: `declared` is `ok`, `inferred` is `warning`, a warning alone leaves the exit code at 0, and the check is `skipped` when the config, secrets or image check failed. No doctor test opens a sandbox.
- **`tests/config.test.ts`** (existing) — a config carrying `greenGate` is refused by strict mode; the sentinel tests are deleted; a minimal config is now `defaultBranch` alone.
- **`tests/crew.test.ts`** (existing) — the seventh role is wired.
- **`tests/init.test.ts`** (existing) — the written config round-trips through `loadConfig` carrying `defaultBranch` and no gate; the report names declaring the gate in the docs.

Prior art to follow: `tests/planner.test.ts` for a single-role suite, `tests/harness.test.ts`'s stub crew for topology, `tests/doctor.test.ts`'s injected fakes for the probe, `tests/config.test.ts`'s temp-root config files for the schema.

Every test fixture that currently sets `greenGate` in a config object — there are several across the suites — loses it.

## Out of Scope

- **Migration handling for existing repos.** None exist. A leftover `greenGate` gets strict mode's generic message and no more.
- **Comparing the docs to a config value.** There is no config value left to compare against.
- **A deterministic doc parser.** Rejected in ADR-0009: relay would fail on every phrasing nobody anticipated.
- **Directory-scoped `AGENTS.md` files.** The gate is repo-wide.
- **Running the gate to verify it.** Static existence checks only; the gate is the most expensive command in the pass.
- **Refusing a pass when no doc declares a gate.** Deliberately rejected — relay infers and reports instead.
- **Per-ticket or per-lens gates.** One gate per pass.
- **Caching a resolved gate across passes.** A **pass** is always a clean restart.
- **Teaching relay what a gate command covers.** No e2e rule, no scope opinion.
- **Editing ADR-0006.** Its Confirmation line is corrected by ADR-0009, not rewritten.
- **Making doctor's probe reuse a pass's sandbox.** Doctor does not run passes.

## Further Notes

The load-bearing trade is stated plainly in ADR-0009 and repeated here because implementation should not soften it: the sentinel guaranteed relay would never run a command nobody chose, and this change gives that guarantee up. What replaces it is visibility — doctor's warning before the fact, the handover's provenance line after it. If the provenance line is ever dropped as noise, the guarantee is gone with nothing in its place.

The resolver is the cheapest leg in the crew and should stay that way. If it grows — reading CI workflow files, reconciling contradictory docs, judging what a command covers — that is a signal the docs it reads are the thing to fix, not the prompt.

One asymmetry worth noticing: relay now reads its own gate out of its own `AGENTS.md` when it runs over itself, which makes this repo the first and best test of the resolver. The sentence is already there and needs no edit.
