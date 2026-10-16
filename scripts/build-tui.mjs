// Precompiles the OpenCode TUI entry to `dist/tui.js`.
//
// OpenCode installs an npm/GitHub TUI plugin under
// `~/.cache/opencode/packages/<spec>/node_modules/<pkg>/`, and OpenTUI's Solid
// transform excludes anything under `node_modules`. So a raw `src/tui.tsx`
// there is never JSX-compiled and its `@opentui/solid` import resolves to the
// plugin's own (separate) renderer instance — the panel then registers against
// a renderer the app isn't using and silently never shows. Shipping this
// precompiled bundle (with the framework imports left literal, for the host to
// rewrite onto its own copies) is the fix. `--ignore-scripts` on install means
// `dist/tui.js` has to be committed.

import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";

await build({
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  jsx: "automatic",
  external: [
    "solid-js",
    "solid-js/*",
    "@opentui/core",
    "@opentui/core/*",
    "@opentui/solid",
    "@opentui/solid/*",
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/*",
    "node:*",
  ],
  plugins: [solidPlugin({ solid: { generate: "universal", moduleName: "@opentui/solid" } })],
  logLevel: "info",
});
