import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "global-connect-pilot-db";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    ...options,
  });
}

console.log(`Ищу существующую D1 базу ${DB_NAME}...`);
const raw = run("npx", ["wrangler", "d1", "list", "--json"], { capture: true });
const databases = JSON.parse(raw);
const database = databases.find((item) => item.name === DB_NAME);

if (!database) {
  console.error(`Не найдена D1 база ${DB_NAME}.`);
  console.error("Создайте её один раз командой: npx wrangler d1 create global-connect-pilot-db");
  process.exit(1);
}

const databaseId = database.uuid || database.id;
if (!databaseId) {
  console.error("Cloudflare вернул базу без UUID/ID:", database);
  process.exit(1);
}

console.log(`Найдена D1 база ${DB_NAME}: ${databaseId}`);

const baseConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
baseConfig.d1_databases = [
  {
    binding: "DB",
    database_name: DB_NAME,
    database_id: databaseId,
  },
];

const generated = "wrangler.deploy.json";
writeFileSync(generated, JSON.stringify(baseConfig, null, 2) + "\n", "utf8");

console.log("Разворачиваю Worker с явной привязкой к существующей D1...");
run("npx", ["wrangler", "deploy", "--config", generated]);
