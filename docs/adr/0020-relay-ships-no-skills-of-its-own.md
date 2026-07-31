# 0020. relay ships no skills of its own

- **Status:** accepted
- **Date:** 2026-07-29

## Context and Problem Statement

[ADR-0019](0019-relays-own-skills-ship-as-an-installed-plugin.md), one day old, made this repo a Claude plugin marketplace so that relay's own two skills — an unattended commit and a maintainability review — could be installed on a host and mounted per **leg**.

That bought relay a second release surface, a second operator prerequisite, and a version pair that can mismatch, all to deliver two skills relay wrote itself.
Meanwhile the public `mattpocock-skills:code-review` skill already reviews a diff on both axes relay cares about — standards and spec — as two parallel subagents, which is what relay's own review skill and its separate spec **lens** were each doing half of.

## Decision Drivers

- A skill relay maintains itself is a skill relay has to publish, version and check for.
- Whatever a public skill already does well is not relay's to reimplement.
- The **crew** should have as few configurations as the work actually has.

## Considered Options

- **Option A** — Keep the marketplace and the plugin, per ADR-0019.
- **Option B** — Delete both, take the review from `mattpocock-skills:code-review`, and put no commit rules anywhere.
- **Option C** — Delete the marketplace but keep relay's commit rules as a shared prompt fragment injected into the implementer and fixer prompts.

## Decision Outcome

Chosen option: **Option B**.
The marketplace and `plugins/relay-skills/` are gone, and relay ships no skill of its own in any form.

The review is one **role** with one prompt, run once per **review scope**: it names the fixed point and the issue, invokes `mattpocock-skills:code-review`, and translates that skill's prose report into the `<relay-findings>` block the fixer reads.
That collapses three lenses — a two-axis ticket lens, an in-depth code lens and an in-depth spec lens — into two runs of one review, named by the only thing that differs between them, so **lens** stops being a term this project needs.
The model map follows: `ticket-review` and `branch-review`.

Committing goes back to being an instruction in the implementer and fixer prompts — "commit your work to the current branch, as one commit for this ticket" — with no rules attached.
`mattpocock-skills@claude-plugins-official` is now the one **skill plugin** a pass mounts, and ADR-0004's mount-from-host rule is unchanged.

### Consequences

- Good: one release surface, one operator prerequisite, no plugin version that can disagree with a relay version.
- Good: one review prompt instead of three, and one review skill relay does not maintain.
- Good: the spec axis can no longer come up empty, because the prompt hands the skill the issue rather than letting it hunt for a reference in commit messages.
- Bad: relay's commits carry whatever Claude Code writes by default, including AI-attribution trailers, which the dropped skill forbade.
- Bad: nothing enforces the commit conventions of the repo a pass runs on — no Conventional Commits type, no issue scope, no rule against staging unrelated work.
- Bad: relay's review depends on the shape of a third party's prose report, and a change to that skill's headings or wording lands in relay without warning.
- Bad: a repo whose `.relay/config.ts` set `inDepthCodeReview` or `inDepthSpecReview` now fails config validation, since the model map is strict.

## Pros and Cons of the Options

### Option A — keep the marketplace and the plugin

- Good, because relay's commits keep their conventions, and its review rubric is relay's own to tune.
- Good, because a human can invoke the same skills by hand outside a pass.
- Bad, because two skills cost a marketplace, a hand-bumped plugin version, an operator install step and a `doctor` check.
- Bad, because the review skill largely duplicated `mattpocock-skills:code-review`.

### Option C — keep the commit rules as a prompt fragment

- Good, because it drops the marketplace while keeping the rules relay's landing depends on.
- Neutral, because it needs no new mechanism: the rules travel as a prompt argument.
- Bad, because relay then maintains commit conventions for every repo it runs on, which is the repo's business and not relay's.

## More Information

- Supersedes [ADR-0019](0019-relays-own-skills-ship-as-an-installed-plugin.md).
- Related: [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md), whose mount-from-host rule now covers exactly one plugin.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
