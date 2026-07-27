# Spec: `relay init` bootstraps a repo

Status: ready-for-agent

Vocabulary: `CONTEXT.md` — **Init**, **Sandbox recipe**, **Doctor**, **Tracker doc**, **Green gate**, **Pass**, **Sandbox**.
Architecture it rests on: [ADR-0007](../../docs/adr/0007-one-forge-one-tracker-no-abstraction.md) (GitHub is hardcoded, no adapter).
Checklist it replaces the head of: `docs/migrating-a-repo-to-relay.md`.

## Problem Statement

Setting a repo up for relay is a six-step manual checklist, and an operator gets no help with any of it.

They must hand-author a `relay.config.ts` with two values that have no defaults, hand-write a **sandbox recipe** that satisfies four requirements documented nowhere except a reference Dockerfile in relay's own docs, copy a **tracker doc**, create four labels, provision a token, and only then find out whether any of it was right.

The failures this produces are slow and badly signposted:

- A **sandbox recipe** without `gh` fails the **pass** at the in-sandbox preflight, before the first **leg**.
- A recipe that hardcodes a uid instead of honouring the `AGENT_UID` / `AGENT_GID` build arguments relay always passes produces wrong ownership on the bind-mounted worktree and fails sandcastle's image-uid preflight — on macOS, where the host uid is 501 and every convenient devcontainer base pins 1000 or 1001, this is the default outcome.
- A recipe without the `docker` CLI passes a **pass** but fails **doctor**'s daemon check.
- A recipe without `claude` runs nothing at all.
- A wrong or absent **green gate** is the worst of them: the config schema accepts any non-empty string, so a plausible-but-wrong command is the sole evidence relay uses to call a branch green.

None of this is discoverable from the repo. The operator learns it by reading `docs/relay.Dockerfile`'s comments, or by failing.

## Solution

`relay init` — a third flagless command beside `doctor`, run once per repo, that writes the two files relay can honestly generate and names everything it cannot.

The operator clones a repo, runs `relay init`, and gets:

- `relay.config.ts` with `defaultBranch` read from the clone and `greenGate` detected from the repo's manifest.
- `docker/relay.Dockerfile` — a complete **sandbox recipe** for the repo's language, carrying the kipu devcontainer base the team already standardises on plus the tooling relay requires, with the agent user driven by the `AGENT_UID` / `AGENT_GID` build arguments.
- A printed report of what was written, what was left alone, and what remains a human's job: confirm the **green gate**, create the labels, provision `GH_TOKEN`, then run `relay doctor`.

Init never claims to be right. It claims to save typing. Detection is a convenience, the files it writes are meant to be read and edited, and the one value it cannot guess is written as a sentinel the config schema refuses outright rather than a guess that runs as if confirmed.

Init is safe to re-run. It never overwrites, so a repo that already has a hand-tuned recipe gets only the missing file, and a fully set-up repo gets a no-op.

## User Stories

