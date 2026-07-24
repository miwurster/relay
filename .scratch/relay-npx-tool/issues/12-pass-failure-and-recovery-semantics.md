# Pass failure and recovery semantics

Type: grilling
Status: resolved
Blocked by: 07

## Question

What happens when a single pass fails partway — crash, infra fault, or a role that can't finish — now that the topology (ticket 07) is fixed?

Ticket 07 settled the happy-path graph (harness-owned loop, one sandbox/branch, per-role cold sessions sharing files+git) and the *planned* escalations (under-spec early bail, exhausted-cap mid-block → ticket 05 endpoints). This ticket covers the **unplanned** exits.

Decide:

- **Crash mid-pass** (a `sandbox.run` throws, Docker dies, host killed): does the pass leave the branch + partial commits for the human, and what does it write to Jira / exit with? Is anything cleaned up, or is the sandbox left for inspection?
- **Resume vs restart**: is a re-run of the same work item a clean restart (fresh branch/sandbox) or does it resume from existing commits on the branch? The map says one pass hands to a human — is resume even in scope, or does every invocation start clean?
- **Needs-input mid-pass**: can a role legitimately pause for human input, or does "can't proceed" always collapse into the ticket 05 mid-block handover (Draft MR + `agent-blocked`, exit 1)? (Leaning: always mid-block; no interactive pause — relay is one autonomous leg.)
- **Idempotency of Jira transitions**: if a pass crashes after In Progress but before In Review, what state is the item left in, and does a re-run tolerate an already-In-Progress item?

Depends on ticket 07 (topology).

## Answer

Resolved by grilling (2026-07-24). Every invocation is a **clean restart** — no resume, no cross-pass state; the human is the recovery mechanism. The unplanned exits fold into ticket 05's exit vocabulary; no new "paused" state exists.

### Resume vs restart — clean restart, always

- Every invocation starts fresh: new sandbox, fresh plan over the item's current tickets. relay **never** resumes a crashed pass from existing commits. Resume would need a durable cross-pass progress ledger (which tickets done, commit-to-ticket map, gate state); ticket 07 deliberately keeps all handoff **ephemeral** (files + git + `OUTPUT_DIR`), and resume contradicts the map's "one autonomous leg, hand to a human" thesis.
- A crashed pass leaves its **branch + partial commits** on the host for the human. The human inspects / fixes / discards, then re-runs clean over whatever they left. That *is* the recovery path.
- **Branch collision** (target branch already exists from a prior crashed pass): relay **refuses and exits 2** — it never deletes or resets commits it did not create this pass (may hold human inspection state). Human clears the branch (`git branch -D`) before re-running. Chosen over auto-reset: safety over zero-touch.

### Crash mid-pass — exit 2, best-effort Jira, dispose

- A `sandbox.run` throw / Docker death / host kill is an **unplanned** exit, distinct from the planned escalations. Exit code **2** (error/infra class, same bucket as config/auth per ticket 05) — separates crash (relay itself broke) from mid-block (relay ran correctly, work legitimately can't finish → exit 1, Draft MR).
- **No MR** opened. Item is left **In Progress** (no clean deliverable to move to In Review or Draft). On a *catchable* crash, write a **best-effort Jira failure comment** naming the failed role. On a SIGKILL / Docker-died crash no cleanup code runs → no comment, item simply stuck In Progress; the re-run + human handle it.
- **Sandbox: always dispose, never leave running for inspection.** Progress lives in host-side git commits (ticket 07), not container state; a leaked container per crash is an operational wart. Container-level debugging is a `relay doctor` / manual-repro concern, not the pass's job.

### Needs-input mid-pass — always mid-block, no pause

- A role that genuinely can't proceed without a human **never pauses interactively** — structurally impossible headless (`-p`, no TTY, no human on the other end mid-pass). It stops, writes its reason to its `OUTPUT_DIR` status file, and the pass ends **mid-block** (Draft MR + `agent-blocked` + comment naming what it needs, exit 1). The human answers by editing the ticket/branch and re-running (clean restart).
- No third "paused/waiting" state. The only "needs human" outcomes stay ticket 05's two: under-spec (planner, pre-commit, exit 1, no MR) and mid-block (post-commit, exit 1, Draft MR).

### Jira transition idempotency — In Progress is re-entrant

- The planner **ensures** the item is In Progress (not "transition Not-Started→In-Progress"): already In Progress → no-op, proceed. This is the normal re-run-after-crash path and must not fail. Implement via the available-transitions list (MCP `getTransitionsForJiraIssue`) — if the target status isn't offered because the item is already there, skip silently. Same at handover for In Review.
- relay **never assumes a clean Not-Started start**. It tolerates the mid-flight statuses relay itself sets.
- This does **not** relax ticket 03's selection guards: auto-pick's frontier JQL already excludes In Review / Done (only `ready-for-agent` Story/Bug/Vuln); an explicit key pointing at an already-In-Review/Done item is rejected by the planner's gates (exit 2). Idempotency applies to relay's own In Progress / In Review transitions, not to bypassing selection.

### Deltas to already-resolved tickets

- **Ticket 05** (handover/exits): the exit-2 error bucket gains two concrete triggers — **crash mid-pass** and **branch collision** — alongside config/auth/Task-as-param. Crash also defines a new outcome: item left In Progress + best-effort failure comment, no MR (distinct from every planned endpoint).
- **Ticket 06** (config/green-gate): the cheap fail-fast set gains a **branch-collision check** (target branch exists → exit 2), and `relay doctor` may surface it. Sits with config-parse + secrets as pre-run fail-fast.
- **Ticket 03 / 07** (planner): the planner's "sets In Progress" is now "**ensures** In Progress" — idempotent via the transitions list, tolerant of an already-In-Progress item from a prior crashed pass.
