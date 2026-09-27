const ACTIONS = {
  solve: "Могу решить",
  direction: "Знаю, куда копать",
  person: "Знаю конкретного человека",
  clarify: "Нужно уточнение",
  pass: "Не могу помочь",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  deadline TEXT,
  budget TEXT,
  constraints TEXT,
  success_criteria TEXT,
  attention_budget INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  source_ref TEXT,
  action TEXT NOT NULL,
  note TEXT,
  contact TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  request_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  first_viewed_at TEXT,
  responded_at TEXT,
  PRIMARY KEY(request_id, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_events_request_id ON events(request_id);
CREATE INDEX IF NOT EXISTS idx_events_source_ref ON events(source_ref);
`;

const CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;background:#f7f7f8}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.05);margin:16px 0}h1{font-size:30px;margin:0 0 10px}h2{font-size:20px}.muted{color:#71717a}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f4f4f5;margin:3px 4px 3px 0;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{margin:14px 0}label{display:block;font-size:13px;font-weight:650;margin-bottom:6px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit}textarea{min-height:96px;resize:vertical}button,.button{display:inline-block;border:0;border-radius:10px;background:#18181b;color:#fff;padding:11px 14px;font-weight:650;cursor:pointer;text-decoration:none}.action{border-top:1px solid #eee;padding-top:16px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top}@media(max-width:620px){.grid{grid-template-columns:1fr}h1{font-size:25px}}
`;

function esc(value="") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(title, body) {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
}

function redirect(location) {
  return new Response(null, {status: 303, headers: {location}});
}

function text(value, status=200) {
  return new Response(value, {status, headers: {"content-type":"text/plain; charset=utf-8"}});
}

function now() { return new Date().toISOString(); }

function rowHtml(label, value) {
  if (!value) return "";
  return `<div class="field"><div class="muted">${esc(label)}</div><div>${esc(value)}</div></div>`;
}

async function ensureSchema(env) {
  await env.DB.exec(SCHEMA);
}

function requireAdmin(request, env) {
  const url = new URL(request.url);
  const supplied = url.searchParams.get("token") || request.headers.get("x-admin-token");
  if (!env.GC_ADMIN_TOKEN) return {ok:false, response:text("Не задан GC_ADMIN_TOKEN", 503)};
  if (supplied !== env.GC_ADMIN_TOKEN) return {ok:false, response:text("Страница не найдена", 404)};
  return {ok:true, token:supplied};
}

async function getRequest(env, rid) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id=? LIMIT 1").bind(rid).first();
  if (!row) return null;
  const events = await env.DB.prepare("SELECT * FROM events WHERE request_id=? ORDER BY id").bind(rid).all();
  return {row, events: events.results || []};
}

async function markView(env, rid, ref) {
  if (!ref) return;
  await env.DB.prepare(`
    INSERT INTO invitations(request_id,source_ref,first_viewed_at)
    VALUES(?,?,?)
    ON CONFLICT(request_id,source_ref) DO UPDATE SET
      first_viewed_at=COALESCE(invitations.first_viewed_at,excluded.first_viewed_at)
  `).bind(rid, ref.slice(0,64), now()).run();
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0,10);
}

async function handleHome(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return page("Global Connect", `<div class="card"><h1>Global Connect</h1><p>Эксперимент: может ли одна человеческая подсказка открыть путь, который не нашёл цифровой поиск.</p><p class="muted">Если вам прислали ссылку на запрос, откройте именно её.</p></div>`);
  }
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;
  return page("Создать запрос", `
    <div class="card"><h1>Global Connect — пилот</h1><p class="muted">Создание экспериментального запроса.</p>
    <form method="post" action="/requests?token=${esc(token)}">
      <div class="field"><label>Что должно произойти?</label><textarea name="goal" required></textarea></div>
      <div class="grid"><div class="field"><label>Срок</label><input name="deadline"></div><div class="field"><label>Бюджет</label><input name="budget"></div></div>
      <div class="field"><label>Ограничения</label><textarea name="constraints"></textarea></div>
      <div class="field"><label>Как понять, что результат достигнут?</label><textarea name="success_criteria"></textarea></div>
      <div class="field"><label>Бюджет человеческого внимания</label><input type="number" min="0" max="20" name="attention_budget" value="3"></div>
      <button type="submit">Создать запрос</button>
    </form></div>`);
}

