# Issue tracker: GitHub

Issues for this repo live as GitHub issues in this same repo.
Use the `gh` CLI for all operations.

`gh` infers the repo from the clone's remote, so no command here names an owner or a repo.

## Conventions

- **Read an issue**: `gh issue view <number> --comments`
- **List open issues**: `gh issue list --state open --json number,title,body,labels`
- **Read an issue's sub-issues and dependencies**: `gh api repos/{owner}/{repo}/issues/<number> --jq '{sub_issues_summary, issue_dependencies_summary}'`, and `gh api repos/{owner}/{repo}/issues/<number>/sub_issues` for the children themselves.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --comment "..."`

A **work item** is an issue with sub-issues; each sub-issue is a **ticket**.
Blocking between tickets is GitHub's native issue dependencies, read from `issue_dependencies_summary.blocked_by` — open blockers only.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
