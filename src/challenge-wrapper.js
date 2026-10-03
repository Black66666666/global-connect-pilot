import app from "./root.js";

const SERVER_VERSION = "0.4.1";
const OPENAI_CHALLENGE_TOKEN = "VONqdSiuFsgS9E6jBPmEa290-C_0eIsRoiOQGpr1An4";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // OpenAI domain verification must not depend on D1 initialization, MCP setup,
    // environment variables, or any other application state.
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      const headers = new Headers({
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "pragma": "no-cache",
        "x-content-type-options": "nosniff",
      });

      if (request.method === "HEAD") {
        headers.set("content-length", String(new TextEncoder().encode(OPENAI_CHALLENGE_TOKEN).byteLength));
        return new Response(null, { status: 200, headers });
      }

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }

      return new Response(OPENAI_CHALLENGE_TOKEN, { status: 200, headers });
    }

    // Distinct deployment marker so CI cannot accept an older Worker revision.
    if (url.pathname === "/mcp-health") {
      return Response.json({ ok: true, service: "global-connect-mcp", version: SERVER_VERSION }, {
        headers: { "cache-control": "no-store" },
      });
    }

    return app.fetch(request, env, ctx);
  },
};
