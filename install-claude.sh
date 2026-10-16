#!/usr/bin/env bash
# One-step install of the water-bar band above the Claude Code prompt.
#
# The band is plain TypeScript run by Claude Code itself: nothing else to
# install. Re-running is safe.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code ('claude') is not on PATH. Inside Claude Code, run:" >&2
  echo "  /plugin install water-bar --marketplace $REPO_DIR" >&2
  exit 1
fi

if claude plugin list 2>/dev/null | grep -q "water-bar@water-bar"; then
  echo "==> Updating water-bar"
  # Re-read this checkout's marketplace file.
  claude plugin marketplace update water-bar
  claude plugin update water-bar@water-bar --scope user
else
  echo "==> Installing water-bar"
  # A folder marketplace: Claude Code reads the plugin from this checkout, so
  # pulling new commits and running /reload-plugins picks them up.
  claude plugin install water-bar --marketplace "$REPO_DIR" --scope user
fi

echo
echo "Done. Start a new Claude Code session (or run /reload-plugins in an open one)."
echo "The water band appears above the prompt after the first reply."
