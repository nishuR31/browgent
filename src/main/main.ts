import { app, BrowserWindow, ipcMain, session, WebContentsView, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

// Input validation helpers
function isValidUUID(s: any): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}
function isValidURL(s: any): s is string {
  if (typeof s !== 'string') return false;
  if (s === 'about:blank') return true;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
function isValidSelector(s: any): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 500 && !/<script|<iframe|javascript:/i.test(s);
}

let win: BrowserWindow;

type Tab = { id: string; view: WebContentsView; title: string; url: string; cdpPort?: number };
type Island = {
  id: string;
  name: string;
  color: string;
  partition: string;
  tabs: Map<string, Tab>;
  activeTabId: string | null;
};
const islands = new Map<string, Island>();
let nextCdpPort = 9323;

type PrivacyLevel = 'balanced' | 'strict' | 'maximum';
let privacyLevel: PrivacyLevel = 'balanced';
const trackerHosts = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'facebook.net',
  'connect.facebook.net', 'hotjar.com', 'segment.io', 'mixpanel.com',
];
const LOW_END_MEM_KB = 4 * 1024 * 1024;

function isLowEnd() {
  try {
    const mem = process.getSystemMemoryInfo();
    return Boolean(mem.total && mem.total < LOW_END_MEM_KB);
  } catch { return false; }
}

function gpuFlags(extra: string[] = []): string[] {
  const forceNoGpu = process.env.SESSION_BROWSER_FORCE_NO_GPU === '1' || isLowEnd();
  const base = [
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-ipc-flooding-protection',
    '--disable-features=TranslateUI,BlinkGenPropertyTrees,NetworkServiceInProcess2',
    '--aggressive-cache-discard',
    '--memory-pressure-off',
    '--max_old_space_size=256',
  ];
  if (forceNoGpu) base.push('--disable-gpu', '--disable-software-rasterizer', '--disable-gpu-compositing');
  return [...base, ...extra];
}

const HEADLESS = process.env.SESSION_BROWSER_HEADLESS === '1' || process.argv.includes('--headless');

for (const flag of gpuFlags()) {
  const [name, ...rest] = flag.split('=');
  app.commandLine.appendSwitch(name, rest.join('='));
}

let panelRightOffset = 0;
const bounds = () => ({ x: 0, y: 70, width: Math.max(1, win.getBounds().width - panelRightOffset), height: Math.max(1, win.getBounds().height - 70) });

const sessionEvents = new Map<string, { console: any[]; errors: any[]; network: any[] }>();
const MAX_EVENTS = 500;

function pushEvent(tabId: string, kind: 'console' | 'errors' | 'network', ev: any) {
  const bucket = sessionEvents.get(tabId);
  if (!bucket) return;
  bucket[kind].push(ev);
  if (bucket[kind].length > MAX_EVENTS) bucket[kind].shift();
  try {
    const islandId = [...islands.entries()].find(([, i]) => i.tabs.has(tabId))?.[0];
    win?.webContents.send('session:event', { sessionId: tabId, islandId, kind, event: ev });
  } catch {}
}

function setupTabDebugger(view: WebContentsView, tabId: string) {
  const attached = view.webContents.debugger;
  sessionEvents.set(tabId, { console: [], errors: [], network: [] });
  const enable = (method: string) => (attached.sendCommand as any)(method, {}).catch(() => {});
  enable('Page.enable');
  enable('Runtime.enable');
  enable('Network.enable');
  enable('Fetch.enable');
  attached.on('message', (_event: any, method: string, params: any, _sid: string) => {
    if (method === 'Page.console') pushEvent(tabId, 'console', params);
    else if (method === 'Runtime.exceptionThrown') pushEvent(tabId, 'errors', params);
    else if (method === 'Network.requestWillBeSent') pushEvent(tabId, 'network', params);
    else if (method === 'Fetch.requestPaused') pushEvent(tabId, 'network', { ...params, type: 'fetch_paused' });
  });
  return attached;
}

