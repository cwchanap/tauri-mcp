import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';

const TEST_APP_PATH = path.resolve(process.cwd(), '../test-app'),
      TEST_APP_PORT_FILE = path.resolve(process.cwd(), '.test-app-port');

// Detect GitHub CI environment and use longer timeout
// eslint-disable-next-line no-process-env
const IS_CI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

const STARTUP_TIMEOUT_MS = IS_CI ? 480000 : 30000; // 4 minutes in CI, 30 seconds locally

let tauriProcess: ChildProcess | null = null,
    isShuttingDown = false,
    testAppPort: number | null = null;

async function startGlobalTestApp(): Promise<void> {
   return new Promise((resolve, reject) => {
      console.log('🚀 Starting Tauri app globally (once for all tests)...');

      // A packaged-origin binary exercises CSP enforcement that tauri dev does not.
      // eslint-disable-next-line no-process-env
      const testAppBinary = process.env.TAURI_MCP_TEST_APP_BINARY;

      tauriProcess = spawn(testAppBinary || 'npm', testAppBinary ? [] : [ 'run', 'tauri', 'dev' ], {
         cwd: TEST_APP_PATH,
         stdio: 'pipe',
         shell: true,
         detached: process.platform !== 'win32',
         // eslint-disable-next-line no-process-env
         env: { ...process.env, WEBKIT_DISABLE_COMPOSITING_MODE: '1' },
      });

      if (!tauriProcess.stdout || !tauriProcess.stderr) {
         reject(new Error('Failed to spawn Tauri process'));
         return;
      }

      let pluginReady = false,
          startupSettled = false;

      const startupTimer = setTimeout(() => {
         if (!startupSettled) {
            startupSettled = true;
            reject(new Error(`Tauri app failed to start within ${STARTUP_TIMEOUT_MS / 1000}s timeout`));
         }
      }, STARTUP_TIMEOUT_MS);

      const failStartup = (error: Error): void => {
         if (!startupSettled) {
            startupSettled = true;
            clearTimeout(startupTimer);
            reject(error);
         }
      };

      // The MCP bridge plugin only initializes after Tauri loads the webview,
      // which only happens once Vite (beforeDevCommand) is reachable. Treating
      // pluginReady as the single source of truth avoids a CI race where
      // Vite's "Local:" output is buffered by the Tauri CLI and never reaches
      // this listener, even though the app itself starts successfully.
      tauriProcess.stdout.on('data', (data) => {
         const output = data.toString();

         if (output.includes('Local:') || output.includes('MCP Bridge') || output.includes('WebSocket server')) {
            console.log('[App]:', output.trim());
         }

         if (!pluginReady && output.includes('WebSocket server listening on:')) {
            const portMatch = output.match(/WebSocket server listening on:.*:(\d+)/);

            if (portMatch) {
               testAppPort = parseInt(portMatch[1], 10);
               console.log(`✓ MCP Bridge plugin ready on port ${testAppPort}`);
            } else {
               console.log('✓ MCP Bridge plugin ready');
            }
            pluginReady = true;
            startupSettled = true;
            clearTimeout(startupTimer);
            console.log('✅ Global test environment ready!');
            resolve();
         }
      });

      tauriProcess.stderr.on('data', (data) => {
         // Don't log anything during shutdown
         if (isShuttingDown) {
            return;
         }

         const err = data.toString(),
               noisePatterns = [ 'Compiling', 'Building', 'Finished', 'Info', 'Running', 'npm warn' ],
               isNoise = noisePatterns.some((p) => { return err.includes(p); });

         if (!isNoise) {
            console.error('[App Error]:', err.trim());
         }
      });

      tauriProcess.on('error', (error) => {
         // Don't log anything during shutdown
         if (isShuttingDown) {
            return;
         }

         console.error('Failed to start Tauri process:', error);
         failStartup(error);
      });

      tauriProcess.on('exit', (code, signal) => {
         if (!pluginReady) {
            failStartup(new Error(`Tauri app exited before MCP bridge was ready (code ${code ?? 'null'}, signal ${signal ?? 'none'})`));
         }
      });
   });
}

function stopGlobalTestApp(): void {
   if (tauriProcess) {
      console.log('🛑 Stopping global Tauri app...');
      isShuttingDown = true;

      try {
         if (process.platform === 'win32') {
            const pid = tauriProcess.pid;

            if (pid) {
               spawn('taskkill', [ '/pid', pid.toString(), '/f', '/t' ]);
            }
         } else {
            // Kill the entire process group
            const pid = tauriProcess.pid;

            if (pid) {
               process.kill(-pid, 'SIGTERM');
            }
         }
      } catch(error: unknown) {
         console.error('Error stopping Tauri app:', error);
      }

      tauriProcess = null;
   }
}

export async function setup(): Promise<void> {
   await startGlobalTestApp();

   // Write port to file so tests can read it (global vars don't work across processes)
   if (testAppPort) {
      writeFileSync(TEST_APP_PORT_FILE, String(testAppPort), 'utf-8');
   }

   // Store the process reference globally
   (global as Record<string, unknown>).__TAURI_APP_STARTED = true;
}

export async function teardown(): Promise<void> {
   stopGlobalTestApp();

   // Clean up the port file
   if (existsSync(TEST_APP_PORT_FILE)) {
      unlinkSync(TEST_APP_PORT_FILE);
   }

   (global as Record<string, unknown>).__TAURI_APP_STARTED = false;
}
