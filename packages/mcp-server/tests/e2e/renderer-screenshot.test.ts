import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manageDriverSession } from '../../src/driver/session-manager.js';
import { executeAsyncInWebview } from '../../src/driver/webview-executor.js';
import { screenshot } from '../../src/driver/webview-interactions.js';
import { getTestAppPort } from '../test-utils.js';

describe('Renderer readback screenshots', () => {
   const selector = '#readback-map',
         script = 'return { width: 2, height: 2, pixels: new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]) };';

   beforeAll(async () => {
      await manageDriverSession('start', undefined, getTestAppPort());
      await executeAsyncInWebview(`
         const fixture = document.createElement('div');
         fixture.id = 'readback-fixture';
         fixture.style.cssText = 'position:fixed;left:0;top:0;width:80px;height:80px;z-index:2147483647';
         const map = document.createElement('canvas');
         map.id = 'readback-map'; map.width = 2; map.height = 2;
         map.style.cssText = 'width:80px;height:80px;display:block';
         map.getContext('2d').fillRect(0, 0, 2, 2);
         const hud = document.createElement('div');
         hud.style.cssText = 'position:absolute;left:10px;top:10px;width:20px;height:20px;background:rgb(0,0,255)';
         fixture.append(map, hud); document.body.append(fixture);
         return true;
      `);
   });

   afterAll(async () => {
      try {
         await executeAsyncInWebview('document.getElementById("readback-fixture")?.remove(); return true;');
      } finally {
         await manageDriverSession('stop');
      }
   });

   it('composes renderer pixels below the HTML HUD and preserves the source canvas', async () => {
      const result = await screenshot({ format: 'png', maxWidth: 400, canvasCapture: { selector, script } });

      if (!('content' in result)) {
         throw new Error('Expected an image result');
      }
      const image = result.content.find((item) => { return item.type === 'image'; });

      if (image?.type !== 'image') {
         throw new Error('Expected PNG content');
      }
      expect(result.content[0]).toEqual({ type: 'text', text: expect.stringContaining('captured via renderer readback') });
      const pixels = JSON.parse(await executeAsyncInWebview(`
         const image = new Image();
         image.src = ${JSON.stringify('data:image/png;base64,')} + ${JSON.stringify(image.data)};
         await image.decode();
         const canvas = document.createElement('canvas');
         canvas.width = image.width; canvas.height = image.height;
         const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
         const scale = image.width / innerWidth;
         const pixel = (x, y) => Array.from(ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data);
         return JSON.stringify({ width: image.width, map: pixel(50,50), hud: pixel(20,20),
            source: Array.from(document.querySelector('${selector}').getContext('2d').getImageData(0,0,1,1).data) });
      `));

      expect(pixels).toEqual({ width: 400, map: [ 255, 0, 0, 255 ], hud: [ 0, 0, 255, 255 ], source: [ 0, 0, 0, 255 ] });
   });

   it('isolates renderer frames between concurrent screenshot requests', async () => {
      function solid(r: number, g: number, b: number): string {
         const pixels = Array(4).fill([ r, g, b, 255 ]).flat().join(',');

         return `return { width: 2, height: 2, pixels: new Uint8Array([${pixels}]) };`;
      }

      async function mapPixel(data: string): Promise<number[]> {
         return JSON.parse(await executeAsyncInWebview(`
            const image = new Image();
            image.src = 'data:image/png;base64,' + ${JSON.stringify(data)};
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const scale = image.width / innerWidth;
            return JSON.stringify(Array.from(ctx.getImageData(Math.floor(60 * scale), Math.floor(60 * scale), 1, 1).data));
         `));
      }

      const [ redResult, greenResult ] = await Promise.all([
         screenshot({ format: 'png', canvasCapture: { selector, script: solid(255, 0, 0) } }),
         screenshot({ format: 'png', canvasCapture: { selector, script: solid(0, 128, 0) } }),
      ]);

      if (!('content' in redResult) || !('content' in greenResult)) {
         throw new Error('Expected image results');
      }
      const redImage = redResult.content.find((item) => { return item.type === 'image'; }),
            greenImage = greenResult.content.find((item) => { return item.type === 'image'; });

      if (redImage?.type !== 'image' || greenImage?.type !== 'image') {
         throw new Error('Expected PNG content');
      }
      expect(await mapPixel(redImage.data)).toEqual([ 255, 0, 0, 255 ]);
      expect(await mapPixel(greenImage.data)).toEqual([ 0, 128, 0, 255 ]);
   });

   it('restores the helper in the target document even when the app registry already contains it', async () => {
      await screenshot({ windowId: 'main', format: 'png', canvasCapture: { selector, script } });
      await executeAsyncInWebview('delete window.html2canvas; return true;');

      const result = await screenshot({ windowId: 'main', format: 'png', canvasCapture: { selector, script } });

      if (!('content' in result)) {
         throw new Error('Expected an image result');
      }
      expect(result.content.some((item) => { return item.type === 'image' && item.mimeType === 'image/png'; })).toBe(true);
   });

   it.each([
      [ 'return null;', 'RGBA' ],
      [ 'return { width: 2, height: 2, pixels: [255] };', 'RGBA' ],
      [ 'return { width: 2, height: 2, pixels: Array(16).fill(-1) };', 'RGBA' ],
      [ 'throw new Error("Renderer unavailable");', 'Renderer unavailable' ],
   ])(
      'reports invalid or failed renderer readback: %s',
      async (captureScript, message) => {
         await expect(screenshot({ canvasCapture: { selector, script: captureScript } })).rejects.toThrow(message);
      }
   );

   it('rejects a missing canvas instead of capturing an incomplete page', async () => {
      await expect(screenshot({ canvasCapture: { selector: '#missing-map', script } }))
         .rejects
         .toThrow('one canvas');
   });
});
