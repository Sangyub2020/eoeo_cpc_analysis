// Run arbitrary SQL against a Supabase project via the Management API.
// Usage: node scripts/mgmt-sql.mjs <path-to-sql-file>
// Env: SUPABASE_PAT, SUPABASE_PROJECT_REF
import { readFileSync } from "node:fs";

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!PAT || !REF) {
  console.error("Set SUPABASE_PAT and SUPABASE_PROJECT_REF env vars.");
  process.exit(1);
}

const arg = process.argv[2];
let sql;
if (arg?.startsWith("--sql=")) {
  sql = arg.slice("--sql=".length);
} else if (arg) {
  sql = readFileSync(arg, "utf8");
} else {
  console.error("Pass an SQL file path or --sql='...' inline.");
  process.exit(1);
}

const res = await fetch(
  `https://api.supabase.com/v1/projects/${REF}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  },
);

const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, text);
  process.exit(1);
}
console.log(text);
