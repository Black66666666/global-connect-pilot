import app from "./index.js";

const ENGLISH_CARDS = {
  acf0adc6f9: {
    title: "Find an engineer with firsthand experience of a large PostgreSQL major-version upgrade",
    deadline: "14 days",
    budget: "Not defined",
    constraints: "We need firsthand practical experience, not general PostgreSQL consulting and not a sales proposal. A close version path is acceptable if the production database was at least 5 TB and the system remained in active use.",
    success: "A specific engineer or architect with verified firsthand experience agrees to a 20-minute research conversation.",
  },
  bb46e4fca9: {
    title: "Find a technical leader with firsthand experience of a staged Angular → React migration",
    deadline: "14 days",
    budget: "Not defined",
    constraints: "We need Angular 2+ → React experience, not AngularJS → Angular. The migration should have been staged while the existing production product remained live, preferably in a large enterprise system.",
    success: "A technical lead or architect with this firsthand experience agrees to a 20-minute research conversation.",
  },
  "8afa4eea76": {
    title: "Find an operator of a production AI system that escalates to a human and then continues the workflow",
    deadline: "14 days",
    budget: "Not defined",
    constraints: "We need a real production system, not a demo. Preferably someone from the customer/operator side rather than only a platform vendor. No confidential metrics need to be disclosed.",
    success: "A person who directly works with such a production system agrees to a 20-minute research conversation.",
  },
  berlin70s1: {
    title: "Find 1–3 musicians in Berlin who want to casually play 70s rock together",
    deadline: "14 days",
    budget: "Unpaid / casual music project",
    constraints: "Berlin. Casual, non-professional. Rehearsal roughly once a week or twice a month. English is fine. The requester plays guitar and bass and is interested in Cream, Rush, David Bowie and similar music. The original requester has explicitly agreed to this request being shared.",
    success: "At least one suitable musician contacts the original requester and they agree to arrange a first jam or rehearsal.",
    source_url: "https://www.reddit.com/r/berlinsocialclub/comments/1whcgz9/finding_a_band_to_play/",
    source_label: "Open the original Reddit request / contact the requester",
  },
};

const SEEDED_REQUESTS = {
  berlin70s1: {
    goal: ENGLISH_CARDS.berlin70s1.title,
    deadline: ENGLISH_CARDS.berlin70s1.deadline,
    budget: ENGLISH_CARDS.berlin70s1.budget,
    constraints: ENGLISH_CARDS.berlin70s1.constraints,
    success_criteria: ENGLISH_CARDS.berlin70s1.success,
    attention_budget: 3,
  },
};

async function ensureCoreSchema(env) {
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
  ]);
}

async function ensureSeededRequests(env) {
  await ensureCoreSchema(env);
  const createdAt = new Date().toISOString();
  for (const [id, card] of Object.entries(SEEDED_REQUESTS)) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO requests(
        id,goal,deadline,budget,constraints,success_criteria,attention_budget,status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(
      id,
      card.goal,
      card.deadline,
      card.budget,
      card.constraints,
      card.success_criteria,
      card.attention_budget,
      "open",
      createdAt,
    ).run();
  }
}