1. As an operator adopting relay in a new repo, I want a single command that writes the files relay needs, so that I do not hand-author a config and a Dockerfile from a checklist.
2. As an operator, I want `relay init` to work with no flags and no prompts, so that it behaves like the rest of relay's CLI and can be scripted.
3. As an operator, I want init to write `relay.config.ts` at the repo root, so that `loadConfig` finds it where it already looks.
4. As an operator, I want `defaultBranch` filled in from my clone rather than assumed to be `main`, so that a repo on `trunk` or `master` is correct without an edit.
5. As an operator on a repo whose `origin/HEAD` was never set, I want init to fall back to my current branch rather than fail, so that a fresh clone still gets a usable config.
6. As an operator of a Maven repo, I want `greenGate` detected as a Maven command, so that the common case needs no edit.
7. As an operator of a Node repo, I want init to prefer my `verify` script over `test`, so that the detected gate is the one that covers static analysis rather than tests alone.
8. As an operator of a Python repo, I want a `uv`-based gate detected, so that the toolchain the base image ships is the one the config names.
9. As an operator whose green gate cannot be detected, I want init to write a sentinel rather than a guess, so that relay never calls a branch green on a command I never chose.
10. As an operator who left the sentinel in place, I want `relay.config.ts` to fail to load with a message telling me to fill the gate in, so that I find out at once rather than forty minutes into a **pass**.
11. As an operator, I want `relay doctor` to report the unset gate as a failed config check, so that the command built to show me my whole setup shows me this too.
12. As an operator, I want the detected gate written with a comment telling me to confirm it, so that I know init guessed rather than knew.
13. As an operator of a Java repo, I want init to write a **sandbox recipe** built on the kipu Maven devcontainer base, so that my sandbox matches what the platform team maintains.
14. As an operator of a Node repo, I want the same for the kipu Node base.
15. As an operator of a Python repo, I want the same for the kipu `uv` base.
16. As an operator, I want the written recipe to install `gh`, so that my **pass** does not die at the in-sandbox preflight.
17. As an operator, I want the written recipe to install the native `claude`, so that the **legs** can run at all.
18. As an operator, I want the written recipe to install the `docker` CLI, so that **doctor**'s daemon check can prove the sandbox user reaches the host daemon.
19. As an operator on macOS, I want the recipe's agent user built from the `AGENT_UID` / `AGENT_GID` build arguments relay passes, so that my uid 501 does not collide with a hardcoded 1001 and break worktree ownership.
20. As an operator, I want the recipe written to the path `relay.config.ts` already defaults to, so that the two files agree without an edit.
21. As an operator of a polyglot repo, I want a documented precedence rather than a refusal, so that I get a starting recipe and edit one `FROM` line if it guessed wrong.
22. As an operator of a repo in none of the three languages, I want init to write no recipe and tell me where to write one, so that I am not handed a recipe for a toolchain I do not use.
23. As an operator, I want init to tell me which template it chose and why, so that I can tell at a glance whether detection got it right.
24. As an operator re-running init on a half-set-up repo, I want the missing file written and the existing one left alone, so that recovering from a partial setup is one command.
25. As an operator who hand-tuned my **sandbox recipe** for CI parity, I want init never to overwrite it, so that my edits cannot be silently reverted.
26. As an operator, I want each file reported as written or kept, so that a re-run tells me what it actually did.
27. As an operator, I want init to leave my files unstaged and uncommitted, so that I review and commit them myself.
28. As an operator, I want init to refuse before writing anything when I am not in a git repo, so that a mistyped directory does not sprout a config.
29. As an operator, I want init to refuse when the remote is not GitHub, so that I do not get a config that can never work under relay's GitHub-only architecture.
30. As an operator, I want that refusal to be exit code 2, so that it matches every other relay setup failure.
31. As an operator, I want init never to touch `docs/agents/issue-tracker.md`, so that the **tracker doc** stays the human-owned, human-maintained file it is.
32. As an operator, I want init never to create labels, so that my repo's label vocabulary stays mine.
33. As an operator, I want init to print the labels I still have to create, so that I know the manual step exists.
34. As an operator, I want init to print that `GH_TOKEN` is still mine to provision, so that the one step nothing can automate is not the one step I forget.
35. As an operator, I want init to end by naming `relay doctor` as the next command, so that verification is discoverable without reading the migration doc.
36. As an operator, I do not want init to run doctor for me, so that a bootstrap command does not spend minutes building a Docker image I did not ask it to build.
37. As an operator, I want init to exit 0 when it wrote what it could, so that a successful bootstrap is not reported as a failure because a token I have not provisioned yet is missing.
38. As a maintainer, I want `init` handled by `parseArgs` as a reserved positional beside `doctor`, so that the flagless CLI keeps one shape.
39. As a maintainer, I want init's per-file verdicts available as data rather than only as printed text, so that its behaviour is testable without scraping stdout.
40. As a maintainer, I want the three templates shipped as resources beside relay's prompts, so that they travel with the published package like every other data file.
41. As a maintainer, I want git reached through an injectable runner, so that init's tests fake it the way the **doctor** tests already fake `docker` and `gh`.
42. As an operator following the migration checklist, I want its first steps replaced by `relay init`, so that the doc and the tool do not disagree about how a repo is set up.

## Implementation Decisions

### The new module

One new module, `src/init.ts`, shaped after `src/doctor.ts`:

