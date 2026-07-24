---
name: kipu-commit
version: 2.0.1
description: Write and commit a Conventional Commits message for the current changes, unattended or interactive. Use when the user wants to commit, or when the self-driving delivery flow needs to commit a ticket's changes.
---

# Kipu commit message

Write one Conventional Commits message for the current changes so semantic-release can read the type and cut the version, then commit it.
Base message rules come from the **caveman-commit** skill; this skill adds the Kipu layer — semantic-release types, ticket scope, a breaking-change gate, clipboard copy, and an autonomous direct commit.

This skill runs **unattended** — invoked by the self-driving delivery flow as well as by a person at the keyboard (see **Autonomous operation**).

## Base rules — read first

`caveman-commit` (installed via the `caveman` plugin, a required dependency of `kipu-all`) owns the message shape.
Read its `SKILL.md` and apply it — do not restate it here.
It defines: the subject `<type>(<scope>): <summary>`, imperative mood, ≤50 chars (hard cap 72), no trailing period, and the full **never-include** list.

Kipu diverges from caveman-commit in two places, each marked **override** below:

- **Types** — the type set is the semantic-release table below, not caveman-commit's generic list.
- **Commit** — this skill runs `git commit` autonomously; caveman-commit never does.

Subject wording, body, and footer all follow caveman-commit unchanged.
Kipu constrains only the **type** (table below) and the **scope** (the ticket reference, see **Scope**); everything else about the message shape is caveman-commit's.

One never-include rule is tightened: never add `Co-authored-by:` or AI-attribution trailers for Claude or any agent — even the opt-in trailer caveman-commit permits.

## Autonomous operation

This skill never asks a human and never waits for a reply.
Every decision resolves from context by the deterministic rules below.
When a gate cannot be resolved from context, do **not** prompt — instead:

- Take the documented **safe default** where one exists (scope → omit; breaking → non-breaking).
- Otherwise **stop** at the printed message and report a specific, actionable reason, so the self-driving flow can surface it as a tracker `needs_input` question and resume later.

This replaces every "ask the user" branch caveman-commit or an interactive commit skill would use.

## Process

Open with **one batch** of parallel tool calls — `git diff --staged`, `git status`, the branch name, and `docs/agents/issue-tracker.md` (for scope) are independent, so issue them together, not one turn each.

1. **Read the changes.** Inspect `git diff --staged`; if nothing is staged, use `git diff` plus `git status`.
   The diff decides the summary — and the type, unless the invocation names one (see **Types**).
2. **Resolve the scope.** See **Scope**.
3. **Decide breaking.** See **Breaking**. Default: not breaking.
4. **Compose** on caveman-commit's base, with the Kipu **type** and **scope**; subject, body, and footer follow caveman-commit.
5. **Output** the message in a single code block, ready to paste.
6. **Copy** it to the clipboard, best-effort. See **Clipboard**.
7. **Commit** autonomously when the repo permits. See **Commit**.

## Types — override

The type set is this table, not caveman-commit's generic list.
Release column is what `semantic-release` bumps from that type.

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

`none` = no release on its own.

When the invocation names a type — a bare `feat`/`fix`/… or a `--feat`/`--fix`/… flag matching a row above — use that type verbatim and skip the diff-based choice.
Otherwise pick the type that matches the change, not the bump you want — except a major, which is a deliberate gate (see **Breaking**).

## Scope

When the repo tracks work in an issue tracker **and** a ticket is in context, the scope **is** that ticket's reference — the whole reference, not a component name.
The reference shape comes from the tracker (`docs/agents/issue-tracker.md`):

- **Jira** → the issue key, e.g. `fix(PSD-123): handle empty cart`.
- **GitHub / GitLab** (issues in the git host) → the issue number as `#<number>`, e.g. `fix(#142): handle empty cart` — the host auto-links it.

Find the reference in this order; stop at the first hit:

1. Read `docs/agents/issue-tracker.md` for the tracker and its reference shape.
   - **Jira** — take the **project key** from its "Setup constants"; the reference is `<KEY>-<number>`.
   - **GitHub / GitLab** — the reference is `#<number>`.
   - **None / any other tracker** — skip ticket scope (use a component scope or none).
