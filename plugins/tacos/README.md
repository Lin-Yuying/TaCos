# TaCos plugin

Tasks, comments and labels from inside Codex, Claude Code or any MCP client. The plugin ships a
stdio MCP server that calls the workspace's `/api/v1` with a personal API key, so the TaCos server
stays the only writer and the key decides which workspace a call acts for.

Tools: `whoami`, `list_tasks`, `get_task`, `create_task`, `update_task`, `add_comment`,
`delete_task`, `list_labels`, `create_label`. `delete_task` moves a task to Trash, where it can be
restored.

## Before you install

1. In TaCos open **Settings → Agent access** and create a key. Copy it once; TaCos stores only its
   hash.
2. Export the key where your agent runs. Never commit it or paste it into a prompt.

```bash
export TACOS_API_KEY=tac_...
export TACOS_URL=http://127.0.0.1:3000   # optional; this is the default
```

`TACOS_URL` points at the TaCos server: the desktop app's local server, or a remote one you can
reach.

## Codex

```bash
codex plugin marketplace add /absolute/path/to/TaCos
codex plugin add tacos@tacos
codex plugin list          # tacos@tacos  installed, enabled
```

## Claude Code

Add the server with an absolute path (Claude Code starts MCP servers from the project directory):

```bash
claude mcp add tacos -e TACOS_API_KEY="$TACOS_API_KEY" -- node /absolute/path/to/TaCos/plugins/tacos/mcp/tacos-mcp.mjs
```

The `.claude-plugin/` manifests let Claude Code's marketplace add the plugin, its skill and an
MCP entry that resolves through `${CLAUDE_PLUGIN_ROOT}`; the server inherits `TACOS_API_KEY` from
the shell that starts Claude Code. The Codex path above was checked against Codex CLI 0.163.0;
Claude Code was not installed where this was written, so `claude mcp add` above is the setup that
does not depend on plugin path handling.

## Any other MCP client

Point it at the same script with the same two variables:

```json
{
  "mcpServers": {
    "tacos": {
      "command": "node",
      "args": ["/absolute/path/to/TaCos/plugins/tacos/mcp/tacos-mcp.mjs"],
      "env": {
        "TACOS_URL": "http://127.0.0.1:3000",
        "TACOS_API_KEY": "tac_..."
      }
    }
  }
}
```

## Layout

```
plugins/tacos/
  .codex-plugin/plugin.json   Codex manifest
  .claude-plugin/plugin.json  Claude Code manifest
  .mcp.json                   the tacos MCP server, enabled with the plugin
  mcp/tacos-mcp.mjs           zero-dependency stdio bridge, Node 20+
  skills/tacos/SKILL.md       when to use the tools and in what order
```

The marketplace manifests live at the repository root (`.agents/plugins/marketplace.json` for
Codex, `.claude-plugin/marketplace.json` for Claude Code).
