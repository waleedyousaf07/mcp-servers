# MCP Servers

This repo hosts a small collection of MCP servers that can be published as npm
packages and launched via `npx`.

## Goals
- Keep each server lean, focused, and independently publishable.
- Support `npx` usage so downstream apps do not need to clone this repo.
- Provide clear per-server `setup.md` usage instructions.

## Structure
```
packages/
  http/        # HTTP MCP server
  gmail/       # Gmail MCP server
  google-calendar/ # Google Calendar MCP server
  google-docs/ # Google Docs MCP server
  google-sheets/ # Google Sheets MCP server
  search-serper/ # Serper search MCP server
```

## Publishing
Each package under `packages/*` is an npm workspace package and can be published
independently. Use a scoped name if you want to own the namespace.
