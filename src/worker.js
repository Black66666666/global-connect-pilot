import app from "./index.js";

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

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, patchedEnvironment(env), ctx);
    return stripAdminTokenFromRedirect(request, response);
  },
};
