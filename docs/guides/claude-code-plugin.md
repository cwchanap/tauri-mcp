---
title: Claude Code Plugin
description: Install Tauri MCP tools and the bundled CLI skill as a Claude Code Plugin.
head:
  - - meta
    - name: keywords
      content: claude code plugin, marketplace, tauri mcp, agent skills, mcp server
---

# Claude Code Plugin

The Tauri MCP CLI is available as a **Claude Code Plugin**. The plugin bundles the existing `tauri-mcp-cli` Agent Skill and automatically wires the Tauri MCP server through the shared `packages/cli/.mcp.json` launcher.

## Install from Marketplace

### 1. Add the marketplace

Inside Claude Code:

```text
/plugin marketplace add cwchanap/tauri-mcp
```

### 2. Install the plugin

```text
/plugin install tauri-mcp-cli@cwchanap
```

### 3. Verify

```text
/plugin list
```

You should see `tauri-mcp-cli` listed and enabled. Start a fresh Claude Code session if the MCP tools were not loaded in the current session.

## What Gets Installed

The plugin provides:

- **Tauri MCP connection** — launches `npx -y @hypothesi/tauri-mcp-server@0.12.0` through the shared `.mcp.json` configuration.
- **Agent Skill** — the bundled `tauri-mcp-cli` skill covering driver-session management, webview inspection, UI interactions, screenshots, IPC debugging, and mobile or remote devices.

There is no Claude-specific MCP implementation; Claude Code and Codex use the same published Tauri MCP server.

## Managing the Plugin

```text
/plugin enable tauri-mcp-cli
/plugin disable tauri-mcp-cli
/plugin uninstall tauri-mcp-cli
```

## Direct MCP Fallback

If you prefer direct MCP configuration instead of the plugin wrapper:

```bash
claude mcp add --transport stdio tauri -- npx -y @hypothesi/tauri-mcp-server@0.12.0
```

## Plugin Structure

```text
packages/cli/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── .codex-plugin/
│   └── plugin.json
└── skills/
    └── tauri-mcp-cli/
        └── SKILL.md
```

See [Agent Plugins](/guides/agent-plugins) for the Codex and Pi installation flows, or [Agent Skills](/guides/agent-skills) for skill-only installation.
