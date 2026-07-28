import { describe, expect, it } from "vitest";
import { readResource } from "../src/resources.js";

describe.each([
  ["java.Dockerfile", "FROM maven:3-eclipse-temurin-21"],
  ["python.Dockerfile", "FROM ghcr.io/astral-sh/uv:python3.12-trixie"],
  ["node.Dockerfile", "FROM node:lts"],
])("sandbox recipe template %s", (file, fromLine) => {
  it("declares the build arguments relay always passes", async () => {
    const recipe = await readResource("sandbox-recipes", file);
    expect(recipe).toContain("ARG AGENT_UID");
    expect(recipe).toContain("ARG AGENT_GID");
  });

  it("installs gh, the docker CLI, and claude", async () => {
    const recipe = await readResource("sandbox-recipes", file);
    expect(recipe).toMatch(/gh_\$\{GH_VERSION\}/);
    expect(recipe).toContain("docker-ce-cli");
    expect(recipe).toContain("claude.ai/install.sh");
  });

  it("makes room for the agent user when the base image already holds its uid", async () => {
    const recipe = await readResource("sandbox-recipes", file);
    expect(recipe).toMatch(/getent passwd "\$\{AGENT_UID\}"/);
    expect(recipe).toContain("userdel");
  });

  it("is built on its documented base", async () => {
    const recipe = await readResource("sandbox-recipes", file);
    expect(recipe).toContain(fromLine);
  });

  it("ends with an idling entrypoint", async () => {
    const recipe = await readResource("sandbox-recipes", file);
    expect(recipe.trim().endsWith('ENTRYPOINT ["sleep", "infinity"]')).toBe(true);
  });
});

describe("node sandbox recipe", () => {
  it("installs a pinned pnpm", async () => {
    const recipe = await readResource("sandbox-recipes", "node.Dockerfile");
    expect(recipe).toContain("ARG PNPM_VERSION");
    expect(recipe).toMatch(/pnpm@\$\{PNPM_VERSION\}/);
  });
});
