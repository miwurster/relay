import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readResource, resourcePath } from "../src/resources.js";

describe("resources", () => {
  it("resolves a resource path next to the compiled module", () => {
    expect(existsSync(resourcePath("README.md"))).toBe(true);
  });

  it("reads a shipped resource file", async () => {
    const readme = await readResource("README.md");
    expect(readme).toContain("relay resources");
  });
});

/**
 * A prompt names a forge command outright — the branch, the pull request and
 * the repository are the pass's own publication, and relay owns their shape.
 * A tracker item's commands are the target repo's to state, so a prompt reaches
 * them through `{{TRACKER_DOC}}` and names none of them itself
 * ([ADR-0028](../docs/adr/0028-the-tracker-doc-owns-invocation-relay-owns-the-graph.md)).
 *
 * That asymmetry is why this guard names `gh issue` rather than `gh`: widening
 * it to every `gh` command would forbid the `gh pr create` the handover is
 * required to run.
 */
describe("the prompts", () => {
  it("names no tracker-item command, whatever the prompt", async () => {
    const prompts = await readPrompts();

    // A sweep that found nothing would pass this on its own.
    expect(prompts.map(([name]) => name)).toContain("planner.md");

    for (const [name, body] of prompts) {
      expect(`${name}: ${body}`).not.toContain("gh issue");
    }
  });
});

/**
 * Every prompt relay ships, by name: the markdown sitting directly in
 * `resources`, which is where a role's prompt lives and nothing else does.
 * Reading one level deep therefore leaves out the `skills` directory, which is
 * what this wants anyway — a **vendored rubric** is a third party's words,
 * taken verbatim and never edited here. `README.md` documents the directory
 * rather than briefing a role.
 */
async function readPrompts(): Promise<[string, string][]> {
  const names = (await readdir(resourcePath())).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  );
  return Promise.all(names.map(async (name) => [name, await readResource(name)] as const));
}
