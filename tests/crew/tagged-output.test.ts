import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RoleError } from "../../src/errors.js";
import { readTaggedOutput } from "../../src/crew/tagged-output.js";

const schema = z.object({ answer: z.number() });

const read = (stdout: string) =>
  readTaggedOutput({ stdout, tag: "result", schema, role: "tester" });

describe("readTaggedOutput", () => {
  it("reads the tagged JSON out of the surrounding prose", () => {
    expect(read('Here you go.\n<result>{"answer": 42}</result>\nDone.')).toEqual({ answer: 42 });
  });

  it("takes the last block when the role emitted more than one", () => {
    expect(read('<result>{"answer": 1}</result> then <result>{"answer": 2}</result>')).toEqual({
      answer: 2,
    });
  });

  it("unwraps a fenced block", () => {
    expect(read('<result>\n```json\n{"answer": 7}\n```\n</result>')).toEqual({ answer: 7 });
  });

  it("fails when the role emitted no block", () => {
    expect(() => read("I had a lovely time thinking about it.")).toThrow(RoleError);
  });

  it("fails when the block is not JSON", () => {
    expect(() => read("<result>the answer is 42</result>")).toThrow(RoleError);
  });

  it("fails when the block does not match the schema", () => {
    expect(() => read('<result>{"answer": "42"}</result>')).toThrow(/tester/);
  });
});
