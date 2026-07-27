# Issue tracker: GitHub

Reference tracker doc — copy this into a target repo as `docs/agents/issue-tracker.md`.

Issues for this repo live as GitHub issues in this same repo.
Reach them with the `gh` CLI, which infers the repo from the clone's git remote — there is no project id, field id or transition id to configure.

## Relation model

- **Parent / child** — a work item's tickets are its **sub-issues**.
  Read them with `gh issue view <number> --json subIssues`.
  An item with no sub-issues is its own single ticket.
- **Blocks / is blocked by** — native GitHub issue dependencies.
  Read them with `gh issue view <number> --json blockedBy`, and write one with `gh issue edit <number> --add-blocked-by <number>`.
  Never call the REST `dependencies/blocked_by` endpoint: it takes a database id, and passing an issue *number* succeeds while linking an unrelated repository's issue.
  A blocked-by entry carries its own state — a closed blocker does not hold work back.

## Lifecycle labels

Lifecycle is carried by labels, applied and removed idempotently.
There are no status transitions.

- `ready-for-agent` — a human has blessed this item; relay runs only over these.
- `agent-in-progress` — a pass has claimed the item.
  The planner applies it, the handover removes it.
- `agent-in-review` — a pass finished and the work is waiting on a human.
- `agent-blocked` — a pass stopped short and the item needs a human decision.

## Commenting

`gh issue comment <number> --body '<text>'`.

## What never happens

relay never closes an issue.
Closing is a human act, tied to merging the pull request.
