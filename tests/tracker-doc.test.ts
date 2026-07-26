import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import { TRACKER_DOC_PATH, loadTrackerScope } from "../src/tracker-doc.js";

async function repoWithTrackerDoc(contents?: string): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "relay-tracker-"));
  if (contents !== undefined) {
    const path = join(repoRoot, TRACKER_DOC_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return repoRoot;
}

const trackerDoc = `# Issue tracker: Jira

Issues and specs for this repo live in Jira, reached through the **Atlassian MCP**.

## Setup constants

- **Jira project key:** \`PSD\` — every issue for this repo is created in this project.
- **Repo label:** \`repo:qc-catalog\` — the only thing that scopes work to this repo.
- **Cloud id:** \`35183b42-c98a-4cd0-a8a7-32a27ea7856e\` — the site id.
`;

describe("loadTrackerScope", () => {
  it("reads the project key and repo label from the setup constants", async () => {
    const repoRoot = await repoWithTrackerDoc(trackerDoc);

    await expect(loadTrackerScope(repoRoot)).resolves.toEqual({
      projectKey: "PSD",
      repoLabel: "repo:qc-catalog",
    });
  });

  it("fails when the tracker doc is absent", async () => {
    const repoRoot = await repoWithTrackerDoc();

    await expect(loadTrackerScope(repoRoot)).rejects.toThrow(ConfigError);
  });

  it("names every missing constant at once", async () => {
    const repoRoot = await repoWithTrackerDoc("# Issue tracker: Local Markdown\n");

    await expect(loadTrackerScope(repoRoot)).rejects.toThrow(/Jira project key.*Repo label/s);
  });
});
