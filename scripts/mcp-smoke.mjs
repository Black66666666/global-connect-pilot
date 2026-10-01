import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const publicUrl = process.env.MCP_URL || "https://global-connect-pilot.biv-ai-lab.workers.dev/mcp";
const writeUrl = process.env.MCP_WRITE_URL || "";
const testPublicCreate = process.env.MCP_TEST_PUBLIC_CREATE === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function connect(url, name) {
  const client = new Client({ name, version: "0.3.1" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return client;
}

async function main() {
  console.log(`MCP public smoke: ${publicUrl}`);
  const client = await connect(publicUrl, "global-connect-smoke-public");

  const version = client.getServerVersion();
  console.log("Server:", version);
  assert(version?.name === "global-connect", "Unexpected MCP server name");

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  console.log("Public tools:", toolNames.join(", "));

  for (const required of ["get_request", "get_request_stats", "draft_request", "create_request"]) {
    assert(toolNames.includes(required), `Missing public tool: ${required}`);
  }
  for (const forbidden of ["list_requests", "list_routes", "register_route"]) {
    assert(!toolNames.includes(forbidden), `${forbidden} must not be exposed on anonymous MCP URL`);
  }

  const request = await client.callTool({ name: "get_request", arguments: { id: "berlin70s1" } });
  assert(!request.isError, "get_request failed for berlin70s1");

  const stats = await client.callTool({ name: "get_request_stats", arguments: { id: "berlin70s1" } });
  assert(!stats.isError, "get_request_stats failed for berlin70s1");
  const statData = stats.structuredContent;
  assert(Number(statData?.totals?.sent || 0) >= 6, "berlin70s1 must report at least six sent routes");
  assert(!("routes" in (statData || {})), "Public statistics must not expose the route ledger");

  console.log("Public read smoke: PASS");

  if (testPublicCreate) {
    const created = await client.callTool({
      name: "create_request",
      arguments: {
        goal: "Public MCP smoke-test request — safe to delete",
        deadline: "1 day",
        budget: "0",
        constraints: "Technical smoke test only",
        success_criteria: "Public create_request returns a public card URL",
        attention_budget: 0,
        language: "en"
      }
    });
    assert(!created.isError, "public create_request smoke failed");
    assert(created.structuredContent?.id, "public create_request did not return an ID");
    console.log("Public create smoke: PASS", created.structuredContent.public_url);
  } else {
    console.log("Public create smoke: SKIPPED (set MCP_TEST_PUBLIC_CREATE=1 explicitly to create a test card)");
  }

  await client.close();

  if (!writeUrl) {
    console.log("Admin smoke: SKIPPED (set MCP_WRITE_URL explicitly to test operator-only tools)");
    return;
  }

  console.log(`MCP admin smoke: ${writeUrl.replace(/key=[^&]+/i, "key=***")}`);
  const writer = await connect(writeUrl, "global-connect-smoke-admin");
  const adminTools = await writer.listTools();
  const adminNames = adminTools.tools.map((tool) => tool.name);
  for (const required of ["create_request", "list_requests", "list_routes", "register_route"]) {
    assert(adminNames.includes(required), `Missing admin tool: ${required}`);
  }

  const routes = await writer.callTool({ name: "list_routes", arguments: { id: "berlin70s1" } });
  assert(!routes.isError, "admin list_routes failed for berlin70s1");
  assert(Array.isArray(routes.structuredContent?.routes), "admin list_routes did not return routes");
  assert(routes.structuredContent.routes.length >= 6, "admin route ledger must contain the six seeded routes");

  console.log("Admin smoke: PASS");
  await writer.close();
}

main().catch((error) => {
  console.error("MCP smoke: FAIL");
  console.error(error);
  process.exit(1);
});
