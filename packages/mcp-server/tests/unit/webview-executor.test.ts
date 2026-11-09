import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendCommand = vi.fn();

const mockConnect = vi.fn();

const mockIsConnected = vi.fn(() => { return true; });

const mockRegisterScript = vi.fn();

const mockIsScriptRegistered = vi.fn();

const mockHasActiveSession = vi.fn(() => { return true; });

const mockResolveTargetApp = vi.fn();

vi.mock('../../src/driver/script-manager.js', () => {
   return {
      registerScript: mockRegisterScript,
      isScriptRegistered: mockIsScriptRegistered,
   };
});

vi.mock('../../src/driver/session-manager.js', () => {
   return {
      hasActiveSession: mockHasActiveSession,
      resolveTargetApp: mockResolveTargetApp,
   };
});

vi.mock('../../src/logger.js', () => {
   return {
      createMcpLogger: () => {
         return {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
         };
      },
   };
});

function createSession(): {
   host: string;
   port: number;
   client: {
      connect: typeof mockConnect;
      isConnected: typeof mockIsConnected;
      sendCommand: typeof mockSendCommand;
   };
} {
   return {
      host: 'localhost',
      port: 9300,
      client: {
         connect: mockConnect,
         isConnected: mockIsConnected,
         sendCommand: mockSendCommand,
      },
   };
}

