const baseUrl = process.env.GC_BASE_URL || "https://global-connect.specforge.ru";
const expectedVersion = process.env.GC_EXPECTED_VERSION || "0.5.0";
const expectedChallenge = process.env.GC_OPENAI_CHALLENGE || "gt8yqWFuuBumU8UBQlEoSHsZAo8e4cqeU5sruHohKh8";
const attempts = Number(process.env.GC_REMOTE_ATTEMPTS || 24);
const delayMs = Number(process.env.GC_REMOTE_DELAY_MS || 10000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVersion() {
  let last = "no response";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/mcp-health`, { headers: { "cache-control": "no-cache" } });
      const text = await response.text();
      last = `${response.status} ${text}`;
      if (response.ok) {
        const data = JSON.parse(text);
        if (data.ok === true && data.version === expectedVersion && data.service === "global-connect-reddit-mcp") {
          console.log(`Deployed Reddit connector ${expectedVersion} is ready on attempt ${attempt}.`);
          return;
        }
      }
    } catch (error) {
      last = String(error);
    }
    console.log(`Waiting for deployed ${expectedVersion}: attempt ${attempt}/${attempts}; last=${last}`);
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Deployed version ${expectedVersion} did not become ready. Last result: ${last}`);
}

async function verifyOpenAiChallenge() {
  const response = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`, {
    headers: { "cache-control": "no-cache" },
    redirect: "manual",
  });
  const text = await response.text();
  if (response.status !== 200 || text !== expectedChallenge) {
    throw new Error(`OpenAI challenge mismatch: HTTP ${response.status}; body=${JSON.stringify(text)}`);
  }
  console.log("OpenAI domain challenge: PASS");
}

async function verifyOAuthMetadata() {
  const resourceResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  const resource = await resourceResponse.json();
  if (!resourceResponse.ok || resource.resource !== baseUrl || !Array.isArray(resource.authorization_servers)) {
    throw new Error(`Protected resource metadata invalid: ${JSON.stringify(resource)}`);
  }

  const authResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  const auth = await authResponse.json();
  if (!authResponse.ok || auth.authorization_endpoint !== `${baseUrl}/oauth/authorize` || auth.token_endpoint !== `${baseUrl}/oauth/token`) {
    throw new Error(`Authorization server metadata invalid: ${JSON.stringify(auth)}`);
  }
  if (!auth.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("OAuth metadata does not advertise PKCE S256");
  }
  console.log("OAuth metadata: PASS");
}

async function verifyMcpRequiresOAuth() {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  const challenge = response.headers.get("www-authenticate") || "";
  if (response.status !== 401 || !challenge.includes("/.well-known/oauth-protected-resource")) {
    const text = await response.text();
    throw new Error(`Expected OAuth 401 from MCP; got HTTP ${response.status}; challenge=${challenge}; body=${text}`);
  }
  console.log("MCP OAuth protection: PASS");
}

await waitForVersion();
await verifyOpenAiChallenge();
await verifyOAuthMetadata();
await verifyMcpRequiresOAuth();
console.log("Remote Reddit connector smoke: PASS");
