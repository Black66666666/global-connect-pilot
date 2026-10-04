const UPSTREAM = "https://global-connect-pilot.biv-ai-lab.workers.dev";
const OPENAI_CHALLENGE_TOKEN = "gt8yqWFuuBumU8UBQ1EoSHsZAo8e4cqeU5sruHohKh8";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/.well-known/openai-apps-challenge") {
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

    const target = new URL(incoming.pathname + incoming.search, UPSTREAM);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const response = await fetch(new Request(target.toString(), init));
    const outHeaders = new Headers(response.headers);
    outHeaders.set("x-global-connect-gateway", "cloudflare-pages");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    });
  },
};
