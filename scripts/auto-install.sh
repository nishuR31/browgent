#!/usr/bin/env bash
# Auto-install: dependency + browser binary + build
set -euo pipefail

echo "Installing dependencies..."
npm install 2>&1 | tail -3

echo "Installing Playwright Chromium..."
npx playwright install chromium 2>&1 | tail -3 || echo "Playwright binary may already be present"

echo "Building agent browser..."
npm run build 2>&1 | tail -3

echo "Standalone agent browser ready. Launch: bash scripts/agent-browser"
echo "Or direct: node dist/agent-browser/mcp.js"
