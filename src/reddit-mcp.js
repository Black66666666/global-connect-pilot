import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const CONNECTOR_VERSION = "0.5.0";
const OAUTH_CLIENT_ID = "global-connect-chatgpt";
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;
const AUTH_CODE_TTL_SECONDS = 300;
const PENDING_TTL_SECONDS = 600;
const REDDIT_SCOPES = "identity read submit";
const INTERNAL_SCOPES = ["reddit.identity", "reddit.read", "reddit.write"];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function html(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 18px;color:#18181b}code{background:#f4f4f5;padding:2px 5px;border-radius:5px}.card{border:1px solid #e4e4e7;border-radius:16px;padding:22px}.muted{color:#71717a}</style></head><body><div class="card">${body}</div></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function oauthToolError(origin, description = "Connect your Reddit account to continue.") {
  const metadata = `${origin}/.well-known/oauth-protected-resource`;
  return {
    content: [{ type: "text", text: description }],
    structuredContent: { error: "authentication_required", message: description },
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${metadata}", error="invalid_token", error_description="${description.replaceAll('"', "'")}"`,
      ],
    },
    isError: true,
  };
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return base64Url(new Uint8Array(digest));
}

async function importEncryptionKey(env) {
  if (!env.REDDIT_TOKEN_KEY) {
    throw new Error("REDDIT_TOKEN_KEY is not configured");
  }
  const raw = fromBase64Url(env.REDDIT_TOKEN_KEY);
  if (raw.byteLength !== 32) {
    throw new Error("REDDIT_TOKEN_KEY must decode to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env, plaintext) {
  const key = await importEncryptionKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(String(plaintext)),
  );
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(env, payload) {
  const [ivPart, cipherPart] = String(payload || "").split(".");
  if (!ivPart || !cipherPart) throw new Error("Encrypted token is malformed");
  const key = await importEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivPart) },
    key,
    fromBase64Url(cipherPart),
  );
  return new TextDecoder().decode(plaintext);
}

async function ensureRedditSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reddit_oauth_pending (
      state_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      client_state TEXT,
      code_challenge TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reddit_accounts (
      account_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      reddit_user_id TEXT,
      refresh_token_enc TEXT NOT NULL,
      access_token_enc TEXT,
      access_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS connector_auth_codes (
      code_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS connector_tokens (
      access_hash TEXT PRIMARY KEY,
      refresh_hash TEXT UNIQUE NOT NULL,
      account_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT,
      access_expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_connector_tokens_account ON connector_tokens(account_id)"),
  ]);

  const cutoff = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reddit_oauth_pending WHERE created_at < ?").bind(cutoff - PENDING_TTL_SECONDS),
    env.DB.prepare("DELETE FROM connector_auth_codes WHERE expires_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM connector_tokens WHERE refresh_expires_at < ?").bind(cutoff),
  ]);
}

const PUBLIC_ORIGIN = "https://global-connect.specforge.ru";

function originFromRequest(_request) {
  return PUBLIC_ORIGIN;
}

function isAllowedChatGptRedirect(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return false;
    return url.pathname === "/connector_platform_oauth_redirect" || url.pathname.startsWith("/connector/oauth/");
  } catch {
    return false;
  }
}

function oauthConfigurationError() {
  return html(
    "Reddit connector configuration required",
    "<h1>Reddit connector is not configured yet</h1><p>The connector needs its Reddit Data API client credentials before account linking can start.</p><p class=\"muted\">Required server variables: <code>REDDIT_CLIENT_ID</code>, <code>REDDIT_CLIENT_SECRET</code>, and <code>REDDIT_TOKEN_KEY</code>.</p>",
    503,
  );
}

