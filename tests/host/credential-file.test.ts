import { describe, expect, it } from "vitest";
import { CREDENTIAL_FILE_PATH } from "../../src/config.js";
import { credentialFileIgnored, credentialFilePath } from "../../src/host/credential-file.js";

describe("credentialFilePath", () => {
  it("points at the credential file in the target repo", () => {
    expect(credentialFilePath("/work/repo")).toBe("/work/repo/.relay/.env");
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
