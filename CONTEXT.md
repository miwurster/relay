# relay

relay runs one autonomous **pass** over a single **work item**, brings it to a reviewable state, and hands the baton to a human.

This file is the project's glossary.
It names only the terms relay coins or overloads — terms carrying their ordinary industry meaning (branch, worktree, Docker image, MCP) are left alone.

## The pass

**Pass**:
One end-to-end run of relay over a single **work item**, from selection to **handover**.
A pass is always a clean restart: it never resumes a previous one.
_Avoid_: run, session, job

**Leg**:
One run of one **role** inside a pass, and the unit of work handed from role to role.
Every leg is a **cold session** over the shared worktree.
Legs run strictly one after another — they share that worktree, so two at once would race on its refs.
_Avoid_: step, stage, phase

**Cold session**:
A fresh agent process that inherits no conversation from the leg before it.
Legs share only the worktree's files and git history, so anything one leg must tell the next is committed, written to a file, or returned as a small value.
_Avoid_: subagent, child agent

**Role**:
A kind of **leg**: **gate resolver**, planner, implementer, reviewer, fixer, **green gate**, **lander**, handover.
A role is a prompt, a model, a tagged answer, and a rule about what it may leave on the branch.
_Avoid_: agent, worker, actor

**Crew**:
The **roles** one pass runs, as one interface.
Seven of them always, and the **lander** as an eighth when the repo's **landing** is `merge`.
_Avoid_: pipeline, team, orchestrator

**Leg record**:
What one **leg** leaves on the host for a human to read: its status, the **findings** a reviewer leg reported, and the **verdicts** a fixer leg gave them.
A file per leg, never a shared one, so every file is attributable to the leg that wrote it.
It lives on the host rather than in the **sandbox**'s worktree, because that worktree is disposed of once the **pass** ends ([ADR-0003](docs/adr/0003-a-crashed-pass-leaves-the-work-for-a-human.md)).
A **pass** records under `.relay/<work item>`; the **gate probe** records under `.relay/doctor`.
Its sibling in that directory is the **pass record**, which belongs to no leg.
_Avoid_: output, artefact, hand-off

**Pass record**:
The **pass**'s own facts, as against a **leg record**, which is one leg's: which **work item** over which branches, the repo's **landing**, when it ran, and how it ended — either the **outcome** with everything the harness worked out beside it, or the error that ended it.
The harness's, so there is no leg to keep it next to: every fact in it is derived as the legs run and readable off none of their records afterwards ([ADR-0035](docs/adr/0035-a-pass-records-its-own-facts.md)).
A crashed pass records that it crashed and states the rest as unknown, rather than recording a **gate verdict** nobody asked for.
_Avoid_: pass status, run metadata, summary

**Archive**:
Everything relay knows about one **pass**, as a single file: the **pass record**, the **leg records** rendered as a digest, the **pass branch**'s diff, and every leg's transcript whole.
Made for judging the flow long after the pass, by a human or by a model, which is why it is one file rather than a directory and why every section is present even when empty.
Written unasked at the end of every pass, because a leg's transcript is named after the pass branch alone and the next pass over that **work item** overwrites it — and written again on demand by `relay archive`.
It infers nothing: what the pass did comes from the pass record, what each leg did from the leg records, what the legs said from their transcripts, and what came of it from git.
_Avoid_: log, dump, report, postmortem

## The work

**Work item**:
The one tracker item a **pass** runs over, and the only thing the **eligibility check** gates.
A **spec**, a **ticket**, or any other issue a human filed — relay asks only whether it is specified enough to plan.
A GitHub issue today, which is why the tracker-neutral word is the one relay uses for the role.
_Avoid_: story, task

**Spec**:
A **work item** that describes wanted behaviour, normally written by a `to-spec` run.
_Avoid_: "the spec" for whatever a work item asked for, which is the **axis**'s question and not this

