from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from workers import asgi
from urllib.parse import parse_qs
from uuid import uuid4
from datetime import datetime, timezone
from html import escape

app = FastAPI(title="Global Connect Pilot", version="0.8")
Default = asgi.entrypoint(app)

ACTIONS = {
    "solve": "Могу решить",
    "direction": "Знаю, куда копать",
    "person": "Знаю конкретного человека",
    "clarify": "Нужно уточнение",
    "pass": "Не могу помочь",
}

SCHEMA = """
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
"""

CSS = """
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;background:#f7f7f8}
*{box-sizing:border-box} body{margin:0}.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.05);margin:16px 0}h1{font-size:30px;margin:0 0 10px}h2{font-size:20px}.muted{color:#71717a}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f4f4f5;margin:3px 4px 3px 0;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{margin:14px 0}label{display:block;font-size:13px;font-weight:650;margin-bottom:6px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit}textarea{min-height:96px;resize:vertical}button,.button{display:inline-block;border:0;border-radius:10px;background:#18181b;color:#fff;padding:11px 14px;font-weight:650;cursor:pointer;text-decoration:none}.secondary{background:#f4f4f5;color:#18181b;border:1px solid #d4d4d8}.action{border-top:1px solid #eee;padding-top:16px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0}.warning{background:#fffbeb;border-color:#fde68a}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee;vertical-align:top}@media(max-width:620px){.grid{grid-template-columns:1fr}h1{font-size:25px}}
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def env(request: Request):
    return request.scope["env"]


def db(request: Request):
    try:
        return env(request).DB
    except Exception as exc:
        raise HTTPException(503, "База данных D1 не подключена") from exc


async def ensure_schema(request: Request):
    await db(request).exec(SCHEMA)


def to_py(value):
    if value is None:
        return None
    return value.to_py() if hasattr(value, "to_py") else value


async def form_data(request: Request):
    raw = (await request.body()).decode("utf-8")
    parsed = parse_qs(raw, keep_blank_values=True)
    return {k: (v[0] if v else "") for k, v in parsed.items()}


def admin_token(request: Request):
    try:
        token = getattr(env(request), "GC_ADMIN_TOKEN", None)
        return str(token) if token else None
    except Exception:
        return None


def require_admin(request: Request):
    configured = admin_token(request)
    supplied = request.query_params.get("token") or request.headers.get("x-admin-token")
    if not configured:
        raise HTTPException(503, "Не задан GC_ADMIN_TOKEN")
    if supplied != configured:
        raise HTTPException(404, "Страница не найдена")
    return configured


def page(title: str, body: str, *, noindex: bool = True):
    robots = '<meta name="robots" content="noindex,nofollow">' if noindex else ""
    return HTMLResponse(f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">{robots}<title>{escape(title)}</title><style>{CSS}</style></head><body><main class="wrap">{body}</main></body></html>""")


def row_html(label, value):
    if not value:
        return ""
    return f'<div class="field"><div class="muted">{escape(label)}</div><div>{escape(str(value))}</div></div>'


async def get_request(request: Request, rid: str):
    await ensure_schema(request)
    row = await db(request).prepare("SELECT * FROM requests WHERE id=? LIMIT 1").bind(rid).first()
    row = to_py(row)
    if not row:
        raise HTTPException(404, "Запрос не найден")
    result = await db(request).prepare("SELECT * FROM events WHERE request_id=? ORDER BY id").bind(rid).run()
    events = to_py(result.results) or []
    return row, events


async def mark_view(request: Request, rid: str, source_ref: str):
    if not source_ref:
        return
    await db(request).prepare("""
        INSERT INTO invitations(request_id,source_ref,first_viewed_at)
        VALUES(?,?,?)
        ON CONFLICT(request_id,source_ref) DO UPDATE SET
          first_viewed_at=COALESCE(invitations.first_viewed_at,excluded.first_viewed_at)
    """).bind(rid, source_ref[:64], now()).run()


