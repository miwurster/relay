import { describe, expect, it, vi } from "vitest";
import { parseArgs, runCli, type CliHandlers } from "../src/cli.js";
import { SelectionError } from "../src/errors.js";
import { ExitCode } from "../src/exit-codes.js";

describe("parseArgs", () => {
  it("treats a bare positional as a pass over that work item", () => {
    expect(parseArgs(["PROJ-123"])).toEqual({
      kind: "pass",
      workItem: "PROJ-123",
    });
  });

  it("treats the `doctor` keyword as the doctor command", () => {
    expect(parseArgs(["doctor"])).toEqual({ kind: "doctor" });
  });

  it("treats no argument as an auto-pick pass", () => {
    expect(parseArgs([])).toEqual({ kind: "pass", workItem: undefined });
  });
});

describe("runCli", () => {
  const handlers = (): CliHandlers => ({
    runPass: vi.fn(async () => ExitCode.Success),
    runDoctor: vi.fn(async () => ExitCode.Success),
  });

  it("dispatches a named work item to runPass and returns its exit code", async () => {
    const h = handlers();
    const code = await runCli(["PROJ-123"], h);
    expect(h.runPass).toHaveBeenCalledWith("PROJ-123");
    expect(code).toBe(ExitCode.Success);
  });

  it("dispatches no argument to runPass with no work item", async () => {
    const h = handlers();
    await runCli([], h);
    expect(h.runPass).toHaveBeenCalledWith(undefined);
  });

  it("dispatches `doctor` to runDoctor", async () => {
    const h = handlers();
    await runCli(["doctor"], h);
    expect(h.runDoctor).toHaveBeenCalledOnce();
    expect(h.runPass).not.toHaveBeenCalled();
  });

  it("propagates a handler's non-success exit code", async () => {
    const h = handlers();
    h.runPass = vi.fn(async () => ExitCode.Blocked);
    expect(await runCli([], h)).toBe(ExitCode.Blocked);
  });

  it("maps an ineligible work item to the error exit code", async () => {
    const h = handlers();
    h.runPass = vi.fn(async () => {
      throw new SelectionError("PROJ-123 is a Task — relay only runs Story, Bug, Vulnerability.");
    });
    expect(await runCli(["PROJ-123"], h)).toBe(ExitCode.Error);
  });

  it("maps an unexpected handler crash to the error exit code", async () => {
    const h = handlers();
    h.runPass = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await runCli([], h)).toBe(ExitCode.Error);
  });
});
