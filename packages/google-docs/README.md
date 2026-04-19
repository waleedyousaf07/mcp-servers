# @waleedyousaf07/mcp-google-docs

Thin Google Docs MCP server for any MCP-compatible client. It runs over stdio, uses direct Google Docs + Drive REST calls, and keeps the tool surface small.

## Quick Start

```bash
npx @waleedyousaf07/mcp-google-docs@latest
```

## OAuth Setup

Create a Google OAuth Desktop app, enable the Google Docs API and Google Drive API, and use one of:

```bash
MCP_GOOGLE_DOCS_CLIENT_ID=your_client_id
MCP_GOOGLE_DOCS_CLIENT_SECRET=your_client_secret
```

Or point to the downloaded OAuth JSON file:

```bash
MCP_GOOGLE_DOCS_CLIENT_CREDENTIALS_PATH=/absolute/path/to/google-oauth-client.json
```

Optional:

```bash
MCP_GOOGLE_DOCS_USE_KEYTAR=true
```

If `MCP_GOOGLE_DOCS_USE_KEYTAR=true` but `keytar` is unavailable, the server falls back to a plaintext token file in the OS config directory.

## Scopes

This package uses:

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive.metadata.readonly`
- `https://www.googleapis.com/auth/drive`

That covers reading/writing Docs content plus metadata-based discovery in My Drive.

## Reference Resolution

Most document-targeting tools accept exactly one reference field:

- `id`
- `url`
- `name`
- `path` (My Drive style like `Folder/Subfolder/FileName`)

If a `name` or `path` lookup resolves to 0 or multiple documents, the tool returns an error with candidate metadata.

`docs.composeFromPlan` also supports template-free mode: you may omit all reference fields, and it will create a blank Google Doc in the target folder before applying the render plan.

## Tools

- `docs.searchDocuments`
- `docs.getDocument`
- `docs.createDocument`
- `docs.insertText`
- `docs.replaceAllText`
- `docs.batchUpdate`
- `docs.copyTemplateToFolder`
- `docs.composeFromPlan`

## Client Config Example

Any MCP client that can launch a stdio server can use this package. Use `npx` as the default command so the config stays portable across macOS, Linux, and Windows:

```json
{
  "id": "google-docs",
  "transport": "stdio",
  "command": [
    "npx",
    "--yes",
    "@waleedyousaf07/mcp-google-docs@latest"
  ],
  "headers": {}
}
```

If your MCP client supports OS-specific overrides, only add a Windows-specific `npx.cmd` path there. Keep the default config on plain `npx`.

## Troubleshooting

- Browser did not open: the server prints the Google auth URL to `stderr`. Open it manually in a browser on the same machine. This is expected on headless Linux or any machine without a desktop opener.
- `invalid_grant`: your stored refresh token is no longer valid. Delete the saved token from your user config directory and authorize again.
- `insufficient authentication scopes` (403) on `docs.copyTemplateToFolder`: your stored token is missing a required scope (for example `drive`). Delete the saved token and re-authorize so consent includes the current scope set.
- Permission errors: confirm the Google Docs and Google Drive APIs are enabled in your Google Cloud project and the OAuth client is a Desktop app.

## Local Commands

```bash
pnpm i
pnpm build
pnpm test
node dist/cli.js
```
