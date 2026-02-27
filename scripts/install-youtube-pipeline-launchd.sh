#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/scripts/com.daglo.youtube-pipeline.plist.example"
PLIST_DST="$HOME/Library/LaunchAgents/com.daglo.youtube-pipeline.plist"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "Template not found: $PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"

echo "Installed launchd plist template to: $PLIST_DST"
echo "Next steps:"
echo "1) Edit ProgramArguments/EnvironmentVariables in $PLIST_DST"
echo "2) launchctl unload $PLIST_DST 2>/dev/null || true"
echo "3) launchctl load $PLIST_DST"
echo "4) launchctl start com.daglo.youtube-pipeline"
