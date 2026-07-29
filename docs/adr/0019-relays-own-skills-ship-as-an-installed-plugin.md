# 0019. relay's own skills ship as a plugin installed from this repo's marketplace

- **Status:** accepted
- **Date:** 2026-07-29

## Context and Problem Statement

Two of the skills a **role** runs are relay's own — the unattended commit and the maintainability review.
They were ported out of a private plugin, so relay now has to publish them somewhere an operator can get them.

The other mounted plugin, `mattpocock-skills`, is a public plugin from a marketplace that ships with Claude Code: nothing for relay to publish.
relay's own two skills are the question.

relay already publishes an npm package, and that package already carries relay's prompt resources.
Putting the skills there would need no second release surface and no operator step.
But [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md) decided a **skill plugin** is mounted from the host's Claude installation, and skills inside the npm package are not that.

## Decision Drivers

- Skills invoked by qualified `<plugin>:<skill>` name have to arrive as a plugin, because that name is what makes them plugin-delivered.
- One delivery mechanism for all mounted plugins is one thing to explain and one thing to check.
- Skills are Claude artefacts a human also runs by hand; relay's npm package is not where a human looks for one.
- The skills version on a cadence of their own, unrelated to relay's releases.

## Considered Options

- **Option A** — Publish this repo as a Claude plugin marketplace named `relay`, carrying a `relay-skills` plugin the operator installs.
- **Option B** — Ship the skills inside the npm package, beside relay's prompt resources, and mount them from there.

## Decision Outcome

Chosen option: **Option A**.
Every mounted plugin then reaches the sandbox the same way — a host install path read out of Claude's `installed_plugins.json` and bind-mounted per **leg** — so relay's own skills are an instance of ADR-0004's rule rather than an exception to it.
The `relay` marketplace lives in this repo's `.claude-plugin/marketplace.json`, and the plugin under `plugins/relay-skills`, versioned by hand and kept out of the published tarball.

ADR-0004 is not superseded and nothing about it changes: relay's own plugin is a host-installed plugin, mounted like any other.

### Consequences

- Good: one delivery mechanism for every mounted plugin, so one paragraph of setup and one `doctor` check cover them all.
- Good: the skills fire under their qualified `relay-skills:<skill>` name, the same as every other plugin skill a prompt invokes.
- Good: an operator can invoke the same skills by hand outside a pass, because they are installed in their Claude, not buried in a node module.
- Good: the skills version independently of the npm package.
- Bad: a second release surface — a plugin version to bump that npm knows nothing about.
- Bad: one more operator prerequisite before a first pass, and one more way a fresh host is not ready.
- Bad: two operators on different `relay-skills` versions get different behaviour from the same relay version, which Option B would have pinned.

### Confirmation

`docs/setup.md` step 6 gives the marketplace-add and install commands, and the README names both plugins in its prerequisites.
`relay doctor`'s `skill plugins` check fails naming `relay-skills@relay` when it is not installed.

## Pros and Cons of the Options

### Option B — ship the skills inside the npm package

- Good, because there is no operator install step and no second release surface.
- Good, because the skills are pinned to the relay version that shipped them, so no operator runs a mismatched pair.
- Bad, because a skill mounted out of a node module is not a plugin, so it loses the qualified `<plugin>:<skill>` name the prompts invoke.
- Bad, because it makes relay's skills a second, special delivery path alongside ADR-0004's, with its own mount and its own failure mode.
- Bad, because a human cannot invoke those skills outside a pass without going through relay.

## More Information

- Provenance: issue #19.
- Related: [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md), whose mount-from-host rule this decision is an instance of.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
