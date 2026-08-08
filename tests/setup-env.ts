import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load local .env (gitignored) into the test process so hosted tests can run
// from a developer machine without duplicating secrets. In CI the values come
// from the workflow environment instead and .env is absent.
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(join(process.cwd(), ".env"));
