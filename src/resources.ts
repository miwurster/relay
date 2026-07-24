import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to a shipped data file under the `resources` directory that
 * sits beside this module (in both `src` during dev and `dist` once built).
 */
export function resourcePath(...segments: string[]): string {
  return fileURLToPath(new URL(`./resources/${segments.join("/")}`, import.meta.url));
}

/** Read a shipped resource file as UTF-8 text. */
export function readResource(...segments: string[]): Promise<string> {
  return readFile(resourcePath(...segments), "utf8");
}
