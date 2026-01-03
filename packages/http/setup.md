# Setup

This server runs over stdio and can be launched with `npx`.

## Run locally
```
npx @waleedyousaf07/mcp-http@latest
```

## Config
You can control behavior via CLI flags or environment variables.

### CLI flags
- `--timeout-ms <number>`: request timeout in milliseconds (default: 10000)
- `--max-bytes <number>`: max response size in bytes (default: 2000000)
- `--allow-host <host>`: allowlist host (repeatable)
- `--deny-host <host>`: denylist host (repeatable)
- `--header-allow <name>`: allowlist outbound header name (repeatable)
- `--retry <number>`: retry count for transient errors (default: 0)

### Environment variables
- `MCP_HTTP_TIMEOUT_MS`
- `MCP_HTTP_MAX_BYTES`
- `MCP_HTTP_ALLOW_HOSTS` (comma-separated)
- `MCP_HTTP_DENY_HOSTS` (comma-separated)
- `MCP_HTTP_HEADER_ALLOWLIST` (comma-separated)
- `MCP_HTTP_RETRY`

## RAI usage
Example `.rai.json` MCP entry:
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["@waleedyousaf07/mcp-http@latest"],
  "description": "HTTP MCP server"
}
```
