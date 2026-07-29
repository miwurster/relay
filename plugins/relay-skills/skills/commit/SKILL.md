---
name: kipu-commit
version: 3.0.0
description: Commit the current changes as a Conventional Commits message. Use for every commit, including when another skill's step says to commit, whether or not it names this skill.
---

# Kipu commit message

## Resolve from context

Every gate resolves from context by the deterministic rules below — **attended** at the keyboard or **unattended** from another skill's build step, the path is the same.
When a gate does not resolve:

- Take the documented **safe default** where one exists.
- Otherwise **stop** at the printed message and report a specific, actionable reason.

## Process

Open with **one batch** of parallel tool calls — `git diff --staged`, `git diff`, `git status`, the branch name, and `docs/agents/issue-tracker.md` (for scope) are independent, so issue them together, not one turn each.

1. **Read the changes.** Inspect `git diff --staged`; if nothing is staged, use `git diff` plus `git status`.
   The diff decides the summary; the type comes from **Types**.
2. **Resolve the scope.** See **Scope**.
3. **Decide breaking.** See **Breaking**.
4. **Compose** the message. See **Message shape**.
5. **Copy** the message to the clipboard, best-effort. See **Clipboard**.
6. **Output** it in a single code block, ready to paste.
7. **Commit** when the repo permits. See **Commit**.
   The run ends in exactly one of three states — committed, blocked (message printed, specific reason reported), or nothing to commit.

## Message shape

Subject:

- `<type>(<scope>): <summary>` — the scope is optional (see **Scope**).
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding".
- Lowercase after the colon.
- ≤50 chars; hard cap 72.
- No trailing period.

Body — omit it when the subject speaks for itself.
Write one for a non-obvious *why*, and always for a breaking change, a security fix, or a data migration.
Wrap at 72 chars; bullets are `-`.

The ticket reference lives in the **scope** and nowhere else — no `Closes`/`Fixes`/`Resolves` footer.
The one footer this skill writes is `BREAKING CHANGE:` (see **Breaking**).

Subject and body describe the change — not the author, not the act of committing.
Omit the file name when the scope already names it.

Never include `Co-authored-by:`, `Generated with Claude Code`, or any other AI-attribution trailer, for Claude or any agent.

## Types

Release column is what `semantic-release` bumps from that type; `none` releases nothing on its own.

| Type       | Use for                        | Release   |
|------------|--------------------------------|-----------|
| `feat`     | new feature                    | **minor** |
| `fix`      | bug fix                        | **patch** |
| `perf`     | performance improvement        | **patch** |
| `refactor` | code change, no feature or fix | none      |
| `docs`     | documentation only             | none      |
| `test`     | add or correct tests           | none      |
| `build`    | build system or dependencies   | none      |
| `ci`       | CI config and scripts          | none      |
| `chore`    | chores, no src or test change  | none      |

When the invocation names a type — a bare `feat`/`fix`/… or a `--feat`/`--fix`/… flag matching a row above — use that type verbatim and skip the diff-based choice.
Otherwise pick the type that matches the change, not the bump you want — except a major, which is a deliberate gate (see **Breaking**).

## Scope

When the repo tracks work in an issue tracker **and** a ticket is in context, the scope **is** that ticket's reference — the whole reference, not a component name.
The reference shape comes from the tracker (`docs/agents/issue-tracker.md`):

- **Jira** → the issue key, `<KEY>-<number>`, with the **project key** from the tracker doc's "Setup constants".
- **GitHub / GitLab** (issues in the git host) → the issue number as `#<number>` — the host auto-links it.

Find the reference in this order; stop at the first hit:

1. `docs/agents/issue-tracker.md` — the tracker and its project key.
   None, or any other tracker → skip ticket scope.
2. A reference given in the task context this run — explicit beats inferred, so it wins over the branch.
3. The branch name (`git rev-parse --abbrev-ref HEAD`) — a spec's branch is cut from its ticket, so the reference is usually here.
   Jira spells it out; GitHub / GitLab commonly encode it as a leading `<number>-` segment.
4. Nothing found → the **safe default**: an optional component scope (`api`, `auth`, …), or omit the scope.

## Breaking

A breaking change cuts a **major** release, so it is a gate.
Stay non-breaking unless the task **explicitly** asks — "these are breaking changes", "I want a new major version", "major bump", or a clear equivalent in the ticket or instructions driving this run.
A large or risky-looking diff is **not** a signal.
Implicit or ambiguous wording → the **safe default**: non-breaking.

When triggered, and only then:

- Mark the subject with `!` after the type/scope: `feat(PSD-123)!: …`.
- Add the footer after a blank line — it is what makes semantic-release bump major, so it goes in alongside the `!`, never instead of it:
  ```
  BREAKING CHANGE: <what broke and how to migrate>
  ```

## Clipboard

Copy the full message — subject, body, footer — to the clipboard the moment it is composed.
The clipboard is the fallback when **Commit** is blocked or denied, so the copy is its own tool call, before the printing and before the commit: bundled into the commit command, a denied commit takes the copy down with it.

Write the message to a scratch file (see `scratch-file.md`), then `pbcopy < <path>`.
Keep that file — **Commit** reuses it, so the copied text and the committed text stay one source.

Report the copy outcome:

- Copied → say the message is on the clipboard.
- Failed for any reason — denied, no clipboard utility, anything else → on an **attended** run say so and point the human at the printed code block; on an **unattended** run skip silently and carry on.

## Commit

Check the target repo's agent instructions (`AGENTS.md`, `CLAUDE.md`).
If they forbid `git commit` or commit-like actions, stop at the printed message and report that the repo forbids agent commits — never commit.
Absent any such rule, commits are permitted.

Commit the exact message shown, preserving the body and footer — reuse the temp file from **Clipboard** and `git commit -F <file>`.

Staging:

- Commit what is already staged.
- If nothing is staged, stage the working-tree changes that belong to the task being committed — the files created or modified for it, whoever wrote them — then commit.
- Never `git add -A`, never stage unrelated working-tree changes.
- If there is nothing to commit, stop and report it.

Commit on the branch checked out right now — the default branch (`main`/`master`) included.
The branch is cut upstream, before this skill runs, so the harness's "branch before committing on the default branch" default does **not** apply here: commit where the change already lives.
Never `--amend`, never `push`, never merge — merges stay a human step.

## Examples

Bodies appear only when the *why* is non-obvious.

Bug fix on a Jira ticket (branch `feature/PSD-123-cart`), self-explanatory — no body:
```
fix(PSD-123): stop double-charge on retry
```

New feature, minor bump, no ticket — body carries the non-obvious *why*:
```
feat(auth): add passkey login

WebAuthn lets users skip passwords on trusted devices, ahead of
the SMS-OTP provider being sunset next quarter.
```

Breaking change, major bump (task asked for it) — footer is what cuts the major:
```
feat(PSD-204)!: drop v1 token endpoint

BREAKING CHANGE: /v1/token removed. Move clients to /v2/token;
old route returns 410.
```
