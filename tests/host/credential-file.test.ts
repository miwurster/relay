import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_FILE_PATH, RELAY_DIR, RELAY_GITIGNORE_PATH } from "../../src/config.js";
import {
  credentialFileIgnored,
  credentialFilePath,
  ignoresCredentialFile,
  readRelayGitignore,
  withCredentialFileIgnored,
} from "../../src/host/credential-file.js";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-credential-file-"));
}

/** A repo root whose `.relay/.gitignore` holds the given contents. */
async function repoWithRelayGitignore(contents: string): Promise<string> {
  const repoRoot = await tempRepo();
  await mkdir(join(repoRoot, RELAY_DIR), { recursive: true });
  await writeFile(join(repoRoot, RELAY_GITIGNORE_PATH), contents, "utf8");
  return repoRoot;
}

describe("credentialFilePath", () => {
  it("points at the credential file in the target repo", () => {
    expect(credentialFilePath("/work/repo")).toBe("/work/repo/.relay/.env");
  });
});

describe("readRelayGitignore", () => {
  it("reads the contents of relay's own .gitignore", async () => {
    const repoRoot = await repoWithRelayGitignore(".env\n");
    expect(await readRelayGitignore(repoRoot)).toBe(".env\n");
  });

  it("is empty when relay's directory has no .gitignore", async () => {
    expect(await readRelayGitignore(await tempRepo())).toBe("");
  });
});

describe("ignoresCredentialFile", () => {
  it("recognises the bare entry", () => {
    expect(ignoresCredentialFile(".env\n")).toBe(true);
  });

  it("recognises a rooted entry among other lines", () => {
    expect(ignoresCredentialFile("*.log\n/.env\n")).toBe(true);
  });

  it("does not mistake a wider pattern for the entry", () => {
    expect(ignoresCredentialFile(".env.local\n")).toBe(false);
  });

  it("is false for empty contents", () => {
    expect(ignoresCredentialFile("")).toBe(false);
  });
});

describe("withCredentialFileIgnored", () => {
  it("writes the whole file when relay's directory has no .gitignore", () => {
    expect(withCredentialFileIgnored("")).toBe(
      "# The credentials a relay pass runs on. Never commit this.\n.env\n",
    );
  });

  it("appends to existing contents rather than replacing them", () => {
    expect(withCredentialFileIgnored("scratch/\n")).toBe(
      "scratch/\n\n# The credentials a relay pass runs on. Never commit this.\n.env\n",
    );
  });

  it("separates from contents that do not end in a newline", () => {
    expect(withCredentialFileIgnored("scratch/")).toContain("scratch/\n\n#");
  });
});

describe("credentialFileIgnored", () => {
  it("is true when git says the credential file is ignored", async () => {
    const calls: string[][] = [];
    const git = async (args: readonly string[]) => {
      calls.push([...args]);
      return "";
    };

    expect(await credentialFileIgnored({ repoRoot: "/repo", git })).toBe(true);
    expect(calls).toEqual([["-C", "/repo", "check-ignore", "-q", CREDENTIAL_FILE_PATH]]);
  });

  it("is false when git exits non-zero, which is how it says not ignored", async () => {
    const git = async () => {
      throw new Error("git check-ignore -q .relay/.env failed: Command failed");
    };
    expect(await credentialFileIgnored({ repoRoot: "/repo", git })).toBe(false);
  });
});
