import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
source.d1_databases = [
  {
    binding: "DB",
    database_name: "global-connect-ci-db",
    database_id: "00000000-0000-0000-0000-000000000000"
  }
];

const generated = "wrangler.ci.json";
writeFileSync(generated, JSON.stringify(source, null, 2) + "\n", "utf8");

try {
  execFileSync("npx", ["wrangler", "deploy", "--dry-run", "--config", generated], {
    stdio: "inherit"
  });
  console.log("Cloudflare Worker build check: PASS");
} finally {
  rmSync(generated, { force: true });
}
