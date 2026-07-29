import { describe, expect, it } from "vitest";
import { roleAgent } from "../../src/crew/role-agent.js";
import { SANDBOX_PLUGIN_ROOT } from "../../src/sandbox/skills.js";

const printCommand = () =>
  roleAgent("claude-opus-4-8").buildPrintCommand({
    prompt: "plan it",
    dangerouslySkipPermissions: true,
  });

describe("roleAgent", () => {
  it("loads every mounted plugin so the role's skills are the operator's", () => {
    const { command } = printCommand();
    expect(command).toContain(`--plugin-dir ${SANDBOX_PLUGIN_ROOT}/mattpocock-skills`);
  });

  it("wires no MCP server, since the tracker is reached with `gh`", () => {
    expect(printCommand().command).not.toContain("--mcp-config");
  });

  it("keeps the underlying claude invocation intact", () => {
    const { command, stdin } = printCommand();
    expect(command.startsWith("claude ")).toBe(true);
    expect(command).toContain("--model 'claude-opus-4-8'");
    expect(command).toContain("--output-format stream-json");
    expect(command.endsWith("-p -")).toBe(true);
    expect(stdin).toBe("plan it");
  });
});
