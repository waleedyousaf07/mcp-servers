# Setup

Run HireLoop backend first (default `http://127.0.0.1:8787`), then launch the MCP server:

```bash
HIRELOOP_BASE_URL=http://127.0.0.1:8787 node src/index.js
```

Optional env vars:

- `HIRELOOP_BASE_URL` (default: `http://127.0.0.1:8787`)
- `HIRELOOP_TIMEOUT_MS` (default: `30000`)
