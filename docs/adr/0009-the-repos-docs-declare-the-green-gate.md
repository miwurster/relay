# 0009. The repo's docs declare the green gate

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

The **green gate** command was a required field in the target repo's `relay.config.ts`.
`relay init` detected it from the repo's build manifest and wrote a sentinel value the schema refused when it could not.

But a repo that relay runs over already says how it is verified.
This repo's own `AGENTS.md` carries the sentence "`npm run verify` — typecheck, ESLint, Prettier, tests. It is the green gate for this repo", because contributors — human and **cold session** alike — need to know it.
So the command lived in two places, and only one of them was obeyed.
The day someone changes the docs, relay keeps running the config's command and nothing says otherwise.

Every other repo-specific convention relay needs is already read from a document rather than configured: the tracker's conventions come from the **tracker doc**, and which repo the issues live in comes from the git remote.
The gate was the outlier.

## Decision Drivers

- One source of truth for "how is this repo verified", and it should be the one contributors read.
- The gate command is the sole evidence relay uses to call a branch green, so a command nobody chose is the worst failure available.
- A **pass** costs many agent sessions already; one more is affordable, but the *green* path currently costs zero and that is worth defending.
- relay is deliberately opinion-free about the gate: it never parses the output, and an exit code is the one thing every build tool agrees on.

## Considered Options

- **Option A** — a **gate resolver** role reads the repo's docs at the start of every pass and returns the command.
- **Option B** — `relay init` reads the docs instead of the manifest and writes the command into the config, which stays required.
- **Option C** — keep the config field authoritative, treat the docs as advisory.
- **Option D** — a convention line in the docs that relay greps deterministically, with no agent involved.

## Decision Outcome

Chosen option: **Option A**.

`greenGate` leaves the config schema entirely, and with it `UNSET_GREEN_GATE` and the whole sentinel idea.
A seventh **role** joins the **crew**: the **gate resolver** runs as the pass's first **leg**, reads the root doc graph in precedence order — `AGENTS.md`, then `CLAUDE.md`, then `README.md`, following `@` includes — and returns the first explicitly declared gate command.
Its answer is resolved once and reused for every attempt of the gate loop, so the three runs of a red-gate pass can never disagree about what they are running.

Three sub-decisions carry most of the weight.

**An undeclared gate is inferred, not refused.**
When no doc declares one — or the declared command's target does not exist — the same session infers a gate from the build manifest and marks its answer `inferred`.
The rejected alternative was to stop the pass as a setup error, which is what the sentinel did.
It was rejected because relay would then refuse to run over a repo it could plainly verify, and because the inference is the same inference `init` was already trusted to make.
The cost is real and is accepted here: an inferred gate can become the evidence for calling a branch green.

**The provenance travels with the command.**
The resolver returns `provenance: "declared" | "inferred"` plus a `source` line naming the file or manifest key it came from.
`relay doctor` runs the resolver and reports `declared` as ok and `inferred` as a warning, which is where an operator finds out before the first pass.
The **handover** always names the command and its provenance in the tracker comment and the pull request, which is where a human finds out afterwards — and how a doc edit that changed the gate becomes visible.
Those two reports are the entire replacement for the sentinel's loud refusal.

**Verification is static, never a trial run.**
The resolver confirms the command's target exists — a script in `package.json`, a target in the `Makefile`, a wrapper on disk — and falls through to inference when it does not.
Without this, a renamed script means a red gate, two **fixer** legs spent editing code that was never broken, and a `mid-block` whose stated reason is wrong.
Running the command to prove it works was rejected: it is the most expensive command in the pass.

The e2e carve-out is dropped as part of this.
The config field's documentation required a gate covering every check "except e2e"; that was advice to whoever authored the field, and there is no longer an author.
Whatever the docs declare is the gate, and a repo that wants e2e out of it says so in its own docs — where its contributors need to read it anyway.

### Consequences

- Good: the command relay verifies with and the command the docs tell a contributor to run cannot drift apart, because they are the same sentence.
- Good: setting a repo up for relay loses a step — `relay init` no longer detects, guesses, or asks for confirmation of a gate, and writes `defaultBranch` alone.
- Good: the gate is named in every handover, so what relay accepted as evidence for green is on the record of each pass rather than in a config file nobody re-reads.
- Bad: one more agent session per pass, and the previously free green path now costs the resolver's leg.
- Bad: the gate is no longer deterministic across passes — a repo whose docs are ambiguous can be verified differently on Tuesday than on Monday.
- Bad: the sentinel's guarantee is gone. relay will infer a gate and run it, and `doctor`'s warning is opt-in.
- Bad: the fallback cannot be unit-tested, only prompt-tested. Tests cover the resolver's contract — a command plus a provenance — not its judgement.

### Confirmation

A pass over a repo whose `AGENTS.md` declares its gate reports `declared` and that file as the source; the same repo with the declaration removed reports `inferred` and the manifest key.
`relay doctor` warns on the second and not the first.

## Pros and Cons of the Options

### Option B — init reads the docs and writes the config

- Good, because the pass stays deterministic and costs no extra session.
- Good, because a human confirms the command once, at the moment they are setting the repo up.
- Bad, because the config and the docs can still disagree the moment either is edited, and only the config is obeyed — which is the problem being solved.

### Option C — config authoritative, docs advisory

- Good, because it is the status quo and costs nothing.
- Bad, because it makes the duplication official, and leaves the doc that contributors actually read as the one relay ignores.

### Option D — a grepped convention line

- Good, because it is deterministic, needs no session, and `doctor` can check it without a sandbox.
- Bad, because it is a config file wearing prose: a repo would have to write the gate in relay's syntax, in a document whose readers are human.
- Bad, because relay would fail on every phrasing nobody anticipated, which is exactly the class of problem an agent is better at than a regex.

## More Information

- Provenance: grilling of 2026-07-27.
- Supersedes the closing note of [ADR-0006](0006-static-analysis-is-part-of-green.md), whose Confirmation records this repo's operator config setting `greenGate: "npm run verify"`. The command is unchanged; it is now read from `AGENTS.md`, and no operator config sets it.
- Related: [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md) — the resolver is a leg like any other, and runs before the planner for that reason.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
