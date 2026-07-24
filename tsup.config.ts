import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main.ts",
  },
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  platform: "node",
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: true,
  treeshake: true,
});