async function handleAuthorize(request, env) {
  await ensureRedditSchema(env);
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET || !env.REDDIT_TOKEN_KEY) {
    return oauthConfigurationError();
  }

  const url = new URL(request.url);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const clientState = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const requestedScope = url.searchParams.get("scope") || INTERNAL_SCOPES.join(" ");
  const requestedScopes = [...new Set(requestedScope.split(/\s+/).filter(Boolean))];
  const unsupportedScopes = requestedScopes.filter((scope) => !INTERNAL_SCOPES.includes(scope));
  if (unsupportedScopes.length) {
    return json({ error: "invalid_scope", error_description: `Unsupported scopes: ${unsupportedScopes.join(", ")}` }, 400);
  }
  const scope = requestedScopes.join(" ");
  const resource = url.searchParams.get("resource") || originFromRequest(request);

  if (responseType !== "code") return json({ error: "unsupported_response_type" }, 400);
  if (clientId !== OAUTH_CLIENT_ID) return json({ error: "unauthorized_client" }, 400);
  if (!redirectUri || !isAllowedChatGptRedirect(redirectUri)) return json({ error: "invalid_redirect_uri" }, 400);
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return json({ error: "invalid_request", error_description: "PKCE S256 is required" }, 400);
  }

  const origin = originFromRequest(request);
  if (resource !== origin && resource !== `${origin}/mcp`) {
    return json({ error: "invalid_target", error_description: "Unexpected OAuth resource" }, 400);
  }

  const redditState = randomToken(24);
  const stateHash = await sha256(redditState);
  await env.DB.prepare(`INSERT INTO reddit_oauth_pending(
    state_hash,client_id,redirect_uri,client_state,code_challenge,scope,resource,created_at
  ) VALUES(?,?,?,?,?,?,?,?)`).bind(
    stateHash,
    clientId,
    redirectUri,
    clientState,
    codeChallenge,
    scope,
    resource,
    nowSeconds(),
  ).run();

  const reddit = new URL("https://www.reddit.com/api/v1/authorize");
  reddit.searchParams.set("client_id", env.REDDIT_CLIENT_ID);
  reddit.searchParams.set("response_type", "code");
  reddit.searchParams.set("state", redditState);
  reddit.searchParams.set("redirect_uri", `${origin}/oauth/reddit/callback`);
  reddit.searchParams.set("duration", "permanent");
  reddit.searchParams.set("scope", REDDIT_SCOPES);

  return Response.redirect(reddit.toString(), 302);
}

function basicAuth(clientId, clientSecret) {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function exchangeRedditCode(env, origin, code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${origin}/oauth/reddit/callback`,
  });
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: basicAuth(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": env.REDDIT_USER_AGENT || `GlobalConnectReddit/${CONNECTOR_VERSION}`,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Reddit token exchange failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  if (!data.refresh_token) {
    throw new Error("Reddit did not return a refresh token. Permanent authorization is required.");
  }
  return data;
}

async function redditRawFetch(accessToken, path, options = {}, env = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("user-agent", env.REDDIT_USER_AGENT || `GlobalConnectReddit/${CONNECTOR_VERSION}`);
  return fetch(`https://oauth.reddit.com${path}`, { ...options, headers });
}

async function getRedditIdentity(accessToken, env) {
  const response = await redditRawFetch(accessToken, "/api/v1/me", {}, env);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.name) {
    throw new Error(`Unable to read Reddit identity: HTTP ${response.status}`);
  }
  return data;
}

