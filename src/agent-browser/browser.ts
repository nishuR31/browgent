import { chromium, type Browser, type BrowserContext, type Page, type ChromiumBrowser, type LaunchOptions } from 'playwright';

export type SessionId = string;
export type PageId = string;

export interface AgentBrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userDataDir?: string;
  ignoreHTTPSErrors?: boolean;
  args?: string[];
}

export interface NavigateResult {
  ok: boolean;
  url?: string;
  title?: string;
  error?: string;
}

export interface ClickResult { ok: boolean; error?: string; }
export interface FillResult { ok: boolean; error?: string; }
export interface EvaluateResult { ok: boolean; result?: any; error?: string; }
export interface ScreenshotResult { ok: boolean; data?: string; error?: string; }
export interface DomNode {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  children: DomNode[];
}
export interface DomResult { ok: boolean; dom?: DomNode[]; error?: string; }

class AgentBrowser {
  private browser: ChromiumBrowser | null = null;
  private contexts = new Map<SessionId, BrowserContext>();
  private pages = new Map<PageId, { sessionId: SessionId; page: Page }>();
  private options: Required<AgentBrowserOptions>;

  constructor(opts: AgentBrowserOptions = {}) {
    this.options = {
      headless: opts.headless ?? true,
      viewport: opts.viewport ?? { width: 1280, height: 720 },
      userDataDir: opts.userDataDir ?? '',
      ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? true,
      args: opts.args ?? [],
    };
  }

