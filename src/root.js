import webApp from "./worker.js";
import { handleMcp } from "./mcp.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;background:#f7f7f8}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.05);margin:16px 0}h1{font-size:30px;margin:0 0 10px}h2{font-size:20px}.muted{color:#71717a}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f4f4f5;margin:3px 4px 3px 0;font-size:13px}.field{margin:14px 0}label{display:block;font-size:14px;font-weight:650;margin-bottom:6px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit}textarea{min-height:96px;resize:vertical}button,.button{display:inline-block;border:0;border-radius:10px;background:#18181b;color:#fff;padding:11px 14px;font-weight:650;cursor:pointer;text-decoration:none}.action{border-top:1px solid #eee;padding-top:16px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0}@media(max-width:620px){h1{font-size:25px}}
`;

function htmlPage(lang, title, body) {
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function renderMcpCard(request, env, id) {
  let row;
  try {
    row = await env.DB.prepare(`
      SELECT r.*,m.language,m.source_url,m.source_label,m.created_via
      FROM requests r JOIN request_meta m ON m.request_id=r.id
      WHERE r.id=? AND m.created_via='mcp' LIMIT 1
    `).bind(id).first();
  } catch {
    return null;
  }
  if (!row) return null;

  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").slice(0, 64);
  const now = new Date().toISOString();
  if (ref) {
    await env.DB.prepare(`
      INSERT INTO invitations(request_id,source_ref,first_viewed_at)
      VALUES(?,?,?)
      ON CONFLICT(request_id,source_ref) DO UPDATE SET
        first_viewed_at=COALESCE(invitations.first_viewed_at,excluded.first_viewed_at)
    `).bind(id, ref, now).run();
  }

  const counts = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN action='direction' THEN 1 ELSE 0 END) AS direction,
      SUM(CASE WHEN action='person' THEN 1 ELSE 0 END) AS person
    FROM events WHERE request_id=?
  `).bind(id).first();
  const used = Number(counts?.direction || 0) + Number(counts?.person || 0);
  const left = Math.max(0, Number(row.attention_budget || 0) - used);
  const refQ = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const isRu = row.language === "ru";

  const t = isRu ? {
    deadline: "Срок", budget: "Бюджет", constraints: "Ограничения", success: "Критерий результата",
    status: "Статус", remaining: "Осталось дорогих человеческих вмешательств", help: "Что вы можете сделать?",
    direction: "Знаю, куда копать", directionHint: "Например: подходящее сообщество, место или направление поиска.",
    person: "Знаю конкретного человека", personHint: "Имя или публичный профиль достаточно. Не публикуйте личные контакты без согласия.",
    solve: "Могу помочь напрямую", clarify: "Нужно уточнение", pass: "Не могу помочь",
    comment: "Комментарий", commentPh: "Подсказка, человек/профиль или уточняющий вопрос",
    contact: "Ваш контакт — необязательно", contactPh: "Только свой или публичный/согласованный контакт",
    send: "Отправить", noReg: "Регистрация не требуется. Ответ используется только для этого запроса.",
    thanks: "Спасибо. Ответ сохранён.", source: "Открыть исходный запрос",
  } : {
    deadline: "Deadline", budget: "Budget", constraints: "Constraints", success: "What counts as success",
    status: "Status", remaining: "Remaining high-cost human interventions", help: "How can you help?",
    direction: "I know where to look", directionHint: "For example: a relevant community, place or search direction.",
    person: "I know a specific person", personHint: "A name or public profile is enough. Please do not share private contact details without permission.",
    solve: "I can help directly", clarify: "The request needs clarification", pass: "I cannot help",
    comment: "Comment", commentPh: "A direction, person/profile, or clarifying question",
    contact: "Your contact details — optional", contactPh: "Only your own contact details or a public/approved contact",
    send: "Send response", noReg: "No registration is required. Your response is used only for this request.",
    thanks: "Thank you. Your response has been saved.", source: "Open original request",
  };

  const details = [
    row.deadline ? `<div class="field"><div class="muted">${t.deadline}</div><div>${esc(row.deadline)}</div></div>` : "",
    row.budget ? `<div class="field"><div class="muted">${t.budget}</div><div>${esc(row.budget)}</div></div>` : "",
    row.constraints ? `<div class="field"><div class="muted">${t.constraints}</div><div>${esc(row.constraints)}</div></div>` : "",
    row.success_criteria ? `<div class="field"><div class="muted">${t.success}</div><div>${esc(row.success_criteria)}</div></div>` : "",
  ].join("");
  const source = row.source_url
    ? `<div class="field"><a class="button" href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">${esc(row.source_label || t.source)}</a></div>`
    : "";
  const thanks = url.searchParams.get("thanks") === "1" ? `<div class="card ok"><b>${t.thanks}</b></div>` : "";

  return htmlPage(isRu ? "ru" : "en", row.goal, `${thanks}
    <div class="card">
      <span class="pill">Request ${esc(id)}</span><span class="pill">${t.status}: ${esc(row.status)}</span>
      <h1>${esc(row.goal)}</h1>${details}${source}
      <p class="muted">${t.remaining}: ${left}</p>
    </div>
    <div class="card"><h2>${t.help}</h2>
      <form method="post" action="/r/${esc(id)}/event?x=1${refQ}">
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="direction" checked> ${t.direction}</label><p class="muted">${t.directionHint}</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="person"> ${t.person}</label><p class="muted">${t.personHint}</p></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="solve"> ${t.solve}</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="clarify"> ${t.clarify}</label></div>
        <div class="action"><label><input style="width:auto" type="radio" name="action" value="pass"> ${t.pass}</label></div>
        <div class="field"><label>${t.comment}</label><textarea name="note" placeholder="${esc(t.commentPh)}"></textarea></div>
        <div class="field"><label>${t.contact}</label><input name="contact" placeholder="${esc(t.contactPh)}"></div>
        <button type="submit">${t.send}</button>
      </form><p class="muted">${t.noReg}</p>
    </div>`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }

    if (request.method === "GET") {
      const cardMatch = url.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)$/);
      if (cardMatch) {
        const response = await renderMcpCard(request, env, cardMatch[1]);
        if (response) return response;
      }
    }

    return webApp.fetch(request, env, ctx);
  },
};
