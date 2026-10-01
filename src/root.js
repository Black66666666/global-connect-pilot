import webApp from "./worker.js";
import { handleMcp, ensurePilotRoutingData } from "./mcp.js";

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
*{box-sizing:border-box}body{margin:0}.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.05);margin:16px 0}h1{font-size:30px;margin:0 0 10px}h2{font-size:20px}.muted{color:#71717a}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f4f4f5;margin:3px 4px 3px 0;font-size:13px}.field{margin:14px 0}label{display:block;font-size:14px;font-weight:650;margin-bottom:6px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit}textarea{min-height:96px;resize:vertical}button,.button{display:inline-block;border:0;border-radius:10px;background:#18181b;color:#fff;padding:11px 14px;font-weight:650;cursor:pointer;text-decoration:none}.action{border-top:1px solid #eee;padding-top:16px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0}ul{line-height:1.55}@media(max-width:620px){h1{font-size:25px}}
`;

function htmlPage(lang, title, body) {
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="wrap">${body}</main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function publicInfoPage(kind) {
  const updated = "2026-10-01";
  if (kind === "plugin") {
    return htmlPage("en", "Global Connect", `
      <div class="card"><h1>Global Connect</h1>
      <p>Global Connect turns a real human request into a portable card and measures how that request moves through people, communities and connected services.</p>
      <p>The current pilot records distribution routes, card opens and response types. It does not require recipients to create an account.</p>
      <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></p>
      </div>`);
  }
  if (kind === "privacy") {
    return htmlPage("en", "Global Connect Privacy Policy", `
      <div class="card"><h1>Privacy Policy</h1><p class="muted">Last updated ${updated}</p>
      <p>Global Connect is an experimental request-routing service.</p>
      <h2>Data we collect</h2><ul>
        <li>Request-card content supplied by the request creator.</li>
        <li>Anonymous route references used to measure whether a shared card was opened or answered.</li>
        <li>Response text and an optional contact field when a recipient voluntarily submits them.</li>
        <li>Operational logs produced by the hosting platform.</li>
      </ul>
      <h2>How we use data</h2><p>Data is used only to operate the request, measure routing outcomes, prevent abuse, and improve the pilot.</p>
      <h2>Data minimization</h2><p>Distribution routes store non-sensitive labels rather than recipient email addresses. Public MCP tools return aggregate routing information and do not return private response text or contact fields.</p>
      <h2>Sharing</h2><p>Request cards are public to anyone who has their link. We do not sell personal data. Hosting and connected delivery services process data only as needed to provide their services.</p>
      <h2>Retention and controls</h2><p>Pilot data is retained while the experiment is active or until removal is requested. For removal or questions, use the support page.</p>
      </div>`);
  }
  if (kind === "terms") {
    return htmlPage("en", "Global Connect Terms", `
      <div class="card"><h1>Terms of Service</h1><p class="muted">Last updated ${updated}</p>
      <p>Global Connect is an experimental service provided without a guarantee that a request will receive a response or reach a successful outcome.</p>
      <ul>
        <li>Only submit information you are allowed to share.</li>
        <li>Do not publish another person's private contact details without permission.</li>
        <li>Do not use the service for unlawful, deceptive, harassing, dangerous or abusive requests.</li>
        <li>Recipients choose voluntarily whether to respond, ignore, or pass a request onward.</li>
        <li>External communities and services retain their own rules and terms.</li>
      </ul>
      <p>Features, limits and data structures may change during the pilot.</p>
      </div>`);
  }
  return htmlPage("en", "Global Connect Support", `
    <div class="card"><h1>Support</h1>
    <p>For pilot support, privacy requests, abuse reports, or deletion requests, contact:</p>
    <p><b>globalconnect-pilot@agentmail.to</b></p>
    <p>Include the request-card ID when your question concerns a specific card. Do not send passwords or authentication tokens.</p>
    </div>`);
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
    await ensurePilotRoutingData(env);
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return handleMcp(request, env);
    }
    if (url.pathname === "/plugin") return publicInfoPage("plugin");
    if (url.pathname === "/privacy") return publicInfoPage("privacy");
    if (url.pathname === "/terms") return publicInfoPage("terms");
    if (url.pathname === "/support") return publicInfoPage("support");
    if (url.pathname === "/mcp-health") {
      return Response.json({ ok: true, service: "global-connect-mcp", version: "0.2.0" });
    }
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_APPS_CHALLENGE) return new Response("Not configured", { status: 404 });
      return new Response(String(env.OPENAI_APPS_CHALLENGE), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
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
