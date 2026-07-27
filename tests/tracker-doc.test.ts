import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { TRACKER_DOC_PATH, requireTrackerDoc } from "../src/tracker-doc.js";

async function repoWithTrackerDoc(contents?: string): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "relay-tracker-"));
  if (contents !== undefined) {
    const path = join(repoRoot, TRACKER_DOC_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return repoRoot;
}

describe("requireTrackerDoc", () => {
  it("passes on a repo that commits the doc, whatever it says", async () => {
    const repoRoot = await repoWithTrackerDoc("# Issue tracker: GitHub\n");

    await expect(requireTrackerDoc(repoRoot)).resolves.toBeUndefined();
  });

  it("fails with the path when the tracker doc is absent", async () => {
    const repoRoot = await repoWithTrackerDoc();

    await expect(requireTrackerDoc(repoRoot)).rejects.toThrow(ConfigError);
    await expect(requireTrackerDoc(repoRoot)).rejects.toThrow(/issue-tracker\.md/);
  });
});
