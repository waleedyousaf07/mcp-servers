#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.HIRELOOP_BASE_URL || "http://127.0.0.1:8787";
const TIMEOUT_MS = Number(process.env.HIRELOOP_TIMEOUT_MS || 30000);

function buildResponse(result, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError,
  };
}

async function apiRequest(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const detail = typeof json?.detail === "string" ? json.detail : JSON.stringify(json);
      throw new Error(`HireLoop API ${res.status}: ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function runStart(args) {
  return apiRequest("POST", "/runs/start", {
    trigger: args.trigger || "on_demand",
    config_path: args.config_path,
  });
}

async function runStatus(args) {
  const runId = requireString(args.run_id, "run_id");
  return apiRequest("GET", `/runs/${encodeURIComponent(runId)}`);
}

async function runResults(args) {
  const runId = requireString(args.run_id, "run_id");
  return apiRequest("GET", `/runs/${encodeURIComponent(runId)}/results`);
}

async function jobsList(args) {
  const query = new URLSearchParams();
  if (args.run_id) query.set("run_id", String(args.run_id));
  if (args.stage) query.set("stage", String(args.stage));
  if (typeof args.limit === "number") query.set("limit", String(args.limit));
  if (typeof args.offset === "number") query.set("offset", String(args.offset));
  const suffix = query.toString();
  return apiRequest("GET", `/jobs${suffix ? `?${suffix}` : ""}`);
}

async function jobsUpdate(args) {
  const jobs = Array.isArray(args.jobs) ? args.jobs : [];
  if (jobs.length === 0) throw new Error("jobs is required and must be a non-empty array");
  let runId = args.run_id;
  if (!runId) {
    const runIds = [...new Set(jobs.map((job) => job?.run_id).filter((value) => typeof value === "string" && value.trim().length > 0))];
    if (runIds.length === 1) {
      runId = runIds[0];
    }
  }
  return apiRequest("PATCH", "/jobs", {
    run_id: runId,
    jobs,
  });
}

async function sheetSync(args) {
  const runId = requireString(args.run_id, "run_id");
  return apiRequest("POST", "/sheet/sync", { run_id: runId });
}

async function profileContext(args) {
  const payload = {};
  if (args.run_id) payload.run_id = String(args.run_id);
  if (args.config_path) payload.config_path = String(args.config_path);
  if (typeof args.compact === "boolean") payload.compact = args.compact;
  return apiRequest("POST", "/profile/context", payload);
}

async function applyStart(args) {
  const runId = requireString(args.run_id, "run_id");
  return apiRequest("POST", "/apply/start", { run_id: runId });
}

async function applyStatus(args) {
  const taskId = requireString(args.task_id, "task_id");
  return apiRequest("GET", `/apply/${encodeURIComponent(taskId)}`);
}

const handlers = {
  "hireloop.run_start": runStart,
  "hireloop.run_status": runStatus,
  "hireloop.run_results": runResults,
  "hireloop.jobs_list": jobsList,
  "hireloop.jobs_update": jobsUpdate,
  "hireloop.sheet_sync": sheetSync,
  "hireloop.profile_context": profileContext,
  "hireloop.apply_start": applyStart,
  "hireloop.apply_status": applyStatus,
};

const server = new Server(
  { name: "mcp-hireloop", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "hireloop.run_start",
      description: "Start a new HireLoop run (scheduled or on-demand).",
      inputSchema: {
        type: "object",
        properties: {
          trigger: { type: "string", enum: ["schedule", "on_demand"] },
          config_path: { type: "string" },
        },
      },
    },
    {
      name: "hireloop.run_status",
      description: "Get status for a HireLoop run.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    },
    {
      name: "hireloop.run_results",
      description: "Get aggregated results for a HireLoop run.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    },
    {
      name: "hireloop.jobs_list",
      description: "List jobs with optional filters.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          stage: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    {
      name: "hireloop.jobs_update",
      description: "Patch jobs with scores, approvals, status, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          jobs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                score: { type: "number" },
                recommendation: { type: "string" },
                stage: { type: "string" },
                shortlist_decision: { type: "string" },
                cv_status: { type: "string" },
                cv_doc_url: { type: "string" },
                cv_approval: { type: "string" },
                apply_decision: { type: "string" },
                apply_status: { type: "string" },
                last_error: { type: "string" },
                easy_apply: { type: "boolean" },
                challenged: { type: "boolean" },
                metadata: { type: "object" },
              },
              required: ["id"],
            },
          },
        },
        required: ["jobs"],
      },
    },
    {
      name: "hireloop.sheet_sync",
      description: "Build canonical sheet rows for a run.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    },
    {
      name: "hireloop.profile_context",
      description:
        "Load normalized profile context (Master CV + optional CCC enrichments) for scoring/CV generation.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          config_path: { type: "string" },
          compact: { type: "boolean" },
        },
      },
    },
    {
      name: "hireloop.apply_start",
      description: "Start apply execution for approved jobs in a run.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" } },
        required: ["run_id"],
      },
    },
    {
      name: "hireloop.apply_status",
      description: "Check apply task status.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args && typeof args === "object" ? args : {};
  const handler = handlers[name];
  if (!handler) {
    return buildResponse({ error: `Unknown tool: ${name}` }, true);
  }
  try {
    const result = await handler(input);
    return buildResponse(result);
  } catch (err) {
    return buildResponse({ error: String(err?.message || err) }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