async function handleCreate(request, env) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;
  await ensureSchema(env);
  const form = await request.formData();
  const goal = String(form.get("goal") || "").trim();
  if (!goal) return text("Нужно описать цель", 400);
  const rid = randomId();
  const rawAttention = Number.parseInt(String(form.get("attention_budget") || "3"), 10);
  const attention = Number.isFinite(rawAttention) ? Math.max(0, Math.min(rawAttention, 20)) : 3;
  await env.DB.prepare(`
    INSERT INTO requests(id,goal,deadline,budget,constraints,success_criteria,attention_budget,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    rid,
    goal,
    String(form.get("deadline") || "").trim(),
    String(form.get("budget") || "").trim(),
    String(form.get("constraints") || "").trim(),
    String(form.get("success_criteria") || "").trim(),
    attention,
    "open",
    now(),
  ).run();
  return redirect(`/r/${rid}?admin=${encodeURIComponent(admin.token)}`);
}

async function handleCard(request, env, rid) {
  const found = await getRequest(env, rid);
  if (!found) return text("Запрос не найден", 404);
  const {row, events} = found;
  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").slice(0,64);
  await markView(env, rid, ref);
  const used = events.filter(e => e.action === "direction" || e.action === "person").length;
  const left = Math.max(0, Number(row.attention_budget || 0) - used);
  const details = [
    rowHtml("Срок", row.deadline), rowHtml("Бюджет", row.budget),
    rowHtml("Ограничения", row.constraints), rowHtml("Критерий результата", row.success_criteria),
  ].join("");
  const refQ = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const thanks = url.searchParams.get("thanks") === "1" ? `<div class="card ok"><b>Спасибо. Ответ сохранён.</b></div>` : "";
  return page(row.goal, `${thanks}
    <div class="card"><span class="pill">Запрос ${esc(rid)}</span><span class="pill">Статус: ${esc(row.status)}</span>
    <h1>${esc(row.goal)}</h1>${details}
    <p class="muted">Осталось дорогих человеческих вмешательств: ${left}. Даже короткая подсказка «куда копать» полезна.</p></div>
    <div class="card"><h2>Что вы можете сделать?</h2>
      <form method="post" action="/r/${esc(rid)}/event?x=1${refQ}">
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="direction" checked> Знаю, куда копать</label><p class="muted">Например: «ищите не в ИТ, а у службы эксплуатации».</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="person"> Знаю конкретного человека</label><p class="muted">Можно указать имя/роль. Не публикуйте личный контакт без согласия.</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="solve"> Могу решить</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="clarify"> Нужно уточнение</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="pass"> Не могу помочь</label></div>
        <div class="field"><label>Комментарий</label><textarea name="note" placeholder="Подсказка, имя/роль человека или вопрос"></textarea></div>
        <div class="field"><label>Контакт для связи — необязательно</label><input name="contact" placeholder="Только свой контакт или публичный/согласованный"></div>
        <button type="submit">Отправить</button>
      </form><p class="muted">Регистрация не нужна. Ответ относится только к этому запросу.</p>
    </div>`);
}

async function handleEvent(request, env, rid) {
  const found = await getRequest(env, rid);
  if (!found) return text("Запрос не найден", 404);
  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").slice(0,64);
  const form = await request.formData();
  const action = String(form.get("action") || "");
  const note = String(form.get("note") || "").trim();
  const contact = String(form.get("contact") || "").trim();
  if (!(action in ACTIONS)) return text("Неизвестное действие", 400);
  if ((action === "direction" || action === "person") && !note) return text("Нужно добавить комментарий", 400);
  await env.DB.prepare("INSERT INTO events(request_id,source_ref,action,note,contact,created_at) VALUES(?,?,?,?,?,?)")
    .bind(rid, ref, action, note.slice(0,4000), contact.slice(0,500), now()).run();
  if (ref) {
    await env.DB.prepare(`
      INSERT INTO invitations(request_id,source_ref,first_viewed_at,responded_at)
      VALUES(?,?,?,?)
      ON CONFLICT(request_id,source_ref) DO UPDATE SET responded_at=excluded.responded_at
    `).bind(rid, ref, now(), now()).run();
  }
  if (action === "solve") await env.DB.prepare("UPDATE requests SET status='lead' WHERE id=?").bind(rid).run();
  const suffix = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return redirect(`/r/${rid}?thanks=1${suffix}`);
}

async function handleApi(env, rid) {
  const found = await getRequest(env, rid);
  if (!found) return Response.json({error:"not found"}, {status:404});
  return Response.json({...found.row, allowed_human_actions:Object.keys(ACTIONS), events:found.events});
}

async function handleAdmin(request, env) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;
  await ensureSchema(env);
  const result = await env.DB.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM events e WHERE e.request_id=r.id) AS event_count,
      (SELECT COUNT(*) FROM events e WHERE e.request_id=r.id AND e.action='direction') AS direction_count,
      (SELECT COUNT(*) FROM events e WHERE e.request_id=r.id AND e.action='person') AS person_count,
      (SELECT COUNT(*) FROM invitations i WHERE i.request_id=r.id AND i.first_viewed_at IS NOT NULL) AS viewed_count,
      (SELECT COUNT(*) FROM invitations i WHERE i.request_id=r.id AND i.responded_at IS NOT NULL) AS responded_count
    FROM requests r ORDER BY r.created_at DESC
  `).all();
  const rows = result.results || [];
  const trs = rows.map(r => `<tr><td><a href="/r/${esc(r.id)}">${esc(r.id)}</a></td><td>${esc(r.goal)}</td><td>${esc(r.status)}</td><td>${r.viewed_count||0}</td><td>${r.responded_count||0}</td><td>${r.direction_count||0}</td><td>${r.person_count||0}</td></tr>`).join("");
  return page("Статистика", `<div class="card"><h1>Статистика пилота</h1><p><a class="button" href="/?token=${encodeURIComponent(admin.token)}">Создать запрос</a></p><table><thead><tr><th>ID</th><th>Цель</th><th>Статус</th><th>Открыли</th><th>Ответили</th><th>Куда копать</th><th>Человек</th></tr></thead><tbody>${trs}</tbody></table></div>`);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/health" && request.method === "GET") {
        await ensureSchema(env);
        return Response.json({ok:true, version:"0.9"});
      }
      if (path === "/" && request.method === "GET") return handleHome(request, env);
      if (path === "/requests" && request.method === "POST") return handleCreate(request, env);
      if (path === "/admin" && request.method === "GET") return handleAdmin(request, env);
      const api = path.match(/^\/api\/r\/([a-zA-Z0-9_-]+)$/);
      if (api && request.method === "GET") return handleApi(env, api[1]);
      const event = path.match(/^\/r\/([a-zA-Z0-9_-]+)\/event$/);
      if (event && request.method === "POST") return handleEvent(request, env, event[1]);
      const card = path.match(/^\/r\/([a-zA-Z0-9_-]+)$/);
      if (card && request.method === "GET") return handleCard(request, env, card[1]);
      return text("Страница не найдена", 404);
    } catch (error) {
      console.error(error);
      return text(`Ошибка сервиса: ${error?.message || error}`, 500);
    }
  }
};
