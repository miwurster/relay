import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureIgnored, isIgnored, type IgnoreRule } from "../../src/host/gitignore.js";

/** A rule in a nested `.gitignore`, so the operations have a directory to create. */
const RULE: IgnoreRule = {
  file: "nested/.gitignore",
  entries: ["secrets/"],
  why: "What a relay pass keeps out of git.",
};

const ENTRY_LINES = "# What a relay pass keeps out of git.\nsecrets/\n";

/** A rule whose entries share one reason, so one comment covers both. */
const TWO_ENTRY_RULE: IgnoreRule = {
  ...RULE,
  entries: ["secrets/", "records/"],
};

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "relay-gitignore-"));
}

/** A repo root whose rule file holds the given contents. */
async function repoWithIgnoreFile(contents: string): Promise<string> {
  const repoRoot = await tempRepo();
  const path = join(repoRoot, RULE.file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return repoRoot;
}

describe("isIgnored", () => {
  it.each(["secrets", "secrets/", "/secrets", "/secrets/", "  secrets/  "])(
    "recognises %j as carrying the entry",
    async (line) => {
      const repoRoot = await repoWithIgnoreFile(`dist\n${line}\nnode_modules/\n`);
      expect(await isIgnored(repoRoot, RULE)).toBe(true);
    },
  );

  it("does not mistake a comment for an entry", async () => {
    expect(await isIgnored(await repoWithIgnoreFile("# secrets/\n"), RULE)).toBe(false);
  });

  it("does not match a longer path that merely starts the same", async () => {
    expect(await isIgnored(await repoWithIgnoreFile("secrets-old/\n"), RULE)).toBe(false);
  });

  it("is false when the repo has no such file", async () => {
    expect(await isIgnored(await tempRepo(), RULE)).toBe(false);
  });

  it("is false when the file carries only some of a rule's entries", async () => {
    const repoRoot = await repoWithIgnoreFile("secrets/\n");

    expect(await isIgnored(repoRoot, TWO_ENTRY_RULE)).toBe(false);
  });

  it("is true when the file carries every entry", async () => {
    const repoRoot = await repoWithIgnoreFile("secrets/\nrecords/\n");

    expect(await isIgnored(repoRoot, TWO_ENTRY_RULE)).toBe(true);
  });
});

describe("ensureIgnored", () => {
  it("writes the entry alone into a file the repo did not have", async () => {
    const repoRoot = await tempRepo();

    expect(await ensureIgnored(repoRoot, RULE)).toBe(true);
    expect(await readFile(join(repoRoot, RULE.file), "utf8")).toBe(ENTRY_LINES);
  });

  it("appends after a blank line, keeping what was there", async () => {
    const repoRoot = await repoWithIgnoreFile("dist\n");

    expect(await ensureIgnored(repoRoot, RULE)).toBe(true);
    expect(await readFile(join(repoRoot, RULE.file), "utf8")).toBe(`dist\n\n${ENTRY_LINES}`);
  });

  it("closes a file that did not end in a newline", async () => {
    const repoRoot = await repoWithIgnoreFile("dist");

    await ensureIgnored(repoRoot, RULE);
    expect(await readFile(join(repoRoot, RULE.file), "utf8")).toBe(`dist\n\n${ENTRY_LINES}`);
  });

  it("leaves a file that already carries the entry alone", async () => {
    const repoRoot = await repoWithIgnoreFile("dist\n/secrets\n");

    expect(await ensureIgnored(repoRoot, RULE)).toBe(false);
    expect(await readFile(join(repoRoot, RULE.file), "utf8")).toBe("dist\n/secrets\n");
  });

  it("writes a rule's entries under one comment", async () => {
    const repoRoot = await tempRepo();

    expect(await ensureIgnored(repoRoot, TWO_ENTRY_RULE)).toBe(true);
    expect(await readFile(join(repoRoot, TWO_ENTRY_RULE.file), "utf8")).toBe(
      "# What a relay pass keeps out of git.\nsecrets/\nrecords/\n",
    );
  });

  it("appends only the entries the file was missing", async () => {
    const repoRoot = await repoWithIgnoreFile("secrets/\n");

    expect(await ensureIgnored(repoRoot, TWO_ENTRY_RULE)).toBe(true);
    expect(await readFile(join(repoRoot, TWO_ENTRY_RULE.file), "utf8")).toBe(
      "secrets/\n\n# What a relay pass keeps out of git.\nrecords/\n",
    );
  });

  it("writes contents the predicate then recognises", async () => {
    const repoRoot = await repoWithIgnoreFile("dist\n");
    await ensureIgnored(repoRoot, RULE);

    expect(await isIgnored(repoRoot, RULE)).toBe(true);
  });
});