2. Match the reference in the branch name (`git rev-parse --abbrev-ref HEAD`): a `<KEY>-<number>` for Jira, or the issue `<number>` the branch encodes for GitHub/GitLab (commonly a leading `<number>-` segment).
   In the self-driving flow the branch is cut from the ticket, so it is almost always here.
3. A reference given in the task context this run.
4. Nothing found → an optional component scope (`api`, `auth`, …) or omit the scope.

## Breaking

A breaking change cuts a **major** release, so it is a gate.
Stay non-breaking unless the task **explicitly** asks — "these are breaking changes", "I want a new major version", "major bump", or a clear equivalent in the ticket or instructions driving this run.
A large or risky-looking diff is **not** a signal.
Implicit or ambiguous wording → stay non-breaking; never guess.

When triggered, and only then:

- Mark the subject with `!` after the type/scope: `feat(PSD-123)!: …`.
- Add the footer after a blank line:
  ```
  BREAKING CHANGE: <what broke and how to migrate>
  ```

The `BREAKING CHANGE:` footer is what makes semantic-release bump major — always include it when breaking, even alongside the `!`.

## Clipboard

Copy the full message — subject, body, footer — to the clipboard the moment it is composed; this is non-destructive.
The clipboard is the fallback when **Commit** is blocked or denied, so the copy is its own tool call that runs **before** any commit — never bundle it into the commit command, or a denied commit takes the copy down with it.

Create the temp file with `mktemp` and write the message into it with a shell heredoc — write via shell, not the Write tool, which refuses to overwrite a stale file a prior run left behind.
Reuse the literal path `mktemp` printed for both the copy and the commit; shell variables do not survive between separate tool calls.
Then `pbcopy < <path>` (macOS).
Keep that file — **Commit** reuses it, so the copied text and the committed text stay one source.
Other platforms: `xclip -selection clipboard` or `wl-copy` (Linux), `clip.exe` (WSL).

Report the copy outcome:

- Copied → say the message is on the clipboard.
- Copy failed or was denied on an **attended** run → say so, and point the human at the printed code block.
- Unattended run with no clipboard utility → skip silently and carry on.

## Commit — override

caveman-commit never commits.
This skill commits **autonomously** when the repo permits — no approval prompt (see **Autonomous operation**).

Check the target repo's agent instructions (`AGENTS.md`, `CLAUDE.md`).
If they forbid `git commit` or commit-like actions, stop at the printed message and report that the repo forbids autonomous commits — never commit.
Absent any such rule, commits are permitted.

Whenever a commit does not happen — repo forbids it, harness denies it, or nothing is staged — the clipboard copy from **Clipboard** has already run, so end the report by confirming the message is on the clipboard (or that the copy failed) and ready to paste manually.

Then commit the exact message shown, preserving the body and footer — reuse the temp file from **Clipboard** and `git commit -F <file>`.

Staging:

- Commit what is already staged.
- If nothing is staged, stage only the changes this run produced — the files this run created or modified for the task — then commit.
- Never `git add -A`, never stage unrelated working-tree changes.
- If there is nothing to commit, stop and report it.

Commit on the **current branch** — the one checked out right now — and stay on it.
This holds even on the default branch (`main`/`master`): commit there, on the branch as it is; never create, switch, or checkout a branch first.
The general "branch before committing on the default branch" harness default does **not** apply to kipu-commit — this skill always commits where the change already lives (in the self-driving flow the branch is cut from the ticket upstream, before this skill runs).
Never `--amend`, never `push`, never merge — merges stay a human step (the self-driving flow never merges an MR unattended).

## Examples

These show the Kipu layer — type and ticket scope; the body/footer shape is caveman-commit's, so bodies appear only when the *why* is non-obvious.

Bug fix on a Jira ticket (branch `feature/PSD-123-cart`), self-explanatory — no body:
```
fix(PSD-123): stop double-charge on retry
```

Same fix on a GitHub-issue repo (branch `142-cart`) — the scope is the issue number:
```
fix(#142): stop double-charge on retry
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
