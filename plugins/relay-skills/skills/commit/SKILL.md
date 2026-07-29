---
name: commit
description: Write one Conventional Commits message for the current changes and commit it to the current branch, unattended. Use when a relay leg — or a person — wants the current changes committed.
---

<!--
  Adapted from the `kipu-commit` skill of the private `kipu-all` Claude plugin,
  rewritten to stand alone: it delegates its message rules to no other skill.
-->

# Commit

Write one Conventional Commits message for the current changes, then commit it to the branch that is checked out right now.

This skill runs **unattended**.
It never asks and never waits for a reply — every gate resolves from context by the rules below.
When a gate cannot be resolved:

- Take the documented **safe default** where one exists — scope omitted, change treated as non-breaking.
- Where no safe default exists, **stop** at the written message and report one specific, actionable reason, so the invoker can surface it to a human.

It never pushes, never branches, never merges, never amends.
Moving branches belongs to whoever lands the work.

## Process

Open with **one batch** of parallel tool calls — `git diff --staged`, `git status`, the branch name, and `docs/agents/issue-tracker.md` (for scope) are independent, so issue them together rather than one turn each.

1. **Read the changes.** Inspect `git diff --staged`; if nothing is staged, use `git diff` plus `git status`.
   The diff decides the summary, and the type unless the invocation names one.
2. **Resolve the scope.** See **Scope**.
3. **Decide breaking.** See **Breaking**. Default: not breaking.
4. **Compose** the message. See **Message**.
5. **Output** the message in a single code block.
6. **Commit** it. See **Commit**.

## Message

Subject:

- `<type>(<scope>): <imperative summary>` — the scope is optional.
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding".
- ≤50 chars when possible, hard cap 72.
- No trailing period.
- Match the repo's convention for capitalization after the colon.

Body — only when it earns its place:

- Skip it entirely when the subject is self-explanatory.
- Add one for a non-obvious *why*, a breaking change, migration notes, or linked issues.
- Wrap at 72 chars.
- Bullets `-`, not `*`.
- Reference issues at the end: `Closes #42`, `Refs #17`.

Always include a body for a breaking change, a security fix, a data migration, or a revert — a future debugger needs the context.

Never include:

- "This commit does X", "I", "we", "now", "currently" — the diff says what.
- "As requested by …".
- `Co-authored-by:`, `Generated with Claude Code`, `Assisted-by:`, or any other AI-attribution trailer.
  Not ever, not opt-in: relay's commits do not advertise the agent that wrote them.
- Emoji, unless the repo's convention requires them.
- The file name, when the scope already says it.

## Types

Plain Conventional Commits types:

| Type       | Use for                        |
|------------|--------------------------------|
| `feat`     | new feature                    |
| `fix`      | bug fix                        |
| `perf`     | performance improvement        |
| `refactor` | code change, no feature or fix |
| `docs`     | documentation only             |
| `test`     | add or correct tests           |
| `build`    | build system or dependencies   |
| `ci`       | CI config and scripts          |
| `style`    | formatting only, no behaviour  |
| `revert`   | reverts an earlier commit      |
| `chore`    | chores, no src or test change  |

When the invocation names a type — a bare `feat`/`fix`/… — use it verbatim and skip the diff-based choice.
Otherwise pick the type that matches the change.

## Scope

When a tracker reference is in context, the scope **is** that reference — the whole reference, not a component name.
Its shape comes from the target repo's tracker convention, declared in `docs/agents/issue-tracker.md`: for issues in the git host, the issue number as `#<number>`, e.g. `fix(#142): handle empty cart`, which the host auto-links.

Find the reference in this order; stop at the first hit:

1. The reference the invoker supplied for this run.
2. The reference encoded in the branch name (`git rev-parse --abbrev-ref HEAD`) — commonly a leading `<number>-` segment.
3. Nothing found → the safe default: omit the scope, or use a component scope (`api`, `auth`, …) when one is obvious.

When `docs/agents/issue-tracker.md` is absent, or states no reference shape, skip the tracker scope and take the same default.

## Breaking

A breaking change is a gate.
Stay non-breaking unless the invocation **explicitly** asks — "these are breaking changes", "major bump", or a clear equivalent in the work item or instructions driving this run.
A large or risky-looking diff is **not** a signal.
Implicit or ambiguous wording → stay non-breaking; never guess.

When triggered, and only then:

- Mark the subject with `!` after the type and scope: `feat(#204)!: …`.
- Add the footer after a blank line:
  ```
  BREAKING CHANGE: <what broke and how to migrate>
  ```

Include the footer whenever the change is breaking, even alongside the `!`.

## Commit

Check the target repo's agent instructions (`AGENTS.md`, `CLAUDE.md`).
If they forbid `git commit` or commit-like actions, stop at the printed message and report that the repo forbids autonomous commits — never commit.
Absent such a rule, commits are permitted and need no approval.

Commit the exact message shown, body and footer preserved.
Write it to a temp file with `mktemp` and a shell heredoc — via shell, not the Write tool, which refuses to overwrite a stale file a prior run left behind — then `git commit -F <file>`.
Reuse the literal path `mktemp` printed; shell variables do not survive between separate tool calls.

Staging:

- Commit what is already staged.
- If nothing is staged, stage only the changes this run produced — the files this run created or modified for the task — then commit.
- Never `git add -A`, never stage unrelated working-tree changes.
- If there is nothing to commit, stop and report it.

Commit on the **current branch** and stay on it.
This holds on the default branch (`main`/`master`) too: commit there, on the branch as it is, and never create, switch or check out a branch first.
The general "branch before committing on the default branch" harness default does **not** apply here — this skill commits where the change already lives, and the invoker owns which branch that is.

Whenever a commit does not happen — the repo forbids it, the harness denies it, or nothing is staged — end the report with the written message and the specific reason it was not committed.

## Examples

Bug fix on a GitHub-issue repo (branch `142-cart`), self-explanatory — no body:

```
fix(#142): stop double-charge on retry
```

New feature, no work item in context — the scope is omitted and the body carries the non-obvious *why*:

```
feat: add passkey login

WebAuthn lets users skip passwords on trusted devices, ahead of
the SMS-OTP provider being sunset next quarter.
```

Breaking change, asked for explicitly — the footer is what states the migration:

```
feat(#204)!: drop v1 token endpoint

BREAKING CHANGE: /v1/token removed. Move clients to /v2/token;
old route returns 410.
```
