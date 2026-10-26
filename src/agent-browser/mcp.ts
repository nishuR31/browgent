import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { agentBrowser } from './browser.js';

const tools: Tool[] = [
  {
    name: 'browser_launch',
    description: 'Launch the headless Chromium browser',
    inputSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Run headless (default true)' },
        viewport_width: { type: 'number', description: 'Viewport width' },
        viewport_height: { type: 'number', description: 'Viewport height' },
      },
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser and all sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_new_session',
    description: 'Create a new isolated browser session (context)',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session ID' } },
      required: ['session_id'],
    },
  },
  {
    name: 'browser_close_session',
    description: 'Close a browser session',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session ID' } },
      required: ['session_id'],
    },
  },
  {
    name: 'browser_new_page',
    description: 'Open a new page in a session',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        page_id: { type: 'string', description: 'Page ID' },
        url: { type: 'string', description: 'Initial URL' },
      },
      required: ['session_id', 'page_id'],
    },
  },
  {
    name: 'browser_close_page',
    description: 'Close a page',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a page to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['page_id', 'url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        selector: { type: 'string', description: 'CSS selector' },
      },
      required: ['page_id', 'selector'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill an input field by CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        selector: { type: 'string', description: 'CSS selector' },
        value: { type: 'string', description: 'Value to fill' },
      },
      required: ['page_id', 'selector', 'value'],
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        key: { type: 'string', description: 'Key name (e.g. Enter, Escape)' },
      },
      required: ['page_id', 'key'],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Run JavaScript in the page context',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        script: { type: 'string', description: 'JavaScript to evaluate' },
      },
      required: ['page_id', 'script'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the page',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        full_page: { type: 'boolean', description: 'Full page screenshot' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_dom',
    description: 'Get the DOM tree of the page',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back in history',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_forward',
    description: 'Go forward in history',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the page',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_wait_for_selector',
    description: 'Wait for a CSS selector to appear',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        selector: { type: 'string', description: 'CSS selector' },
        timeout: { type: 'number', description: 'Timeout in ms' },
      },
      required: ['page_id', 'selector'],
    },
  },
  {
    name: 'browser_list_pages',
    description: 'List all open pages',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_list_sessions',
    description: 'List all browser sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_url',
    description: 'Get the current URL of a page',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_get_title',
    description: 'Get the current title of a page',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_set_viewport',
    description: 'Set the viewport size of a page',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        width: { type: 'number', description: 'Viewport width' },
        height: { type: 'number', description: 'Viewport height' },
      },
      required: ['page_id', 'width', 'height'],
    },
  },
  {
    name: 'browser_upload_file',
    description: 'Upload a file to a file input',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        selector: { type: 'string', description: 'CSS selector of file input' },
        file_path: { type: 'string', description: 'Path to file on disk' },
      },
      required: ['page_id', 'selector', 'file_path'],
    },
  },
  {
    name: 'browser_wait_for_navigation',
    description: 'Wait for navigation to complete',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        timeout: { type: 'number', description: 'Timeout in ms' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_get_cookies',
    description: 'Get cookies for the page context',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_clear_cookies',
    description: 'Clear cookies for the page context',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string', description: 'Page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'browser_add_script_tag',
    description: 'Add a script tag to the page',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID' },
        url: { type: 'string', description: 'Script URL' },
      },
      required: ['page_id', 'url'],
    },
  },
];

async function main() {
  const server = new Server(
    {
      name: 'browgent-agent-browser',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'browser_launch': {
          await agentBrowser.launch({
            headless: args?.headless ?? true,
            viewport: args?.viewport_width && args?.viewport_height
              ? { width: args.viewport_width, height: args.viewport_height }
              : { width: 1280, height: 720 },
          });
          return { content: [{ type: 'text', text: 'Browser launched successfully' }] };
        }
        case 'browser_close': {
          await agentBrowser.close();
          return { content: [{ type: 'text', text: 'Browser closed' }] };
        }
        case 'browser_new_session': {
          await agentBrowser.newSession(args!.session_id as string);
          return { content: [{ type: 'text', text: `Session ${args.session_id} created` }] };
        }
        case 'browser_close_session': {
          await agentBrowser.closeSession(args!.session_id as string);
          return { content: [{ type: 'text', text: `Session ${args.session_id} closed` }] };
        }
        case 'browser_new_page': {
          await agentBrowser.newPage(
            args!.session_id as string,
            args!.page_id as string,
            (args?.url as string) ?? 'about:blank'
          );
          return { content: [{ type: 'text', text: `Page ${args.page_id} created in session ${args.session_id}` }] };
        }
        case 'browser_close_page': {
          await agentBrowser.closePage(args!.page_id as string);
          return { content: [{ type: 'text', text: `Page ${args.page_id} closed` }] };
        }
        case 'browser_navigate': {
          const res = await agentBrowser.navigate(args!.page_id as string, args!.url as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_click': {
          const res = await agentBrowser.click(args!.page_id as string, args!.selector as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_fill': {
          const res = await agentBrowser.fill(args!.page_id as string, args!.selector as string, args!.value as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_press': {
          const res = await agentBrowser.press(args!.page_id as string, args!.key as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_evaluate': {
          const res = await agentBrowser.evaluate(args!.page_id as string, args!.script as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_screenshot': {
          const res = await agentBrowser.screenshot(args!.page_id as string, args?.full_page ?? false);
          if (res.ok && res.data) {
            return {
              content: [{ type: 'text', text: `data:image/png;base64,${res.data}` }],
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_dom': {
          const res = await agentBrowser.getDom(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_back': {
          const res = await agentBrowser.goBack(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_forward': {
          const res = await agentBrowser.goForward(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_reload': {
          const res = await agentBrowser.reload(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_wait_for_selector': {
          const res = await agentBrowser.waitForSelector(
            args!.page_id as string,
            args!.selector as string,
            args?.timeout ?? 10000
          );
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_list_pages': {
          const pages = agentBrowser.listPages();
          return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
        }
        case 'browser_list_sessions': {
          const sessions = agentBrowser.listSessions();
          return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
        }
        case 'browser_get_url': {
          const url = await agentBrowser.getUrl(args!.page_id as string);
          return { content: [{ type: 'text', text: url }] };
        }
        case 'browser_get_title': {
          const title = await agentBrowser.getTitle(args!.page_id as string);
          return { content: [{ type: 'text', text: title }] };
        }
        case 'browser_set_viewport': {
          const res = await agentBrowser.setViewport(args!.page_id as string, args!.width as number, args!.height as number);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_upload_file': {
          const res = await agentBrowser.uploadFile(args!.page_id as string, args!.selector as string, args!.file_path as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_wait_for_navigation': {
          const res = await agentBrowser.waitForNavigation(args!.page_id as string, args?.timeout ?? 30000);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_get_cookies': {
          const res = await agentBrowser.getCookies(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_clear_cookies': {
          const res = await agentBrowser.clearCookies(args!.page_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        case 'browser_add_script_tag': {
          const res = await agentBrowser.addScriptTag(args!.page_id as string, args!.url as string);
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e) }, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Browgent Agent Browser MCP server running on stdio\n');
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});