- `runInit(options)` — performs the bootstrap, prints the report, returns an `ExitCode`.
- A planning/execution function returning the per-file verdicts as structured data, the way `runDoctorChecks` returns `DoctorCheck[]`. Each verdict names the file, an outcome of written / kept / skipped, and a human-readable detail.

Options carry an overridable `repoRoot` (defaulting to `process.cwd()`) and an injectable git runner, matching `DoctorOptions`.

### Git access

A `GitRunner` type in the same shape as the existing `DockerRunner` and `GhRunner` — takes an argument list, returns trimmed stdout, wraps failures in a relay error. It answers two questions: the `origin` remote URL, and the default branch via `origin/HEAD` with a current-branch fallback.

`branchExists` in `src/sandbox.ts` shells out to `git` un-injected and is not part of this change; `GitRunner` is where it should eventually move.

### The guard

Before any write: the directory must be a git repo, and its `origin` remote must be a GitHub URL (ssh or https). Either failure is a `ConfigError`-class refusal, exit code 2, nothing written. This mirrors the config schema's strictness, whose stated reason is that a half-migrated repo should not start a **pass**.

### Language detection

Fixed precedence, first match wins:

| Marker | Language | Base image |
| --- | --- | --- |
| `pom.xml` | Java | `maven:3-eclipse-temurin-21` |
| `pyproject.toml` | Python | `ghcr.io/astral-sh/uv:python3.12-trixie` |
| `package.json` | Node | `node:lts` |

Java first because a Maven repo carrying a `package.json` for lint tooling is common and the reverse is not. No match means no **sandbox recipe** is written and the report says where to write one.

### The three templates

Three self-contained files shipped under relay's resources directory, read through the existing `resourcePath` / `readResource` helpers. Each is the operator-supplied kipu devcontainer recipe — the language base, the shared apt block (`curl`, `wget`, `git-all`, `unzip`, `ca-certificates`, `jq`, `sudo`), the `airuser` / `agents` user with passwordless sudo, and the `org.opencontainers.image.source` label — with two changes:

