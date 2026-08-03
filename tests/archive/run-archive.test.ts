import { describe, expect, it } from "vitest";
import { runArchive } from "../../src/archive/run-archive.js";
import { SelectionError } from "../../src/errors.js";

describe("runArchive", () => {
  it("refuses without a work item, because an archive is of one named pass", async () => {
    await expect(runArchive(undefined)).rejects.toThrow(SelectionError);
  });

  it("refuses an argument that names no issue", async () => {
    await expect(runArchive("the last one")).rejects.toThrow(SelectionError);
  });
});
