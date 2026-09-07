import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)),
      CLI_ROOT = path.join(REPO_ROOT, 'packages', 'cli'),
      SERVER_PACKAGE = '@hypothesi/tauri-mcp-server@0.12.0',
      PI_ADAPTER_VERSION = '4.3.1';

function readJson(relativePath: string): Record<string, unknown> {
   return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')) as Record<string, unknown>;
}

describe('cross-agent plugin distribution', () => {
   it('shares one pinned Tauri MCP launcher between Codex and Claude Code', () => {
      const cliPackage = readJson('packages/cli/package.json') as { version: string },
            mcp = readJson('packages/cli/.mcp.json') as {
               mcpServers: Record<string, { type: string; command: string; args: string[] }>;
            },
            codex = readJson('packages/cli/.codex-plugin/plugin.json') as {
               version: string;
               mcpServers: string;
            },
            claude = readJson('packages/cli/.claude-plugin/plugin.json') as {
               version: string;
               mcpServers: string;
            };

      expect(mcp.mcpServers.tauri).toEqual({
         type: 'stdio',
         command: 'npx',
         args: [ '-y', SERVER_PACKAGE ],
      });
      expect(codex.version).toBe(cliPackage.version);
      expect(codex.mcpServers).toBe('./.mcp.json');
      expect(claude.version).toBe(cliPackage.version);
      expect(claude.mcpServers).toBe('./.mcp.json');
   });

   it('exposes the CLI plugin through the Codex and Claude marketplaces in this repository', () => {
      const codexMarketplace = readJson('.agents/plugins/marketplace.json') as {
               name: string;
               plugins: Array<{ name: string; source: { source: string; path: string } }>;
            },
            claudeMarketplace = readJson('.claude-plugin/marketplace.json') as {
               name: string;
               plugins: Array<{ name: string; source: string }>;
            };

      expect(codexMarketplace.name).toBe('cwchanap');
      expect(codexMarketplace.plugins).toContainEqual(expect.objectContaining({
         name: 'tauri-mcp-cli',
         source: {
            source: 'local',
            path: './packages/cli',
         },
      }));
      expect(claudeMarketplace.name).toBe('cwchanap');
      expect(claudeMarketplace.plugins).toContainEqual(expect.objectContaining({
         name: 'tauri-mcp-cli',
         source: './packages/cli',
      }));
   });

   it('packages the existing Tauri skill and a thin MCP adapter extension for Pi', () => {
      const rootPackage = readJson('package.json') as {
               dependencies?: Record<string, string>;
               pi?: { extensions?: string[]; skills?: string[] };
            },
            lockfile = readJson('package-lock.json') as {
               packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
            },
            extension = readFileSync(path.join(CLI_ROOT, 'pi', 'tauri-mcp.ts'), 'utf8');

      expect(rootPackage.dependencies?.['pi-mcp-adapter']).toBe(PI_ADAPTER_VERSION);
      expect(rootPackage.pi).toEqual({
         extensions: [ './packages/cli/pi/tauri-mcp.ts' ],
         skills: [ './packages/cli/skills' ],
      });
      expect(lockfile.packages[''].dependencies?.['pi-mcp-adapter']).toBe(PI_ADAPTER_VERSION);
      expect(lockfile.packages['node_modules/pi-mcp-adapter']?.version).toBe(PI_ADAPTER_VERSION);
      expect(extension).toContain("import { createMcpAdapter } from 'pi-mcp-adapter';");
      expect(extension).toContain(SERVER_PACKAGE);
   });
});
