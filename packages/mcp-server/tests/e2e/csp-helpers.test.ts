import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manageDriverSession, resolveTargetApp } from '../../src/driver/session-manager.js';
import { clearScripts, registerScript } from '../../src/driver/script-manager.js';
import { captureScreenshot, executeInWebview, resetInitialization } from '../../src/driver/webview-executor.js';
import { getTestAppPort } from '../test-utils.js';

describe.skipIf(!process.env.TAURI_MCP_TEST_APP_BINARY)('Packaged WebView helpers with restrictive CSP', () => {
   beforeAll(async () => {
      await manageDriverSession('start', undefined, getTestAppPort());
   });

   afterAll(async () => {
      await clearScripts();
      await manageDriverSession('stop');
   });

   it('executes helpers, captures screenshots and restores scripts when inline tags are blocked', async () => {
      const { client } = resolveTargetApp();

      const blockedTag = await client.sendCommand({
         command: 'execute_js',
         args: {
            script: `
               window.__CSP_TAG_RAN__ = false;
               const tag = document.createElement('script');
               tag.textContent = 'window.__CSP_TAG_RAN__ = true;';
               document.head.appendChild(tag);
               tag.remove();
               delete window.__MCP__;
               return window.__CSP_TAG_RAN__;
            `,
         },
      });

      expect(blockedTag).toMatchObject({ success: true, data: false });
      await clearScripts();
      resetInitialization();
      expect(await executeInWebview('return 6 * 7')).toBe('42');
      expect(await executeInWebview('return window.__MCP__.resolveRef("body").tagName')).toBe('BODY');

      const screenshot = await captureScreenshot({ format: 'png' });

      expect(screenshot.content.some((item) => { return item.type === 'image' && item.data.length > 100; })).toBe(true);

      await registerScript('csp-strict', 'inline', '"use strict"; window.__CSP_STRICT__ = (function() { return this === undefined; })();');
      expect(await executeInWebview('return window.__CSP_STRICT__')).toBe('true');

      await registerScript('csp-counter', 'inline', 'window.__CSP_COUNT__ = (window.__CSP_COUNT__ || 0) + 1;');
      expect(await executeInWebview('return window.__CSP_COUNT__')).toBe('1');

      await registerScript(
         'csp-globals',
         'inline',
         'var persistedHelper = 42; function persistedFn() { return persistedHelper * 2; }'
      );
      expect(await executeInWebview('return window.persistedHelper')).toBe('42');
      expect(await executeInWebview('return window.persistedFn()')).toBe('84');

      await registerScript('csp-strict-globals', 'inline', '"use strict"; var strictHelper = "strict-ok";');
      expect(await executeInWebview('return window.strictHelper')).toBe('strict-ok');

      const reload = await client.sendCommand({
         command: 'execute_js',
         args: {
            script: `
               window.__CSP_COUNT__ = 0;
               setTimeout(() => location.reload(), 0);
               return true;
            `,
         },
      });

      expect(reload.success).toBe(true);
      const restored = expect.poll(async () => {
         const response = await client.sendCommand({
            command: 'execute_js',
            args: { script: 'return window.__CSP_COUNT__' },
         });

         return response.data;
      }, { timeout: 15000 });

      await restored.toBe(1);
      expect(await executeInWebview('return window.__MCP__.resolveRef("body").tagName')).toBe('BODY');
   }, 60000);

   it('rejects an unknown window in the OS capture bridge command', async () => {
      const { client } = resolveTargetApp();

      const response = await client.sendCommand({
         command: 'capture_window_screenshot',
         args: { windowLabel: 'missing-capture-window' },
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Window \'missing-capture-window\' not found');
   });

   it.skipIf(process.platform !== 'darwin')('captures the OS window or reports OS capture as unavailable', async () => {
      let result;

      try {
         result = await captureScreenshot({ mode: 'window', format: 'png', maxWidth: 200 });
      } catch(error) {
         expect(error).toBeInstanceOf(Error);
         expect((error as Error).message).toContain('macOS window capture unavailable');
         return;
      }

      expect(result.content[0]).toEqual({ type: 'text', text: expect.stringContaining('OS window capture') });
      const image = result.content.find((item) => { return item.type === 'image'; });

      expect(image?.type).toBe('image');
      if (image?.type === 'image') {
         const bytes = Buffer.from(image.data, 'base64');

         expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
         expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(200);
      }
   }, 20000);
});
