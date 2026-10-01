import { existsSync, readFileSync } from "node:fs";

function fail(message) {
  console.error(`Plugin package check: FAIL — ${message}`);
  process.exit(1);
}

const plugin = JSON.parse(readFileSync("plugin.json", "utf8"));
const mcp = JSON.parse(readFileSync("mcp.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const skill = readFileSync("skills/global-connect/SKILL.md", "utf8");

if (plugin.name !== "global-connect") fail("unexpected plugin name");
if (plugin.version !== pkg.version) fail(`plugin.json version ${plugin.version} != package.json ${pkg.version}`);
if (!skill.startsWith("---\n")) fail("SKILL.md is missing YAML frontmatter");

const openai = plugin.extensions?.["com.openai"];
if (!openai) fail("missing extensions.com.openai");

const ui = openai.interface || {};
for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category", "websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL", "composerIcon", "logo"]) {
  if (!ui[key]) fail(`missing interface.${key}`);
}
if (String(ui.displayName).length > 30) fail("displayName exceeds 30 characters");
if (String(ui.shortDescription).length > 30) fail("shortDescription exceeds 30 characters");
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  if (!String(ui[key]).startsWith("https://")) fail(`${key} must use HTTPS`);
}
for (const key of ["composerIcon", "logo"]) {
  const value = String(ui[key]);
  if (!value.startsWith("./")) fail(`${key} must be a ./-prefixed package-relative path`);
  const localPath = value.slice(2);
  if (!existsSync(localPath)) fail(`${key} file does not exist: ${localPath}`);
  if (!/\.(png|jpe?g|webp|svg)$/i.test(localPath)) fail(`${key} uses an unsupported image extension`);
}

const review = openai.review;
if (!review) fail("missing review metadata");
const positive = review.test_cases?.positive || [];
const negative = review.test_cases?.negative || [];
if (positive.length !== 5) fail(`expected exactly 5 positive test cases, got ${positive.length}`);
if (negative.length !== 3) fail(`expected exactly 3 negative test cases, got ${negative.length}`);
for (const [index, test] of positive.entries()) {
  for (const key of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
    if (!test[key]) fail(`positive test ${index + 1} missing ${key}`);
  }
}
for (const [index, test] of negative.entries()) {
  for (const key of ["description", "prompt"]) {
    if (!test[key]) fail(`negative test ${index + 1} missing ${key}`);
  }
}
if (!openai.publication?.release_notes) fail("missing publication.release_notes");

const servers = mcp.mcpServers || {};
const names = Object.keys(servers);
if (names.length !== 1 || names[0] !== "global-connect") fail("mcp.json must define exactly one server named global-connect");
const server = servers["global-connect"];
if (server.type !== "streamable-http") fail("MCP server type must be streamable-http");
if (server.url !== "https://global-connect-pilot.biv-ai-lab.workers.dev/mcp") fail("unexpected production MCP URL");

console.log(`Plugin package check: PASS — ${plugin.name} v${plugin.version}, ${positive.length} positive + ${negative.length} negative cases, directory icon present`);
