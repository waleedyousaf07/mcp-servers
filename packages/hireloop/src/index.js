#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.HIRELOOP_BASE_URL || "http://127.0.0.1:8787";

function buildResponse(result, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError,
  };
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
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
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

const handlers = {
  "hireloop.run_start": async (args) =>
    apiRequest("POST", "/runs/start", { trigger: args.trigger || "on_demand", config_path: args.config_path }),

  "hireloop.run_active": async () => apiRequest("GET", "/runs/active"),

  "hireloop.run_status": async (args) => {
    const runId = requireString(args.run_id, "run_id");
    return apiRequest("GET", `/runs/${encodeURIComponent(runId)}`);
  },

  "hireloop.run_results": async (args) => {
    const runId = requireString(args.run_id, "run_id");
    return apiRequest("GET", `/runs/${encodeURIComponent(runId)}/results`);
  },

  "hireloop.run_resume": async (args) => {
    const runId = requireString(args.run_id, "run_id");
    return apiRequest("POST", "/runs/resume", {
      run_id: runId,
      force_ingest: typeof args.force_ingest === "boolean" ? args.force_ingest : true,
    });
  },

  "hireloop.run_cancel": async (args) => {
    const runId = requireString(args.run_id, "run_id");
    return apiRequest("POST", "/runs/cancel", {
      run_id: runId,
      reason: typeof args.reason === "string" ? args.reason : undefined,
    });
  },

  "hireloop.run_delete": async (args) => {
    const runId = requireString(args.run_id, "run_id");
    return apiRequest("POST", "/runs/delete", {
      run_id: runId,
      force: typeof args.force === "boolean" ? args.force : false,
    });
  },

  "hireloop.jobs_approve": async (args) => {
    const jobs = Array.isArray(args.jobs) ? args.jobs : [];
    if (!jobs.length) throw new Error("jobs must be a non-empty array");
    return apiRequest("POST", "/jobs/approve", {
      run_id: args.run_id,
      jobs,
      continue_after_update: typeof args.continue_after_update === "boolean" ? args.continue_after_update : true,
    });
  },

  "hireloop.job_delete": async (args) => {
    const jobId = requireString(args.job_id, "job_id");
    return apiRequest("POST", "/jobs/delete", {
      job_id: jobId,
      run_id: typeof args.run_id === "string" ? args.run_id : undefined,
    });
  },

  "hireloop.job_retry": async (args) => {
    const jobId = requireString(args.job_id, "job_id");
    return apiRequest("POST", "/jobs/retry", {
      job_id: jobId,
      run_id: typeof args.run_id === "string" ? args.run_id : undefined,
      stage: typeof args.stage === "string" ? args.stage : "auto",
      process_now: typeof args.process_now === "boolean" ? args.process_now : true,
    });
  },
};

const tools = [
  {
    name: "hireloop.run_start",
    description: "Start a HireLoop run.",
    inputSchema: {
      type: "object",
      properties: {
        trigger: { type: "string", enum: ["schedule", "on_demand"] },
        config_path: { type: "string" },
      },
    },
  },
  {
    name: "hireloop.run_active",
    description: "Get active run status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hireloop.run_status",
    description: "Get run status.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
    },
  },
  {
    name: "hireloop.run_results",
    description: "Get run aggregate results.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
    },
  },
  {
    name: "hireloop.run_resume",
    description: "Force approval ingest and continue queue processing for a run.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        force_ingest: { type: "boolean" },
      },
      required: ["run_id"],
    },
  },
  {
    name: "hireloop.run_cancel",
    description: "Cancel an active run and stop pending/running work items.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["run_id"],
    },
  },
  {
    name: "hireloop.run_delete",
    description: "Delete a run and all linked jobs/work items/events.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["run_id"],
    },
  },
  {
    name: "hireloop.jobs_approve",
    description: "Patch approvals for jobs and optionally continue processing.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        continue_after_update: { type: "boolean" },
        jobs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              shortlist_decision: { type: "string", enum: ["approved", "rejected", "pending"] },
              cv_approval: { type: "string", enum: ["approved", "rejected", "pending"] },
              apply_decision: { type: "string", enum: ["approved", "rejected", "pending"] },
              last_error: { type: "string" },
            },
            required: ["id"],
          },
        },
      },
      required: ["jobs"],
    },
  },
  {
    name: "hireloop.job_delete",
    description: "Delete one job and its linked work items.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        run_id: { type: "string" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "hireloop.job_retry",
    description: "Retry one job at score/cv/apply stage with safe re-enqueue semantics.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        run_id: { type: "string" },
        stage: { type: "string", enum: ["auto", "score", "cv", "apply"] },
        process_now: { type: "boolean" },
      },
      required: ["job_id"],
    },
  },
];

const server = new Server({ name: "mcp-hireloop", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = args && typeof args === "object" ? args : {};
  const handler = handlers[name];
  if (!handler) return buildResponse({ error: `Unknown tool: ${name}` }, true);
  try {
    return buildResponse(await handler(input));
  } catch (err) {
    return buildResponse({ error: String(err?.message || err) }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
