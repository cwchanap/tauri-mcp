---
title: Agent Plugins
description: Install Tauri MCP for Codex, Claude Code, and Pi using the repository's plugin metadata.
head:
  - - meta
    - name: keywords
      content: codex plugin, claude code plugin, pi agent plugins, tauri mcp, one-click setup
---

# Agent Plugins

This repository ships one Tauri MCP runtime integration with native wrapper metadata for Codex and Claude Code plus portable Agent Plugins 1.0 metadata for Pi.

Every integration ultimately launches the same published MCP server:

```text
npx -y @hypothesi/tauri-mcp-server@0.12.0
```

The plugin also includes the existing `tauri-mcp-cli` Agent Skill so supported clients get the Tauri workflow guidance together with the MCP connection.

## Codex

Add this repository as a marketplace and install the plugin:

```bash
codex plugin marketplace add cwchanap/tauri-mcp
codex plugin add tauri-mcp-cli@cwchanap
```

Start a new Codex task after installation so the Tauri MCP tools are loaded.

## Claude Code

Start Claude Code and run:

```text
/plugin marketplace add cwchanap/tauri-mcp
/plugin install tauri-mcp-cli@cwchanap
```

The plugin loads both the bundled skill and `packages/cli/.mcp.json`; no separate Claude-specific MCP implementation is used.

Verify installation with:

```text
/plugin list
```

## Pi

Pi does not provide native MCP transport through this repository. Like the Godot plugin distribution, Tauri MCP uses the community-maintained Agent Plugins and MCP adapter packages.

Install those Pi packages once:

```bash
pi install npm:pi-mcp-adapter
pi install npm:pi-agent-plugins
```

Then install and trust this repository inside Pi:

```text
/plugin install https://github.com/cwchanap/tauri-mcp.git
/plugin trust tauri-mcp-cli
```

The Agent Plugins loader discovers the root `plugin.json`, `mcp.json`, and `skills/tauri-mcp-cli/SKILL.md`, then projects the Tauri server through `pi-mcp-adapter`.

`pi-mcp-adapter` and `pi-agent-plugins` are community-maintained. Review their source and this repository before installing or trusting a plugin because trusted MCP servers run with your user permissions.

## Direct MCP Fallback

Any MCP-compatible agent can skip plugin metadata and launch the same server directly:

```bash
npx -y @hypothesi/tauri-mcp-server@0.12.0
```

Client-specific MCP configuration only needs a stdio command of `npx` with arguments `-y` and `@hypothesi/tauri-mcp-server@0.12.0`.

## Distribution Layout

```text
.agents/plugins/marketplace.json      # Codex marketplace
.claude-plugin/marketplace.json       # Claude Code marketplace
plugin.json                           # Agent Plugins 1.0 manifest
mcp.json                              # Portable MCP definition
skills/tauri-mcp-cli/SKILL.md         # Portable copy of the existing CLI skill
packages/cli/
├── .codex-plugin/plugin.json         # Codex plugin metadata
├── .claude-plugin/plugin.json        # Claude Code plugin metadata
├── .mcp.json                         # Shared Codex/Claude MCP launcher
└── skills/tauri-mcp-cli/SKILL.md     # Existing CLI skill source
```

The packaging contract test keeps both skill copies identical and checks that all wrappers use the same pinned MCP server version.
