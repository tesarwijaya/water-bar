#!/usr/bin/env bash
# Wire this checkout into OpenCode as a plugin. The repo root is the plugin
# root (package.json -> ./src/index.ts, ./src/tui.tsx), the same folder Claude
# Code loads. The estimator is ./core, imported relatively, so nothing escapes
# the package.
#
# Re-running is safe: entries are de-duplicated, and the stale
# `<repo>/opencode-plugin` entries the older layout wrote are removed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

if [ ! -f "$REPO_DIR/src/index.ts" ] || [ ! -f "$REPO_DIR/src/tui.tsx" ]; then
  echo "Plugin source not found: expected $REPO_DIR/src/index.ts and $REPO_DIR/src/tui.tsx." >&2
  exit 1
fi

if [ ! -d "$CONFIG_DIR" ]; then
  echo "OpenCode config directory not found: $CONFIG_DIR" >&2
  echo "Run OpenCode once, or set OPENCODE_CONFIG_DIR to your config directory." >&2
  exit 1
fi

SERVER_ENTRY="file://$REPO_DIR"
TUI_ENTRY="file://$REPO_DIR/src/tui.tsx"

node - "$CONFIG_DIR" "$SERVER_ENTRY" "$TUI_ENTRY" "$REPO_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [configDir, serverEntry, tuiEntry, repoDir] = process.argv.slice(2);

// What the pre-restructure installer wrote, when the plugin lived in opencode-plugin/.
const STALE = `file://${repoDir}/opencode-plugin`;

// Ensure `entry` is in the file's `"plugin": [...]` array, dropping any stale
// entry and any duplicate. Returns true if the file changed.
function wire(file, entry) {
  const token = JSON.stringify(entry);
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  const array = /("plugin"\s*:\s*\[)([\s\S]*?)(\])/;
  const match = text.match(array);

  if (match) {
    const items = match[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = items.filter((it) => !it.includes(STALE) && it !== token);
    next.push(token);
    if (JSON.stringify(next) === JSON.stringify(items)) return false;
    text = text.replace(array, (_m, open, _body, close) => `${open}${next.join(", ")}${close}`);
  } else {
    const body = text.trim() === "" ? "{\n}\n" : text;
    const brace = body.indexOf("{");
    if (brace === -1) {
      console.error(`Not a JSON object: ${file}`);
      process.exit(1);
    }
    const insert = `\n  "plugin": [${token}],`;
    text = body.slice(0, brace + 1) + insert + body.slice(brace + 1);
  }
  fs.writeFileSync(file, text);
  return true;
}

function ensureDependency(file, name, range) {
  let pkg = {};
  if (fs.existsSync(file)) pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.dependencies = pkg.dependencies || {};
  if (pkg.dependencies[name]) return false;
  pkg.dependencies[name] = range;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

const tuiFile = path.join(configDir, "tui.json");
const jsonc = path.join(configDir, "opencode.jsonc");
const json = path.join(configDir, "opencode.json");
const serverFile = fs.existsSync(jsonc) ? jsonc : json;

console.log(
  JSON.stringify({
    tui: wire(tuiFile, tuiEntry),
    server: wire(serverFile, serverEntry),
    dependency: ensureDependency(path.join(configDir, "package.json"), "@opencode-ai/plugin", ">=1.0.0"),
  }),
);
NODE

echo "OpenCode water-bar plugin wired up:"
echo "  tool plugin    : $SERVER_ENTRY"
echo "  sidebar plugin : $TUI_ENTRY"
echo "  config dir     : $CONFIG_DIR"
echo "Restart OpenCode to load it."
