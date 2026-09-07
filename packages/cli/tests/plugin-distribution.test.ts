import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)),
      SERVER_PACKAGE = '@hypothesi/tauri-mcp-server@0.12.0';

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

   it('ships a portable Agent Plugins package for Pi without adding another MCP runtime', () => {
      const cliPackage = readJson('packages/cli/package.json') as { version: string },
            portablePlugin = readJson('plugin.json') as { $schema: string; name: string; version: string },
            portableMcp = readJson('mcp.json') as {
               $schema: string;
               mcpServers: Record<string, { type: string; command: string; args: string[]; cwd: string }>;
            },
            rootSkill = readFileSync(path.join(REPO_ROOT, 'skills', 'tauri-mcp-cli', 'SKILL.md'), 'utf8'),
            cliSkill = readFileSync(path.join(REPO_ROOT, 'packages', 'cli', 'skills', 'tauri-mcp-cli', 'SKILL.md'), 'utf8');

      expect(portablePlugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
      expect(portablePlugin.name).toBe('tauri-mcp-cli');
      expect(portablePlugin.version).toBe(cliPackage.version);
      expect(portableMcp.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
      expect(portableMcp.mcpServers.tauri).toEqual({
         type: 'stdio',
         command: 'npx',
         args: [ '-y', SERVER_PACKAGE ],
         cwd: '${PLUGIN_DATA}',
      });
      expect(rootSkill).toBe(cliSkill);
   });
});
