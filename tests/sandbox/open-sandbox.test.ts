import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSandbox, type Sandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { relayConfigSchema } from "../../src/config.js";
import { openSandbox } from "../../src/sandbox/sandbox.js";
import { resolveSandboxImage } from "../../src/sandbox/sandbox-image.js";
import { assertGhInSandbox } from "../../src/sandbox/docker-host.js";
import type { Secrets } from "../../src/host/secrets.js";

// Everything `openSandbox` reaches for outside itself: the container it opens,
// the image resolution it may skip, and the two host questions that need a real
// daemon. What is left under test is the wiring — which image the sandbox runs.
vi.mock("@ai-hero/sandcastle", () => ({ createSandbox: vi.fn() }));
vi.mock("@ai-hero/sandcastle/sandboxes/docker", () => ({ docker: vi.fn() }));

vi.mock("../../src/sandbox/sandbox-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/sandbox/sandbox-image.js")>()),
  resolveSandboxImage: vi.fn(async () => "relay-sandbox:resolved"),
}));

vi.mock("../../src/sandbox/docker-host.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/sandbox/docker-host.js")>()),
  assertGhInSandbox: vi.fn(async () => undefined),
  detectDockerSocketGid: vi.fn(async () => 0),
  resolveTestcontainersHost: vi.fn(async () => "host.docker.internal"),
}));

vi.mock("../../src/sandbox/skills.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/sandbox/skills.js")>()),
  resolveSkillPlugins: vi.fn(async () => []),
}));

const secrets: Secrets = {
  githubToken: "gh-token",
  claude: { variable: "CLAUDE_CODE_OAUTH_TOKEN", token: "claude-token" },
  sources: [
    { variable: "GH_TOKEN", from: "environment" },
    { variable: "CLAUDE_CODE_OAUTH_TOKEN", from: "environment" },
  ],
};

const config = relayConfigSchema.parse({ landing: "pull-request" });

/** A container that answers the one question `openSandbox` asks of it. */
const writableSandbox = {
  exec: vi.fn(async () => ({ exitCode: 0 })),
  close: vi.fn(async () => undefined),
} as unknown as Sandbox;

function open(image?: string) {
  return openSandbox({
    repoRoot: "/repo",
    config,
    secrets,
    branch: "agent/123",
    baseBranch: "main",
    image,
  });
}

/** The image name the provider was asked to run the container from. */
function ranImage(): unknown {
  return vi.mocked(dockerSandbox).mock.calls[0]?.[0]?.imageName;
}

describe("openSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSandbox).mockResolvedValue(writableSandbox);
  });

  it("runs the image a caller hands in, and resolves none of its own", async () => {
    await open("registry.example.com/relay:1");

    expect(resolveSandboxImage).not.toHaveBeenCalled();
    expect(ranImage()).toBe("registry.example.com/relay:1");
    expect(assertGhInSandbox).toHaveBeenCalledWith({ image: "registry.example.com/relay:1" });
  });

  it("resolves the image itself when no caller has one in hand", async () => {
    await open();

    expect(resolveSandboxImage).toHaveBeenCalledWith({ repoRoot: "/repo", config });
    expect(ranImage()).toBe("relay-sandbox:resolved");
  });
});
