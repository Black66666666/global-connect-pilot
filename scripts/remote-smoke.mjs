import { execFileSync } from "node:child_process";

const baseUrl = process.env.GC_BASE_URL || "https://global-connect-pilot.biv-ai-lab.workers.dev";
const expectedVersion = process.env.GC_EXPECTED_VERSION || "0.3.1";
const attempts = Number(process.env.GC_REMOTE_ATTEMPTS || 24);
const delayMs = Number(process.env.GC_REMOTE_DELAY_MS || 10000);

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

await waitForVersion();

execFileSync("npm", ["run", "smoke:mcp"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MCP_URL: `${baseUrl}/mcp`,
    MCP_TEST_PUBLIC_CREATE: process.env.MCP_TEST_PUBLIC_CREATE || "0"
  }
});

console.log("Deployed Global Connect MCP smoke: PASS");
