#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_URL = "https://google.serper.dev/search";

function requireApiKey() {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is required");
  return key;
}

function buildPayload(args) {
  const payload = {
    q: args.query,
  };
  if (args.num !== undefined) payload.num = args.num;
  if (args.gl) payload.gl = args.gl;
  if (args.hl) payload.hl = args.hl;
  return payload;
}

function normalizeResults(data) {
  const items = [];
  const source = Array.isArray(data?.organic) ? data.organic : [];
  for (const item of source) {
    items.push({
      title: item.title || "",
      url: item.link || "",
      snippet: item.snippet || "",
      position: item.position,
    });
  }
  return {
    query: data?.searchParameters?.q || "",
    results: items,
  };
}

async function searchQuery(args) {
  if (!args || typeof args !== "object") throw new Error("Invalid arguments");
  if (!args.query) throw new Error("query is required");

  const apiKey = requireApiKey();
  const url = process.env.SERPER_API_URL || DEFAULT_URL;
  const payload = buildPayload(args);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Serper error ${res.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response from Serper");
  }

  return normalizeResults(data);
}

function buildResponse(result, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError,
  };
}

const server = new Server(
  { name: "mcp-search-serper", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search.query",
      description: "Search the web via Serper",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          num: { type: "number", description: "Number of results" },
          gl: { type: "string", description: "Country code, e.g., us" },
          hl: { type: "string", description: "Language code, e.g., en" },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args && typeof args === "object" ? args : {};
  try {
    if (name === "search.query") {
      const result = await searchQuery(input);
      return buildResponse(result);
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return buildResponse({ error: String(err?.message || err) }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

