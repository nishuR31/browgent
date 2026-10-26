#!/usr/bin/env bash
# One-command full package: install + build + start headless + capture first test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

bash scripts/auto-install.sh

echo "Starting headless agent browser on port 9222..."
bash scripts/agent-browser --port=9222 &
sleep 3

echo "Capturing first screenshot..."
node -e "
import { agentBrowser } from './dist/agent-browser/browser.js';
await agentBrowser.launch({ headless: true, viewport: { width: 1280, height: 720 } });
await agentBrowser.newSession('first');
await agentBrowser.newPage('first', 'first-tab', 'https://example.com');
await new Promise(r => setTimeout(r, 1500));
const s = await agentBrowser.screenshot('first-tab', false);
if (s.ok && s.data) {
  const fs = await import('fs'); fs.writeFileSync('./pics/auto-first.png', Buffer.from(s.data, 'base64'));
  console.log('Auto-capture saved to pics/auto-first.png');
}
await agentBrowser.close();
" 2>&1 | grep -E "Auto|saved" | head

echo "Package complete. All standalone. Launch: bash scripts/agent-browser"
echo "MCP server: node dist/agent-browser/mcp.js"
echo ".gitignore: ignores node_modules, dist, logs, pics png"
