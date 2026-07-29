import { defineConfig } from "vitest/config";

/**
 * The sandbox probe's own runner, deliberately not part of `npm run verify`.
 *
 * relay's green gate runs inside a sandbox during a pass over this repo, so a
 * sandbox-opening test inside that gate would nest — and every leg of every
 * pass would pay an image build for it. Hand-run instead: `npm run test:sandbox`.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.probe.ts"],
    // One probe, one image build, one container: nothing here is parallel, and
    // two probes sharing the fixture's clone would race on its refs.
    fileParallelism: false,
  },
});