function startCdpProxy(view: WebContentsView, tabId: string, port: number) {
  const wss = new WebSocketServer({ port });
  let conns = 0;
  const attached = view.webContents.debugger;
  const broadcast = (msg: string) => {
    wss.clients.forEach((c) => { if (c.readyState === c.OPEN) c.send(msg); });
  };
  attached.on('message', (_event: any, method: string, params: any, _sid: string) => {
    broadcast(JSON.stringify({ method, params }));
  });
  wss.on('connection', (ws, _req) => {
    if (!attached) { ws.close(1011, 'debugger not attached'); return; }
    let closed = false;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    const onClientMessage = (data: string | Buffer) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      try {
        const payload = JSON.parse(String(data));
        if (payload && typeof payload === 'object' && typeof payload.id === 'number' && payload.method) {
          pending.set(payload.id, { resolve: () => {}, reject: () => {} });
          (attached.sendCommand as any)(payload.method, payload.params ?? {}).then((result: any) => {
            const p = pending.get(payload.id);
            if (p && !closed && ws.readyState === ws.OPEN) { p.resolve(result); ws.send(JSON.stringify({ id: payload.id, result })); }
            pending.delete(payload.id);
          }).catch((err: any) => {
            const p = pending.get(payload.id);
            if (p && !closed && ws.readyState === ws.OPEN) { p.reject(err); ws.send(JSON.stringify({ id: payload.id, error: { message: String(err) } })); }
            pending.delete(payload.id);
          });
        } else if (payload && typeof payload === 'object' && typeof payload.id === 'number') {
          const p = pending.get(payload.id);
          if (p) { p.reject(new Error('no method')); pending.delete(payload.id); }
        }
      } catch {}
    };
    ws.on('message', onClientMessage);
    attached.on('message', (_event: any, method: string, params: any, _sid: string) => {
      if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ method, params }));
    });
    ws.on('close', () => { closed = true; ws.removeListener('message', onClientMessage); conns--; if (conns <= 0) attached.removeListener('message', broadcast as any); });
    ws.on('error', () => { closed = true; });
    conns++;
  });
  wss.on('error', () => {});
  return wss;
}

