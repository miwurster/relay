# 0004. Skill plugins are mounted from the host, never baked into the sandbox image

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

Every **role** runs skills — `tdd`, `relay-skills:commit`, the review skills.
Those skills live in Claude plugins the operator has installed on their own machine.
The **sandbox** has to get them from somewhere.

Baking them into the image is the obvious move, and it is what a normal container build would do.
But it pins skills at image-build time while the operator's installed copies keep moving, and it makes every skill change an image rebuild.

## Decision Drivers

- A **leg** should run the same skill version the operator has installed, not a stale copy.
- Nothing about a **role**'s setup should survive its run, so every leg stays a **cold session**.
- Skill discovery must actually work headless under `claude --print`, which was not a given.

## Considered Options

- **Option A** — Bind-mount the host's installed plugin directories and pass `--plugin-dir` per **leg**.
- **Option B** — Bake the plugins into the sandbox image at build time.
- **Option C** — Bind-mount the individual `SKILL.md` files into `~/.claude/skills` inside the container.

## Decision Outcome

Chosen option: **Option A**, because `--plugin-dir` is session-scoped, so the skills exist for exactly one **leg** and nothing about them persists in the image or the home directory.

Spike 02 proved this works: a real plugin skill is discovered and invoked by headless `claude --print` inside the sandbox, both by capability and by name, with the skill body actually running.
Plugin-delivered skills fire under the qualified `<plugin>:<skill>` name; that is the only observable difference from the personal-artifact route.

The host's `installed_plugins.json` is read to find each plugin's install path, and a plugin the operator has not installed is reported as a setup error before anything expensive happens.

### Consequences

- Good: a **role** runs the operator's installed skill version, with no rebuild to pick up a change.
- Good: nothing about skills survives a **leg** — no image state, no home-directory state.
- Good: the sandbox image stays generic and does not need rebuilding when a skill changes.
- Bad: relay depends on the shape of Claude's `installed_plugins.json`, which is not relay's file to control.
- Bad: a **pass** cannot run on a host without those plugins installed, so relay is not self-contained.
- Bad: two operators on different plugin versions get different behaviour from the same relay version.

### Confirmation

`src/sandbox/skills.ts` resolves every required plugin up front and fails with one error naming all the missing ones.
`relay doctor`'s `skill plugins` check runs that same resolution, so a missing plugin surfaces before a pass is attempted, and an installed one is reported with the version a pass would mount.

## Pros and Cons of the Options

### Option B — bake plugins into the image

- Good, because the sandbox becomes self-contained and reproducible.
- Good, because it removes the dependency on the host's Claude installation.
- Bad, because skills are pinned at build time and drift from the operator's installed copies.
- Bad, because every skill change forces an image rebuild.

### Option C — mount bare `SKILL.md` into `~/.claude/skills`

- Good, because it was proven first, in spike 11, and it works.
- Neutral, because skills then fire under their bare name rather than a qualified one.
- Bad, because it writes into the container's home directory, which is exactly the persistent state a **cold session** should not have.
- Bad, because it delivers skills stripped of their plugin, so anything plugin-scoped is lost.

## More Information

- Provenance: `.scratch/relay-build/research/spike-02-plugin-skills/FINDINGS.md`, 2026-07-24.
- Related: [ADR-0019](0019-relays-own-skills-ship-as-an-installed-plugin.md), which ships relay's own skills as one of these host-installed plugins.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