**Ticket**:
One unit of the **plan**, and the thing one implementer **leg** runs over.
A ticket is one of the **work item**'s sub-issues, and carries its issue number.
Normally written by a `to-tickets` run, slicing a **spec** into tracer-bullet deliverables.
A work item with no sub-issues is its own single ticket.
What a pass writes back to a ticket is its state and nothing else — the implementer marks the one it is on, and the **handover** records what the pass earned ([ADR-0026](docs/adr/0026-the-handover-writes-ticket-state.md)).
_Avoid_: subtask, item, unit

**Finished ticket**:
A **ticket** the pass committed that carries no **unaddressed finding** that is **binding**, and the only kind the **handover** records as done.
The **harness**'s fact rather than a leg's judgement, because a ticket counts as committed from the moment its implementer returns — before its review runs, so a **blocked** pass's committed tickets include the one it blocked on.
Binding rather than any finding, because a pass lands with the non-binding ones overridden: on a `success` every committed ticket is finished, and on a **blocked** pass the difference is the ticket it blocked on.
_Avoid_: done ticket, completed ticket, clean ticket

**Tick**:
What the **handover** does to a **ticket**'s checkboxes: every unchecked box in the body of a **finished ticket**, or none of them.
A claim that the branch satisfies the ticket, never a verification of one criterion at a time — the **green gate** and the reviews are what a tick rests on, and neither answers box by box.
_Avoid_: check, complete, mark done

**Ready label**:
`ready-for-agent`, a human's offer of a **work item** to relay, and what the **frontier** and the **eligibility check** both read.
Consumed by the **pass** that acts on it: the **handover** strips it from the work item and from every **ticket** it writes, so re-offering the work is a human's act ([ADR-0025](docs/adr/0025-the-ready-label-is-consumed-by-the-pass-that-acts-on-it.md)).
An `early-bail` consumes nothing and leaves it alone.
_Avoid_: ready flag, agent label, opt-in label

**Plan**:
The planner's answer: **tickets** in dependency order, or a refusal to start on an under-specified **work item**.
_Avoid_: backlog, task list

