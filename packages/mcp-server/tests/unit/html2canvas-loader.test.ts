import { describe, expect, it } from 'vitest';

import {
   buildCanvasReadbackScript,
   buildScreenshotCaptureScript,
   buildScreenshotScript,
   getWrappedHtml2CanvasSource,
   HTML2CANVAS_RESOLVER_SCRIPT,
} from '../../src/driver/scripts/html2canvas-loader.js';

describe('html2canvas screenshot script', () => {
   it('bounds fallback screenshots to the visible viewport', () => {
      const script = buildScreenshotCaptureScript('png', 80);

      expect(script).toContain('x: viewportX');
      expect(script).toContain('y: viewportY');
      expect(script).toContain('width: viewportWidth');
      expect(script).toContain('height: viewportHeight');
      expect(script).toContain('windowWidth: viewportWidth');
      expect(script).toContain('windowHeight: viewportHeight');
      expect(script).not.toContain('Capture the entire document');
   });

   it('tags source canvas with an attribute and looks up the clone by attribute', () => {
      const script = buildScreenshotCaptureScript('png', 80, {
         canvasCapture: { selector: 'canvas:nth-child(2)', script: 'return { width: 1, height: 1, pixels: new Uint8Array(4) };' },
      });

      expect(script).toContain('setAttribute(__mcp_markerAttr, \'true\')');
      expect(script).toContain('clonedDocument.querySelector(\'[\' + __mcp_markerAttr + \']\')');
      expect(script).toContain('removeAttribute(__mcp_markerAttr)');
   });

   it('uses a unique marker attribute per generated capture script', () => {
      const options = { canvasCapture: { selector: 'canvas', script: 'return { width: 1, height: 1, pixels: new Uint8Array(4) };' } },
            first = buildScreenshotCaptureScript('png', 80, options),
            second = buildScreenshotCaptureScript('png', 80, options);

      const firstMarker = first.match(/data-mcp-capture-source-[a-z0-9]+/)?.[0],
            secondMarker = second.match(/data-mcp-capture-source-[a-z0-9]+/)?.[0];

      expect(firstMarker).toBeDefined();
      expect(secondMarker).toBeDefined();
      expect(firstMarker).not.toBe(secondMarker);
      expect(first).toContain(`const __mcp_markerAttr = '${firstMarker}'`);
      expect(second).toContain(`const __mcp_markerAttr = '${secondMarker}'`);
   });

   it('marks the source canvas only after the renderer frame is consumed', () => {
      const script = buildScreenshotCaptureScript('png', 80, {
         canvasCapture: { selector: 'canvas', script: 'return { width: 1, height: 1, pixels: new Uint8Array(4) };' },
      });

      const readbackIndex = script.indexOf('new ImageData'),
            markIndex = script.indexOf('setAttribute(__mcp_markerAttr'),
            captureIndex = script.indexOf('canvas = await html2canvasFn');

      expect(readbackIndex).toBeGreaterThan(-1);
      expect(markIndex).toBeGreaterThan(readbackIndex);
      expect(markIndex).toBeLessThan(captureIndex);
   });

   it('inlines the canvasCapture body in an async closure instead of eval-able constructors', () => {
      const script = buildCanvasReadbackScript({
         selector: 'canvas',
         script: 'canvas = 1; element = 2; output = 3; return { width: 1, height: 1, pixels: new Uint8Array(4) };',
      });

      expect(script).not.toContain('AsyncFunction');
      expect(script).not.toContain('new Function');
      expect(script).not.toContain('eval(');
      expect(script).toContain('await (async () => {');
      expect(script).toContain('canvas = 1; element = 2; output = 3;');
   });

   it('keeps the renderer frame in a local binding instead of a shared window slot', () => {
      const script = buildScreenshotCaptureScript('png', 80, {
         canvasCapture: { selector: 'canvas', script: 'return { width: 1, height: 1, pixels: new Uint8Array(4) };' },
      });

      expect(script).toContain('const __mcp_frame = await (async () => {');
      expect(script).not.toContain('window.__MCP_CANVAS_FRAME__');
      expect(script).not.toContain('AsyncFunction');
      expect(script).not.toContain('new Function');
   });

   it('prefers bundled html2canvas-pro via __MCP_HTML2CANVAS__ in resolver', () => {
      expect(HTML2CANVAS_RESOLVER_SCRIPT).toContain('window.__MCP_HTML2CANVAS__');
      expect(HTML2CANVAS_RESOLVER_SCRIPT).toContain('globalThis.__MCP_HTML2CANVAS__');
   });

   it('wrapped html2canvas source exposes __MCP_HTML2CANVAS__ without overwriting app html2canvas', () => {
      const wrapped = getWrappedHtml2CanvasSource();

      expect(wrapped).toContain('window.__MCP_HTML2CANVAS__ = window.html2canvas');
      expect(wrapped).toContain('window.html2canvas = __orig');
   });

   it('legacy inline screenshot script uses wrapped html2canvas source', () => {
      const script = buildScreenshotScript('png', 80);

      expect(script).toContain('window.__MCP_HTML2CANVAS__');
   });
});
