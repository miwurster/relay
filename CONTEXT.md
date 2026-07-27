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
A kind of **leg**: **gate resolver**, planner, implementer, reviewer, fixer, **green gate**, handover.
A role is a prompt, a model, a tagged answer, and a rule about what it may leave on the branch.
_Avoid_: agent, worker, actor

**Crew**:
The seven **roles** one pass runs, as one interface.
_Avoid_: pipeline, team, orchestrator

**Lens**:
One of the reviewer's four configurations — fast or in-depth, code or spec.
A lens is not a **role**; the harness passes it to the one reviewer role.
Known wart: the model map is keyed per lens for the reviewer and per role for everyone else.
_Avoid_: review type, review mode

## The work

**Work item**:
The one tracker issue a **pass** runs over, and the only thing the **eligibility check** gates.
_Avoid_: issue, story, task

**Ticket**:
One unit of the **plan**, and the thing one implementer **leg** runs over.
A ticket is one of the **work item**'s sub-issues, and carries its issue number.
It is pass-local and ephemeral — nothing about it is written back, and a work item with no sub-issues is its own single ticket.
_Avoid_: subtask, item, unit

**Plan**:
The planner's answer: **tickets** in dependency order, or a refusal to start on an under-specified **work item**.
_Avoid_: backlog, task list

**Review scope**:
What a **lens** reads: one **ticket**'s own change from the commit it started at, or the whole branch from the default branch.
_Avoid_: diff range, target

**Finding**:
One thing a **lens** or the **green gate** wants changed, stamped with its source and the **ticket** it is about.
_Avoid_: issue, comment, remark

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

**Provenance**:
Where a **gate resolver**'s answer came from: `declared` when a doc named it, `inferred` when the resolver fell back to the manifest.
It is on the record of every **pass** — the **handover** names it, and the **doctor** warns on an inferred gate before a pass ever runs — because an inferred gate is a command no human chose.
_Avoid_: source, origin, confidence

**Handover**:
The pass's last **leg**: it publishes the branch as a pull request when the **outcome** is owed one, and tells the human what state the work is in.
Every outcome reaches it — no path skips the handover.
_Avoid_: finalize, wrap-up, publish

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
GitHub has no priority field, so humans steer by when they apply the ready label.
A prefilter only — every candidate still faces the **eligibility check**.
_Avoid_: queue, backlog, inbox

**Eligibility check**:
The gates a **work item** must pass before relay will run over it: ready label, not already **held**, still open, no **open blocker**.
The same check decides both auto-pick and an explicitly named item, so the two can never disagree.
_Avoid_: selection gate, filter, guard

**Open blocker**:
A GitHub issue dependency of a **work item** that is not itself closed.
relay filters for open itself, because GitHub's blocked-by count includes closed blockers.
_Avoid_: blocked by, dependency

**Held**:
A **work item** carrying the `agent-in-progress` label, which the planner applies and the **handover** replaces.
A held item is ineligible, so a crashed **pass** leaves the work visibly claimed rather than silently free.
_Avoid_: locked, assigned, in progress

**Tracker doc**:
The repo's committed `docs/agents/issue-tracker.md`, which carries the repo's own tracker conventions and is what the tracker-facing **roles** are told to read first.
relay hardcodes GitHub itself and nothing beyond it: which repo the issues live in comes from the git remote, since a repo owns its own issues.
_Avoid_: tracker config, issue config

**Sandbox**:
The one container and git worktree a **pass** runs in, on its own **pass branch**.
The container is disposed of whatever happens; the worktree is disposed of on a clean exit.
Every **leg** of the pass runs inside it.
_Avoid_: container, environment, workspace

**Pass branch**:
The branch one **pass** commits to, cut from the repo's default branch.
relay never reuses, resets or deletes one.
_Avoid_: agent branch, feature branch

**Skill plugin**:
An installed Claude plugin whose skills a **role** runs, bind-mounted from the operator's own installation rather than baked into the sandbox image.
_Avoid_: extension, tool pack

**Tagged block**:
The `<tag>…</tag>` block a **role** ends its run with, holding the JSON answer the harness reads.
The last block wins — a role that corrected itself means the correction.
_Avoid_: output block, response payload

**Init**:
The one-off bootstrap that writes a repo's `relay.config.ts` and **sandbox recipe** from what it can detect, and names what is left to a human.
It only ever writes those two files: it never touches the **tracker doc**, never creates labels, and never overwrites, so re-running it fills gaps rather than undoing hand-tuning.
It has no say in the **green gate** — that is the repo's docs' to declare and the **gate resolver**'s to read — so init names declaring it as one of the human steps left.
_Avoid_: bootstrap, setup, scaffold

**Sandbox recipe**:
The target repo's committed Dockerfile for the **sandbox**, which relay builds when no prebuilt image is configured.
The repo owns it, because only the repo knows what its **green gate** needs — relay only requires the tooling a **pass** itself uses, and passes the host's UID and GID in as build arguments.
_Avoid_: sandbox dockerfile, image recipe

**Doctor**:
The opt-in preflight that runs every setup check eagerly and reports them all, rather than failing on the first.
A check it could not reach is skipped rather than failed, and one it can only warn about is a **warning**, which does not fail the run.
_Avoid_: healthcheck, diagnostics

**Warning**:
A **doctor** check whose setup relay can run against but had to guess at — today, an `inferred` **provenance**.
It prints apart from ok and from failed and leaves the exit code alone, because a gate no doc declares is imperfect, not broken.
_Avoid_: soft failure, notice

**Gate probe**:
How **doctor** answers what a **pass** would verify with, without being a pass: it opens a **sandbox**, runs the **gate resolver** in it, and takes both the sandbox and its own branch back down.
That branch is named off the configured prefix rather than numbered, so it is never a **pass branch** — which is what lets the probe delete it, the one exception to relay never deleting a branch.
_Avoid_: gate check, doctor pass
