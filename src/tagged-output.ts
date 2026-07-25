import type { z } from "zod";
import { RoleError } from "./errors.js";

/**
 * Read a role's answer out of the `<tag>…</tag>` block it ended its run with.
 *
 * A role talks its way to an answer, so the answer is only usable when it is
 * fenced off from the prose around it. The last block wins: a role that
 * corrected itself means the correction.
 */
export function readTaggedOutput<Schema extends z.ZodType>({
  stdout,
  tag,
  schema,
  role,
}: {
  stdout: string;
  tag: string;
  schema: Schema;
  role: string;
}): z.infer<Schema> {
  const block = lastBlock(stdout, tag);
  if (block === undefined) {
    throw new RoleError(`The ${role} emitted no <${tag}> block.`);
  }

  const result = schema.safeParse(parseJson(block, tag, role));
  if (!result.success) {
    throw new RoleError(`The ${role}'s <${tag}> block does not fit: ${result.error.message}`);
  }
  return result.data;
}

function lastBlock(stdout: string, tag: string): string | undefined {
  const blocks = [...stdout.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))];
  return blocks.at(-1)?.[1];
}

function parseJson(block: string, tag: string, role: string): unknown {
  try {
    return JSON.parse(unwrapFence(block.trim()));
  } catch {
    throw new RoleError(`The ${role}'s <${tag}> block is not JSON.`);
  }
}

/** Agents habitually fence JSON, and the fence is not part of the answer. */
function unwrapFence(block: string): string {
  return /^```(?:json)?\n([\s\S]*)\n```$/.exec(block)?.[1] ?? block;
}