function patchedDatabase(db) {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "exec") {
        return async (sql) => {
          const statements = String(sql)
            .split(";")
            .map((statement) => statement.trim())
            .filter(Boolean);

          if (statements.length === 0) return { count: 0 };

          const prepared = statements.map((statement) => target.prepare(statement));
          return target.batch(prepared);
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function patchedEnvironment(env) {
  const db = patchedDatabase(env.DB);
  return new Proxy(env, {
    get(target, prop) {
      if (prop === "DB") return db;
      return Reflect.get(target, prop, target);
    },
  });
}

function stripAdminTokenFromRedirect(request, response) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/requests" || response.status !== 303) {
    return response;
  }

  const location = response.headers.get("location");
  if (!location) return response;

  const clean = new URL(location, request.url);
  clean.searchParams.delete("admin");

  const headers = new Headers(response.headers);
  headers.set("location", clean.pathname + clean.search + clean.hash);
  return new Response(null, { status: 303, headers });
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function englishPage(title, body) {
  const css = `
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;background:#f7f7f8}
    *{box-sizing:border-box}body{margin:0}.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.05);margin:16px 0}h1{font-size:30px;margin:0 0 10px}h2{font-size:20px}.muted{color:#71717a}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f4f4f5;margin:3px 4px 3px 0;font-size:13px}.field{margin:14px 0}label{display:block;font-size:14px;font-weight:650;margin-bottom:6px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit}textarea{min-height:96px;resize:vertical}button,.button{display:inline-block;border:0;border-radius:10px;background:#18181b;color:#fff;padding:11px 14px;font-weight:650;cursor:pointer;text-decoration:none}.action{border-top:1px solid #eee;padding-top:16px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0}@media(max-width:620px){h1{font-size:25px}}
  `;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${css}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function markEnglishView(env, rid, ref) {
  if (!ref) return;
  const currentTime = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO invitations(request_id,source_ref,first_viewed_at)
    VALUES(?,?,?)
    ON CONFLICT(request_id,source_ref) DO UPDATE SET
      first_viewed_at=COALESCE(invitations.first_viewed_at,excluded.first_viewed_at)
  `).bind(rid, ref.slice(0,64), currentTime).run();
}

async function renderEnglishCard(request, env, rid) {
  const card = ENGLISH_CARDS[rid];
  if (!card) return null;

  const row = await env.DB.prepare("SELECT id,status,attention_budget FROM requests WHERE id=? LIMIT 1").bind(rid).first();
  if (!row) return null;

  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").slice(0,64);
  await markEnglishView(env, rid, ref);

  const events = await env.DB.prepare("SELECT action FROM events WHERE request_id=?").bind(rid).all();
  const used = (events.results || []).filter((e) => e.action === "direction" || e.action === "person").length;
  const left = Math.max(0, Number(row.attention_budget || 0) - used);
  const refQuery = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const thanks = url.searchParams.get("thanks") === "1"
    ? `<div class="card ok"><b>Thank you. Your response has been saved.</b></div>`
    : "";
  const source = card.source_url
    ? `<div class="field"><a class="button" href="${esc(card.source_url)}" target="_blank" rel="noopener noreferrer">${esc(card.source_label || "Open original request")}</a></div>`
    : "";

  const body = `${thanks}
    <div class="card">
      <span class="pill">Request ${esc(rid)}</span><span class="pill">Status: ${esc(row.status)}</span>
      <h1>${esc(card.title)}</h1>
      <div class="field"><div class="muted">Deadline</div><div>${esc(card.deadline)}</div></div>
      <div class="field"><div class="muted">Budget</div><div>${esc(card.budget)}</div></div>
      <div class="field"><div class="muted">Constraints</div><div>${esc(card.constraints)}</div></div>
      <div class="field"><div class="muted">What counts as success</div><div>${esc(card.success)}</div></div>
      ${source}
      <p class="muted">Remaining high-cost human interventions: ${left}. Even a short pointer about where to look can be useful.</p>
    </div>
    <div class="card">
      <h2>How can you help?</h2>
      <form method="post" action="/r/${esc(rid)}/event?x=1${refQuery}">
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="direction" checked> I know where to look</label><p class="muted">For example: “Try this local musicians' group” or “Post on this rehearsal-space board.”</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="person"> I know a specific person</label><p class="muted">A name or public profile is enough. Please do not share private contact details without permission.</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="solve"> I can help directly</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="clarify"> The request needs clarification</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="pass"> I cannot help</label></div>
        <div class="field"><label>Comment</label><textarea name="note" placeholder="A direction, a person/profile, or a clarifying question"></textarea></div>
        <div class="field"><label>Your contact details — optional</label><input name="contact" placeholder="Only your own contact details or a public/approved contact"></div>
        <button type="submit">Send response</button>
      </form>
      <p class="muted">No registration is required. Your response is used only for this request.</p>
    </div>`;

  return englishPage(card.title, body);
}

async function renderSafeApi(env, rid) {
  const row = await env.DB.prepare("SELECT id,goal,deadline,budget,constraints,success_criteria,attention_budget,status,created_at FROM requests WHERE id=? LIMIT 1").bind(rid).first();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const events = await env.DB.prepare("SELECT action,COUNT(*) AS count FROM events WHERE request_id=? GROUP BY action").bind(rid).all();
  return Response.json({
    ...row,
    allowed_human_actions: ["solve", "direction", "person", "clarify", "pass"],
    response_counts: Object.fromEntries((events.results || []).map((item) => [item.action, Number(item.count || 0)])),
  });
}

export default {
  async fetch(request, env, ctx) {
    await ensureSeededRequests(env);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const apiMatch = url.pathname.match(/^\/api\/r\/([a-zA-Z0-9_-]+)$/);
      if (apiMatch) return renderSafeApi(env, apiMatch[1]);

      const match = url.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)$/);
      if (match && ENGLISH_CARDS[match[1]]) {
        const response = await renderEnglishCard(request, env, match[1]);
        if (response) return response;
      }
    }

    const response = await app.fetch(request, patchedEnvironment(env), ctx);
    return stripAdminTokenFromRedirect(request, response);
  },
};
