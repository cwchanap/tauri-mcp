/**
 * html2canvas-pro library loader
 *
 * Loads the html2canvas-pro library from node_modules and provides it as a string
 * that can be injected into the webview. html2canvas-pro is a fork of html2canvas
 * that adds support for modern CSS color functions like oklch(), oklab(), lab(),
 * lch(), and color().
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

// Use createRequire to resolve the path to html2canvas-pro in node_modules
const require = createRequire(import.meta.url);

let html2canvasProSource: string | null = null;

/** Script ID used for the html2canvas library in the script registry. */
export const HTML2CANVAS_SCRIPT_ID = '__mcp_html2canvas__';

/** App-provided renderer readback for one canvas, in top-left RGBA8 order. */
export interface CanvasCaptureOptions {
   selector: string;
   script: string;
}

interface DomCaptureOptions {
   canvasCapture?: CanvasCaptureOptions;
   maxWidth?: number;
}

/**
 * Get the html2canvas-pro library source code.
 * Loaded lazily and cached.
 */
export function getHtml2CanvasSource(): string {
   if (html2canvasProSource === null) {
      // Resolve the path to html2canvas-pro.js (UMD build)
      // Note: We use the main entry point since the minified version isn't exported
      const html2canvasProPath = require.resolve('html2canvas-pro');

      html2canvasProSource = readFileSync(html2canvasProPath, 'utf-8')
         // Strip sourceMappingURL to prevent the browser from trying to fetch the
         // .map file relative to the page's base URL (which fails when the app is
         // served under a sub-path like '/some/path/').
         .replace(/\/\/[#@]\s*sourceMappingURL=.*/g, '');
   }

   return html2canvasProSource;
}

export const HTML2CANVAS_RESOLVER_SCRIPT = `
      // Get the html2canvas function (may be on window, self, or globalThis)
      const html2canvasFn = typeof html2canvas !== 'undefined' ? html2canvas :
                           (typeof window !== 'undefined' && window.html2canvas) ? window.html2canvas :
                           (typeof self !== 'undefined' && self.html2canvas) ? self.html2canvas :
                           (typeof globalThis !== 'undefined' && globalThis.html2canvas) ? globalThis.html2canvas : null;

      if (!html2canvasFn) {
         throw new Error('html2canvas not loaded');
      }
`;

export const HTML2CANVAS_OPTIONS_SCRIPT = `{
         backgroundColor: null,
         scale: window.devicePixelRatio || 1,
         logging: false,
         useCORS: true,
         allowTaint: false,
         imageTimeout: 5000,
      }`;

/**
 * Build a script that captures a screenshot using html2canvas.
 * Assumes html2canvas is already loaded (either via script manager or inline).
 */
export function buildScreenshotCaptureScript(format: 'png' | 'jpeg', quality: number, options: DomCaptureOptions = {}): string {
   const readbackScript = options.canvasCapture ? `
      const captureSelector = ${JSON.stringify(options.canvasCapture.selector)};
      const sources = document.querySelectorAll(captureSelector);
      if (sources.length !== 1 || !(sources[0] instanceof HTMLCanvasElement)) {
         throw new Error('canvasCapture selector must match exactly one canvas');
      }
      const frame = await (async () => { ${options.canvasCapture.script}\n })();
      if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
          frame.width <= 0 || frame.height <= 0 ||
          frame.width !== sources[0].width || frame.height !== sources[0].height ||
          !(Array.isArray(frame.pixels) || frame.pixels instanceof Uint8Array || frame.pixels instanceof Uint8ClampedArray) ||
          frame.pixels.length !== frame.width * frame.height * 4) {
         throw new Error('canvasCapture must return {width, height, pixels}: RGBA8 matching the source canvas dimensions');
      }
      for (const value of frame.pixels) {
         if (!Number.isInteger(value) || value < 0 || value > 255) {
            throw new Error('canvasCapture pixels must contain RGBA8 bytes (0-255)');
         }
      }
      const capturedImage = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height);
   ` : '';

   // Note: This script is wrapped by executeAsyncInWebview, so we don't need an IIFE
   return `
      ${HTML2CANVAS_RESOLVER_SCRIPT}
      ${readbackScript}

      // Render the document, but crop the output to the visible viewport. Without
      // explicit bounds html2canvas allocates a canvas for the full scrollable
      // document, which is both inconsistent with the native implementations and
      // can time out on long pages.
      const element = document.documentElement;
      if (!element) {
         throw new Error('document.documentElement is null');
      }

      const viewportWidth = Math.max(element.clientWidth, window.innerWidth || 0);
      const viewportHeight = Math.max(element.clientHeight, window.innerHeight || 0);
      const viewportX = window.scrollX || window.pageXOffset || 0;
      const viewportY = window.scrollY || window.pageYOffset || 0;

      // Capture the webview
      const canvas = await html2canvasFn(element, {
         ...${HTML2CANVAS_OPTIONS_SCRIPT},
         x: viewportX,
         y: viewportY,
         width: viewportWidth,
         height: viewportHeight,
         windowWidth: viewportWidth,
         windowHeight: viewportHeight,
         scrollX: viewportX,
         scrollY: viewportY,
         ${options.canvasCapture ? `onclone: (clonedDocument) => {
            const target = clonedDocument.querySelector(captureSelector);
            if (!target || target.tagName !== 'CANVAS') {
               throw new Error('canvasCapture cloned canvas is unavailable');
            }
            const context = target.getContext('2d');
            if (!context) {
               throw new Error('canvasCapture cloned canvas has no 2D context');
            }
            context.putImageData(capturedImage, 0, 0);
         },` : ''}
      });
      if (!canvas) {
         throw new Error('html2canvas returned null canvas');
      }

      let output = canvas;
      const maxWidth = ${options.maxWidth ?? 'null'};
      if (maxWidth && canvas.width > maxWidth) {
         output = document.createElement('canvas');
         output.width = maxWidth;
         output.height = Math.max(1, Math.round(canvas.height * maxWidth / canvas.width));
         const context = output.getContext('2d');
         if (!context) {
            throw new Error('Screenshot resize canvas has no 2D context');
         }
         context.drawImage(canvas, 0, 0, output.width, output.height);
      }

      // Convert to data URL
      const mimeType = '${format}' === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl = output.toDataURL(mimeType, ${quality / 100});

      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
         throw new Error('canvas.toDataURL returned invalid result: ' + (dataUrl ? dataUrl.substring(0, 50) : 'null'));
      }

      return dataUrl;
   `;
}

/**
 * Build a script that injects html2canvas and captures a screenshot.
 * This is the legacy function that inlines the library - kept for fallback.
 */
export function buildScreenshotScript(format: 'png' | 'jpeg', quality: number, options: DomCaptureOptions = {}): string {
   const html2canvas = getHtml2CanvasSource();

   // Note: This script is wrapped by executeAsyncInWebview, so we don't need an IIFE
   return `
      try {
         // Inject html2canvas if not already present
         // The library uses UMD and may set on globalThis, self, or window
         if (typeof html2canvas === 'undefined') {
            ${html2canvas}
            // After loading, html2canvas should be on globalThis/self/window
         }

         ${buildScreenshotCaptureScript(format, quality, options)}
      } catch (screenshotError) {
         // Re-throw with more context
         throw new Error('Screenshot capture failed: ' + (screenshotError.message || String(screenshotError)));
      }
   `;
}
