# Handover endpoint

Type: grilling
Status: resolved
Blocked by: —

## Question

Where does one pass stop, and what does it hand the human?

Decide between:

- Pushed branch + open GitLab MR (via `kipu-mr`), reflected In Review — the spike/afk endpoint.
- Local branch + worktree only, no push — the human inspects and pushes.
- Configurable.

And: what Jira state reflection happens at handover (In Review? label?), and what the run reports to the operator (URL, branch, tickets + SHAs, gate result).

## Answer

The pass ends by **pushing the branch and opening a GitLab MR via `kipu-mr`** (idempotent, tracker + ADR backlinks), mirroring the locked afk hand-off. Outcomes:

**Success** (gate green, MR opened):

- Picked work item reflected **In Review** — never Done; the human's merge drives Done.
- Post a **resolution comment** on the work item: MR URL + one-line summary of what the pass built.
- Report to operator (stdout, human-readable): outcome class, work-item key + new Jira state, MR URL, branch, each committed ticket + short SHA, gate result.
- Exit **0**.

**Nothing-to-do** (auto-pick found no eligible item): benign no-op, exit **0** (folded into success by decision, not a distinct code).

**Mid-implementation block** (gate red past fix caps / review-fix loop exhausted / unresolvable, with committed work on the branch):

- Push the branch and open a **Draft MR** — preserves the work against ephemeral-sandbox teardown and still hands the human a review surface.
- Add the **`agent-blocked`** label + a comment stating the cause on the work item.
- Report includes the cause. Exit **1**.

**Early bail** (under-specified item, before any code — per ticket 03, never fabricate):

- No MR (an empty branch is noise).
- `agent-blocked` label + a comment stating what's missing on the work item.
- Exit **1** (same human action as mid-block: go look; the comment carries the difference).

**Error** (a Task passed as param, or config/auth/infra failure): exit **2**.

Exit-code taxonomy (an outer poll loop, out of scope now, will branch on it): **0** success / nothing-to-do · **1** handed-to-human (early bail + mid-block) · **2** error.

**Blocked-marker note:** `agent-blocked` is the *Jira* work item's label (afk convention), distinct from relay's five canonical repo triage labels.

**Deferred to fog:** a machine-readable JSON summary for the coming outer poll loop — not built now (loop is out of scope; the exit code already carries the class it needs).

**Left to ticket 07 / 09** (orchestration, not decided here): whether `git push` / `kipu-mr` fires inside the Docker sandbox or on the host after the worktree is handed back; who sets In Review (in-sandbox planner vs harness); sub-tickets already moved In Review earlier in the loop stay as-is when a later ticket blocks.
