# `@waleedyousaf07/mcp-gmail`

Thin Gmail MCP server for any MCP-compatible agent. It stays close to the Gmail REST API: search threads, fetch messages, list labels, create drafts, and send mail.

## Features

- MCP over stdio
- Direct Gmail REST calls with native `fetch`
- Local browser OAuth flow on `127.0.0.1`
- Refresh token reuse with token storage in the user config directory
- Structured logs to `stderr`
- Thin tool surface with bounded defaults

## Tools

- `gmail.search`
- `gmail.getThread`
- `gmail.getMessage`
- `gmail.listLabels`
- `gmail.createDraft`
- `gmail.sendMessage`

## OAuth Scopes

This package uses:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`

`gmail.compose` covers draft creation and sending. No broader Gmail scope is required.

## Quick Start

```bash
pnpm i
pnpm build
pnpm test
```

Run the server locally:

```bash
node dist/cli.js
```

Or through `npx` after publishing:

```bash
npx @waleedyousaf07/mcp-gmail
```

## Google OAuth Setup

1. Open Google Cloud Console.
2. Create a project or choose an existing one.
3. Enable the Gmail API.
4. Go to `APIs & Services` -> `Credentials`.
5. Create an `OAuth client ID`.
6. Choose `Desktop app`.
7. Copy the client ID and client secret.

Desktop app credentials work with the loopback callback used by this server (`127.0.0.1` on a random local port).

## Environment Variables

Set one of these credential options:

```bash
MCP_GMAIL_CLIENT_ID=your_client_id
MCP_GMAIL_CLIENT_SECRET=your_client_secret
```

Or point to a JSON credential file:

```bash
MCP_GMAIL_CLIENT_CREDENTIALS_PATH=/absolute/path/to/oauth-client.json
```

Optional runtime flags:

```bash
MCP_GMAIL_USE_KEYTAR=true
```

If `MCP_GMAIL_USE_KEYTAR=true` but `keytar` is unavailable, the server falls back to a plaintext token file in the OS config directory.

## Client Config Examples

Any MCP client that can launch a stdio server can use this package. For example, a generic stdio config entry can look like:

```json
{
  "id": "gmail",
  "transport": "stdio",
  "command": [
    "C:\\nvm4w\\nodejs\\npx.cmd",
    "--yes",
    "@waleedyousaf07/mcp-gmail@latest"
  ],
  "headers": {}
}
```

## Troubleshooting

- Browser did not open: the server prints the Google auth URL to `stderr`. Open it manually in a browser on the same machine.
- `invalid_grant`: your stored refresh token is no longer valid. Delete the saved token from your user config directory and authorize again.
- Permission errors: confirm the Gmail API is enabled in your Google Cloud project and the OAuth client is a Desktop app.

## Local Commands

```bash
pnpm i
pnpm build
pnpm test
node dist/cli.js
```
