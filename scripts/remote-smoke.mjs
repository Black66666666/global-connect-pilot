import { execFileSync } from "node:child_process";

const baseUrl = process.env.GC_BASE_URL || "https://global-connect-pilot.biv-ai-lab.workers.dev";
const expectedVersion = process.env.GC_EXPECTED_VERSION || "0.4.0";
const expectedChallenge = process.env.GC_OPENAI_CHALLENGE || "VONqdSiuFsgS9E6jBPmEa290-C_0eIsRoiOQGpr1An4";
const attempts = Number(process.env.GC_REMOTE_ATTEMPTS || 24);
const delayMs = Number(process.env.GC_REMOTE_DELAY_MS || 10000);
const smokeAttempts = Number(process.env.GC_MCP_SMOKE_ATTEMPTS || 5);
const smokeDelayMs = Number(process.env.GC_MCP_SMOKE_DELAY_MS || 5000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVersion() {
  let last = "no response";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/mcp-health`, {
        headers: { "cache-control": "no-cache" }
      });
      const text = await response.text();
      last = `${response.status} ${text}`;
      if (response.ok) {
        const data = JSON.parse(text);
        if (data.ok === true && data.version === expectedVersion) {
          console.log(`Deployed version ${expectedVersion} is ready on attempt ${attempt}.`);
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
  const url = `${baseUrl}/.well-known/openai-apps-challenge`;
  const response = await fetch(url, {
    headers: { "cache-control": "no-cache" },
    redirect: "manual"
  });
  const text = await response.text();
  console.log(`OpenAI challenge endpoint: HTTP ${response.status}; body=${JSON.stringify(text)}`);
  if (response.status !== 200) {
    throw new Error(`OpenAI challenge endpoint returned HTTP ${response.status}`);
  }
  if (text !== expectedChallenge) {
    throw new Error(`OpenAI challenge token mismatch. Expected ${JSON.stringify(expectedChallenge)}, got ${JSON.stringify(text)}`);
  }
  console.log("OpenAI domain challenge: PASS");
}

async function runMcpSmoke() {
  let lastError = null;
  for (let attempt = 1; attempt <= smokeAttempts; attempt += 1) {
    try {
      execFileSync("npm", ["run", "smoke:mcp"], {
        stdio: "inherit",
        env: {
          ...process.env,
          MCP_URL: `${baseUrl}/mcp`,
          MCP_TEST_PUBLIC_CREATE: process.env.MCP_TEST_PUBLIC_CREATE || "0"
        }
      });
      console.log(`Deployed Global Connect MCP smoke: PASS on attempt ${attempt}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Deployed MCP smoke attempt ${attempt}/${smokeAttempts}: FAIL`);
      if (attempt < smokeAttempts) await sleep(smokeDelayMs);
    }
  }

  throw lastError || new Error("Deployed MCP smoke failed");
}

await waitForVersion();
await verifyOpenAiChallenge();
await runMcpSmoke();
