// End-to-end test of the chunked commit flow.
const BASE = "http://localhost:3000";
const SLUG = "test_chunked";

const headerPlan = [
  { source_header: "Date",        column_name: "date",        data_type: "date",    is_key: true,  is_new: true, include: true },
  { source_header: "Campaign",    column_name: "campaign",    data_type: "text",    is_key: true,  is_new: true, include: true },
  { source_header: "Impressions", column_name: "impressions", data_type: "integer", is_key: false, is_new: true, include: true },
  { source_header: "Spend",       column_name: "spend",       data_type: "numeric", is_key: false, is_new: true, include: true },
];

// Generate 7500 synthetic rows (exceeds the 3000 chunk size -> exercises chunking)
const rows = [];
for (let i = 0; i < 7500; i++) {
  const d = new Date(2025, 0, 1);
  d.setDate(d.getDate() + (i % 90));
  rows.push({
    Date: d.toISOString().slice(0, 10),
    Campaign: `Camp ${String.fromCharCode(65 + (i % 5))}`,
    Impressions: 100 + (i % 1000),
    Spend: +((5 + (i % 50)) * 1.13).toFixed(2),
  });
}

// Clean slate
await fetch(`${BASE}/api/reports/types/${SLUG}`, { method: "DELETE" });

console.log(`1. POST /api/reports/commit/begin (${rows.length} total)`);
const beginRes = await fetch(`${BASE}/api/reports/commit/begin`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    slug: SLUG,
    display_name: "Test Chunked",
    isNewType: true,
    headerPlan,
    fileName: "synth.csv",
    expectedRowCount: rows.length,
  }),
});
const begin = await beginRes.json();
console.log("   ->", begin.upload_id ? "ok, upload_id=" + begin.upload_id.slice(0, 8) : begin);
if (!begin.upload_id) process.exit(1);

const CHUNK = 3000;
let done = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const rowArrays = chunk.map((r) => begin.sourceHeaders.map((h) => r[h]));
  const res = await fetch(`${BASE}/api/reports/commit/chunk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      upload_id: begin.upload_id,
      tableName: begin.tableName,
      columnNames: begin.columnNames,
      keyColumns: begin.keyColumns,
      dataTypes: begin.dataTypes,
      rows: rowArrays,
    }),
  });
  const j = await res.json();
  done += chunk.length;
  console.log(`2.${i / CHUNK + 1}. chunk -> HTTP ${res.status}`, j);
  if (!res.ok) process.exit(1);
}

console.log(`3. POST /api/reports/commit/finalize`);
const fin = await fetch(`${BASE}/api/reports/commit/finalize`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ upload_id: begin.upload_id, row_count: done }),
});
console.log(`   HTTP ${fin.status}`);

console.log("4. GET data");
const data = await (await fetch(`${BASE}/api/reports/${SLUG}/data?limit=50000`)).json();
console.log(`   rowCount: ${data.rowCount}`);

console.log("5. GET types (with summary)");
const types = await (await fetch(`${BASE}/api/reports/types`)).json();
const mine = types.types?.find((t) => t.slug === SLUG);
console.log(`   rowCount: ${mine?.summary?.rowCount}`);
console.log(`   dateRange: ${mine?.summary?.dateRange?.min} ~ ${mine?.summary?.dateRange?.max}`);
console.log(`   metrics: ${mine?.summary?.metrics?.map((m) => `${m.source_header}=${m.sum}`).join(", ")}`);
console.log(`   dimension: ${mine?.summary?.dimension?.source_header} (${mine?.summary?.dimension?.distinctCount} distinct)`);

// Cleanup
console.log("6. DELETE cleanup");
await fetch(`${BASE}/api/reports/types/${SLUG}`, { method: "DELETE" });

console.log("\nE2E OK");