function makeTab(islandId: string, url: string): Tab {
  const island = islands.get(islandId);
  if (!island) throw new Error('island not found');
  const id = crypto.randomUUID();
  const ses = session.fromPartition(island.partition);
  const view = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, offscreen: false } });
  // Consume Ctrl+W at the webContents level so Electron/Linux does not close
  // the whole window when the user intends to close only this tab.
  view.webContents.on('before-input-event', (_event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'w') {
      _event.preventDefault();
    }
  });
  const contentView = win.contentView;
  if (contentView?.addChildView) contentView.addChildView(view);
  view.setBounds(bounds());
  view.setVisible(false);
  setupTabDebugger(view, id);
  let cdpPort: number | undefined;
  try {
    while (!freePort(nextCdpPort)) nextCdpPort++;
    cdpPort = nextCdpPort++;
    startCdpProxy(view, id, cdpPort);
  } catch {}
  view.webContents.setWindowOpenHandler(({ url: u }) => { view.webContents.loadURL(u); return { action: 'deny' }; });
  const downloads = new Set<string>();
  ses.on('will-download', (_event, download) => {
    const tempDir = path.join(app.getPath('temp'), 'session-browser', islandId, id);
    try {
      mkdirSync(tempDir, { recursive: true });
      const safeName = path.basename(download.getFilename()).replace(/[\\/:*?"<>|]/g, '_');
      const target = path.join(tempDir, `${crypto.randomUUID()}-${safeName}`);
      downloads.add(target);
      download.setSavePath(target);
      download.once('done', (_e, state) => {
        if (state !== 'completed') downloads.delete(target);
        win.webContents.send('download:changed', { islandId, tabId: id, filename: download.getFilename(), state, path: target });
      });
    } catch { download.cancel(); }
  });
  view.webContents.on('did-navigate', () => sendState(islandId));
  view.webContents.on('did-navigate-in-page', () => sendState(islandId));
  view.webContents.on('did-frame-navigate', () => sendState(islandId));
  view.webContents.on('page-title-updated', () => sendState(islandId));
  view.webContents.loadURL(url);
  const tab: Tab = { id, view, title: '', url, cdpPort };
  island.tabs.set(id, tab);
  return tab;
}

function freePort(p: number) { return !islandTabViews().some((t) => t.cdpPort === p); }
function islandTabViews() { return [...islands.values()].flatMap((i) => [...i.tabs.values()]); }

async function makeIsland() {
  const id = crypto.randomUUID();
  const name = `Island ${islands.size + 1}`;
  const color = ['#5b62ff', '#4fe0c1', '#ff5f5f', '#ffb74d', '#a29bfe', '#81c784'][islands.size % 6];
  const partition = `session-${id}`;
  const ses = session.fromPartition(partition, { cache: false });
  applyPrivacyRules(ses);
  const island: Island = { id, name, color, partition, tabs: new Map(), activeTabId: null };
  islands.set(id, island);
  const tab = makeTab(id, 'about:blank');
  tab.view.setVisible(true);
  island.activeTabId = tab.id;
  sendState(id);
  return { island, tab };
}

function sendState(islandId: string) {
  const i = islands.get(islandId); if (!i) return;
  const t = i.activeTabId ? i.tabs.get(i.activeTabId) : null;
  win.webContents.send('session:state', {
    islandId, islandName: i.name, islandColor: i.color,
    activeTabId: t?.id ?? null,
    url: t?.url ?? '', title: t?.title ?? '',
    tabCount: i.tabs.size,
    islands: [...islands.values()].map((x) => ({ id: x.id, name: x.name, color: x.color, tabCount: x.tabs.size, active: x.id === islandId })),
  });
}

async function destroyTab(islandId: string, tabId: string) {
  const i = islands.get(islandId); if (!i) return;
  const t = i.tabs.get(tabId); if (!t) return;
  try { t.view.webContents.stop(); } catch {}
  const contentView = win.contentView;
  try { contentView?.removeChildView(t.view); } catch {}
  try { t.view.webContents.close(); } catch {}
  try { t.view.webContents.debugger.detach(); } catch {}
  sessionEvents.delete(tabId);
  i.tabs.delete(tabId);
  const dir = path.join(app.getPath('temp'), 'session-browser', islandId, tabId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  if (i.activeTabId === tabId) {
    const remaining = i.tabs.values().next().value;
    i.activeTabId = remaining?.id ?? null;
    if (remaining) remaining.view.setVisible(true);
  }
  if (i.tabs.size === 0) {
    await destroyIsland(islandId);
  } else {
    sendState(islandId);
  }
}

async function destroyIsland(islandId: string) {
  const i = islands.get(islandId); if (!i) return;
  for (const [tabId, t] of i.tabs) {
    try { t.view.webContents.stop(); } catch {}
    const contentView = win.contentView;
    try { contentView?.removeChildView(t.view); } catch {}
    try { t.view.webContents.close(); } catch {}
    try { t.view.webContents.debugger.detach(); } catch {}
    sessionEvents.delete(tabId);
    const dir = path.join(app.getPath('temp'), 'session-browser', islandId, tabId);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  i.tabs.clear();
  islands.delete(islandId);
  win.webContents.send('session:closed', islandId);
  if (islands.size > 0) {
    const first = islands.values().next().value!;
    sendState(first.id);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#08090c', show: !HEADLESS,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (!HEADLESS) win.once('ready-to-show', () => win.show());
  win.on('resize', () => {
    for (const t of islandTabViews()) t.view.setBounds(bounds());
  });
}

async function injectEval(view: WebContentsView, code: string) {
  return view.webContents.executeJavaScript(code);
}

function serializeDom(view: WebContentsView) {
  const script = `( () => {
    const walk = (n: Node): any => {
      if (n.nodeType === 3) return { t: 'text', v: n.textContent };
      if (n.nodeType !== 1) return null;
      const el = n as Element;
      const out: any = { t: 'el', tag: el.tagName.toLowerCase(), id: el.id || undefined, cls: el.className || undefined, children: [] };
      for (let i = 0; i < el.children.length; i++) { const c = walk(el.children[i]); if (c) out.children.push(c); }
      return out;
    };
    return walk(document.documentElement);
  })()`;
  return view.webContents.executeJavaScript(script);
}

async function agentDom(view: WebContentsView, op: string, selector?: string, value?: string) {
  const script = `(async () => {
    const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body'};
    if (!el) return { ok: false, error: 'element not found' };
    try {
      if ('${op}' === 'click') { el.click(); return { ok: true }; }
      if ('${op}' === 'fill' && el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.value = ${JSON.stringify(value ?? '')}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true }; }
      if ('${op}' === 'press' && value) { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(value)}, bubbles: true })); return { ok: true }; }
      if ('${op}' === 'text') { return { ok: true, text: el.innerText || el.textContent || '' }; }
      if ('${op}' === 'html') { return { ok: true, html: el.outerHTML }; }
      if ('${op}' === 'value') { return { ok: true, value: (el as any).value ?? '' }; }
      return { ok: false, error: 'unsupported op' };
    } catch (e) { return { ok: false, error: String(e) }; }
  })()`;
  return view.webContents.executeJavaScript(script);
}

app.whenReady().then(async () => {
  ipcMain.handle('island:create', async () => { const { island } = await makeIsland(); return { ok: true, islandId: island.id }; });
  // Backwards-compatible session:* aliases for preload
  ipcMain.handle('session:create', async () => { const { island } = await makeIsland(); return { ok: true, islandId: island.id }; });
  ipcMain.handle('session:close', async (_e, id: string) => { await destroyIsland(id); return { ok: true }; });
  ipcMain.handle('session:select', async (_e, id: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'island not found' };
    for (const t of i.tabs.values()) t.view.setVisible(false);
    const active = i.tabs.get(i.activeTabId ?? '');
    if (active) { active.view.setVisible(true); active.view.setBounds(bounds()); }
    sendState(id);
    return { ok: true };
  });
  ipcMain.handle('session:navigate', async (_e, id: string, url: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'island not found' };
    const t = i.tabs.get(i.activeTabId ?? ''); if (!t) return { ok: false, error: 'no active tab' };
    if (!isValidURL(url)) return { ok: false, error: 'invalid url' };
    let target = url.trim(); if (!/^https?:\/\//i.test(target)) target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    return t.view.webContents.loadURL(target);
  });
  ipcMain.handle('session:back', (_e, id: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'island not found' };
    const t = i.tabs.get(i.activeTabId ?? ''); if (!t) return { ok: false, error: 'no active tab' };
    return t.view.webContents.goBack();
  });
  ipcMain.handle('session:forward', (_e, id: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'island not found' };
    const t = i.tabs.get(i.activeTabId ?? ''); if (!t) return { ok: false, error: 'no active tab' };
    return t.view.webContents.goForward();
  });
  ipcMain.handle('session:reload', (_e, id: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'island not found' };
    const t = i.tabs.get(i.activeTabId ?? ''); if (!t) return { ok: false, error: 'no active tab' };
    return t.view.webContents.reload();
  });
  ipcMain.handle('session:duplicate', async (_e, id: string) => {
    const i = islands.get(id); if (!i) return { ok: false, error: 'Island not found' };
    const ni = await makeIsland();
    return { ok: true, islandId: ni.island.id };
  });
  ipcMain.handle('session:clear-data', async (_e, id: string) => {
    const i = islands.get(id); if (!i) return false;
    try {
      const ses = session.fromPartition(i.partition);
      await ses.clearCache();
      const cookies = await ses.cookies.get({});
      for (const c of cookies) { try { const url = (c.secure ? 'https://' : 'http://') + (c.domain || '') + (c.path || '/'); await ses.cookies.remove(url, c.name); } catch {} }
      return true;
    } catch { return false; }
  });
  ipcMain.handle('session:debugger-attached', (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return false;
    return !!t.view.webContents.debugger;
  });
  ipcMain.handle('session:cdp-send', async (_e, tabId: string, method: string, params: any) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try { const r = await (t.view.webContents.debugger.sendCommand as any)(method, params ?? {}); return { ok: true, result: r }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:cdp-detach', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return false;
    try { t.view.webContents.debugger.detach(); return true; } catch { return false; }
  });
  ipcMain.handle('session:open-devtools', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return false;
    try { t.view.webContents.openDevTools({ mode: 'detach' }); return true; } catch { return false; }
  });
  ipcMain.handle('session:cdp-port', (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return null;
    return t.cdpPort ?? null;
  });
  ipcMain.handle('session:list-ports', () => [...islandTabViews()].map(t => ({ id: t.id, cdpPort: t.cdpPort, url: t.url, title: t.title })));
  ipcMain.handle('island:close', async (_e, id: string) => { await destroyIsland(id); });
  ipcMain.handle('island:select', async (_e, id: string) => {
    const i = islands.get(id); if (!i) return;
    for (const t of i.tabs.values()) t.view.setVisible(false);
    const active = i.tabs.get(i.activeTabId ?? '');
    if (active) { active.view.setVisible(true); active.view.setBounds(bounds()); }
    sendState(id);
  });
  ipcMain.handle('island:list', () => [...islands.entries()].map(([id, i]) => ({ id, name: i.name, color: i.color, tabCount: i.tabs.size, activeTabId: i.activeTabId })));
  ipcMain.handle('tab:create', async (_e, islandId: string, url: string) => {
    if (!isValidUUID(islandId)) return { ok: false, error: 'invalid island id' };
    if (!isValidURL(url)) return { ok: false, error: 'invalid url' };
    const i = islands.get(islandId); if (!i) return { ok: false, error: 'island not found' };
    const tab = makeTab(islandId, url);
    tab.view.setVisible(true);
    i.activeTabId = tab.id;
    sendState(islandId);
    return { ok: true, tabId: tab.id };
  });
  ipcMain.handle('tab:close', async (_e, islandId: string, tabId: string) => {
    if (!isValidUUID(islandId) || !isValidUUID(tabId)) return { ok: false, error: 'invalid ids' };
    await destroyTab(islandId, tabId); return { ok: true }; });
  ipcMain.handle('tab:select', async (_e, islandId: string, tabId: string) => {
    const i = islands.get(islandId); if (!i) return;
    if (!isValidUUID(tabId)) return;
    for (const t of i.tabs.values()) t.view.setVisible(false);
    const t = i.tabs.get(tabId); if (!t) return;
    t.view.setVisible(true); t.view.setBounds(bounds());
    i.activeTabId = tabId;
    sendState(islandId);
  });
  ipcMain.handle('tab:navigate', async (_e, islandId: string, tabId: string, url: string) => {
    const i = islands.get(islandId); if (!i) return;
    if (!isValidUUID(tabId) || !isValidURL(url)) return;
    const t = i.tabs.get(tabId); if (!t) return;
    let target = url.trim(); if (!/^https?:\/\//i.test(target)) target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    return t.view.webContents.loadURL(target);
  });
  ipcMain.handle('tab:back', (_e, islandId: string, tabId: string) => {
    const i = islands.get(islandId); if (!i) return; const t = i.tabs.get(tabId); if (!t) return; return t.view.webContents.goBack();
  });
  ipcMain.handle('tab:forward', (_e, islandId: string, tabId: string) => {
    const i = islands.get(islandId); if (!i) return; const t = i.tabs.get(tabId); if (!t) return; return t.view.webContents.goForward();
  });
  ipcMain.handle('tab:reload', (_e, islandId: string, tabId: string) => {
    const i = islands.get(islandId); if (!i) return; const t = i.tabs.get(tabId); if (!t) return; return t.view.webContents.reload();
  });
  ipcMain.handle('webview:setBounds', async (_e, tabId: string, bounds: any) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return false;
    try { t.view.setBounds(bounds); return true; } catch { return false; }
  });
  ipcMain.handle('webview:setVisible', async (_e, tabId: string, visible: boolean) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return false;
    try { t.view.setVisible(visible); return true; } catch { return false; }
  });
  ipcMain.handle('webview:setPanelOffset', (_e, offset: number) => {
    panelRightOffset = Math.max(0, offset);
    for (const t of islandTabViews()) { try { t.view.setBounds(bounds()); } catch {} }
    return true;
  });
  ipcMain.handle('download:save', async (_e, islandId: string, tabId: string, sourcePath: string) => {
    const i = islands.get(islandId); if (!i) return false;
    const t = i.tabs.get(tabId); if (!t || !t.view) return false;
    const result: any = await dialog.showSaveDialog(win, { defaultPath: path.basename(sourcePath).replace(/^[0-9a-f-]+-/, '') });
    if (result.canceled || !result.filePath) return false;
    await fs.copyFile(sourcePath, result.filePath);
    return true;
  });
  ipcMain.handle('privacy:get', () => privacyLevel);
  ipcMain.handle('privacy:set', (_e, level: PrivacyLevel) => {
    if (!['balanced', 'strict', 'maximum'].includes(level)) return false;
    privacyLevel = level;
    for (const i of islands.values()) applyPrivacyRules(session.fromPartition(i.partition));
    return true;
  });
  ipcMain.handle('extensions:install', async (_e, islandId: string) => {
    const i = islands.get(islandId); if (!i) return { ok: false, error: 'Island not found' };
    const pick: any = await dialog.showOpenDialog(win, { title: 'Select an unpacked Chromium extension folder', properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true };
    try { const ext = await session.fromPartition(i.partition).loadExtension(pick.filePaths[0], { allowFileAccess: false }); return { ok: true, name: ext.name }; } catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle('extensions:list', (_e) => []);
  ipcMain.handle('island:duplicate', async (_e, islandId: string) => {
    const i = islands.get(islandId); if (!i || !isValidUUID(islandId)) return { ok: false, error: 'Island not found' };
    const ni = await makeIsland();
    return { ok: true, islandId: ni.island.id };
  });
  ipcMain.handle('island:clear-data', async (_e, islandId: string) => {
    const i = islands.get(islandId); if (!i) return false;
    try {
      const ses = session.fromPartition(i.partition);
      await ses.clearCache();
      const cookies = await ses.cookies.get({});
      for (const c of cookies) { try { const url = (c.secure ? 'https://' : 'http://') + (c.domain || '') + (c.path || '/'); await ses.cookies.remove(url, c.name); } catch {} }
      return true;
    } catch { return false; }
  });
  ipcMain.handle('island:open-external', (_e, url: string) => shell.openExternal(url));

  ipcMain.handle('session:screenshot', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try { const img = await t.view.webContents.capturePage(); return { ok: true, data: img.toDataURL() }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:query-selector', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try {
      const r = await (t.view.webContents.debugger.sendCommand as any)('Runtime.evaluate', {
        expression: `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return{tag:el.tagName.toLowerCase(),id:el.id||'',cls:el.className||'',text:(el.innerText||el.textContent||'').slice(0,200),href:el.href||'',x:r.x,y:r.y,w:r.width,h:r.height,visible:el.offsetParent!==null||getComputedStyle(el).visibility!=='hidden'}}})()`,
        returnByValue: true,
      });
      return { ok: true, result: r.result?.result };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:click-element', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try { return await agentDom(t.view, 'click', selector); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:fill-element', async (_e, tabId: string, selector: string, value: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    if (typeof value !== 'string') return { ok: false, error: 'invalid value' };
    try { return await agentDom(t.view, 'fill', selector, value); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:press-key', async (_e, tabId: string, selector: string, key: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    if (typeof key !== 'string') return { ok: false, error: 'invalid key' };
    try { return await agentDom(t.view, 'press', selector, key); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:wait-for-selector', async (_e, tabId: string, selector: string, timeoutMs: number = 5000) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await (t.view.webContents.debugger.sendCommand as any)('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(selector)})`, returnByValue: true });
        if (r.result?.result?.value === true) return { ok: true, found: true };
      } catch {}
      await new Promise((t2) => setTimeout(t2, 200));
    }
    return { ok: true, found: false };
  });
  ipcMain.handle('session:wait-for-navigation', async (_e, tabId: string, timeoutMs: number = 10000) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    const start = Date.now();
    let last = t.view.webContents.getURL();
    while (Date.now() - start < timeoutMs) {
      await new Promise((t2) => setTimeout(t2, 200));
      const cur = t.view.webContents.getURL();
      if (cur !== last) return { ok: true, url: cur };
      last = cur;
    }
    return { ok: true, url: last, changed: false };
  });
  ipcMain.handle('session:console-events', (_e, tabId: string) => { const b = sessionEvents.get(tabId); return b ? b.console : []; });
  ipcMain.handle('session:console-errors', (_e, tabId: string) => { const b = sessionEvents.get(tabId); return b ? b.errors : []; });
  ipcMain.handle('session:clear-console', (_e, tabId: string) => { const b = sessionEvents.get(tabId); if (b) { b.console = []; b.errors = []; } return true; });
  ipcMain.handle('session:enable-network-interception', async (_e, tabId: string, enabled: boolean = true) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try { await (t.view.webContents.debugger.sendCommand as any)(enabled ? 'Fetch.enable' : 'Fetch.disable', {}); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:set-blocked-urls', async (_e, tabId: string, patterns: string[] = []) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!Array.isArray(patterns) || !patterns.every(p => typeof p === 'string')) return { ok: false, error: 'invalid patterns' };
    try { await (t.view.webContents.debugger.sendCommand as any)('Network.setBlockedURLs', { urls: patterns }); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('session:network-events', (_e, tabId: string) => { const b = sessionEvents.get(tabId); return b ? b.network : []; });
  ipcMain.handle('session:audit-accessibility', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try {
      const script = `(()=>{
        const issues=[];
        document.querySelectorAll('img').forEach(i=>{if(!i.alt&&!i.getAttribute('aria-label'))issues.push({kind:'missing-alt',selector:'img',message:'Image missing alt text',x:i.getBoundingClientRect().x,y:i.getBoundingClientRect().y});});
        document.querySelectorAll('button').forEach(b=>{const txt=b.innerText||b.textContent||'';if(!txt&&!b.getAttribute('aria-label')&&!b.getAttribute('aria-labelledby'))issues.push({kind:'missing-button-label',selector:'button',message:'Button missing accessible label',x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y});});
        document.querySelectorAll('a').forEach(a=>{const txt=a.innerText||a.textContent||'';if(!txt&&!a.getAttribute('aria-label'))issues.push({kind:'missing-link-text',selector:'a',message:'Link missing accessible text',x:a.getBoundingClientRect().x,y:a.getBoundingClientRect().y});});
        const h1s=document.querySelectorAll('h1');if(h1s.length===0)issues.push({kind:'missing-h1',selector:'h1',message:'Page missing h1'});if(h1s.length>1)issues.push({kind:'multiple-h1',selector:'h1',message:'Multiple h1 elements'});
        return issues;
      })()`;
      const r = await (t.view.webContents.debugger.sendCommand as any)('Runtime.evaluate', { expression: script, returnByValue: true });
      return { ok: true, issues: r.result?.result?.value || [] };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  ipcMain.handle('agent:list-sessions', () => [...islands.entries()].flatMap(([islandId, i]) =>
    ([...i.tabs.entries()].map(([tabId, t]) => ({ id: tabId, islandId, url: t.url, title: t.title, gpuDisabled: isLowEnd() })))));
  ipcMain.handle('agent:execute', async (_e, tabId: string, code: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (typeof code !== 'string' || code.length > 100000) return { ok: false, error: 'invalid code' };
    try { const r = await injectEval(t.view, code); return { ok: true, result: r }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:evaluate', async (_e, tabId: string, code: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (typeof code !== 'string' || code.length > 100000) return { ok: false, error: 'invalid code' };
    try { const r = await injectEval(t.view, code); return { ok: true, result: r }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:screenshot', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try { const img = await t.view.webContents.capturePage(); return { ok: true, data: img.toDataURL() }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:click', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try { return await agentDom(t.view, 'click', selector); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:fill', async (_e, tabId: string, selector: string, value: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    if (typeof value !== 'string') return { ok: false, error: 'invalid value' };
    try { return await agentDom(t.view, 'fill', selector, value); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:press', async (_e, tabId: string, selector: string, key: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    if (typeof key !== 'string') return { ok: false, error: 'invalid key' };
    try { return await agentDom(t.view, 'press', selector, key); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:text', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try { return await agentDom(t.view, 'text', selector); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:html', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try { return await agentDom(t.view, 'html', selector); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:value', async (_e, tabId: string, selector: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    if (!isValidSelector(selector)) return { ok: false, error: 'invalid selector' };
    try { return await agentDom(t.view, 'value', selector); } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:dom', async (_e, tabId: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return { ok: false, error: 'tab not found' };
    try { const d = await serializeDom(t.view); return { ok: true, dom: d }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('agent:navigate', (_e, tabId: string, url: string) => {
    const t = [...islandTabViews()].find((x) => x.id === tabId);
    if (!t) return;
    if (!isValidURL(url)) return;
    let target = url.trim(); if (!/^https?:\/\//i.test(target)) target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    return t.view.webContents.loadURL(target);
  });
  ipcMain.handle('agent:get-system-info', () => {
    let mem;
    try { mem = process.getSystemMemoryInfo(); } catch { mem = { total: 0, free: 0 }; }
    return {
      platform: process.platform, arch: process.arch, electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome, nodeVersion: process.versions.node,
      totalMemKB: mem.total, freeMemKB: mem.free, lowEnd: isLowEnd(),
      gpuDisabled: isLowEnd() || process.env.SESSION_BROWSER_FORCE_NO_GPU === '1',
    };
  });

  createWindow();
  await makeIsland();

  app.on('before-quit', async (e) => { e.preventDefault(); for (const id of [...islands.keys()]) await destroyIsland(id); app.exit(0); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function applyPrivacyRules(ses: Electron.Session) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (privacyLevel === 'balanced') return callback({});
    let host = ''; try { host = new URL(details.url).hostname.toLowerCase(); } catch {}
    const isTracker = trackerHosts.some((domain) => host === domain || host.endsWith('.' + domain));
    const isThirdParty = (() => {
      try {
        const origin = new URL((details as any).referrer || details.url).hostname;
        return Boolean(origin && host && origin !== host && !origin.endsWith('.' + host) && !host.endsWith('.' + origin));
      } catch { return false; }
    })();
    callback({ cancel: isTracker || (privacyLevel === 'maximum' && isThirdParty && details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') });
  });
}
