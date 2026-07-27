# 0011. Init creates the label vocabulary

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

A **pass** speaks in four labels — `ready-for-agent`, `agent-in-progress`, `agent-in-review`, `agent-blocked` — and the **agent skills** speak in four more.
None of them are created lazily: `gh` resolves every `--label` and `--add-label` name against the repo's existing labels and fails the whole call when a name is missing.
A repo whose maintainer skipped that setup step does not get a degraded pass; it gets a pass that dies mid-flight applying a label, with a **held** item and a branch left behind.

`relay init` knew this and said so, in the worst possible way: it printed "create the label vocabulary" as one of three manual steps and left it there.
Nothing verified the step had been done — `relay doctor` checked config, secrets, `gh`, the sandbox image, Docker and the gate, and never asked GitHub what labels this repo has.
So the one setup step relay could not survive being skipped was the one step relay neither did nor checked.

The reason it was not done was a stated invariant: init writes files, never tracker state, and never overwrites.
That invariant is worth something — an operator can run `relay init` on any clone and know nothing outside the working tree changed.
The question is whether the label vocabulary is tracker *state* in the sense the invariant meant, or setup relay is uniquely placed to do.

## Decision Drivers

- The failure mode is the worst class available: not a refusal before work starts, but a crash after a pass has taken a branch and a hold.
- Setup steps that are documented but unverified are setup steps that get skipped.
- A repo's labels belong to its maintainers, colours and descriptions included; relay is a guest in that namespace.
- `init` is the one command an operator runs before they have any relay experience, and `doctor` is the one they run to be told what is still wrong.

## Considered Options

- **Option A** — `init` creates the labels, `doctor` verifies them.
- **Option B** — a separate command, `relay labels`, creates them; `init` stays offline and file-only.
- **Option C** — `doctor` verifies them and nothing creates them; the manual step stays, but is now checked.
- **Option D** — a **pass** creates a missing label at the moment it needs it.

## Decision Outcome

Chosen option: **Option A**.

`relay init` creates all eight labels through the host's `gh`, against whatever repo `gh` resolves the clone to, and reports one verdict per label alongside its three file verdicts.
`relay doctor` grows two checks that read the repo's labels in one call.

Four sub-decisions carry the weight.

**Create the missing, never touch the present.**
Init never passes `--force`.
An existing label is reported `kept` and left exactly as its maintainers tuned it, which is the same rule init already applies to `relay.config.ts` and the **sandbox recipe**.
The rejected alternative was `--force` on every label, optionally behind a `relay init --force` flag — rejected because the only thing it buys is re-normalising colours somebody may have deliberately changed, and because it would have cost the CLI its flaglessness to offer a switch whose sole effect is undoing a maintainer's choice.
Names are matched case-insensitively, as GitHub matches them, so an existing `Ready-For-Agent` is kept rather than duplicated.

**Both label sets, graded differently.**
Init creates the four pass labels and the four triage labels alike, because relay ships the skills that speak the second set and a repo running them hits the same failure.
Doctor does not treat them alike: a missing pass label is `failed`, because relay's own code will die on it, and a missing triage label is `warning`, because relay's code never reads it and `docs/agents/triage-labels.md` explicitly invites a repo to use its own vocabulary instead.

**A label init could not create does not fail the bootstrap.**
Init still exits 0 always.
A host with no `gh`, or with no credential GitHub accepts, has its labels reported `skipped` — init never got to ask — and its files written regardless, so bootstrapping a repo offline still works.
A `gh` that asked and was refused reports `failed` with GitHub's own reason.
Exiting 2 was rejected: it would make a perfectly written config look like a failed bootstrap, and `doctor` is where a setup is judged.

**The vocabulary gets one home.**
`src/labels.ts` owns all eight names with their colours and descriptions, and `READY_LABEL` and `HELD_LABEL` move there from `github.ts` and `work-item.ts`.
Two commands and the pass code now read the same list rather than agreeing by coincidence.

### Consequences

- Good: the one setup step a pass cannot survive being skipped is now done by relay and checked by relay.
- Good: a maintainer's colours and descriptions survive every re-run, so the safe habit is re-running `init`.
- Good: `doctor` can answer "will a pass die on this repo's labels" before a pass is spent finding out.
- Bad: `init` is no longer purely local. It now needs `gh`, a credential, and the network to do its whole job, and it writes to a repo — on a fork clone, to whatever repo `gh` resolves to, which may not be `origin`.
- Bad: the "never touches tracker state" invariant is gone, and with it the guarantee that `relay init` changes nothing outside the working tree.
- Bad: relay now has an opinion about eight label names in someone else's namespace, four of which its own code never reads.

### Confirmation

`relay init` on a repo with no relay labels reports eight `wrote` verdicts and `relay doctor` then reports both label checks ok.
Re-running `init` reports eight `kept` verdicts and issues no `gh label create` at all.
A repo missing `agent-in-progress` fails `doctor`; a repo missing only `needs-info` warns and still exits 0.

## Pros and Cons of the Options

### Option B — a separate `relay labels` command

- Good, because `init` keeps its invariant intact and stays runnable offline in full.
- Bad, because bootstrapping becomes three commands, and the third is the one nobody runs — which is the status quo with extra steps.

### Option C — doctor verifies, nobody creates

- Good, because it is the smallest change that closes the crash, and relay never writes to a repo's labels.
- Bad, because it converts a silent mid-flight crash into a loud setup failure and stops there, leaving the operator to run eight commands relay could have run.

### Option D — a pass creates a label when it needs one

- Good, because the vocabulary can never be missing at the moment it is used.
- Bad, because it puts a repo-mutating write in the middle of an autonomous run, where nobody chose it and nobody sees it.
- Bad, because it hides the setup gap forever rather than reporting it once.

## More Information

- Provenance: grilling of 2026-07-27.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) — the labels are GitHub labels, created with `gh`, with no vocabulary abstraction between.
- Related: [ADR-0009](0009-the-repos-docs-declare-the-green-gate.md) — the green gate stays the repo's to declare; init creates labels but still only names the gate as a human step.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