@app.get("/health")
async def health(request: Request):
    await ensure_schema(request)
    return {"ok": True, "version": "0.8"}


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    token = request.query_params.get("token")
    if token:
        require_admin(request)
        body = f"""
        <div class="card"><h1>Global Connect — пилот</h1><p class="muted">Создание экспериментального запроса.</p>
        <form method="post" action="/requests?token={escape(token)}">
          <div class="field"><label>Что должно произойти?</label><textarea name="goal" required></textarea></div>
          <div class="grid"><div class="field"><label>Срок</label><input name="deadline"></div><div class="field"><label>Бюджет</label><input name="budget"></div></div>
          <div class="field"><label>Ограничения</label><textarea name="constraints"></textarea></div>
          <div class="field"><label>Как понять, что результат достигнут?</label><textarea name="success_criteria"></textarea></div>
          <div class="field"><label>Бюджет человеческого внимания</label><input type="number" min="0" max="20" name="attention_budget" value="3"></div>
          <button type="submit">Создать запрос</button>
        </form></div>"""
        return page("Создать запрос", body)
    return page("Global Connect", '<div class="card"><h1>Global Connect</h1><p>Эксперимент: может ли одна человеческая подсказка открыть путь, который не нашёл цифровой поиск.</p><p class="muted">Если вам прислали ссылку на запрос, откройте именно её.</p></div>')


@app.post("/requests")
async def create_request(request: Request):
    require_admin(request)
    await ensure_schema(request)
    data = await form_data(request)
    goal = data.get("goal", "").strip()
    if not goal:
        raise HTTPException(400, "Нужно описать цель")
    rid = uuid4().hex[:10]
    try:
        attention = max(0, min(int(data.get("attention_budget", "3") or 3), 20))
    except ValueError:
        attention = 3
    await db(request).prepare("""
        INSERT INTO requests(id,goal,deadline,budget,constraints,success_criteria,attention_budget,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)
    """).bind(
        rid, goal, data.get("deadline", "").strip(), data.get("budget", "").strip(),
        data.get("constraints", "").strip(), data.get("success_criteria", "").strip(),
        attention, "open", now()
    ).run()
    token = request.query_params.get("token", "")
    return RedirectResponse(f"/r/{rid}?admin={token}", status_code=303)


@app.get("/r/{rid}", response_class=HTMLResponse)
async def card(request: Request, rid: str):
    row, events = await get_request(request, rid)
    source_ref = (request.query_params.get("ref") or "")[:64]
    await mark_view(request, rid, source_ref)
    used = sum(1 for e in events if e.get("action") in ("direction", "person"))
    left = max(0, int(row.get("attention_budget", 0)) - used)

    details = "".join([
        row_html("Срок", row.get("deadline")),
        row_html("Бюджет", row.get("budget")),
        row_html("Ограничения", row.get("constraints")),
        row_html("Критерий результата", row.get("success_criteria")),
    ])
    ref_q = f"&ref={escape(source_ref)}" if source_ref else ""
    action = f"/r/{escape(rid)}/event?x=1{ref_q}"
    body = f"""
    <div class="card"><span class="pill">Запрос {escape(rid)}</span><span class="pill">Статус: {escape(str(row.get('status','open')))}</span>
    <h1>{escape(str(row['goal']))}</h1>{details}
    <p class="muted">Осталось дорогих человеческих вмешательств: {left}. Даже короткая подсказка «куда копать» полезна.</p></div>
    <div class="card"><h2>Что вы можете сделать?</h2>
      <form method="post" action="{action}">
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="direction" checked> Знаю, куда копать</label><p class="muted">Например: «ищите не в ИТ, а у службы эксплуатации».</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="person"> Знаю конкретного человека</label><p class="muted">Можно указать имя/роль. Не публикуйте личный контакт без согласия.</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="solve"> Могу решить</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="clarify"> Нужно уточнение</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="pass"> Не могу помочь</label></div>
        <div class="field"><label>Комментарий</label><textarea name="note" placeholder="Подсказка, имя/роль человека или вопрос"></textarea></div>
        <div class="field"><label>Контакт для связи — необязательно</label><input name="contact" placeholder="Только свой контакт или публичный/согласованный"></div>
        <button type="submit">Отправить</button>
      </form>
      <p class="muted">Регистрация не нужна. Ответ относится только к этому запросу.</p>
    </div>"""
    if request.query_params.get("thanks") == "1":
        body = '<div class="card ok"><b>Спасибо. Ответ сохранён.</b></div>' + body
    return page(str(row["goal"]), body)