async function handleRedditCallback(request, env) {
  await ensureRedditSchema(env);
  const origin = originFromRequest(request);
  const url = new URL(request.url);
  const redditState = url.searchParams.get("state") || "";
  const stateHash = await sha256(redditState);
  const pending = await env.DB.prepare("SELECT * FROM reddit_oauth_pending WHERE state_hash=? LIMIT 1").bind(stateHash).first();

  if (!pending || pending.created_at < nowSeconds() - PENDING_TTL_SECONDS) {
    return html("Authorization expired", "<h1>Authorization expired</h1><p>Return to ChatGPT and connect Reddit again.</p>", 400);
  }

  const redirect = new URL(pending.redirect_uri);
  const redditError = url.searchParams.get("error");
  if (redditError) {
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", redditError);
    if (pending.client_state) redirect.searchParams.set("state", pending.client_state);
    await env.DB.prepare("DELETE FROM reddit_oauth_pending WHERE state_hash=?").bind(stateHash).run();
    return Response.redirect(redirect.toString(), 302);
  }

  const code = url.searchParams.get("code");
  if (!code) return html("Authorization failed", "<h1>Authorization failed</h1><p>Reddit did not return an authorization code.</p>", 400);

  try {
    const redditTokens = await exchangeRedditCode(env, origin, code);
    const identity = await getRedditIdentity(redditTokens.access_token, env);
    const accountId = randomToken(18);
    const current = nowSeconds();

    await env.DB.prepare(`INSERT INTO reddit_accounts(
      account_id,username,reddit_user_id,refresh_token_enc,access_token_enc,access_expires_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).bind(
      accountId,
      identity.name,
      identity.id || null,
      await encryptSecret(env, redditTokens.refresh_token),
      await encryptSecret(env, redditTokens.access_token),
      current + Number(redditTokens.expires_in || 3600),
      current,
      current,
    ).run();

    const connectorCode = randomToken(32);
    await env.DB.prepare(`INSERT INTO connector_auth_codes(
      code_hash,account_id,client_id,redirect_uri,code_challenge,scope,resource,expires_at
    ) VALUES(?,?,?,?,?,?,?,?)`).bind(
      await sha256(connectorCode),
      accountId,
      pending.client_id,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      current + AUTH_CODE_TTL_SECONDS,
    ).run();

    await env.DB.prepare("DELETE FROM reddit_oauth_pending WHERE state_hash=?").bind(stateHash).run();

    redirect.searchParams.set("code", connectorCode);
    if (pending.client_state) redirect.searchParams.set("state", pending.client_state);
    return Response.redirect(redirect.toString(), 302);
  } catch (error) {
    console.error("Reddit OAuth callback failed", error);
    return html("Reddit authorization failed", `<h1>Reddit authorization failed</h1><p>${escapeHtml(error?.message || error)}</p>`, 502);
  }
}

async function verifyPkce(verifier, expectedChallenge) {
  if (!verifier) return false;
  return (await sha256(verifier)) === expectedChallenge;
}

async function issueConnectorTokens(env, record) {
  const current = nowSeconds();
  const accessToken = randomToken(32);
  const refreshToken = randomToken(40);
  await env.DB.prepare(`INSERT INTO connector_tokens(
    access_hash,refresh_hash,account_id,client_id,scope,resource,access_expires_at,refresh_expires_at,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).bind(
    await sha256(accessToken),
    await sha256(refreshToken),
    record.account_id,
    record.client_id,
    record.scope,
    record.resource,
    current + ACCESS_TOKEN_TTL_SECONDS,
    current + REFRESH_TOKEN_TTL_SECONDS,
    current,
  ).run();
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: record.scope,
  };
}

async function handleToken(request, env) {
  await ensureRedditSchema(env);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });

  const form = await request.formData();
  const grantType = String(form.get("grant_type") || "");
  const clientId = String(form.get("client_id") || "");
  if (clientId !== OAUTH_CLIENT_ID) return json({ error: "invalid_client" }, 401);

  if (grantType === "authorization_code") {
    const code = String(form.get("code") || "");
    const redirectUri = String(form.get("redirect_uri") || "");
    const codeVerifier = String(form.get("code_verifier") || "");
    const tokenResource = String(form.get("resource") || "");
    const record = await env.DB.prepare("SELECT * FROM connector_auth_codes WHERE code_hash=? LIMIT 1").bind(await sha256(code)).first();

    if (!record || record.expires_at < nowSeconds()) return json({ error: "invalid_grant" }, 400);
    if (record.redirect_uri !== redirectUri || record.client_id !== clientId) return json({ error: "invalid_grant" }, 400);
    if (tokenResource && tokenResource !== record.resource) return json({ error: "invalid_target", error_description: "OAuth resource mismatch" }, 400);
    if (!(await verifyPkce(codeVerifier, record.code_challenge))) return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);

    await env.DB.prepare("DELETE FROM connector_auth_codes WHERE code_hash=?").bind(await sha256(code)).run();
    return json(await issueConnectorTokens(env, record), 200, { "cache-control": "no-store" });
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") || "");
    const refreshHash = await sha256(refreshToken);
    const record = await env.DB.prepare("SELECT * FROM connector_tokens WHERE refresh_hash=? LIMIT 1").bind(refreshHash).first();
    if (!record || record.refresh_expires_at < nowSeconds() || record.client_id !== clientId) {
      return json({ error: "invalid_grant" }, 400);
    }

    await env.DB.prepare("DELETE FROM connector_tokens WHERE refresh_hash=?").bind(refreshHash).run();
    return json(await issueConnectorTokens(env, record), 200, { "cache-control": "no-store" });
  }

  return json({ error: "unsupported_grant_type" }, 400);
}

