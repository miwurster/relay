import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { SandboxRunOptions } from "@ai-hero/sandcastle";
import { expect } from "vitest";
import { resourcePath } from "../../../src/resources.js";

/** The placeholder form sandcastle substitutes an argument into. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Hold one captured run to what relay owes sandcastle: the role's own prompt as
 * a file on disk, never an inline prompt, whose placeholders are exactly the
 * arguments the role passed.
 *
 * Both halves fail at run time rather than in review — sandcastle refuses
 * arguments handed to an inline prompt, and a placeholder with no argument
 * aborts the run — so every role asserts them here rather than each in its own
 * words.
 */
export async function expectPromptParity(
  run: SandboxRunOptions | undefined,
  resource: string,
): Promise<void> {
  expect(run?.prompt).toBeUndefined();

  const promptFile = resourcePath(resource);
  expect(isAbsolute(promptFile)).toBe(true);
  expect(run?.promptFile).toBe(promptFile);

  const prompt = await readFile(promptFile, "utf8");
  expect(placeholdersOf(prompt)).toEqual(Object.keys(run?.promptArgs ?? {}).sort());
}

function placeholdersOf(prompt: string): string[] {
  const keys = [...prompt.matchAll(PLACEHOLDER)].map(([, key]) => key ?? "");
  return [...new Set(keys)].sort();
}
