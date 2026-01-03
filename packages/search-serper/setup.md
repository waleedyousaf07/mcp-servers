# Setup

This server runs over stdio and can be launched with `npx`.

## Run locally
```
SERPER_API_KEY=your_key npx @waleedyousaf07/mcp-search-serper@latest
```

## Config
- `SERPER_API_KEY` (required): API key for Serper
- `SERPER_API_URL` (optional): override the endpoint (default: `https://google.serper.dev/search`)

## RAI usage
Example `.rai.json` MCP entry:
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["@waleedyousaf07/mcp-search-serper@latest"],
  "description": "Serper search MCP server"
}
```

