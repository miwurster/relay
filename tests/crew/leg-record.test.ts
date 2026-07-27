import { describe, expect, it } from "vitest";
import { doctorRecordDir, passRecordDir } from "../../src/crew/leg-record.js";

describe("leg record directories", () => {
  it("gives a pass its own directory, named after the work item", () => {
    expect(passRecordDir("/repo", 42)).toBe("/repo/.relay/42");
  });

  it("gives the gate probe a named directory, so it is never a pass's", () => {
    expect(doctorRecordDir("/repo")).toBe("/repo/.relay/doctor");
  });
});
