# 05 — The handover opens a pull request

**What to build:** the **handover** publishes to GitHub and hands the baton to a human.

A `success` **outcome** gets a pull request; a `mid-block` with committed work gets a **draft** one; a mid-block on an empty branch and an `early-bail` get none.
relay still computes that verdict from what the pass committed and holds the leg to it — the leg never decides it from the branch.

The leg opens it with `gh pr create` directly, using `--draft` inline for a mid-block.
The `kipu-mr` delegation and the separate draft-conversion command both go, so relay stops depending on a plugin skill for its own critical path.

The pull-request body carries `Closes #<ticket>` for **each ticket the pass committed**, and **never** a closing keyword against the work item when that item is a parent.
GitHub neither refuses nor warns there: a probe closed a parent with two open sub-issues and left it marked `completed` with `0 of 2`.
So a human closes the parent after merging, which GitHub makes visible through its own child count.

The leg swaps `agent-in-progress` for `agent-in-review` on success or `agent-blocked` on a block, comments the outcome on the work item, and writes no code.

Merge-request naming becomes pull-request throughout — the reported URL field, the rule that enforces it, the glossary-facing wording, and the README.

**Blocked by:** 03.

**Status:** resolved

- [x] Each outcome publishes what it is owed, and the harness rejects a leg that ignores the verdict in **either** direction — no pull request when one was required, or one opened when it was forbidden.
- [x] A mid-block with commits produces a draft pull request in one command.
- [x] The body closes each committed ticket and never the parent work item.
- [x] The work item ends labelled `agent-in-review` or `agent-blocked`, with `agent-in-progress` removed.
- [x] The work item is commented with the pull request URL and one line on what the pass built.
- [x] The operator's terminal report names the outcome and its cause, the item and the state it was left in, the branch, the pull request URL when there is one, each committed ticket with its short SHA, and the green gate's verdict.
- [x] The leg makes no commit of its own.
- [x] Nothing in the codebase says "merge request", and `npm run verify` exits zero.