@app.post("/r/{rid}/event")
async def add_event(request: Request, rid: str):
    row, _ = await get_request(request, rid)
    data = await form_data(request)
    action = data.get("action", "")
    note = data.get("note", "").strip()
    contact = data.get("contact", "").strip()
    source_ref = (request.query_params.get("ref") or "")[:64]
    if action not in ACTIONS:
        raise HTTPException(400, "Неизвестное действие")
    if action == "direction" and not note:
        raise HTTPException(400, "Для подсказки нужно написать, куда копать")
    if action == "person" and not note:
        raise HTTPException(400, "Укажите имя, роль или описание человека")

    await db(request).prepare("INSERT INTO events(request_id,source_ref,action,note,contact,created_at) VALUES(?,?,?,?,?,?)").bind(
        rid, source_ref, action, note[:4000], contact[:500], now()
    ).run()
    if source_ref:
        await db(request).prepare("""
            INSERT INTO invitations(request_id,source_ref,first_viewed_at,responded_at)
            VALUES(?,?,?,?)
            ON CONFLICT(request_id,source_ref) DO UPDATE SET responded_at=excluded.responded_at
        """).bind(rid, source_ref, now(), now()).run()
    if action == "solve":
        await db(request).prepare("UPDATE requests SET status='lead' WHERE id=?").bind(rid).run()
    suffix = f"&ref={source_ref}" if source_ref else ""
    return RedirectResponse(f"/r/{rid}?thanks=1{suffix}", status_code=303)


@app.get("/api/r/{rid}")
async def api_card(request: Request, rid: str):
    row, events = await get_request(request, rid)
    return JSONResponse({
        **row,
        "allowed_human_actions": list(ACTIONS.keys()),
        "events": events,
    })


@app.get("/admin", response_class=HTMLResponse)
async def admin(request: Request):
    token = require_admin(request)
    await ensure_schema(request)
    res = await db(request).prepare("""
      SELECT r.*, COUNT(e.id) event_count,
        SUM(CASE WHEN e.action='direction' THEN 1 ELSE 0 END) directions,
        SUM(CASE WHEN e.action='person' THEN 1 ELSE 0 END) persons,
        SUM(CASE WHEN e.action='solve' THEN 1 ELSE 0 END) solves,
        COUNT(DISTINCT CASE WHEN i.first_viewed_at IS NOT NULL THEN i.source_ref END) unique_views,
        COUNT(DISTINCT CASE WHEN i.responded_at IS NOT NULL THEN i.source_ref END) unique_responses
      FROM requests r
      LEFT JOIN events e ON r.id=e.request_id
      LEFT JOIN invitations i ON r.id=i.request_id
      GROUP BY r.id ORDER BY r.created_at DESC
    """).run()
    rows = to_py(res.results) or []
    trs = []
    for r in rows:
        trs.append(f"<tr><td><a href='/r/{escape(str(r['id']))}?admin={escape(token)}'>{escape(str(r['id']))}</a></td><td>{escape(str(r['goal']))}</td><td>{int(r.get('unique_views') or 0)}</td><td>{int(r.get('unique_responses') or 0)}</td><td>{int(r.get('directions') or 0)}</td><td>{int(r.get('persons') or 0)}</td><td>{int(r.get('solves') or 0)}</td></tr>")
    body = f"""
    <div class='card'><h1>Пилот: статистика</h1><p><a class='button secondary' href='/?token={escape(token)}'>Создать запрос</a></p>
    <table><thead><tr><th>ID</th><th>Цель</th><th>Открыли</th><th>Ответили</th><th>Направления</th><th>Люди</th><th>Могут решить</th></tr></thead><tbody>{''.join(trs)}</tbody></table></div>
    """
    return page("Статистика", body)
