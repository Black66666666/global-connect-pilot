import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const publicUrl = process.env.MCP_URL || "https://global-connect-pilot.biv-ai-lab.workers.dev/mcp";
const writeUrl = process.env.MCP_WRITE_URL || "";
const testPublicCreate = process.env.MCP_TEST_PUBLIC_CREATE === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function connect(url, name) {
  const client = new Client({ name, version: "0.3.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return client;
}

async function main() {
  console.log(`MCP public smoke: ${publicUrl}`);
  const client = await connect(publicUrl, "global-connect-smoke-read");

  const version = client.getServerVersion();
  console.log("Server:", version);
  assert(version?.name === "global-connect", "Unexpected MCP server name");

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  console.log("Public tools:", toolNames.join(", "));

  for (const required of ["list_requests", "get_request", "get_request_stats", "list_routes", "draft_request", "create_request"]) {
    assert(toolNames.includes(required), `Missing public tool: ${required}`);
  }
  assert(!toolNames.includes("register_route"), "register_route must not be exposed on anonymous MCP URL");

  const request = await client.callTool({ name: "get_request", arguments: { id: "berlin70s1" } });
  assert(!request.isError, "get_request failed for berlin70s1");

  const routes = await client.callTool({ name: "list_routes", arguments: { id: "berlin70s1" } });
  assert(!routes.isError, "list_routes failed for berlin70s1");
  const routeData = routes.structuredContent;
  assert(Array.isArray(routeData?.routes), "list_routes did not return routes");
  assert(routeData.routes.length >= 6, "berlin70s1 must expose the six seeded distribution routes");

  const stats = await client.callTool({ name: "get_request_stats", arguments: { id: "berlin70s1" } });
  assert(!stats.isError, "get_request_stats failed for berlin70s1");
  const statData = stats.structuredContent;
  assert(Number(statData?.totals?.sent || 0) >= 6, "berlin70s1 must report at least six sent routes");

  console.log("Read smoke: PASS");

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
  assert(adminNames.includes("create_request"), "Missing create_request tool on admin MCP URL");
  assert(adminNames.includes("register_route"), "Missing protected register_route tool");

  console.log("Admin smoke: PASS");
  await writer.close();
}

main().catch((error) => {
  console.error("MCP smoke: FAIL");
  console.error(error);
  process.exit(1);
});
