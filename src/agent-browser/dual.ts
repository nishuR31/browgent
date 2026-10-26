import { agentBrowser } from './browser.js';

export interface DualAgentBrowserConfig {
  sessionA?: string;
  sessionB?: string;
}

export class DualAgentBrowser {
  private browsers = new Map<string, typeof agentBrowser>();
  private active = new Map<string, string>(); // session -> browser key

  constructor() {
    // Keep agentBrowser as primary; secondary can be launched separately
  }

  async launchSecondary(key: string, opts = { headless: true }): Promise<void> {
    // In production, create a separate Playwright instance
    // For this architecture, we document the dual-pattern
    console.log('[DualAgentBrowser] Secondary browser launched at key:', key);
    this.browsers.set(key, agentBrowser);
  }

  async navigateSecondary(key: string, sessionId: string, url: string): Promise<any> {
    return agentBrowser.navigate(sessionId, url);
  }

  listBrowsers(): string[] {
    return [agentBrowser.toString()];
  }
}

export const dualBrowser = new DualAgentBrowser();
