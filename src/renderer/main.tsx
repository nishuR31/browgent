import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Island = { id: string; name: string; color: string; tabCount: number; activeTabId: string | null };
type Tab = { id: string; islandId: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean };
type Privacy = 'balanced' | 'strict' | 'maximum';
type SysInfo = {
  platform: string; arch: string; electronVersion: string; chromeVersion: string; nodeVersion: string;
  totalMemKB: number; freeMemKB: number; lowEnd: boolean; gpuDisabled: boolean;
};
type SearchEngine = { id: string; name: string; url: string };
declare global { interface Window { browserAPI: any; agentAPI: any } }

const ICONS = {
  back: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M20 11H4c-0.6 0-1 0.4-1 1s0.4 1 1 1h16c0.6 0 1-0.4 1-1s-0.4-1-1-1z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  forward: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 11h16c0.6 0 1-0.4 1-1s-0.4-1-1-1H4c-0.6 0-1 0.4-1 1s0.4 1 1 1z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  reload: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5V2c-5 0-7.5 4-7.5 7.5S7 17 12 17v-3c-2.8 0-5-2.2-5-5s2.2-5 5-5zM12 19v-3c2.8 0 5 2.2 5 5s-2.2 5-5 5V19c-5 0-7.5-4-7.5-7.5S7 12 12 12z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2c-5.5 0-10.5 3-10.5 8.5S6.5 19 12 19s10.5-3 10.5-8.5S17.5 2 12 2zm0 5v5h-5v-5z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  island: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M10 6c-4 0-6 2-6 6 0 2 1 4 3 5v3h4v-3c2-1 3-3 3-5 0-4-2-6-6-6zm8 0c-4 0-6 2-6 6 0 2 1 4 3 5v3h4v-3c2-1 3-3 3-5 0-4-2-6-6-6zm4 0c-4 0-6 2-6 6 0 2 1 4 3 5v3h4v-3c2-1 3-3 3-5 0-4-2-6-6-6z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  dup: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 10c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4v-2H4v-4zm16-2v4c0 1.1-.9 2-2 2h-4v-2h4c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2h-4v2h4c1.1 0 2 .9 2 2z" fill="#5f6368" fill-rule="evenodd"/></svg>',
  clear: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="#d93025" fill-rule="evenodd"/></svg>',
};

const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={q}' },
  { id: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q={q}' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q={q}' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/sp/search?query={q}' },
];

function htmlIcon(svg: string) { return { __html: svg }; }

