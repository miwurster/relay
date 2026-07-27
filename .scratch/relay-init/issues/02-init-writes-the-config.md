# 02 — `relay init` writes the config

**What to build:** an operator clones a repo, runs `relay init`, and gets a `relay.config.ts` they only have to read rather than author.

**Init** joins `doctor` as a reserved positional on the flagless CLI. It reads `defaultBranch` from the clone rather than assuming `main`, detects the **green gate** from the repo's manifest, writes the file, prints what it did, and exits 0.

Detection is a convenience and never a claim to be right. A detected gate is written with a comment asking the operator to confirm it; a gate that cannot be detected is written as the sentinel from ticket 01, so an unconfirmed setup fails loudly instead of running a command nobody chose.

Init refuses before writing anything when the directory is not a git repo, or when its `origin` is not GitHub — relay is GitHub-only by architecture ([ADR-0007](../../../docs/adr/0007-one-forge-one-tracker-no-abstraction.md)), and a config written anywhere else can never work. It never overwrites an existing config, so re-running it on a half-set-up repo is safe, and it leaves everything unstaged for the operator to review.

Carries two seams the next ticket builds on: a git runner injectable the way the docker and `gh` runners already are, and an init entry point that returns its per-file verdicts as data as well as printing them, the way doctor separates its checks from its report.

**Blocked by:** 01.

**Status:** resolved

- [x] `relay init` is a third flagless command beside `doctor`, dispatched through the existing CLI seam.
- [x] In a GitHub clone it writes `relay.config.ts` at the repo root carrying `greenGate` and `defaultBranch` and nothing else — defaults are not echoed back out.
- [x] The written config loads: running init in a temporary repo and then loading the result yields the detected gate and branch.
- [x] `defaultBranch` comes from the clone's default branch, falling back to the current branch when it is unset.
- [x] The gate is detected for all three languages — Maven from `pom.xml`, `uv` from `pyproject.toml`, and from `package.json` scripts preferring `verify`, then `ci`, then `test`.
- [x] A repo matching none of those, or a `package.json` with none of those scripts, gets the ticket-01 sentinel.
- [x] A detected gate is written with a comment marking it as detected and asking for confirmation.
- [x] Outside a git repo, or on a non-GitHub remote, init writes nothing and exits 2.
- [x] An existing `relay.config.ts` is kept, not overwritten, and reported as kept.
- [x] Init reports per-file verdicts as data, not only as printed text, so the behaviour is testable without scraping stdout.
- [x] Init stages and commits nothing.
- [x] Init prints what remains manual — confirm the gate, create the labels, provision `GH_TOKEN` — and names `relay doctor` as the next command.
- [x] Git is reached through an injected runner faked in tests, the way the docker and `gh` runners already are.
- [x] `npm run verify` exits zero.
