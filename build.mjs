import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "bin/aniterm.cjs",
  banner: { js: "#!/usr/bin/env node" },
});

console.log("Build complete: bin/aniterm.cjs");
