import { existsSync } from "node:fs";
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
