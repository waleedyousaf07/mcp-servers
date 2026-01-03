#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 2_000_000;

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    timeoutMs: undefined,
    maxBytes: undefined,
    allowHosts: [],
    denyHosts: [],
    headerAllowlist: [],
    retry: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--max-bytes") {
      opts.maxBytes = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--allow-host") {
      opts.allowHosts.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === "--deny-host") {
      opts.denyHosts.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === "--header-allow") {
      opts.headerAllowlist.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === "--retry") {
      opts.retry = Number(argv[i + 1]);
      i += 1;
    }
  }

  return opts;
}

const args = parseArgs(process.argv.slice(2));
const envAllowHosts = parseCsv(process.env.MCP_HTTP_ALLOW_HOSTS);
const envDenyHosts = parseCsv(process.env.MCP_HTTP_DENY_HOSTS);
const envHeaderAllowlist = parseCsv(process.env.MCP_HTTP_HEADER_ALLOWLIST);

const config = {
  timeoutMs: Number(process.env.MCP_HTTP_TIMEOUT_MS) || args.timeoutMs || DEFAULT_TIMEOUT_MS,
  maxBytes: Number(process.env.MCP_HTTP_MAX_BYTES) || args.maxBytes || DEFAULT_MAX_BYTES,
  allowHosts: [...envAllowHosts, ...args.allowHosts].filter(Boolean),
  denyHosts: [...envDenyHosts, ...args.denyHosts].filter(Boolean),
  headerAllowlist: [...envHeaderAllowlist, ...args.headerAllowlist]
    .map((h) => h.toLowerCase())
    .filter(Boolean),
  retry: Number(process.env.MCP_HTTP_RETRY) || args.retry || 0,
};

function isHostAllowed(urlObj) {
  const host = urlObj.host.toLowerCase();
  if (config.denyHosts.length > 0 && config.denyHosts.map((h) => h.toLowerCase()).includes(host)) {
    return false;
  }
  if (config.allowHosts.length === 0) return true;
  return config.allowHosts.map((h) => h.toLowerCase()).includes(host);
}

function filterOutboundHeaders(headers) {
  if (!headers) return undefined;
  if (config.headerAllowlist.length === 0) return headers;
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    if (config.headerAllowlist.includes(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function safeResponseHeaders(headers) {
  const allow = new Set(["content-type", "content-length", "etag", "last-modified"]);
  const out = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (allow.has(lower)) out[lower] = value;
  }
  return out;
}

function buildUrl(baseUrl, query) {
  const url = new URL(baseUrl);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readBody(res, maxBytes) {
  const contentType = res.headers.get("content-type") || "";
  const reader = res.body?.getReader?.();
  const chunks = [];
  let total = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response exceeded max_bytes (${maxBytes})`);
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const text = buffer.toString("utf8");
    return { text, contentType, bytes: total };
  }
  const text = await res.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) throw new Error(`Response exceeded max_bytes (${maxBytes})`);
  return { text, contentType, bytes };
}

async function requestOnce(options) {
  const {
    url,
    method,
    headers,
    body,
    timeoutMs,
    maxBytes,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const start = Date.now();
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const { text, contentType, bytes } = await readBody(res, maxBytes);
    const durationMs = Date.now() - start;
    const isJson = /application\/json|\+json/i.test(contentType);
    let parsed = null;
    if (isJson) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      status_text: res.statusText,
      url: res.url || url,
      headers: safeResponseHeaders(res.headers),
      body_type: isJson ? "json" : "text",
      body: isJson && parsed !== null ? parsed : text,
      duration_ms: durationMs,
      bytes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetry(options, retryCount) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const result = await requestOnce(options);
      if (result.ok || result.status < 500 || attempt === retryCount) return result;
      lastError = new Error(`HTTP ${result.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retryCount) break;
    }
    const backoffMs = 200 * (attempt + 1);
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  throw lastError || new Error("Request failed");
}

function buildResponse(result, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError,
  };
}

async function handleHttpRequest(args) {
  if (!args || typeof args !== "object") throw new Error("Invalid arguments");
  if (!args.url) throw new Error("url is required");

  const url = buildUrl(args.url, args.query);
  if (!isHostAllowed(url)) throw new Error(`Host not allowed: ${url.host}`);

  const timeoutMs = Number(args.timeout_ms) || config.timeoutMs;
  const maxBytes = Number(args.max_bytes) || config.maxBytes;
  const retry = Number(args.retry) || config.retry;

  const headers = filterOutboundHeaders(args.headers || undefined);
  let body = args.body;

  if (body && typeof body === "object" && !(body instanceof ArrayBuffer)) {
    body = JSON.stringify(body);
    if (headers) {
      const hasContentType = Object.keys(headers).some(
        (key) => key.toLowerCase() === "content-type"
      );
      if (!hasContentType) headers["content-type"] = "application/json";
    }
  }

  const result = await requestWithRetry(
    {
      url: url.toString(),
      method: args.method,
      headers,
      body,
      timeoutMs,
      maxBytes,
    },
    retry
  );

  return result;
}

const server = new Server(
  { name: "mcp-http", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "http.request",
      description: "Make a configurable HTTP request",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
          body: {},
          timeout_ms: { type: "number" },
          max_bytes: { type: "number" },
          retry: { type: "number" },
        },
        required: ["url"],
      },
    },
    {
      name: "http.get",
      description: "HTTP GET",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
          timeout_ms: { type: "number" },
          max_bytes: { type: "number" },
          retry: { type: "number" },
        },
        required: ["url"],
      },
    },
    {
      name: "http.post",
      description: "HTTP POST",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
          body: {},
          timeout_ms: { type: "number" },
          max_bytes: { type: "number" },
          retry: { type: "number" },
        },
        required: ["url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args && typeof args === "object" ? args : {};
  try {
    if (name === "http.request") {
      const result = await handleHttpRequest({ ...input });
      return buildResponse(result);
    }
    if (name === "http.get") {
      const result = await handleHttpRequest({ ...input, method: "GET" });
      return buildResponse(result);
    }
    if (name === "http.post") {
      const result = await handleHttpRequest({ ...input, method: "POST" });
      return buildResponse(result);
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return buildResponse({ error: String(err?.message || err) }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
