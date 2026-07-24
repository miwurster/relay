# Pass failure and recovery semantics

Type: grilling
Status: open
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
