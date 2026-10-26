# browgent

[![npm](https://img.shields.io/npm/v/browgent.svg)](https://www.npmjs.com/package/browgent)
[![build](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)]()
[![playwright](https://img.shields.io/badge/playwright-1.49+-purple.svg)]()
[![mcp](https://img.shields.io/badge/mcp-27%20tools-orange.svg)]()
[![license](https://img.shields.io/badge/license-MIT-green.svg)]()

> Production-ready headless agent browser. Scrape, navigate, click, fill, evaluate, screenshot — fully scriptable via MCP.

## Install

```bash
npm install -g browgent
```

No clone. No rebuild. Playwright Chrome downloads automatically.

## Start

```bash
# Headless agent browser
browgent --headless --port=9222

# MCP server (27 agent tools, stdio)
browgent-mcp
```

## Quick Script Use

```bash
node -e "
const { agentBrowser } = require('browgent');
await agentBrowser.launch({ headless: true });
await agentBrowser.newSession('agent');
await agentBrowser.newPage('agent', 'p1', 'https://example.com');
await agentBrowser.navigate('p1', 'https://example.com');
const shot = await agentBrowser.screenshot('p1');
console.log('Screenshot ready');
await agentBrowser.close();
"
```

## What browgent does

- **Headless Chromium** via Playwright (no Electron, no GPU crash)
- **Session isolation** — each session = separate BrowserContext
- **Full scraping** — navigate, click, fill, press, evaluate JS
- **Screenshots** — viewport or full-page PNG (base64 / file)
- **DOM extraction** — recursive tree (tag/id/class/text/children)
- **Wait / navigate / back / forward / reload / viewport / cookies**
- **MCP server** — 27 tools callable by any AI agent

## 27 MCP Agent Tools

| Tool | Purpose |
|---|---|
| `browser_launch` | Start Chrome headless |
| `browser_close` | Shutdown |
| `browser_new_session` | New isolated context |
| `browser_close_session` | Close context |
| `browser_new_page` | Open tab |
| `browser_close_page` | Close tab |
| `browser_navigate` | Go to URL |
| `browser_click` | Click by CSS selector |
| `browser_fill` | Fill input |
| `browser_press` | Press key |
| `browser_evaluate` | Run JS |
| `browser_screenshot` | PNG screenshot |
| `browser_dom` | Extract DOM tree |
| `browser_back` | History back |
| `browser_forward` | History forward |
| `browser_reload` | Reload |
| `browser_wait_for_selector` | Wait element |
| `browser_list_pages` | List tabs |
| `browser_list_sessions` | List contexts |
| `browser_get_url` | Current URL |
| `browser_get_title` | Page title |
| `browser_set_viewport` | Resize viewport |
| `browser_upload_file` | Upload to input |
| `browser_wait_for_navigation` | Wait nav |
| `browser_get_cookies` | Read cookies |
| `browser_clear_cookies` | Clear cookies |
| `browser_add_script_tag` | Inject script |

## Source (scraping / finding only)

```
src/agent-browser/
  browser.ts     — Playwright scraping engine
  mcp.ts         — MCP server (27 tools)
  dual.ts        — dual-browser architecture
scripts/
  agent-browser     — launcher
  agent-browser-mcp — MCP launcher
  auto-install.sh   — setup
  package-standalone.sh — full package
.gitignore         — standalone
```

## Setup / Fix

```bash
npm install -g browgent
# Playwright binary installed automatically
# If Chrome binary missing: npm run install
browgent --headless --port=9222
```

## Architecture

```
Agent (MCP) → browgent-mcp → browser.ts → Playwright → Chrome headless
              ↓
         session isolation (BrowserContext)
         full DOM / screenshot / evaluate / navigate
```

## License

MIT — production-ready, standalone, agent-owned.

## Browser Engine
Yes — Chromium (Chrome for Testing headless shell, verified v156.0.8078.4). Same engine as real Chrome.

## Can it do all? (honest)
- **Search**: yes — navigate to any search engine with query
- **Submit / forms**: yes — fill + click/press
- **Find / extract**: yes — DOM tree + evaluate JS + selectors
- **Login**: yes — session isolation + cookies + navigate + fill; agent provides credentials
- **Repeat / loop**: agent decides loop; browser executes per call
- **Captcha**: agent reads screenshot/DOM; solves; brain decides; browser executes — no auto-captcha module
- **Deep automation**: agent scripts multi-step via evaluate + click + wait loops
- **Not built-in**: AI vision (agent reads PNG/DOM), auto-login vault, auto-captcha solver

## Agent Help Prompt (copy into your AI agent)

You have browgent — a headless Chromium agent browser (Playwright). You can:

- Launch / navigate / screenshot / evaluate JS / click / fill / press / wait / back / reload / DOM / cookies / viewport / upload
- Use session IDs to isolate agent instances (cookies/logins separate per session)
- Call any of 27 MCP tools via `browgent-mcp`

For complex tasks (login, captcha, multi-step repeat, deep find):
1. `browser_navigate(url)`
2. `browser_screenshot()` or `browser_dom()` to see state
3. `browser_evaluate(script)` to read/extract/find elements
4. `browser_click()` / `browser_fill()` to interact
5. Loop / repeat via your own reasoning (the browser executes; you plan)
6. Captcha / complex auth: use `browser_evaluate()` to read page hints; agent decides; browser executes

This is Chromium (Chrome for Testing headless shell) — same engine as real Chrome.