function protectedResourceMetadata(request) {
  const origin = originFromRequest(request);
  return json({
    resource: origin,
    authorization_servers: [origin],
    scopes_supported: INTERNAL_SCOPES,
    resource_documentation: `${origin}/reddit-plugin`,
    resource_policy_uri: `${origin}/reddit-privacy`,
    resource_tos_uri: `${origin}/reddit-terms`,
  }, 200, { "cache-control": "public, max-age=300" });
}

function authorizationServerMetadata(request) {
  const origin = originFromRequest(request);
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: INTERNAL_SCOPES,
  }, 200, { "cache-control": "public, max-age=300" });
}

async function authenticateConnectorRequest(request, env) {
  await ensureRedditSchema(env);
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const tokenHash = await sha256(match[1]);
  const record = await env.DB.prepare(`SELECT t.*,a.username,a.reddit_user_id
    FROM connector_tokens t JOIN reddit_accounts a ON a.account_id=t.account_id
    WHERE t.access_hash=? LIMIT 1`).bind(tokenHash).first();
  if (!record || record.access_expires_at < nowSeconds()) return null;
  if (record.resource && record.resource !== PUBLIC_ORIGIN && record.resource !== `${PUBLIC_ORIGIN}/mcp`) return null;
  return record;
}

function authChallenge(request) {
  const origin = originFromRequest(request);
  return new Response("OAuth authentication required", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${INTERNAL_SCOPES.join(" ")}"`,
      "cache-control": "no-store",
    },
  });
}

async function refreshRedditAccessToken(env, account) {
  const refreshToken = await decryptSecret(env, account.refresh_token_enc);
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: basicAuth(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": env.REDDIT_USER_AGENT || `GlobalConnectReddit/${CONNECTOR_VERSION}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Reddit refresh failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }

  const current = nowSeconds();
  const encrypted = await encryptSecret(env, data.access_token);
  await env.DB.prepare("UPDATE reddit_accounts SET access_token_enc=?,access_expires_at=?,updated_at=? WHERE account_id=?")
    .bind(encrypted, current + Number(data.expires_in || 3600), current, account.account_id).run();
  return data.access_token;
}

async function getRedditAccessToken(env, accountId, forceRefresh = false) {
  const account = await env.DB.prepare("SELECT * FROM reddit_accounts WHERE account_id=? LIMIT 1").bind(accountId).first();
  if (!account) throw new Error("Connected Reddit account no longer exists");
  if (!forceRefresh && account.access_token_enc && Number(account.access_expires_at || 0) > nowSeconds() + 60) {
    return decryptSecret(env, account.access_token_enc);
  }
  return refreshRedditAccessToken(env, account);
}

async function redditFetch(env, accountId, path, options = {}) {
  let accessToken = await getRedditAccessToken(env, accountId);
  let response = await redditRawFetch(accessToken, path, options, env);
  if (response.status === 401) {
    accessToken = await getRedditAccessToken(env, accountId, true);
    response = await redditRawFetch(accessToken, path, options, env);
  }
  return response;
}

function normalizePostId(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:comments\/|t3_)?([a-z0-9]+)(?:\/|$)/i);
  return match ? match[1] : raw.replace(/^t3_/, "");
}