describe('Webview Executor Unit Tests', () => {
   beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
      mockHasActiveSession.mockReturnValue(true);
      mockResolveTargetApp.mockReturnValue(createSession());
      mockIsConnected.mockReturnValue(true);
      mockConnect.mockResolvedValue(undefined);
      mockRegisterScript.mockResolvedValue({ registered: true, scriptId: 'test-script' });
      mockIsScriptRegistered.mockResolvedValue(false);
   });

   it('registers the resolve-ref helper in the requested window during initialization', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      executor.resetInitialization();

      mockSendCommand
         .mockResolvedValueOnce({
            success: true,
            data: true,
         })
         .mockResolvedValueOnce({
            success: true,
            data: 'test-app',
            windowContext: { windowLabel: 'recording-toolbar' },
         });

      const result = await executor.executeInWebviewWithContext('document.title', 'recording-toolbar', 9300);

      expect(mockRegisterScript).toHaveBeenCalledWith(
         '__mcp_resolve_ref__',
         'inline',
         expect.any(String),
         'recording-toolbar',
         9300
      );
      expect(mockSendCommand).toHaveBeenNthCalledWith(1, {
         command: 'execute_js',
         args: {
            script: 'return !!(window.__MCP__ && typeof window.__MCP__.resolveRef === "function")',
            windowLabel: 'recording-toolbar',
         },
      }, 2000);
      expect(mockSendCommand).toHaveBeenNthCalledWith(2, {
         command: 'execute_js',
         args: { script: 'document.title', windowLabel: 'recording-toolbar' },
      }, 7000);
      expect(result).toEqual({
         result: 'test-app',
         windowLabel: 'recording-toolbar',
         warning: undefined,
      });
   });

   it('keeps the requested window for html2canvas fallback screenshots', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      executor.resetInitialization();

      mockSendCommand
         .mockResolvedValueOnce({
            success: true,
            data: true,
         })
         .mockResolvedValueOnce({
            success: false,
            error: 'Native screenshot unavailable',
         })
         .mockResolvedValueOnce({
            success: true,
            data: 'data:image/png;base64,ZmFrZQ==',
            windowContext: { windowLabel: 'recording-toolbar' },
         });

      const result = await executor.captureScreenshot({
         windowId: 'recording-toolbar',
         appIdentifier: 9300,
      });

      expect(mockRegisterScript).toHaveBeenCalledWith(
         '__mcp_html2canvas__',
         'inline',
         expect.any(String),
         'recording-toolbar',
         9300
      );
      expect(mockSendCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
         command: 'execute_js',
         args: expect.objectContaining({ script: expect.stringContaining('resolveRef') }),
      }), 2000);
      expect(mockSendCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
         command: 'capture_native_screenshot',
         args: expect.objectContaining({ windowLabel: 'recording-toolbar' }),
      }), 15000);
      expect(mockSendCommand).toHaveBeenNthCalledWith(3, expect.objectContaining({
         command: 'execute_js',
         args: expect.objectContaining({ windowLabel: 'recording-toolbar' }),
      }), 7000);
      expect(result.content[0]).toEqual({
         type: 'text',
         text: expect.stringContaining('WebGPU/WebGL'),
      });
      expect(result.content[1]).toEqual({
         type: 'image',
         data: 'ZmFrZQ==',
         mimeType: 'image/png',
      });
   });

   it('reports unverified GPU surfaces alongside a successful native screenshot', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      mockSendCommand
         .mockResolvedValueOnce({ success: true, data: true })
         .mockResolvedValueOnce({
            success: true,
            data: 'data:image/png;base64,ZmFrZQ==',
            windowContext: { windowLabel: 'main', totalWindows: 2, warning: 'Multiple windows open' },
         });

      const result = await executor.captureScreenshot();

      expect(result.content[0]).toEqual({
         type: 'text',
         text: expect.stringContaining('WebGPU/WebGL'),
      });
      expect(result.content[0]).toEqual({
         type: 'text',
         text: expect.stringContaining('Multiple windows open'),
      });
      expect(result.content[1]).toEqual({ type: 'image', data: 'ZmFrZQ==', mimeType: 'image/png' });
   });

   it('captures the requested OS window directly when window mode is selected', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      mockRegisterScript.mockRejectedValue(new Error('WebView is unavailable'));
      mockSendCommand
         .mockResolvedValueOnce({
            success: true,
            data: 'data:image/png;base64,ZmFrZQ==',
            windowContext: { windowLabel: 'recording-toolbar', totalWindows: 2 },
         });

      const result = await executor.captureScreenshot({
         mode: 'window', windowId: 'recording-toolbar', appIdentifier: 9300, format: 'png', maxWidth: 600,
      });

      expect(mockSendCommand).toHaveBeenLastCalledWith({
         command: 'capture_window_screenshot',
         args: { format: 'png', quality: 80, windowLabel: 'recording-toolbar', maxWidth: 600 },
      }, 15000);
      expect(result.content[0]).toEqual({
         type: 'text', text: expect.stringContaining('OS window capture'),
      });
      expect(result.content[1]).toEqual({ type: 'image', data: 'ZmFrZQ==', mimeType: 'image/png' });
      expect(mockRegisterScript).not.toHaveBeenCalled();
   });

   it('does not fall back to an incomplete WebView snapshot when OS window capture fails', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      mockSendCommand
         .mockResolvedValueOnce({ success: false, error: 'Unknown command: capture_window_screenshot' });

      await expect(executor.captureScreenshot({ mode: 'window', allowScreenCapture: true }))
         .rejects
         .toThrow('OS window capture failed: Unknown command: capture_window_screenshot');
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockIsScriptRegistered).not.toHaveBeenCalled();
   });

   it('does not request screen-sharing permission without explicit opt-in', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      executor.resetInitialization();

      mockSendCommand
         .mockResolvedValueOnce({ success: true, data: true })
         .mockResolvedValueOnce({ success: false, error: 'Native screenshot unavailable on Linux' })
         .mockResolvedValueOnce({ success: false, error: 'Script execution timeout' });

      await expect(executor.captureScreenshot()).rejects.toThrow(
         'Screen Capture API fallback is disabled'
      );

      expect(mockSendCommand).toHaveBeenCalledTimes(3);

      const scripts = mockSendCommand.mock.calls
         .map(([ command ]) => { return command.args?.script; })
         .filter((script): script is string => { return typeof script === 'string'; });

      expect(scripts.every((script) => { return !script.includes('getDisplayMedia'); })).toBe(true);
   });

   it('uses Screen Capture API only after explicit opt-in', async () => {
      const executor = await import('../../src/driver/webview-executor.js');

      executor.resetInitialization();

      mockSendCommand
         .mockResolvedValueOnce({ success: true, data: true })
         .mockResolvedValueOnce({ success: false, error: 'Native screenshot unavailable on Linux' })
         .mockResolvedValueOnce({ success: false, error: 'html2canvas failed' })
         .mockResolvedValueOnce({ success: true, data: 'data:image/png;base64,ZmFrZQ==' });

      const result = await executor.captureScreenshot({ format: 'png', allowScreenCapture: true });

      expect(mockSendCommand).toHaveBeenCalledTimes(4);
      expect(mockSendCommand).toHaveBeenLastCalledWith(expect.objectContaining({
         command: 'execute_js',
         args: expect.objectContaining({ script: expect.stringContaining('getDisplayMedia') }),
      }), 7000);
      expect(result.content[0]).toEqual({
         type: 'text',
         text: 'Screenshot captured via Screen Capture API',
      });
   });
});
