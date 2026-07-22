# Per-repo configuration surface + green-gate discovery

Type: grilling
Status: open
Blocked by: —

## Question

What must a target repo tell the tool, and how does the tool learn the quality-gate command?

Context: the spike hardcodes `GL_PROJECT_PATH`, default branch, image name, and the Maven green-gate (`./mvnw checkstyle:check` + unit groups excluding e2e/migration/integration). A distributed tool run in the pilot repo needs a config surface even before generalizing.

Crossover — ticket 03 (resolved) already decided part of this surface: the planner **reads `docs/agents/issue-tracker.md`** for tracker access, **repo label / project key / cloud id, relation model, and issue-type mapping**, and repo scope is **sourced from that file, not derived from the git remote** (remote-derivation dropped, or fallback-only). This ticket must fit `issue-tracker.md` into the wider config surface (green-gate, default branch, image, timeouts, model) rather than re-open how the tracker config is read.

Decide:

- The config surface — a `.sandcastle/` config file in the target repo, env vars, or auto-derivation (git remote → project path + repo label, as the spike derives)?
- How the quality gate is discovered vs configured (for the Java/Maven pilot: reuse the spike's Maven commands; general discovery is out of scope).
- Default branch, branch-prefix, timeouts, model — defaults vs per-repo overrides.