  async launch(): Promise<void> {
    const launchOpts: LaunchOptions = {
      headless: this.options.headless,
      ignoreHttpsErrors: this.options.ignoreHTTPSErrors,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-gpu-compositing',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-features=IsolateOrigins,site-per-process',
        ...this.options.args,
      ],
    };
    if (this.options.userDataDir) {
      launchOpts.userDataDir = this.options.userDataDir;
    }
    this.browser = (await chromium.launch(launchOpts)) as ChromiumBrowser;
  }

  async close(): Promise<void> {
    for (const [, ctx] of this.contexts) {
      try { await ctx.close(); } catch {}
    }
    this.contexts.clear();
    this.pages.clear();
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }

  newSession(sessionId: SessionId): Promise<void> {
    return this.createContext(sessionId);
  }

  private async createContext(sessionId: SessionId): Promise<void> {
    if (this.contexts.has(sessionId)) return;
    if (!this.browser) throw new Error('browser not launched');
    const ctx = await this.browser.newContext({
      viewport: this.options.viewport,
      ignoreHttpsErrors: this.options.ignoreHTTPSErrors,
    });
    this.contexts.set(sessionId, ctx);
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const ctx = this.contexts.get(sessionId);
    if (ctx) {
      try { await ctx.close(); } catch {}
      this.contexts.delete(sessionId);
    }
    for (const [pid, info] of this.pages) {
      if (info.sessionId === sessionId) this.pages.delete(pid);
    }
  }

  async newPage(sessionId: SessionId, pageId: PageId, url: string = 'about:blank'): Promise<Page> {
    await this.createContext(sessionId);
    const ctx = this.contexts.get(sessionId)!;
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    this.pages.set(pageId, { sessionId, page });
    return page;
  }

  async getPage(pageId: PageId): Promise<Page> {
    const info = this.pages.get(pageId);
    if (!info) throw new Error(`page ${pageId} not found`);
    return info.page;
  }

  async closePage(pageId: PageId): Promise<void> {
    const info = this.pages.get(pageId);
    if (info) {
      try { await info.page.close(); } catch {}
      this.pages.delete(pageId);
    }
  }

  async navigate(pageId: PageId, url: string): Promise<NavigateResult> {
    try {
      const page = await this.getPage(pageId);
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      return {
        ok: true,
        url: page.url(),
        title: await page.title().catch(() => ''),
        error: res ? undefined : 'no response',
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async click(pageId: PageId, selector: string): Promise<ClickResult> {
    try {
      const page = await this.getPage(pageId);
      await page.click(selector, { timeout: 10000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async fill(pageId: PageId, selector: string, value: string): Promise<FillResult> {
    try {
      const page = await this.getPage(pageId);
      await page.fill(selector, value, { timeout: 10000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async press(pageId: PageId, key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.keyboard.press(key);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async evaluate(pageId: PageId, script: string): Promise<EvaluateResult> {
    try {
      const page = await this.getPage(pageId);
      const result = await page.evaluate(script);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async screenshot(pageId: PageId, fullPage: boolean = false): Promise<ScreenshotResult> {
    try {
      const page = await this.getPage(pageId);
      const buf = await page.screenshot({ fullPage, type: 'png' });
      return { ok: true, data: buf.toString('base64') };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async getDom(pageId: PageId): Promise<DomResult> {
    try {
      const page = await this.getPage(pageId);
      const dom = await page.evaluate(() => {
        const walk = (n: Node): DomNode | null => {
          if (n.nodeType === 3) {
            const t = n.textContent?.trim();
            return t ? { tag: '#text', text: t, children: [] } : null;
          }
          if (n.nodeType !== 1) return null;
          const el = n as Element;
          const attrs: Record<string, string> = {};
          for (let i = 0; i < el.attributes.length; i++) {
            const a = el.attributes[i];
            attrs[a.name] = a.value;
          }
          const children: DomNode[] = [];
          for (let i = 0; i < el.children.length; i++) {
            const c = walk(el.children[i]);
            if (c) children.push(c);
          }
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            className: el.className || undefined,
            text: el.textContent?.trim().slice(0, 200),
            attrs,
            children,
          };
        };
        const roots: DomNode[] = [];
        for (let i = 0; i < document.children.length; i++) {
          const c = walk(document.children[i]);
          if (c) roots.push(c);
        }
        return roots;
      });
      return { ok: true, dom };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async goBack(pageId: PageId): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async goForward(pageId: PageId): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.goForward({ waitUntil: 'domcontentloaded' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async reload(pageId: PageId): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.reload({ waitUntil: 'domcontentloaded' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async waitForSelector(pageId: PageId, selector: string, timeout: number = 10000): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.waitForSelector(selector, { timeout });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async getUrl(pageId: PageId): Promise<string> {
    const page = await this.getPage(pageId);
    return page.url();
  }

  async getTitle(pageId: PageId): Promise<string> {
    const page = await this.getPage(pageId);
    return await page.title().catch(() => '');
  }

  listPages(): { pageId: PageId; sessionId: SessionId; url: string }[] {
    const out: { pageId: PageId; sessionId: SessionId; url: string }[] = [];
    for (const [pid, info] of this.pages) {
      try { out.push({ pageId: pid, sessionId: info.sessionId, url: info.page.url() }); } catch {}
    }
    return out;
  }

  listSessions(): SessionId[] {
    return [...this.contexts.keys()];
  }

  async setViewport(pageId: PageId, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.setViewportSize({ width, height });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async addScriptTag(pageId: PageId, url: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.addScriptTag({ url });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async uploadFile(pageId: PageId, selector: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      const input = await page.$(selector);
      if (!input) return { ok: false, error: 'selector not found' };
      await input.setInputFiles(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async waitForNavigation(pageId: PageId, timeout: number = 30000): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.waitForNavigation({ timeout, waitUntil: 'domcontentloaded' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async getCookies(pageId: PageId): Promise<{ ok: boolean; cookies?: any[]; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      const cookies = await page.context().cookies();
      return { ok: true, cookies };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async clearCookies(pageId: PageId): Promise<{ ok: boolean; error?: string }> {
    try {
      const page = await this.getPage(pageId);
      await page.context().clearCookies();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

export const agentBrowser = new AgentBrowser();