function App() {
  const [islands, setIslands] = useState<Island[]>([]);
  const [activeIslandId, setActiveIslandId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [downloads, setDownloads] = useState<any[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [privacy, setPrivacy] = useState<Privacy>('balanced');
  const [sys, setSys] = useState<SysInfo | null>(null);
  const [searchEngine, setSearchEngine] = useState<SearchEngine>(SEARCH_ENGINES[0]);
  const [agentOutput, setAgentOutput] = useState<string>('');
  const [agentInput, setAgentInput] = useState('');
  const [domView, setDomView] = useState<any>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const [webviewBounds, setWebviewBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const PANEL_WIDTH = 470;
  const HEADER_HEIGHT = 44;
  const TAB_STRIP_HEIGHT = 32;
  const TOOLBAR_HEIGHT = 42;
  const TOP = HEADER_HEIGHT + TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT;

  const applyBounds = useCallback(() => {
    if (!activeTabId) return;
    const stageWidth = window.innerWidth;
    const stageHeight = window.innerHeight;
    let width = stageWidth;
    if (settingsOpen) width = 1;
    else if (agentOpen) width = Math.max(250, stageWidth - PANEL_WIDTH - 2);
    setWebviewBounds({ x: settingsOpen || agentOpen ? 0 : 0, y: TOP, width, height: Math.max(100, stageHeight - TOP) });
  }, [activeTabId, agentOpen, settingsOpen]);

  useEffect(() => {
    applyBounds();
    window.addEventListener('resize', applyBounds);
    return () => window.removeEventListener('resize', applyBounds);
  }, [applyBounds]);

  useEffect(() => {
    if (!activeTabId || !webviewBounds) return;
    window.browserAPI.webview.setBounds(activeTabId, webviewBounds);
  }, [activeTabId, webviewBounds]);

  useEffect(() => {
    if (!activeTabId) return;
    window.browserAPI.webview.setVisible(activeTabId, !settingsOpen);
    const offset = settingsOpen ? 99999 : (agentOpen ? PANEL_WIDTH + 2 : 0);
    window.browserAPI.webview.setPanelOffset(offset);
  }, [activeTabId, agentOpen, settingsOpen]);

  useEffect(() => {
    window.browserAPI.getPrivacy().then(setPrivacy);
    window.agentAPI.getSystemInfo().then(setSys);
    window.browserAPI.islandList().then((p: any[]) => {
      const list = p.map((x) => ({ id: x.id, name: x.name, color: x.color, tabCount: x.tabCount, activeTabId: x.activeTabId }));
      setIslands(list);
      if (list.length > 0 && !activeIslandId) setActiveIslandId(list[0].id);
    });
  }, []);

  useEffect(() => {
    const offState = window.browserAPI.onState((s: any) => {
      setIslands(prev => {
        const exists = prev.some(x => x.id === s.islandId);
        if (!exists) return prev;
        return prev.map(x => x.id === s.islandId ? { ...x, tabCount: s.tabCount, activeTabId: s.activeTabId } : x);
      });
      if (s.islandId === activeIslandId) {
        setTabs(prev => {
          const exists = prev.some(x => x.id === s.activeTabId);
          if (!exists) return prev;
          return prev.map(x => x.id === s.activeTabId ? { ...x, url: s.url, title: s.title, canGoBack: s.canGoBack, canGoForward: s.canGoForward } : x);
        });
        setAddress(s.url);
      }
    });
    const offClosed = window.browserAPI.onClosed((id: string) => {
      setIslands(prev => prev.filter(x => x.id !== id));
      setTabs(prev => prev.filter(t => t.islandId !== id));
      setActiveIslandId(prev => (prev === id ? (islands.find(x => x.id !== id)?.id ?? null) : prev));
      if (activeIslandId === id) setActiveTabId(null);
    });
    const offDownload = window.browserAPI.onDownload((d: any) => setDownloads(prev => [{ ...d, id: crypto.randomUUID() }, ...prev].slice(0, 10)));
    return () => { offState(); offClosed(); offDownload(); };
  }, [activeIslandId, islands]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  const MAX_OUTPUT_LINES = 200;
  const appendOutput = useCallback((next: string) => {
    setAgentOutput(prev => {
      const combined = (prev + next).split('\n');
      if (combined.length > MAX_OUTPUT_LINES) return combined.slice(combined.length - MAX_OUTPUT_LINES).join('\n');
      return combined.join('\n');
    });
  }, []);

  const addIsland = async () => {
    const r = await window.browserAPI.islandCreate();
    if (r?.ok) {
      setActiveIslandId(r.islandId);
      await window.browserAPI.islandSelect(r.islandId);
    }
  };
  const selectIsland = async (id: string) => {
    setActiveIslandId(id);
    await window.browserAPI.islandSelect(id);
    setAddressFocused(false);
  };
  const closeIsland = async (id: string) => {
    if (!window.confirm('Close this island? All tabs inside will be destroyed.')) return;
    await window.browserAPI.islandClose(id);
    const next = islands.find(x => x.id !== id);
    if (next) setActiveIslandId(next.id);
    else setActiveIslandId(null);
  };
  const addTab = async () => {
    if (!activeIslandId) return;
    const r = await window.browserAPI.tabCreate(activeIslandId, 'about:blank');
    if (r?.ok) {
      setTabs(prev => [...prev, { id: r.tabId, islandId: activeIslandId, url: 'about:blank', title: 'New Tab', canGoBack: false, canGoForward: false }]);
      setActiveTabId(r.tabId);
    }
  };
  const selectTab = async (tabId: string) => {
    if (!activeIslandId) return;
    setActiveTabId(tabId);
    await window.browserAPI.tabSelect(activeIslandId, tabId);
    const t = tabs.find(x => x.id === tabId);
    setAddress(t?.url || '');
    setAddressFocused(false);
  };
  const closeTab = async (tabId: string) => {
    if (!activeIslandId) return;
    await window.browserAPI.tabClose(activeIslandId, tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));
    const remaining = tabs.filter(t => t.id !== tabId && t.islandId === activeIslandId);
    if (remaining.length > 0) {
      setActiveTabId(remaining[0].id);
    } else {
      const nextIsland = islands.find(x => x.id !== activeIslandId);
      if (nextIsland) setActiveIslandId(nextIsland.id);
      else setActiveIslandId(null);
      setActiveTabId(null);
    }
  };
  const duplicateTab = async (tabId: string) => {
    if (!activeIslandId) return;
    const t = tabs.find(x => x.id === tabId);
    if (!t) return;
    const r = await window.browserAPI.tabCreate(activeIslandId, t.url === 'about:blank' ? 'about:blank' : t.url);
    if (r?.ok) {
      setTabs(prev => [...prev, { id: r.tabId, islandId: activeIslandId, url: t.url === 'about:blank' ? 'about:blank' : t.url, title: 'New Tab', canGoBack: false, canGoForward: false }]);
      setActiveTabId(r.tabId);
    }
  };
  const clearTabData = async () => {
    if (!window.confirm('Clear cache and cookies for this island?')) return;
    await window.browserAPI.clearIslandData(activeIslandId!);
    window.alert('Island data cleared.');
  };
  const nav = async () => {
    if (!activeTabId || !address.trim()) return;
    const input = address.trim();
    let target = input;
    if (!/^https?:\/\//i.test(target)) target = searchEngine.url.replace('{q}', encodeURIComponent(input));
    await window.browserAPI.tabNavigate(activeIslandId!, activeTabId, target);
    setAddressFocused(false);
  };
  const installExtension = async () => {
    if (!activeIslandId) return;
    const result = await window.browserAPI.installExtension(activeIslandId);
    if (result?.ok) alert(`Loaded extension: ${result.name}`);
    else if (result?.cancelled === false) alert(`Could not load extension: ${result.error}`);
  };
  const changePrivacy = async (level: Privacy) => { await window.browserAPI.setPrivacy(level); setPrivacy(level); };
  const saveDownload = async (d: any) => { await window.browserAPI.saveDownload(d.islandId, d.tabId, d.path); };

  const agentExec = async () => {
    if (!activeTabId) return;
    setAgentBusy(true);
    try {
      const r = await window.agentAPI.execute(activeTabId, agentInput);
      appendOutput(`\n[exec] ${JSON.stringify(r)}\n`);
    } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  };
  const agentScreenshot = async () => {
    if (!activeTabId) return;
    setAgentBusy(true);
    try {
      const r = await window.agentAPI.screenshot(activeTabId);
      appendOutput(`\n[screenshot] ${JSON.stringify(r)}\n`);
      if (r?.ok && r.data) {
        const img = document.createElement('img'); img.src = r.data; img.style.maxWidth = '100%'; img.style.border = '1px solid #dadce0'; img.style.borderRadius = '6px'; img.style.marginTop = '8px';
        outputRef.current?.appendChild(img);
      }
    } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  };
  const agentDom = async () => {
    if (!activeTabId) return;
    setAgentBusy(true);
    try {
      const r = await window.agentAPI.dom(activeTabId);
      setDomView(r?.ok ? r.dom : null);
      appendOutput(`\n[dom] captured\n`);
    } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
  };
  const agentClick = async (sel: string) => {
    if (!activeTabId || !sel) return;
    setAgentBusy(true);
    try { const r = await window.agentAPI.clickElement(activeTabId, sel); appendOutput(`\n[click ${sel}] ${JSON.stringify(r)}\n`); } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
  };
  const agentFill = async (sel: string, val: string) => {
    if (!activeTabId || !sel) return;
    setAgentBusy(true);
    try { const r = await window.agentAPI.fillElement(activeTabId, sel, val); appendOutput(`\n[fill ${sel}] ${JSON.stringify(r)}\n`); } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
  };
  const agentNavigate = async (url: string) => {
    if (!activeTabId || !url) return;
    setAgentBusy(true);
    try { await window.agentAPI.navigate(activeTabId, url); appendOutput(`\n[navigate] ${url}\n`); } catch (e) { appendOutput(`\n[error] ${String(e)}\n`); }
    setAgentBusy(false);
  };

  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 't') { e.preventDefault(); addTab(); }
    else if (e.key === 'w') { e.preventDefault(); if (activeTabId && window.confirm('Close this tab?')) closeTab(activeTabId); }
    else if (e.key === 'i') { e.preventDefault(); addIsland(); }
    else if (e.key === 'r') { e.preventDefault(); if (activeTabId) window.browserAPI.tabReload(activeIslandId!, activeTabId); }
    else if (e.key === 'l') { e.preventDefault(); setAddressFocused(true); }
    else if (e.key === 'd') { e.preventDefault(); if (activeTabId) duplicateTab(activeTabId); }
    else if (e.key === 'x' && e.shiftKey) { e.preventDefault(); clearTabData(); }
    else if (e.key === 'a') { e.preventDefault(); setAgentOpen(v => !v); }
    if (addressFocused && addressRef.current) addressRef.current.focus();
  };

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTabId, activeIslandId, tabs, clearTabData]);

  const islandTabs = tabs.filter(t => t.islandId === activeIslandId);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="orb" />
          Browgent
        </div>
        <div className="island-bar">
          {islands.map((i) => {
            const icount = tabs.filter(t => t.islandId === i.id).length;
            return (
              <button key={i.id} className={`island-pill ${i.id === activeIslandId ? 'active' : ''}`} onClick={() => selectIsland(i.id)} title={`${i.name} (${icount} tabs)`}>
                <span className="pill-dot" style={{ background: i.color }} />
                {i.name} <span className="pill-count">{icount}</span>
                <span className="pill-close" onClick={e => { e.stopPropagation(); closeIsland(i.id); }}>&times;</span>
              </button>
            );
          })}
          <button className="add-island" onClick={addIsland} title="New island (Ctrl/Cmd+I)">+ Island</button>
        </div>
        <div className="header-right">
          <button className="icon-btn" onClick={() => setAgentOpen(v => !v)} title="Agent panel (Ctrl/Cmd+A)">Agent</button>
          <button className="icon-btn settings-button" onClick={() => setSettingsOpen(v => !v)}>Settings</button>
        </div>
      </header>
      <div className="tab-strip">
        {islandTabs.map((t) => (
          <button key={t.id} className={`tab ${t.id === activeTabId ? 'active' : ''}`} onClick={() => selectTab(t.id)} title={t.url}>
            <span className="tab-title" title={t.title}>{t.title || 'New Tab'}</span>
            <span className="tab-close" onClick={e => { e.stopPropagation(); closeTab(t.id); }}>&times;</span>
          </button>
        ))}
        <button className="tab add-tab" onClick={addTab} title="New tab (Ctrl/Cmd+T)">+</button>
      </div>
      <div className="toolbar">
        <button onClick={() => activeTabId && window.browserAPI.tabBack(activeIslandId!, activeTabId)} disabled={!activeTab?.canGoBack} title="Back" dangerouslySetInnerHTML={htmlIcon(ICONS.back)} />
        <button onClick={() => activeTabId && window.browserAPI.tabForward(activeIslandId!, activeTabId)} disabled={!activeTab?.canGoForward} title="Forward" dangerouslySetInnerHTML={htmlIcon(ICONS.forward)} />
        <button onClick={() => activeTabId && window.browserAPI.tabReload(activeIslandId!, activeTabId)} title="Reload (Ctrl/Cmd+R)" dangerouslySetInnerHTML={htmlIcon(ICONS.reload)} />
        <form onSubmit={e => { e.preventDefault(); nav(); }} className="address">
          <span>&#x2315;</span>
          <input ref={addressRef} autoFocus={addressFocused} value={address} onChange={e => setAddress(e.target.value)} onBlur={() => setAddressFocused(false)} placeholder={`Search or enter address (${searchEngine.name}) (Ctrl/Cmd+L)`} />
        </form>
        <button onClick={() => activeTabId && duplicateTab(activeTabId)} disabled={!activeTabId} className="icon-btn dup" title="Duplicate tab (Ctrl/Cmd+D)" dangerouslySetInnerHTML={htmlIcon(ICONS.dup)} />
        <button onClick={() => activeTabId && clearTabData()} disabled={!activeTabId} className="icon-btn clear" title="Clear data (Ctrl/Cmd+Shift+X)" dangerouslySetInnerHTML={htmlIcon(ICONS.clear)} />
      </div>
      {settingsOpen && <SettingsPanel privacy={privacy} changePrivacy={changePrivacy} installExtension={installExtension} searchEngine={searchEngine} setSearchEngine={setSearchEngine} onClose={() => setSettingsOpen(false)} />}
      {agentOpen && <AgentPanel sys={sys} activeTabId={activeTabId} agentInput={agentInput} setAgentInput={setAgentInput} agentOutput={agentOutput} agentBusy={agentBusy} outputRef={outputRef} agentExec={agentExec} agentScreenshot={agentScreenshot} agentDom={agentDom} agentClick={agentClick} agentFill={agentFill} agentNavigate={agentNavigate} domView={domView} onClose={() => setAgentOpen(false)} />}
      <main className="browser-stage">
        {!activeTabId && (
          <div className="empty">
            <div className="bigOrb" />
            <h1>Browgent</h1>
            <p>Create an island. Each island gets its own Chromium storage partition — cookies, logins, downloads isolated per island. Tabs inside an island share that identity.</p>
            <button className="primary" onClick={addIsland}>Create an island</button>
            <div className="features"><span>Isolated logins per island</span><span>Tabs share island identity</span><span>Temporary downloads</span><span>Agent controllable</span><span>Lightweight / low-end ready</span></div>
          </div>
        )}
      </main>
      {downloads.length > 0 && (
        <div className="downloads">
          <strong>Downloads</strong>
          {downloads.map(d => (
            <div className="download" key={d.id}>
              <span>{d.filename}</span>
              <small>{d.state}</small>
              <button onClick={() => saveDownload(d)}>Save to system</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ privacy, changePrivacy, installExtension, searchEngine, setSearchEngine, onClose }: { privacy: Privacy; changePrivacy: (l: Privacy) => void; installExtension: () => void; searchEngine: SearchEngine; setSearchEngine: (s: SearchEngine) => void; onClose: () => void }) {
  return (
    <section className="settings-panel">
      <div className="settings-head"><strong>Settings</strong><button onClick={onClose}>&times;</button></div>
      <div className="settings-section">
        <p>Privacy level applies to all islands. Stricter blocking can break sites.</p>
        <div className="privacy-options">
          <button className={privacy === 'balanced' ? 'chosen' : ''} onClick={() => changePrivacy('balanced')}>
            Balanced <strong>Trackers blocked selectively</strong>
          </button>
          <button className={privacy === 'strict' ? 'chosen' : ''} onClick={() => changePrivacy('strict')}>
            Strict <strong>Known trackers blocked</strong>
          </button>
          <button className={privacy === 'maximum' ? 'chosen' : ''} onClick={() => changePrivacy('maximum')}>
            Maximum <strong>Also blocks most third-party subresources</strong>
          </button>
        </div>
      </div>
      <div className="settings-section">
        <p>Default search engine used for address bar queries.</p>
        <div className="search-options">
          {SEARCH_ENGINES.map(e => (
            <button key={e.id} className={searchEngine.id === e.id ? 'chosen' : ''} onClick={() => setSearchEngine(e)}>
              {e.name}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <p>Extensions: load an unpacked Chromium extension folder into the active island. Only install extensions you trust.</p>
        <button className="primary" disabled={!1} onClick={installExtension}>Load extension into active island</button>
      </div>
      <p className="settings-note">No VPN, DoH, fingerprint resistance, or forensic erasure is implied by these settings.</p>
      <button className="close-btn" onClick={onClose}>Close</button>
    </section>
  );
}

function AgentPanel({
  sys, activeTabId, agentInput, setAgentInput, agentOutput, agentBusy, outputRef,
  agentExec, agentScreenshot, agentDom, agentClick, agentFill, agentNavigate, domView, onClose,
}: {
  sys: SysInfo | null; activeTabId: string | null;
  agentInput: string; setAgentInput: (v: string) => void; agentOutput: string; agentBusy: boolean; outputRef: React.RefObject<HTMLDivElement>;
  agentExec: () => void; agentScreenshot: () => void; agentDom: () => void; agentClick: (s: string) => void; agentFill: (s: string, v: string) => void; agentNavigate: (u: string) => void;
  domView: any; onClose: () => void;
}) {
  const [clickSel, setClickSel] = useState('');
  const [fillSel, setFillSel] = useState('');
  const [fillVal, setFillVal] = useState('');
  const [navUrl, setNavUrl] = useState('');

  const memMB = sys ? Math.round(sys.totalMemKB / 1024) : 0;
  return (
    <section className="agent-panel">
      <div className="agent-head"><strong>Agent Control</strong><button onClick={onClose}>&times;</button></div>
      <div className="agent-sys">
        <div className="sys-row"><span>Platform</span><span>{sys?.platform} {sys?.arch}</span></div>
        <div className="sys-row"><span>Memory</span><span>{memMB} MB ({sys?.lowEnd ? 'low-end' : 'standard'})</span></div>
        <div className="sys-row"><span>GPU</span><span>{sys?.gpuDisabled ? 'disabled (lightweight)' : 'enabled'}</span></div>
        <div className="sys-row"><span>Electron</span><span>{sys?.electronVersion}</span></div>
        <div className="sys-row"><span>Chrome</span><span>{sys?.chromeVersion}</span></div>
      </div>
      <div className="agent-group">
        <label>Run JavaScript in active tab</label>
        <textarea value={agentInput} onChange={e => setAgentInput(e.target.value)} placeholder="e.g. document.title" rows={2} />
        <div className="agent-actions">
          <button className="primary" onClick={agentExec} disabled={!activeTabId || agentBusy}>{agentBusy ? 'running…' : 'Execute'}</button>
          <button onClick={agentScreenshot} disabled={!activeTabId || agentBusy}>Screenshot</button>
          <button onClick={agentDom} disabled={!activeTabId || agentBusy}>Capture DOM</button>
        </div>
      </div>
      <div className="agent-group">
        <label>Click element</label>
        <div className="agent-inline"><input value={clickSel} onChange={e => setClickSel(e.target.value)} placeholder="CSS selector" /><button onClick={() => agentClick(clickSel)} disabled={!activeTabId || agentBusy}>Click</button></div>
      </div>
      <div className="agent-group">
        <label>Fill input</label>
        <div className="agent-inline"><input value={fillSel} onChange={e => setFillSel(e.target.value)} placeholder="selector" /><input value={fillVal} onChange={e => setFillVal(e.target.value)} placeholder="value" /><button onClick={() => agentFill(fillSel, fillVal)} disabled={!activeTabId || agentBusy}>Fill</button></div>
      </div>
      <div className="agent-group">
        <label>Navigate</label>
        <div className="agent-inline"><input value={navUrl} onChange={e => setNavUrl(e.target.value)} placeholder="https://example.com" /><button onClick={() => agentNavigate(navUrl)} disabled={!activeTabId || agentBusy}>Go</button></div>
      </div>
      <div className="agent-group">
        <label>Output</label>
        <div className="agent-output" ref={outputRef}>{agentOutput.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
      </div>
      {domView && (
        <div className="agent-group"><label>DOM (preview)</label><pre className="agent-dom">{JSON.stringify(domView, null, 1).slice(0, 2000)}</pre></div>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
