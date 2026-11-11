import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => {
   return {
      healthResults: [] as Array<boolean | Error>,
      instances: [] as Array<{
         readonly checkConnection: ReturnType<typeof vi.fn>;
         readonly connect: ReturnType<typeof vi.fn>;
         readonly disconnect: ReturnType<typeof vi.fn>;
         readonly sentCommands: Array<{ command: string }>;
         emit(event: string): boolean;
      }>,
   };
});

vi.mock('../../src/driver/plugin-client.js', async () => {
   const { EventEmitter } = await import('events');

   class PluginClient extends EventEmitter {
      public readonly host: string;
      public readonly port: number;

      public readonly checkConnection = vi.fn(async () => {
         const result = clientMocks.healthResults.shift() ?? true;

         if (result instanceof Error) {
            throw result;
         }

         return result;
      });

      public readonly isConnected = vi.fn(() => { return true; });

      public readonly connect = vi.fn(() => {
         this.emit('connected');
         return Promise.resolve();
      });

      public readonly disconnect = vi.fn(() => {
         this.emit('disconnected');
      });

      public readonly sentCommands: Array<{ command: string }> = [];

      public readonly sendCommand = vi.fn(async (command: { command: string }) => {
         this.sentCommands.push(command);

         return {
            success: true,
            data: {
               app: { identifier: 'com.hypothesi.test-app' },
               cwd: '/test/app',
            },
         };
      });

      public constructor(host: string, port: number) {
         super();
         this.host = host;
         this.port = port;
         clientMocks.instances.push(this);
      }
   }

   return {
      PluginClient,
      // The session under test always owns the most recently created client.
      ensureSessionAndConnect: vi.fn(async () => {
         const client = clientMocks.instances[clientMocks.instances.length - 1];

         if (!client) {
            throw new Error('No plugin client created');
         }

         return client;
      }),
   };
});

vi.mock('../../src/driver/app-discovery.js', () => {
   class AppDiscovery {
      public readonly host: string;

      public constructor(host: string) {
         this.host = host;
      }

      public async connectToPort(port: number, _appName?: string, host?: string): Promise<{
         name: string;
         host: string;
         port: number;
      }> {
         const targetHost = host ?? this.host;

         return {
            name: `Tauri App (${targetHost}:${port})`,
            host: targetHost,
            port,
         };
      }

      public async getFirstAvailableApp(): Promise<null> {
         return null;
      }

      public disconnectAll(): Promise<void> {
         return Promise.resolve();
      }
   }

   return { AppDiscovery };
});

function registerScriptCalls(instanceIndex: number): number {
   return clientMocks.instances[instanceIndex]?.sentCommands
      .filter((command) => { return command.command === 'register_script'; })
      .length ?? 0;
}

describe('driver session stale recovery', () => {
   beforeEach(() => {
      vi.resetModules();
      clientMocks.healthResults.length = 0;
      clientMocks.instances.length = 0;
   });

   it('keeps a cached session that responds to a liveness probe', async () => {
      const { manageDriverSession } = await import('../../src/driver/session-manager');

      await manageDriverSession('start', 'localhost', 9223);
      const result = await manageDriverSession('start', 'localhost', 9223);

      expect(result).toBe('Already connected to app on port 9223');
      expect(clientMocks.instances).toHaveLength(1);
      expect(clientMocks.instances[0]?.checkConnection).toHaveBeenCalledOnce();
      expect(clientMocks.instances[0]?.disconnect).not.toHaveBeenCalled();
   });

   it('removes and reconnects a cached session that misses its liveness probe', async () => {
      const { manageDriverSession } = await import('../../src/driver/session-manager');

      await manageDriverSession('start', 'localhost', 9223);
      clientMocks.healthResults.push(false);

      const result = await manageDriverSession('start', 'localhost', 9223);

      expect(result).toContain('Session started with app');
      expect(clientMocks.instances).toHaveLength(2);
      expect(clientMocks.instances[0]?.checkConnection).toHaveBeenCalledOnce();
      expect(clientMocks.instances[0]?.disconnect).toHaveBeenCalledOnce();
      expect(clientMocks.instances[1]?.connect).toHaveBeenCalledOnce();
   });

   it('reconnects when probing the cached session throws', async () => {
      const { manageDriverSession } = await import('../../src/driver/session-manager');

      await manageDriverSession('start', 'localhost', 9223);
      clientMocks.healthResults.push(new Error('Socket closed during ping'));

      const result = await manageDriverSession('start', 'localhost', 9223);

      expect(result).toContain('Session started with app');
      expect(clientMocks.instances).toHaveLength(2);
      expect(clientMocks.instances[0]?.disconnect).toHaveBeenCalledOnce();
      expect(clientMocks.instances[1]?.connect).toHaveBeenCalledOnce();
   });

   it('re-registers injected helpers when the same client reconnects after a disconnect', async () => {
      const { manageDriverSession } = await import('../../src/driver/session-manager');

      const { ensureScriptLoadedInTarget } = await import('../../src/driver/script-manager');

      await manageDriverSession('start', 'localhost', 9223);

      await ensureScriptLoadedInTarget('__mcp_html2canvas__', 'inline', 'content');
      expect(registerScriptCalls(0)).toBe(1);

      // While the connection stays up, the cached marker skips re-registration.
      await ensureScriptLoadedInTarget('__mcp_html2canvas__', 'inline', 'content');
      expect(registerScriptCalls(0)).toBe(1);

      // The app restarts on the same port: the socket drops ('disconnected')
      // and auto-reconnect re-emits 'connected'. The restarted bridge has an
      // empty script registry, so the cached marker must be dropped.
      clientMocks.instances[0]?.emit('disconnected');

      await ensureScriptLoadedInTarget('__mcp_html2canvas__', 'inline', 'content');
      expect(registerScriptCalls(0)).toBe(2);
   });

   it('re-registers injected helpers after a stale session is replaced on the same port', async () => {
      const { manageDriverSession } = await import('../../src/driver/session-manager');

      const { ensureScriptLoadedInTarget } = await import('../../src/driver/script-manager');

      await manageDriverSession('start', 'localhost', 9223);
      await ensureScriptLoadedInTarget('__mcp_html2canvas__', 'inline', 'content');
      expect(registerScriptCalls(0)).toBe(1);

      // App dies and restarts on the same port: the cached session fails its
      // liveness probe and start swaps in a fresh client. The restarted app's
      // registry is empty, so the injected marker must not survive.
      clientMocks.healthResults.push(false);
      await manageDriverSession('start', 'localhost', 9223);

      expect(clientMocks.instances).toHaveLength(2);
      expect(registerScriptCalls(1)).toBe(0);

      await ensureScriptLoadedInTarget('__mcp_html2canvas__', 'inline', 'content');
      expect(registerScriptCalls(1)).toBe(1);
   });
});
