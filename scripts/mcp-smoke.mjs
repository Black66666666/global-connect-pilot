import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const publicUrl = process.env.MCP_URL || "https://global-connect-pilot.biv-ai-lab.workers.dev/mcp";
const writeUrl = process.env.MCP_WRITE_URL || "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function connect(url, name) {
  const client = new Client({ name, version: "0.2.0" });
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

  for (const required of ["list_requests", "get_request", "get_request_stats", "list_routes", "draft_request"]) {
    assert(toolNames.includes(required), `Missing public tool: ${required}`);
  }
  assert(!toolNames.includes("create_request"), "create_request must not be exposed on anonymous MCP URL");
  assert(!toolNames.includes("register_route"), "register_route must not be exposed on anonymous MCP URL");

  const request = await client.callTool({ name: "get_request", arguments: { id: "berlin70s1" } });
  assert(!request.isError, "get_request failed for berlin70s1");

  const routes = await client.callTool({ name: "list_routes", arguments: { id: "berlin70s1" } });
  assert(!routes.isError, "list_routes failed for berlin70s1");

  const stats = await client.callTool({ name: "get_request_stats", arguments: { id: "berlin70s1" } });
  assert(!stats.isError, "get_request_stats failed for berlin70s1");

  console.log("Read smoke: PASS");
  await client.close();

  if (!writeUrl) {
    console.log("Write smoke: SKIPPED (set MCP_WRITE_URL explicitly to test write tools)");
    return;
  }

  console.log(`MCP write smoke: ${writeUrl.replace(/key=[^&]+/i, "key=***")}`);
  const writer = await connect(writeUrl, "global-connect-smoke-write");
  const writeTools = await writer.listTools();
  const writeNames = writeTools.tools.map((tool) => tool.name);
  assert(writeNames.includes("create_request"), "Missing protected create_request tool");
  assert(writeNames.includes("register_route"), "Missing protected register_route tool");

  const created = await writer.callTool({
    name: "create_request",
    arguments: {
      goal: "MCP smoke-test request — safe to delete",
      deadline: "1 day",
      budget: "0",
      constraints: "Technical smoke test only",
      success_criteria: "MCP write tool returns a public card URL",
      attention_budget: 0,
      language: "en"
    }
  });
  assert(!created.isError, "create_request smoke failed");
  const createdData = created.structuredContent;
  assert(createdData?.id, "create_request did not return an ID");

  const registered = await writer.callTool({
    name: "register_route",
    arguments: {
      request_id: createdData.id,
      source_ref: "smoke_test_route",
      channel: "other",
      target_label: "Automated MCP smoke test",
      status: "planned"
    }
  });
  assert(!registered.isError, "register_route smoke failed");

  console.log("Write smoke: PASS");
  console.log("Created smoke request:", createdData.public_url);
  await writer.close();
}

main().catch((error) => {
  console.error("MCP smoke: FAIL");
  console.error(error);
  process.exit(1);
});
