import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { manageDriverSession } from '../../src/driver/session-manager.js';
import { executeInWebview, executeAsyncInWebview } from '../../src/driver/webview-executor.js';
import { getTestAppPort } from '../test-utils';
import {
   registerScript,
   removeScript,
   clearScripts,
   getScripts,
   isScriptRegistered,
} from '../../src/driver/script-manager.js';

/**
 * Helper to wait for a condition with polling.
 */
async function waitForCondition(
   checkFn: () => Promise<boolean>,
   timeoutMs = 2000,
   intervalMs = 50
): Promise<boolean> {
   const startTime = Date.now();

   while (Date.now() - startTime < timeoutMs) {
      if (await checkFn()) {
         return true;
      }
      await new Promise((r) => { return setTimeout(r, intervalMs); });
   }

   return false;
}

/**
 * E2E tests for script manager.
 * Tests the persistent script injection system.
 */
describe('Script Manager E2E Tests', () => {
   const TIMEOUT = 15000;

   beforeAll(async () => {
      // App is already started globally - connect to the dynamically assigned port
      await manageDriverSession('start', undefined, getTestAppPort());
   }, TIMEOUT);

   afterAll(async () => {
      // Clean up any registered scripts
      await clearScripts();

      // Don't stop the app - it's managed globally
      await manageDriverSession('stop');
   }, TIMEOUT);

   beforeEach(async () => {
      // Clear scripts before each test
      await clearScripts();
   });

   describe('Script Registration', () => {
      it('should register an inline script', async () => {
         const result = await registerScript(
            'test-inline-script',
            'inline',
            'window.__TEST_SCRIPT_LOADED__ = true;'
         );

         expect(result.registered).toBe(true);
         expect(result.scriptId).toBe('test-inline-script');
      }, TIMEOUT);

      it('should register a URL script', async () => {
         const result = await registerScript(
            'test-url-script',
            'url',
            'https://example.com/script.js'
         );

         expect(result.registered).toBe(true);
         expect(result.scriptId).toBe('test-url-script');
      }, TIMEOUT);

      it('should inject inline script into DOM', async () => {
         await registerScript(
            'test-dom-script',
            'inline',
            'window.__DOM_TEST__ = "injected";'
         );

         // Poll for the script to be executed
         const found = await waitForCondition(async () => {
            const result = await executeInWebview('return window.__DOM_TEST__');

            return result === 'injected';
         });

         expect(found).toBe(true);
      }, TIMEOUT);

      it('should add script tag to document head', async () => {
         await registerScript(
            'test-tag-script',
            'inline',
            'console.log("test");'
         );

         // Poll for the script tag to exist
         const found = await waitForCondition(async () => {
            const result = await executeInWebview(
               'return !!document.querySelector(\'script[data-mcp-script-id="test-tag-script"]\')'
            );

            return result === 'true';
         });

         expect(found).toBe(true);
      }, TIMEOUT);
   });

   describe('Script Removal', () => {
      it('should remove a registered script', async () => {
         await registerScript('to-remove', 'inline', 'window.__TO_REMOVE__ = true;');

         const removeResult = await removeScript('to-remove');

         expect(removeResult.removed).toBe(true);
         expect(removeResult.scriptId).toBe('to-remove');
      }, TIMEOUT);

      it('should remove script tag from DOM', async () => {
         await registerScript('dom-remove', 'inline', 'console.log("remove me");');

         const selector = 'script[data-mcp-script-id="dom-remove"]';

         // Poll for script to exist
         const injected = await waitForCondition(async () => {
            const result = await executeInWebview(`return !!document.querySelector('${selector}')`);

            return result === 'true';
         });

         expect(injected).toBe(true);

         // Remove the script
         await removeScript('dom-remove');

         // Poll for script to be removed
         const removed = await waitForCondition(async () => {
            const result = await executeInWebview(`return !!document.querySelector('${selector}')`);

            return result === 'false';
         });

         expect(removed).toBe(true);
      }, TIMEOUT);

      it('should handle removing non-existent script', async () => {
         const result = await removeScript('non-existent');

         expect(result.removed).toBe(false);
      }, TIMEOUT);
   });

   describe('Script Listing', () => {
      it('should list all registered scripts', async () => {
         await registerScript('script-a', 'inline', 'a');
         await registerScript('script-b', 'url', 'https://example.com/b.js');

         const { scripts } = await getScripts();

         expect(scripts.length).toBe(2);

         const ids = scripts.map((s) => { return s.id; });

         expect(ids).toContain('script-a');
         expect(ids).toContain('script-b');
      }, TIMEOUT);

      it('should return empty array when no scripts registered', async () => {
         const { scripts } = await getScripts();

         expect(scripts).toEqual([]);
      }, TIMEOUT);
   });

   describe('Clear Scripts', () => {
      it('should clear all registered scripts', async () => {
         await registerScript('clear-1', 'inline', '1');
         await registerScript('clear-2', 'inline', '2');
         await registerScript('clear-3', 'inline', '3');

         const clearResult = await clearScripts();

         expect(clearResult.cleared).toBe(3);

         const { scripts } = await getScripts();

         expect(scripts.length).toBe(0);
      }, TIMEOUT);

      it('should remove all script tags from DOM', async () => {
         await registerScript('clear-dom-1', 'inline', 'console.log(1);');
         await registerScript('clear-dom-2', 'inline', 'console.log(2);');

         const countSelector = 'script[data-mcp-script-id]';

         // Poll for scripts to be injected
         const injected = await waitForCondition(async () => {
            const count = await executeInWebview(
               `return document.querySelectorAll('${countSelector}').length`
            );

            return parseInt(count, 10) >= 2;
         });

         expect(injected).toBe(true);

         // Clear all scripts
         await clearScripts();

         // Poll for scripts to be removed
         const cleared = await waitForCondition(async () => {
            const count = await executeInWebview(
               `return document.querySelectorAll('${countSelector}').length`
            );

            return count === '0';
         });

         expect(cleared).toBe(true);
      }, TIMEOUT);
   });

   describe('Script Registration Check', () => {
      it('should return true for registered script', async () => {
         await registerScript('check-exists', 'inline', 'exists');

         const exists = await isScriptRegistered('check-exists');

         expect(exists).toBe(true);
      }, TIMEOUT);

      it('should return false for non-registered script', async () => {
         const exists = await isScriptRegistered('does-not-exist');

         expect(exists).toBe(false);
      }, TIMEOUT);
   });

   describe('Script Re-injection', () => {
      it('should skip scripts whose marker is already in the document even on bare request', async () => {
         await registerScript(
            'reinject-skip',
            'inline',
            'window.__REINJECT_COUNT__ = (window.__REINJECT_COUNT__ || 0) + 1;'
         );

         const injected = await waitForCondition(async () => {
            const count = await executeInWebview('return window.__REINJECT_COUNT__');

            return parseInt(count, 10) === 1;
         });

         expect(injected).toBe(true);

         // A repeated page-load request (even without skipIds) must not re-run
         // scripts whose marker is already present in the document.
         await executeAsyncInWebview(
            'return JSON.stringify(await window.__TAURI__.core.invoke(' +
            '"plugin:mcp-bridge|request_script_injection"));'
         );

         const count = await executeInWebview('return window.__REINJECT_COUNT__');

         expect(parseInt(count, 10)).toBe(1);
      }, TIMEOUT);

      it('should re-inject when the marker is not in the document', async () => {
         await registerScript(
            'reinject-run',
            'inline',
            'window.__REINJECT_RUN__ = (window.__REINJECT_RUN__ || 0) + 1;'
         );

         const injected = await waitForCondition(async () => {
            const count = await executeInWebview('return window.__REINJECT_RUN__');

            return parseInt(count, 10) === 1;
         });

         expect(injected).toBe(true);

         // Remove marker to simulate page reload/navigation
         await executeInWebview(
            'const marker = document.querySelector(\'script[data-mcp-script-id="reinject-run"]\'); ' +
            'if (marker) marker.remove();'
         );

         await executeAsyncInWebview(
            'return JSON.stringify(await window.__TAURI__.core.invoke(' +
            '"plugin:mcp-bridge|request_script_injection"));'
         );

         const count = await executeInWebview('return window.__REINJECT_RUN__');

         expect(parseInt(count, 10)).toBe(2);
      }, TIMEOUT);
   });

   describe('Script Replacement', () => {
      it('should replace script with same ID', async () => {
         await registerScript('replace-me', 'inline', 'window.__REPLACE_VALUE__ = "original";');

         // Poll for original value
         const originalSet = await waitForCondition(async () => {
            const value = await executeInWebview('return window.__REPLACE_VALUE__');

            return value === 'original';
         });

         expect(originalSet).toBe(true);

         // Register again with same ID but different content
         await registerScript('replace-me', 'inline', 'window.__REPLACE_VALUE__ = "replaced";');

         // Poll for replaced value
         const replacedSet = await waitForCondition(async () => {
            const value = await executeInWebview('return window.__REPLACE_VALUE__');

            return value === 'replaced';
         });

         expect(replacedSet).toBe(true);

         // Should still only have one script in registry
         const { scripts } = await getScripts();

         const replaceScripts = scripts.filter((s) => { return s.id === 'replace-me'; });

         expect(replaceScripts.length).toBe(1);
      }, TIMEOUT);
   });
});