function validSubreddit(value) {
  return /^[A-Za-z0-9_]{2,21}$/.test(String(value || ""));
}

function summarizePost(data) {
  return {
    id: data.id,
    fullname: data.name,
    title: data.title,
    subreddit: data.subreddit,
    author: data.author,
    permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
    url: data.url,
    selftext: String(data.selftext || "").slice(0, 4000),
    score: Number(data.score || 0),
    num_comments: Number(data.num_comments || 0),
    created_utc: data.created_utc,
    over_18: Boolean(data.over_18),
    locked: Boolean(data.locked),
    archived: Boolean(data.archived),
  };
}

function flattenComments(children, limit, output = [], depth = 0) {
  for (const child of children || []) {
    if (output.length >= limit) break;
    if (child.kind !== "t1" || !child.data) continue;
    const data = child.data;
    output.push({
      id: data.id,
      fullname: data.name,
      parent_fullname: data.parent_id,
      author: data.author,
      body: String(data.body || "").slice(0, 5000),
      score: Number(data.score || 0),
      created_utc: data.created_utc,
      depth,
      permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : null,
    });
    const replies = data.replies?.data?.children;
    if (Array.isArray(replies)) flattenComments(replies, limit, output, depth + 1);
  }
  return output;
}

async function parseRedditJson(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Reddit API HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function redditWriteError(data) {
  const errors = data?.json?.errors;
  if (Array.isArray(errors) && errors.length) {
    return errors.map((item) => Array.isArray(item) ? item.join(": ") : String(item)).join("; ");
  }
  return null;
}

function hasScope(auth, scope) {
  return String(auth?.scope || "").split(/\s+/).includes(scope);
}

function requireScope(auth, scope) {
  if (hasScope(auth, scope)) return null;
  return errorResult("insufficient_scope", `This action requires the ${scope} scope.`, { required_scope: scope });
}

function createRedditServer(env, request, auth) {
  const origin = originFromRequest(request);
  const server = new McpServer(
    { name: "global-connect-reddit", version: CONNECTOR_VERSION },
    {
      instructions:
        "This connector lets the authenticated user search, read, post, and reply on Reddit using their own Reddit account. Never claim to have posted unless the Reddit API confirms success. Never publish or reply unless the user explicitly asked for that exact external action. Respect subreddit rules and do not expose OAuth tokens.",
    },
  );

  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  };

  server.registerTool(
    "reddit_me",
    {
      title: "Get the connected Reddit account",
      description: "Use this to confirm which Reddit account is currently connected before reading or writing as that user.",
      inputSchema: z.object({}),
      annotations: readAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.identity"] }],
      _meta: { "openai/profile": true },
    },
    async () => {
      const scopeError = requireScope(auth, "reddit.identity");
      if (scopeError) return scopeError;
      try {
        const response = await redditFetch(env, auth.account_id, "/api/v1/me");
        const data = await parseRedditJson(response);
        return jsonResult({
          username: data.name,
          reddit_user_id: data.id,
          link_karma: Number(data.link_karma || 0),
          comment_karma: Number(data.comment_karma || 0),
          total_karma: Number(data.total_karma || 0),
          created_utc: data.created_utc,
          profile_url: `https://www.reddit.com/user/${encodeURIComponent(data.name)}`,
        });
      } catch (error) {
        return errorResult("reddit_identity_failed", error?.message || String(error));
      }
    },
  );

  server.registerTool(
    "reddit_search_posts",
    {
      title: "Search Reddit posts",
      description: "Search public Reddit posts globally or inside one subreddit. Use this for finding relevant threads; it does not search private messages or private user data.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        subreddit: z.string().max(30).optional(),
        sort: z.enum(["relevance", "hot", "top", "new", "comments"]).default("relevance"),
        time: z.enum(["hour", "day", "week", "month", "year", "all"]).default("all"),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: readAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.read"] }],
    },
    async ({ query, subreddit, sort, time, limit }) => {
      const scopeError = requireScope(auth, "reddit.read");
      if (scopeError) return scopeError;
      try {
        if (subreddit && !validSubreddit(subreddit)) {
          return errorResult("invalid_subreddit", "Subreddit names may contain only letters, numbers, and underscores.");
        }
        const params = new URLSearchParams({
          q: query,
          sort,
          t: time,
          limit: String(limit),
          raw_json: "1",
          type: "link",
        });
        const path = subreddit
          ? `/r/${encodeURIComponent(subreddit)}/search.json?${params.toString()}&restrict_sr=on`
          : `/search.json?${params.toString()}`;
        const data = await parseRedditJson(await redditFetch(env, auth.account_id, path));
        const posts = (data?.data?.children || []).map((child) => summarizePost(child.data || {}));
        return jsonResult({ query, subreddit: subreddit || null, posts, after: data?.data?.after || null });
      } catch (error) {
        return errorResult("reddit_search_failed", error?.message || String(error));
      }
    },
  );

  server.registerTool(
    "reddit_get_post",
    {
      title: "Read one Reddit post",
      description: "Read a public Reddit post by its ID, fullname, or Reddit comments URL. Returns the post body and public metadata.",
      inputSchema: z.object({ post_id: z.string().min(1).max(500) }),
      annotations: readAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.read"] }],
    },
    async ({ post_id }) => {
      const scopeError = requireScope(auth, "reddit.read");
      if (scopeError) return scopeError;
      try {
        const id = normalizePostId(post_id);
        const data = await parseRedditJson(await redditFetch(env, auth.account_id, `/by_id/t3_${encodeURIComponent(id)}.json?raw_json=1`));
        const child = data?.data?.children?.[0];
        if (!child?.data) return errorResult("reddit_post_not_found", "No Reddit post was found for that ID.");
        return jsonResult({ post: summarizePost(child.data) });
      } catch (error) {
        return errorResult("reddit_post_failed", error?.message || String(error));
      }
    },
  );

  server.registerTool(
    "reddit_get_comments",
    {
      title: "Read comments from a Reddit thread",
      description: "Read public comments from a Reddit post. Use this to inspect the discussion before deciding whether a reply would be relevant.",
      inputSchema: z.object({
        post_id: z.string().min(1).max(500),
        sort: z.enum(["confidence", "top", "new", "controversial", "old", "qa"]).default("confidence"),
        limit: z.number().int().min(1).max(100).default(50),
        depth: z.number().int().min(1).max(10).default(5),
      }),
      annotations: readAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.read"] }],
    },
    async ({ post_id, sort, limit, depth }) => {
      const scopeError = requireScope(auth, "reddit.read");
      if (scopeError) return scopeError;
      try {
        const id = normalizePostId(post_id);
        const params = new URLSearchParams({ sort, limit: String(limit), depth: String(depth), raw_json: "1" });
        const data = await parseRedditJson(await redditFetch(env, auth.account_id, `/comments/${encodeURIComponent(id)}.json?${params.toString()}`));
        const postData = data?.[0]?.data?.children?.[0]?.data;
        const comments = flattenComments(data?.[1]?.data?.children || [], limit);
        return jsonResult({
          post: postData ? summarizePost(postData) : null,
          comments,
          comment_count_returned: comments.length,
        });
      } catch (error) {
        return errorResult("reddit_comments_failed", error?.message || String(error));
      }
    },
  );

  server.registerTool(
    "reddit_create_post",
    {
      title: "Create a Reddit post",
      description: "Publish a text or link post to a subreddit using the connected Reddit account. Call this only after the user explicitly asks to publish the exact post; drafting or discussing a possible post is not consent to publish.",
      inputSchema: z.object({
        subreddit: z.string().min(2).max(21),
        title: z.string().min(1).max(300),
        kind: z.enum(["self", "link"]).default("self"),
        text: z.string().max(40000).optional().default(""),
        url: z.string().url().optional(),
        nsfw: z.boolean().default(false),
        spoiler: z.boolean().default(false),
      }),
      annotations: writeAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.write"] }],
    },
    async ({ subreddit, title, kind, text, url, nsfw, spoiler }) => {
      const scopeError = requireScope(auth, "reddit.write");
      if (scopeError) return scopeError;
      try {
        if (!validSubreddit(subreddit)) return errorResult("invalid_subreddit", "Invalid subreddit name.");
        if (kind === "link" && !url) return errorResult("missing_url", "A URL is required for a link post.");
        const form = new URLSearchParams({
          api_type: "json",
          sr: subreddit,
          kind,
          title,
          raw_json: "1",
          resubmit: "true",
          sendreplies: "true",
          nsfw: nsfw ? "true" : "false",
          spoiler: spoiler ? "true" : "false",
        });
        if (kind === "self") form.set("text", text || "");
        if (kind === "link") form.set("url", url);

        const response = await redditFetch(env, auth.account_id, "/api/submit", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
        });
        const data = await parseRedditJson(response);
        const apiError = redditWriteError(data);
        if (apiError) return errorResult("reddit_submit_rejected", apiError, { reddit_errors: data.json.errors });

        return jsonResult({
          posted: true,
          fullname: data?.json?.data?.name || null,
          post_id: data?.json?.data?.id || null,
          url: data?.json?.data?.url || null,
          subreddit,
          title,
        });
      } catch (error) {
        return errorResult("reddit_submit_failed", error?.message || String(error));
      }
    },
  );

  server.registerTool(
    "reddit_reply",
    {
      title: "Reply on Reddit",
      description: "Publish a comment under a Reddit post or comment using the connected Reddit account. Call this only after the user explicitly asks to send that exact reply.",
      inputSchema: z.object({
        parent_fullname: z.string().regex(/^t[13]_[a-z0-9]+$/i),
        text: z.string().min(1).max(10000),
      }),
      annotations: writeAnnotations,
      securitySchemes: [{ type: "oauth2", scopes: ["reddit.write"] }],
    },
    async ({ parent_fullname, text }) => {
      const scopeError = requireScope(auth, "reddit.write");
      if (scopeError) return scopeError;
      try {
        const form = new URLSearchParams({
          api_type: "json",
          thing_id: parent_fullname,
          text,
          raw_json: "1",
        });
        const response = await redditFetch(env, auth.account_id, "/api/comment", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
        });
        const data = await parseRedditJson(response);
        const apiError = redditWriteError(data);
        if (apiError) return errorResult("reddit_reply_rejected", apiError, { reddit_errors: data.json.errors });
        const thing = data?.json?.data?.things?.[0]?.data || {};
        return jsonResult({
          posted: true,
          fullname: thing.name || null,
          comment_id: thing.id || null,
          parent_fullname,
          permalink: thing.permalink ? `https://www.reddit.com${thing.permalink}` : null,
        });
      } catch (error) {
        return errorResult("reddit_reply_failed", error?.message || String(error));
      }
    },
  );

  return server;
}

export async function handleRedditConnectorHttp(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/oauth-protected-resource") return protectedResourceMetadata(request);
  if (url.pathname === "/.well-known/oauth-authorization-server") return authorizationServerMetadata(request);
  if (url.pathname === "/oauth/authorize" && request.method === "GET") return handleAuthorize(request, env);
  if (url.pathname === "/oauth/reddit/callback" && request.method === "GET") return handleRedditCallback(request, env);
  if (url.pathname === "/oauth/token") return handleToken(request, env);
  return null;
}

export async function handleMcp(request, env) {
  const auth = await authenticateConnectorRequest(request, env);
  if (!auth) return authChallenge(request);
  const handler = createMcpHandler(() => createRedditServer(env, request, auth));
  return handler.fetch(request);
}

export const REDDIT_CONNECTOR_VERSION = CONNECTOR_VERSION;