1. The user block takes `ARG AGENT_UID` / `ARG AGENT_GID` and creates `airuser` with those, instead of hardcoding 1001 or leaving the uid unpinned. Relay passes both on every build. The group-reuse guard from the current reference recipe is kept, because low gids such as macOS's `staff` (20) often already exist in a base image.
2. A relay stanza adds `gh`, the `docker` CLI (client only — the daemon is the host's, reached over the mounted socket), and the native `claude` install.

The templates are self-contained by decision, accepting that the relay stanza is triplicated: each file is meant to be read and edited as a whole by the repo that owns it. `docs/relay.Dockerfile` remains the reference recipe and should stay consistent with them.

Two details to settle during implementation rather than by guess:

- Whether the image must supply an idling `ENTRYPOINT` itself or sandcastle provides one. The current reference recipe ends `ENTRYPOINT ["sleep", "infinity"]` and `src/docker-host.ts`'s comments assume the image idles; confirm against the sandcastle source before finalising the templates.
- The pinned `gh` version and node major, following the reference recipe's existing `ARG` approach.

### The written config

`relay.config.ts` is written with `greenGate` and `defaultBranch` only — every other field has a default and an init that writes defaults back out would freeze them. The detected gate carries a comment marking it as detected and asking for confirmation.

### The green-gate sentinel

An exported constant in `src/config.ts`. The schema rejects it with a message naming init as its origin and telling the operator to fill the gate in. Because the rejection is in the schema, both `loadConfig` and **doctor**'s config check report it with no further work — doctor gains no new check.

Gate detection: `pom.xml` → a Maven verify command; `pyproject.toml` → a `uv`-run pytest command; `package.json` → the first present of the `verify`, `ci`, `test` scripts, run through `npm run`. Anything else, or a `package.json` with none of those scripts, yields the sentinel.

### CLI

`parseArgs` gains `{ kind: "init" }` for the `init` positional; `CliHandlers` gains `runInit()`. Work items are issue numbers, so the reserved keyword cannot collide with one.

### Exit codes

`0` when init wrote what it could — including when it wrote nothing because everything was already there, and including when the green gate came out as the sentinel, since that is a reported outcome rather than a failure. `2` for the guard refusals and for a write that fails.

### Documentation

`docs/migrating-a-repo-to-relay.md` is rewritten around init: its steps 1–3 become `relay init` plus "confirm the detected green gate", leaving the tracker doc, labels, token, and verify as the human steps. The **tracker doc** stays a manual copy.

## Testing Decisions

A good test here asserts what an operator observes — which files exist afterwards, what they contain, what verdicts came back, what exit code was returned — and never how init decided. Detection is exercised by putting a real `pom.xml` or `package.json` in a temporary directory and checking which recipe landed, not by calling a detector directly.

Prior art to follow closely:

- `tests/doctor.test.ts` — the model for this whole suite: an `mkdtemp` repo root built per case, injected fakes recording their calls, assertions against the returned structured verdicts rather than stdout, plus a couple of cases through the printing entry point for the exit code.
- `tests/config.test.ts` — real config files written into a temp root and loaded, which is exactly how init's written config should be verified: write it with init, load it with `loadConfig`, assert the round trip.
- `tests/resources.test.ts` — the pattern for asserting a shipped resource resolves and reads.
- `tests/cli.test.ts` — `parseArgs` and `runCli` cases, extended for `init`.

Modules under test and what each suite owns:

- **`src/init.ts`** (new suite) — detection precedence including the polyglot case; the no-match case writing no recipe; `defaultBranch` from `origin/HEAD` and its fallback; both guard refusals writing nothing and returning exit 2; the keep-don't-overwrite behaviour for each file independently; verdicts reported for both written and kept; the sentinel path; that nothing is staged or committed.
- **`src/config.ts`** (existing suite) — the sentinel is rejected with a message naming init; a real detected gate still loads.
- **`src/doctor.ts`** (existing suite) — a config carrying the sentinel surfaces as a failed config check.
- **`src/cli.ts`** (existing suite) — `init` parses to the init command and dispatches to the handler; exit code propagates.

The strongest single test is the round trip: run init in a temp repo containing only a `package.json`, then `loadConfig` the result and assert the gate and branch. It proves detection, writing, and schema validity in one, at the highest seam, without asserting on file contents as text.

The templates themselves are asserted only for the properties relay depends on — that each declares `AGENT_UID` and `AGENT_GID` build arguments and installs `gh`, `docker`, and `claude`. Whether they build is not a unit test; that is what `relay doctor` is for.

## Out of Scope

- **Label creation of any kind.** Init does not create, check, or read labels. The four stay a human step in the migration checklist.
- **The silent empty frontier.** `gh issue list --label <nonexistent>` exits 0 with an empty list, so a repo where nobody created `ready-for-agent` reports nothing to do and exits 0 forever. Verified against this repo, which has the stock labels and no `ready-for-agent`. Deliberately left alone; a **doctor** label check was considered and rejected for this effort.
- **Touching `docs/agents/issue-tracker.md`.** Human-owned. Init neither writes nor validates it.
- **Interactive prompts and flags.** Rejected in favour of detect-and-confirm; the CLI stays flagless.
- **Running doctor from init.** Different job, and doctor builds the image.
- **Staging or committing.** Init leaves the working tree for the operator.
- **Provisioning `GH_TOKEN`.** A fine-grained PAT is browser-only; init prints the requirement.
- **A prebuilt `image` path.** Init always writes a recipe for a detected language; a repo using a prebuilt image ref edits the config afterwards.
- **Making `branchExists` use `GitRunner`.** Noted, not done.
- **Templates beyond the three.** Java, Python, Node only.

## Further Notes

Init and **doctor** are deliberately complementary and deliberately separate: init mutates the working tree and answers "what should this repo have?", doctor touches nothing and answers "is this repo ready?". The handoff between them is one printed line.

The detected-but-wrong green gate is the acknowledged limit of this design. A repo whose real gate is `npm run verify` but which also has a `test` script that passes trivially will get a plausible config that no machine can fault. The comment in the written config is the whole mitigation, and that is a deliberate trade: the alternative — a prompt with a pre-filled default — produces the same wrong value with more false confidence.

This repo is itself un-bootstrapped for relay: `miwurster/relay` carries the nine stock GitHub labels and no `ready-for-agent`. It makes a fair first target for the finished command.