**Review scope**:
What one review reads: one **ticket**'s own change from the commit it started at, the whole branch from the **base branch**, or that same branch on the **quality review**'s rubric.
It is the only thing that differs between the reviewer's runs, so it is also what names each one, what picks its model, its prompt, which **axes** it is asked for — a ticket both, the quality scope `quality`, and the whole branch whichever set the **harness** handed it — and the shape it answers in.
It carries what a run has to be told beyond that too: the **findings** the **re-review** is verifying, and the **settled findings** the **quality review** must not silently reverse.
The branch scope reads `spec` alone where every **ticket** was already read on `standards` by its own review, and both axes where no ticket review ran at all — which is the one-ticket **plan**, whose per-ticket review is dropped because no ticket follows the one it would read ([ADR-0031](docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
Three scopes, one **role**: a review is one read-only run over a diff ending in a finding per thing it wants changed, however wide the question ([ADR-0027](docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
_Avoid_: diff range, target, lens

**Quality review**:
The **review scope** that asks whether the branch's implementation is worth keeping, once the **spec** question is settled.
It judges against a vendored third-party rubric rather than this repo's own conventions, and unlike the other two scopes it is not bounded by the diff — a remedy may name code the change never touched, though a problem the change did not cause is not its to raise.
It runs whenever the branch scope did not block, including after a fix, because a branch that was just patched is the likeliest to be structurally messy.
Being last, it is handed the pass's **settled findings**, and may overrule one only by naming what it overrules and why ([ADR-0034](docs/adr/0034-the-quality-review-is-told-what-the-pass-already-settled.md)).
Its **findings** carry the `quality` **axis**, reach one **fixer** leg, and are verified by nothing but the **green gate** ([ADR-0027](docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
_Avoid_: code review, deep review, maintainability review, quality role

**Re-review**:
The run that verifies the branch review's fix, when that fix changed something.
It is handed the **findings** the **fixer** said it fixed and asks one question of each: does the branch now do what that finding asked?
Not the branch review again — a second read of the branch would find its first new findings in the fixer's own commit, and nobody is left to fix those ([ADR-0032](docs/adr/0032-the-re-review-verifies-the-fix-it-was-handed.md)).
Exactly one, never a loop, and report-only: there is no fixer after it, so its findings block if they are **binding** and are reported and landed if they are not ([ADR-0022](docs/adr/0022-a-fix-is-verified-once.md)).
It exists because the **green gate** that runs next is objective, so without it a fix could address the wrong half of what was asked and still land green.
_Avoid_: recheck, second pass, verification

**Finding**:
One thing a review or the **green gate** wants changed, stamped with its source, its **axis** and the **ticket** it is about.
A review finding carries an axis; the green gate's carries none.
_Avoid_: issue, comment, remark

**Axis**:
Which question a **finding** answers: `standards`, whether the change follows this repo's own documented conventions; `spec`, whether it built what the **work item** asked for; or `quality`, whether the implementation is structurally worth keeping, judged by the **quality review** against a rubric wider than this repo's conventions.
`spec` is the `code-review` skill's name for that axis, which resolves the spec to the originating issue where no document exists — so the axis asks its question of any **work item**, whether or not that item is a **spec**.
They do not weigh the same — a `spec` finding is **binding** and the other two are not.
A problem both `standards` and `spec` name is a `spec` finding: the stricter axis wins, because filing it under the other would quietly drop the part that stops a **pass**.
`quality` cannot collide with `standards` that way, because no one **leg** is asked for both.
_Avoid_: category, kind, dimension

**Binding**:
A **finding** the **pass** may not land without addressing.
Spec findings are binding and the other axes' are not, because a branch that does not do what was asked is worse to land than one that landed with a standards or a quality call overridden ([ADR-0021](docs/adr/0021-spec-findings-are-binding.md)).
The **fixer** still decides whether code changes; whether a finding nobody addressed stops the pass is the **harness**'s.
_Avoid_: mandatory, blocking, required

**Verdict**:
What the **fixer** did with one **finding**: fixed, or skipped with a reason.
One per finding and never one per **leg**, and on the **leg record** either way — so declining is a report rather than a veto, and a **binding** finding nobody addressed stops the pass on the sentence the fixer wrote.
_Avoid_: decision, disposition, outcome

**Settled finding**:
A **finding** an earlier review raised and a **fixer** acted on, whose remedy is now on the branch as a decision rather than as a suggestion.
_Avoid_: applied finding, landed fix, prior finding

**Unaddressed finding**:
A **finding** nobody acted on, and why: one the **fixer** declined, or one the **re-review** raised, which by design reaches no fixer.
Every one of them reaches the **handover** — a green pass names how many, a blocked pass names them all.
_Avoid_: ignored finding, leftover, open finding

## Finishing

**Green gate**:
The repo's own command whose exit code decides whether the branch is green, and the **role** that runs it and triages a red result.
Green means every check the repo judges a branch on — static analysis as much as tests — not tests alone.
The command is never configured: the **gate resolver** reads it from the repo's docs, so what relay verifies with and what the docs tell a contributor to run are the same sentence.
relay never parses the command's output, and has no opinion on what the command covers.
_Avoid_: quality gate, CI check, test gate

**Gate resolver**:
The **pass**'s first **leg**: it reads the repo's own docs and answers with the **green gate** command, once, for every attempt of that pass.
It never blocks — a gate no doc declares is inferred from the build manifest instead, and the answer carries its **provenance** either way.
_Avoid_: gate detection, gate config, gate lookup

**Gate verdict**:
What a **pass** verified with and what the **green gate** said about it, or that the pass blocked before the gate ran.
It carries the command and its **provenance** on both counts, because the **gate resolver** runs first: a pass that never reached its gate still knows what it would have run.
The **handover** is told it, and names it in its report and in the resolution comment — the one fact about the gate no other leg can tell a human.
_Avoid_: gate result, gate status, test result

**Provenance**:
Where a **gate resolver**'s answer came from: `declared` when a doc named it, `inferred` when the resolver fell back to the manifest.
It is on the record of every **pass** — the **handover** names it, and the **doctor** warns on an inferred gate before a pass ever runs — because an inferred gate is a command no human chose.
_Avoid_: source, origin, confidence

**Handover**:
The pass's last **leg**: it publishes what the **landing** and the **outcome** owe, names what the pass left as an **unaddressed finding**, and tells the human what state the work is in.
Every outcome reaches it — no path skips the handover.
It is the only role that writes what a pass *earned* — a **tick**, a close, the **ready label** stripped — so closing a **ticket** is its act and never the **lander**'s.
The two writes before it claim nothing: the planner **holds** the work item and the implementer marks the ticket it is on.
It publishes only what relay hands it — the **finished ticket** list, what the **lander** did, the **gate verdict**, the findings left unaddressed — and infers none of it: a fact this leg has to work out for itself is one it can get wrong in the pass's most durable words.
_Avoid_: finalize, wrap-up, publish

**Landing**:
How a repo's passes deliver a green branch: `pull-request`, where a human merges and closes, or `merge`, where the **lander** puts the work on the **base branch** and the **handover** closes what landed.
The repo's to declare and required to declare — relay has no default, because a landing nobody chose is a base branch nobody agreed to move ([ADR-0015](docs/adr/0015-a-repo-declares-how-a-pass-lands.md)).
A `merge` repo never opens a pull request, blocked or not.
_Avoid_: mode, strategy, merge mode

**Lander**:
Under `merge` **landing**, the **leg** between the **green gate** and the **handover**: it rebases the **pass branch** onto the **base branch**, or merges on conflict, and the **harness** re-runs the green gate on the result before the base branch moves.
It only ever moves the pass branch, so the host's move is always a fast-forward and the base branch can only go forward ([ADR-0017](docs/adr/0017-the-lander-rebases-and-the-host-only-fast-forwards.md)).
It writes no tracker state and closes nothing.
_Avoid_: merger, integrator, merge agent

**Outcome**:
How a pass ended, and therefore which **handover** it gets: `success`, `mid-block`, or `early-bail`.
_Avoid_: status, result

**Blocked**:
A pass that stopped short of green — `mid-block` after work started, or `early-bail` when the planner refused an under-specified **work item**.
Exit code 1.
Never used for the tracker relation; that is an **open blocker**.
_Avoid_: failed, stuck, paused

## Selection and setup

**Frontier**:
This repo's eligible **work items**, longest-waiting first.
GitHub has no priority field, so humans steer by when they apply the **ready label**.
A prefilter only — every candidate still faces the **eligibility check**.
_Avoid_: queue, backlog, inbox

**Eligibility check**:
The gates a **work item** must pass before relay will run over it: the **ready label**, not already **held**, still open, no **open blocker**.
The same check decides both auto-pick and an explicitly named item, so the two can never disagree.
_Avoid_: selection gate, filter, guard

**Open blocker**:
A GitHub issue dependency of a **work item** that is not itself closed.
relay filters for open itself, because GitHub's blocked-by count includes closed blockers.
_Avoid_: blocked by, dependency

**Held**:
A **work item** carrying the `agent-in-progress` label, which the planner applies and the **handover** replaces.
A held item is ineligible, so a crashed **pass** leaves the work visibly claimed rather than silently free.
Only a **work item** is ever held: the same label on a **ticket** says an implementer **leg** is on it and gates nothing, because a ticket relay stripped the **ready label** from is already ineligible.
_Avoid_: locked, assigned, in progress

**Tracker doc**:
The repo's committed `docs/agents/issue-tracker.md`, which carries the repo's own tracker conventions and is what the tracker-facing **roles** are told to read first.
Never relay's to write: it belongs to the repo a **pass** runs against.
It owns how a tracker operation is invoked, never what the graph is — the tickets under a **work item** are its GitHub sub-issues and its blockers are its GitHub issue dependencies, whatever a doc calls them ([ADR-0028](docs/adr/0028-the-tracker-doc-owns-invocation-relay-owns-the-graph.md)).
relay hardcodes GitHub itself and nothing beyond it: which repo the issues live in comes from the git remote, since a repo owns its own issues.
_Avoid_: tracker config, issue config

**Forge**:
Where the code lives, as against the tracker, where the work is described — the remote, the branches, the pull requests.
GitHub is both for relay, and the two are still distinct: a **pass** publishes to the forge itself, and reads the tracker the way the **tracker doc** says to ([ADR-0028](docs/adr/0028-the-tracker-doc-owns-invocation-relay-owns-the-graph.md)).
_Avoid_: remote, host, SCM

**Sandbox**:
The one container and git worktree a **pass** runs in, on its own **pass branch**.
The container is disposed of whatever happens; the worktree is disposed of on a clean exit.
Every **leg** of the pass runs inside it.
_Avoid_: container, environment, workspace

**Base branch**:
The one branch a **pass** is cut from, reviewed against, reported against and lands on, read from the host repository's checkout at pass start.
Never configured: a config value detected once and the branch an operator actually stands on drift apart, and merge **landing** cannot survive them disagreeing ([ADR-0016](docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)).
A detached or unborn HEAD is refused rather than fallen back on.
_Avoid_: default branch, target branch, trunk

**Pass branch**:
The branch one **pass** commits to, cut from the **base branch**.
relay never reuses, resets or deletes one, and rewrites one only where the **lander** rebases it.
_Avoid_: agent branch, feature branch

**Skill plugin**:
An installed Claude plugin whose skills a **role** runs, bind-mounted from the operator's own installation rather than baked into the sandbox image.
_Avoid_: extension, tool pack

**Vendored rubric**:
A third party's review rules, copied verbatim into relay's own resources and carried into a **role**'s prompt as an argument.
Not a **skill plugin**: nothing relay ships is visible from inside the **sandbox**, whose worktree is the target repo's, so the prompt inlines it rather than the leg loading it.
Its body is never edited — an upstream change is taken by re-vendoring — and everything that adapts it to relay lives in the prompt that carries it ([ADR-0027](docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
relay authors no rubric of its own.
_Avoid_: bundled skill, forked skill, inlined skill

**Tagged block**:
The `<tag>…</tag>` block a **role** ends its run with, holding the JSON answer the harness reads.
The last block wins — a role that corrected itself means the correction.
_Avoid_: output block, response payload

**Init**:
The one-off bootstrap that writes a repo's `.relay/config.ts`, **sandbox recipe** and **credential file** example from what it can detect, creates the label vocabulary the repo is missing, and names what is left to a human.
It writes the credential example but never the **credential file**, because pasting a token in is the one step it cannot take for an operator — so that is what it names as remaining.
It never touches the **tracker doc** and never overwrites — an existing file is kept and an existing label is left with the colour and description its maintainers gave it — so re-running it fills gaps rather than undoing hand-tuning ([ADR-0011](docs/adr/0011-init-creates-the-label-vocabulary.md)).
It has no say in the **green gate** — that is the repo's docs' to declare and the **gate resolver**'s to read — so init names declaring it as one of the human steps left.
_Avoid_: bootstrap, setup, scaffold

**Sandbox recipe**:
The target repo's committed Dockerfile for the **sandbox**, which relay builds when no prebuilt image is configured.
It lives in the **relay directory**, because it is relay's concern rather than the repo's own application image.
The repo owns its contents, because only the repo knows what its **green gate** needs — relay only requires the tooling a **pass** itself uses, and passes the host's UID and GID in as build arguments.
_Avoid_: sandbox dockerfile, image recipe

**Relay directory**:
`.relay/` in the target repo, holding everything relay asks a repo to commit — its config, its **sandbox recipe**, the **credential file**'s example, and the `.gitignore` that keeps the credential file itself out of git.
Relay-owned on purpose: a recipe under the repo's `docker/` and a config at its root sit in namespaces the repo owns ([ADR-0013](docs/adr/0013-relay-owns-a-dot-directory-in-the-target-repo.md)).
Everything in it is committed except the **credential file** ([ADR-0014](docs/adr/0014-credentials-live-in-the-target-repo-gitignored.md)).
It holds nothing generated — a **pass**'s worktree is gitignored scratch and stays at `.sandcastle/worktrees/`.
_Avoid_: config directory, dotfolder

**Credential file**:
`.relay/.env`, holding the tokens a **pass** runs on — the operator's to write and the one file in the **relay directory** that is never committed.
Per-repo, so each repo relay runs on can carry its own token rather than one token reaching every repo on a machine.
Real environment variables win over it, so CI and one-off runs need no file at all.
**Init** writes its example and never the file, and **doctor** fails a repo whose git does not ignore it.
_Avoid_: secrets file, env file, dotenv

**Doctor**:
The opt-in preflight that runs every setup check eagerly and reports them all, rather than failing on the first.
A check it could not reach is skipped rather than failed, and one it can only warn about is a **warning**, which does not fail the run.
Each check reports as it resolves, and on a terminal a check names itself before it runs, because the deep checks open a **sandbox** and a preflight that says nothing for a minute reads as a hung one.
_Avoid_: healthcheck, diagnostics

**Warning**:
A **doctor** check whose setup relay can run against but had to guess at or would rather the operator knew: an `inferred` **provenance**, or a dirty host worktree under `merge` **landing**.
It prints apart from ok and from failed and leaves the exit code alone, because neither is broken setup — the worktree a **pass** actually refuses is the one it finds dirty at its own start.
Where a pass refuses over the same setup, what doctor warns is the pass's own refusal, so the two can never word one rule differently ([ADR-0023](docs/adr/0023-doctor-and-a-pass-share-rules-not-a-module.md)).
_Avoid_: soft failure, notice

**Gate probe**:
How **doctor** answers what a **pass** would verify with, without being a pass: it opens a **sandbox**, runs the **gate resolver** in it, and takes both the sandbox and its own branch back down.
That branch is named off the configured prefix rather than numbered, so it is never a **pass branch** — which is what lets the probe delete it, the one exception to relay never deleting a branch.
_Avoid_: gate check, doctor pass

**Sandbox probe**:
How a contributor answers whether a **sandbox** can still run a repo's Testcontainers tier against the host daemon, without being a **pass**.
It opens a sandbox over a scripted fixture repo and runs that repo's own command in it, so what it proves is the container contract rather than any **role**'s judgement.
Hand-run and outside relay's own **green gate**, because that gate runs inside a sandbox and a probe within it would nest.
_Avoid_: e2e test, smoke test, test driver, harness

**Rehearsal**:
One real **pass**, over a repo seeded to a fixed **scenario** and declaring a chosen **landing**, run to judge how the flow feels.
Unlike a **probe** it is a whole pass and spends real Claude sessions, and unlike a test it has no oracle: **roles** are non-deterministic, so what it yields is evidence for a human's judgement rather than a verdict ([ADR-0024](docs/adr/0024-the-rehearsal-runs-against-a-real-throwaway-repo.md)).
It runs against a throwaway repo of its own, never a repo anyone works in, because seeding a scenario means destroying whatever was there.
_Avoid_: e2e test, integration test, dry run, pass probe

**Genesis**:
The one fixed commit a **scenario** is seeded onto, and the whole of the **rehearsal** repo's history.
Fixed so that two rehearsals across a change to relay differ by that change and by the models' own variance and by nothing else — which is also why a **scenario** never varies it: a scenario is a tracker state, and genesis is the code that state is about.
It carries a latent defect on purpose, because a **scenario** whose **work item** is a bug report needs one to reproduce ([ADR-0030](docs/adr/0030-genesis-carries-a-latent-defect.md)).
_Avoid_: fixture, base commit, seed state

**Scenario**:
One named seeded state of the **rehearsal** repo's tracker: its **work item** and that item's **tickets**.
Named rather than implied, so a second scenario is an addition rather than a rewrite, and fixed rather than generated, so two rehearsals across a change to relay differ by the change and by the models' own variance and by nothing else.
It says nothing about how the pass over it lands: **landing** is the rehearsal's other axis, so either landing can be rehearsed over any scenario without a second entry.
_Avoid_: case, fixture, suite
