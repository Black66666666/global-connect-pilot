import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

async function ensureMcpSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      deadline TEXT,
      budget TEXT,
      constraints TEXT,
      success_criteria TEXT,
      attention_budget INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      source_ref TEXT,
      action TEXT NOT NULL,
      note TEXT,
      contact TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS invitations (
      request_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      first_viewed_at TEXT,
      responded_at TEXT,
      PRIMARY KEY(request_id, source_ref)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS request_meta (
      request_id TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'en',
      source_url TEXT,
      source_label TEXT,
      created_via TEXT NOT NULL DEFAULT 'web'
    )`),
  ]);
}

async function getPublicRequest(env, id) {
  await ensureMcpSchema(env);
  return env.DB.prepare(`
    SELECT r.id,r.goal,r.deadline,r.budget,r.constraints,r.success_criteria,
           r.attention_budget,r.status,r.created_at,
           m.language,m.source_url,m.source_label,m.created_via
    FROM requests r
    LEFT JOIN request_meta m ON m.request_id=r.id
    WHERE r.id=? LIMIT 1
  `).bind(id).first();
}

async function getStats(env, id) {
  await ensureMcpSchema(env);
  const exists = await env.DB.prepare("SELECT id FROM requests WHERE id=? LIMIT 1").bind(id).first();
  if (!exists) return null;

  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM invitations WHERE request_id=? AND first_viewed_at IS NOT NULL) AS viewed,
      (SELECT COUNT(*) FROM invitations WHERE request_id=? AND responded_at IS NOT NULL) AS responded,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='direction') AS direction,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='person') AS person,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='solve') AS solve,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='clarify') AS clarify,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='pass') AS pass
  `).bind(id,id,id,id,id,id,id).first();

  const routes = await env.DB.prepare(`
    SELECT i.source_ref,
           CASE WHEN i.first_viewed_at IS NULL THEN 0 ELSE 1 END AS viewed,
           CASE WHEN i.responded_at IS NULL THEN 0 ELSE 1 END AS responded,
           SUM(CASE WHEN e.action='direction' THEN 1 ELSE 0 END) AS direction,
           SUM(CASE WHEN e.action='person' THEN 1 ELSE 0 END) AS person,
           SUM(CASE WHEN e.action='solve' THEN 1 ELSE 0 END) AS solve
    FROM invitations i
    LEFT JOIN events e ON e.request_id=i.request_id AND e.source_ref=i.source_ref
    WHERE i.request_id=?
    GROUP BY i.source_ref,i.first_viewed_at,i.responded_at
    ORDER BY i.first_viewed_at DESC
  `).bind(id).all();

  return {
    request_id: id,
    totals: Object.fromEntries(Object.entries(totals || {}).map(([k,v]) => [k, Number(v || 0)])),
    routes: routes.results || [],
  };
}

function createServer(env, request, canWrite) {
  const origin = new URL(request.url).origin;
  const server = new McpServer(
    { name: "global-connect", version: "0.1.0" },
    {
      instructions:
        "Global Connect routes real human requests. Read current request state before reporting results. Do not expose private contact fields. Creating a request is a write action and should only be used when the user explicitly wants a new request card.",
    },
  );

  server.registerTool(
    "list_requests",
    {
      title: "List Global Connect requests",
      description: "List recent Global Connect request cards with public metadata only.",
      inputSchema: z.object({
        status: z.enum(["open", "lead", "closed"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) => {
      await ensureMcpSchema(env);
      let query = `
        SELECT r.id,r.goal,r.deadline,r.budget,r.status,r.created_at,
               COALESCE(m.language,'unknown') AS language,
               COALESCE(m.created_via,'web') AS created_via
        FROM requests r LEFT JOIN request_meta m ON m.request_id=r.id
      `;
      const bindings = [];
      if (status) {
        query += " WHERE r.status=?";
        bindings.push(status);
      }
      query += " ORDER BY r.created_at DESC LIMIT ?";
      bindings.push(limit);
      const result = await env.DB.prepare(query).bind(...bindings).all();
      const requests = (result.results || []).map((row) => ({
        ...row,
        public_url: `${origin}/r/${row.id}`,
      }));
      return jsonResult({ requests });
    },
  );

  server.registerTool(
    "get_request",
    {
      title: "Get Global Connect request",
      description: "Get one request card and its public URL. Does not return private responder contact details.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = await getPublicRequest(env, id);
      if (!row) return jsonResult({ error: "request_not_found", id });
      return jsonResult({ ...row, public_url: `${origin}/r/${row.id}` });
    },
  );

  server.registerTool(
    "get_request_stats",
    {
      title: "Get request routing statistics",
      description: "Get aggregate views, responses and per-ref routing statistics for one request without exposing private response text or contacts.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const stats = await getStats(env, id);
      return jsonResult(stats || { error: "request_not_found", id });
    },
  );

  server.registerTool(
    "draft_request",
    {
      title: "Draft a Global Connect request",
      description: "Normalize a proposed request card without saving it. Use this before creation when requirements are incomplete or need review.",
      inputSchema: z.object({
        goal: z.string().min(3).max(2000),
        deadline: z.string().max(300).optional().default(""),
        budget: z.string().max(300).optional().default(""),
        constraints: z.string().max(4000).optional().default(""),
        success_criteria: z.string().max(4000).optional().default(""),
        attention_budget: z.number().int().min(0).max(20).default(3),
        language: z.enum(["en", "ru"]).default("en"),
        source_url: z.string().url().optional(),
        source_label: z.string().max(300).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult({ draft: input, saved: false }),
  );

  if (canWrite) {
    server.registerTool(
      "create_request",
      {
        title: "Create a Global Connect request card",
        description: "Create and persist a new public Global Connect request card. This changes server state and returns the public card URL.",
        inputSchema: z.object({
          goal: z.string().min(3).max(2000),
          deadline: z.string().max(300).optional().default(""),
          budget: z.string().max(300).optional().default(""),
          constraints: z.string().max(4000).optional().default(""),
          success_criteria: z.string().max(4000).optional().default(""),
          attention_budget: z.number().int().min(0).max(20).default(3),
          language: z.enum(["en", "ru"]).default("en"),
          source_url: z.string().url().optional(),
          source_label: z.string().max(300).optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        await ensureMcpSchema(env);
        const id = randomId();
        const createdAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO requests(id,goal,deadline,budget,constraints,success_criteria,attention_budget,status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
          `).bind(
            id,
            input.goal.trim(),
            input.deadline?.trim() || "",
            input.budget?.trim() || "",
            input.constraints?.trim() || "",
            input.success_criteria?.trim() || "",
            input.attention_budget ?? 3,
            "open",
            createdAt,
          ),
          env.DB.prepare(`
            INSERT INTO request_meta(request_id,language,source_url,source_label,created_via)
            VALUES(?,?,?,?,?)
          `).bind(
            id,
            input.language || "en",
            input.source_url || null,
            input.source_label || null,
            "mcp",
          ),
        ]);
        return jsonResult({
          created: true,
          id,
          public_url: `${origin}/r/${id}`,
          status: "open",
        });
      },
    );
  }

  return server;
}

export async function handleMcp(request, env) {
  const url = new URL(request.url);
  const suppliedKey = url.searchParams.get("key") || "";
  const canWrite = Boolean(env.GC_ADMIN_TOKEN) && suppliedKey === env.GC_ADMIN_TOKEN;
  const handler = createMcpHandler(() => createServer(env, request, canWrite));
  return handler.fetch(request);
}
