#!/bin/zsh
set -euo pipefail

project_path="$(cd "$(dirname "$0")/.." && pwd)"
npm_path="$(command -v npm)"
template_path="$project_path/scripts/com.personal-dashboard.agent.plist.template"
target_path="$HOME/Library/LaunchAgents/com.personal-dashboard.agent.plist"

mkdir -p "$project_path/backend/data" "$HOME/Library/LaunchAgents"
sed -e "s|__PROJECT_PATH__|$project_path|g" -e "s|__NPM_PATH__|$npm_path|g" "$template_path" > "$target_path"
launchctl bootout "gui/$(id -u)" "$target_path" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$target_path"
echo "Installed Personal Dashboard agent at $target_path"
