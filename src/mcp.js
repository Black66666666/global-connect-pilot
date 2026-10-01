import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const SEEDED_ROUTES = [
  { request_id: "berlin70s1", source_ref: "noisy_kalle_01", channel: "email", target_label: "Kalle — Berlin blues/rock/funk sessions", sent_at: "2026-10-01T18:46:41.600Z" },
  { request_id: "berlin70s1", source_ref: "noisy_rooms_01", channel: "email", target_label: "Noisy Rooms community", sent_at: "2026-10-01T18:46:50.270Z" },
  { request_id: "berlin70s1", source_ref: "ben87_02", channel: "email", target_label: "Benjamin — Berlin bassist / classic rock", sent_at: "2026-10-01T18:51:13.880Z" },
  { request_id: "berlin70s1", source_ref: "myra_03", channel: "email", target_label: "Myroslava — Berlin cover-band project", sent_at: "2026-10-01T18:51:23.249Z" },
  { request_id: "berlin70s1", source_ref: "rockmeetup_04", channel: "email", target_label: "Berlin Rock Music Meetup", sent_at: "2026-10-01T18:51:29.335Z" },
  { request_id: "berlin70s1", source_ref: "bluesjam_05", channel: "email", target_label: "Berlin-Friedrichshain blues session", sent_at: "2026-10-01T19:46:42.695Z" },
];

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(code, message, extra = {}) {
  return {
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: code, message, ...extra },
    isError: true,
  };
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function cleanRef(value = "") {
  return String(value).trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export async function ensureMcpSchema(env) {
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS routes (
      request_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      channel TEXT NOT NULL,
      target_label TEXT,
      target_url TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      PRIMARY KEY(request_id, source_ref)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_routes_request ON routes(request_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_routes_channel ON routes(channel)`),
  ]);
}

export async function ensurePilotRoutingData(env) {
  await ensureMcpSchema(env);
  const now = new Date().toISOString();
  for (const route of SEEDED_ROUTES) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO routes(
        request_id,source_ref,channel,target_label,target_url,status,created_at,sent_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      route.request_id,
      route.source_ref,
      route.channel,
      route.target_label,
      null,
      "sent",
      route.sent_at || now,
      route.sent_at || now,
    ).run();
  }
}

async function getPublicRequest(env, id) {
  await ensurePilotRoutingData(env);
  return env.DB.prepare(`
    SELECT r.id,r.goal,r.deadline,r.budget,r.constraints,r.success_criteria,
           r.attention_budget,r.status,r.created_at,
           m.language,m.source_url,m.source_label,m.created_via
    FROM requests r
    LEFT JOIN request_meta m ON m.request_id=r.id
    WHERE r.id=? LIMIT 1
  `).bind(id).first();
}

async function getRoutes(env, id) {
  await ensurePilotRoutingData(env);
  const result = await env.DB.prepare(`
    SELECT
      r.source_ref,
      r.channel,
      r.target_label,
      r.target_url,
      r.status AS delivery_status,
      r.created_at,
      r.sent_at,
      i.first_viewed_at,
      i.responded_at,
      COALESCE(SUM(CASE WHEN e.action='direction' THEN 1 ELSE 0 END),0) AS direction,
      COALESCE(SUM(CASE WHEN e.action='person' THEN 1 ELSE 0 END),0) AS person,
      COALESCE(SUM(CASE WHEN e.action='solve' THEN 1 ELSE 0 END),0) AS solve,
      COALESCE(SUM(CASE WHEN e.action='clarify' THEN 1 ELSE 0 END),0) AS clarify,
      COALESCE(SUM(CASE WHEN e.action='pass' THEN 1 ELSE 0 END),0) AS pass
    FROM routes r
    LEFT JOIN invitations i
      ON i.request_id=r.request_id AND i.source_ref=r.source_ref
    LEFT JOIN events e
      ON e.request_id=r.request_id AND e.source_ref=r.source_ref
    WHERE r.request_id=?
    GROUP BY r.request_id,r.source_ref,r.channel,r.target_label,r.target_url,r.status,r.created_at,r.sent_at,i.first_viewed_at,i.responded_at
    ORDER BY COALESCE(r.sent_at,r.created_at) DESC
  `).bind(id).all();

  return (result.results || []).map((row) => ({
    ...row,
    direction: Number(row.direction || 0),
    person: Number(row.person || 0),
    solve: Number(row.solve || 0),
    clarify: Number(row.clarify || 0),
    pass: Number(row.pass || 0),
    effective_status: row.responded_at ? "responded" : row.first_viewed_at ? "viewed" : row.delivery_status,
  }));
}

async function getStats(env, id) {
  await ensurePilotRoutingData(env);
  const exists = await env.DB.prepare("SELECT id FROM requests WHERE id=? LIMIT 1").bind(id).first();
  if (!exists) return null;

  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM routes WHERE request_id=? AND status IN ('sent','viewed','responded')) AS sent,
      (SELECT COUNT(*) FROM invitations WHERE request_id=? AND first_viewed_at IS NOT NULL) AS viewed,
      (SELECT COUNT(*) FROM invitations WHERE request_id=? AND responded_at IS NOT NULL) AS responded,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='direction') AS direction,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='person') AS person,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='solve') AS solve,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='clarify') AS clarify,
      (SELECT COUNT(*) FROM events WHERE request_id=? AND action='pass') AS pass
  `).bind(id,id,id,id,id,id,id,id).first();

  const routes = await getRoutes(env, id);
  const numericTotals = Object.fromEntries(Object.entries(totals || {}).map(([k,v]) => [k, Number(v || 0)]));
  const sent = numericTotals.sent || 0;
  const viewed = numericTotals.viewed || 0;
  const responded = numericTotals.responded || 0;

  return {
    request_id: id,
    totals: numericTotals,
    rates: {
      view_rate: sent ? viewed / sent : 0,
      response_rate_from_sent: sent ? responded / sent : 0,
      response_rate_from_viewed: viewed ? responded / viewed : 0,
    },
    routes,
  };
}

function createServer(env, request, canWrite) {
  const origin = new URL(request.url).origin;
  const server = new McpServer(
    { name: "global-connect", version: "0.2.0" },
    {
      instructions:
        "Global Connect routes real human requests through measurable referral paths. Read current request and route state before reporting results. Never expose private responder contact fields. Use a unique source_ref for every distribution route. Creating a request or registering a route changes server state and should only happen when the user explicitly wants that action.",
    },
  );

  server.registerTool(
    "list_requests",
    {
      title: "List Global Connect requests",
      description: "List recent Global Connect request cards with public metadata only. Use this to inspect existing requests before creating duplicates.",
      inputSchema: z.object({
        status: z.enum(["open", "lead", "closed"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) => {
      await ensurePilotRoutingData(env);
      let query = `
        SELECT r.id,r.goal,r.deadline,r.budget,r.status,r.created_at,
               COALESCE(m.language,'unknown') AS language,
               COALESCE(m.created_via,'web') AS created_via,
               (SELECT COUNT(*) FROM routes rt WHERE rt.request_id=r.id AND rt.status IN ('sent','viewed','responded')) AS routes_sent
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
        routes_sent: Number(row.routes_sent || 0),
        public_url: `${origin}/r/${row.id}`,
      }));
      return jsonResult({ requests });
    },
  );

  server.registerTool(
    "get_request",
    {
      title: "Get Global Connect request",
      description: "Get one request card and its public URL. Does not return private responder notes or contact details.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = await getPublicRequest(env, id);
      if (!row) return errorResult("request_not_found", "No request exists with this ID.", { id });
      return jsonResult({ ...row, public_url: `${origin}/r/${row.id}` });
    },
  );

  server.registerTool(
    "get_request_stats",
    {
      title: "Get request routing statistics",
      description: "Get the number of registered routes, sends, opens, responses and response types for one request. Includes per-ref route performance but never responder contact details.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const stats = await getStats(env, id);
      return stats ? jsonResult(stats) : errorResult("request_not_found", "No request exists with this ID.", { id });
    },
  );

  server.registerTool(
    "list_routes",
    {
      title: "List distribution routes for a request",
      description: "List every registered distribution route for a request, including channel, non-sensitive target label, send/open/response state and aggregate response types.",
      inputSchema: z.object({ id: z.string().min(1).max(80) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = await getPublicRequest(env, id);
      if (!row) return errorResult("request_not_found", "No request exists with this ID.", { id });
      return jsonResult({ request_id: id, routes: await getRoutes(env, id) });
    },
  );

  server.registerTool(
    "draft_request",
    {
      title: "Draft a Global Connect request",
      description: "Normalize a proposed real-world request card without saving it. Use this before creation when requirements or success criteria need review.",
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
        description: "Create and persist a new public Global Connect request card after the user explicitly asks to create it. Returns the public card URL. This changes Global Connect state but does not contact anyone.",
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
        await ensurePilotRoutingData(env);
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

    server.registerTool(
      "register_route",
      {
        title: "Register a request distribution route",
        description: "Record one planned or already-sent distribution route for a request and return a trackable card link. This only updates the Global Connect routing ledger; it does not send or post the card externally.",
        inputSchema: z.object({
          request_id: z.string().min(1).max(80),
          source_ref: z.string().min(1).max(64).optional(),
          channel: z.enum(["email", "reddit", "discord", "telegram", "forum", "web", "other"]),
          target_label: z.string().max(500).optional().default(""),
          target_url: z.string().url().optional(),
          status: z.enum(["planned", "sent", "failed", "cancelled"]).default("planned"),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        await ensurePilotRoutingData(env);
        const requestRow = await env.DB.prepare("SELECT id FROM requests WHERE id=? LIMIT 1").bind(input.request_id).first();
        if (!requestRow) return errorResult("request_not_found", "Cannot register a route for an unknown request.", { id: input.request_id });

        const generated = `${input.channel}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
        const sourceRef = cleanRef(input.source_ref || generated);
        if (!sourceRef) return errorResult("invalid_source_ref", "source_ref must contain at least one letter, number, underscore or hyphen.");
        const createdAt = new Date().toISOString();
        const sentAt = input.status === "sent" ? createdAt : null;

        await env.DB.prepare(`
          INSERT INTO routes(request_id,source_ref,channel,target_label,target_url,status,created_at,sent_at)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(request_id,source_ref) DO UPDATE SET
            channel=excluded.channel,
            target_label=excluded.target_label,
            target_url=excluded.target_url,
            status=excluded.status,
            sent_at=COALESCE(routes.sent_at,excluded.sent_at)
        `).bind(
          input.request_id,
          sourceRef,
          input.channel,
          input.target_label || null,
          input.target_url || null,
          input.status,
          createdAt,
          sentAt,
        ).run();

        return jsonResult({
          registered: true,
          request_id: input.request_id,
          source_ref: sourceRef,
          channel: input.channel,
          status: input.status,
          tracked_url: `${origin}/r/${input.request_id}?ref=${encodeURIComponent(sourceRef)}`,
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
