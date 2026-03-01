import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  external: ["keytar"],
  noExternal: [/@modelcontextprotocol\/sdk/, /^env-paths$/, /^zod$/]
});
