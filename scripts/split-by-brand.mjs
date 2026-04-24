// Split an existing rpt_<slug> table into per-brand rpt_<kind>__<brand> tables
// using the registered brand_rules.
//
// Usage:
//   SUPABASE_PAT=sbp_... SUPABASE_PROJECT_REF=... \
//     node scripts/split-by-brand.mjs \
//       --source=<source_slug> \
//       --kind=<kind_slug> \
//       [--execute]   # actually run (default is dry-run)
//
// Notes:
// - Priority order: rules are globally ordered by (priority DESC, length(pattern) DESC, created_at ASC).
//   Each row is claimed by the first rule that matches (single SQL CASE expression).
// - Source table is NOT modified. Unmatched rows remain in the source.
// - Destination rows go in under a fresh upload_id tagged "[split-by-brand]".
//   Running the script twice with --execute will add a second upload_id;
//   conflicting keys resolve via ON CONFLICT DO UPDATE.

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!PAT || !REF) {
  console.error("Set SUPABASE_PAT and SUPABASE_PROJECT_REF env vars.");
  process.exit(1);
}

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? true);
}
const sourceSlug = args.get("source");
const kindSlug = args.get("kind");
const execute = args.get("execute") === true;
if (!sourceSlug || !kindSlug) {
  console.error("Required: --source=<slug> --kind=<kind>. Add --execute to actually run.");
  process.exit(1);
}

async function q(sql) {
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

function ident(s) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`bad identifier: ${s}`);
  return `"${s}"`;
}
function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
function pgArrayLit(arr) {
  if (!arr || arr.length === 0) return "ARRAY[]::text[]";
  return "ARRAY[" + arr.map((x) => lit(x)).join(", ") + "]::text[]";
}
function pgTypeOf(dt) {
  switch (dt) {
    case "text": return "text";
    case "numeric": return "numeric";
    case "integer": return "bigint";
    case "date": return "date";
    case "timestamp": return "timestamptz";
    case "boolean": return "boolean";
    default: return "text";
  }
}
function ruleWhere(rule) {
  // Matching is case-insensitive to align with lib/brands/match.ts.
  const col = ident("campaign_name");
  if (rule.match_type === "prefix") return `${col} ILIKE ${lit(rule.pattern + "%")}`;
  if (rule.match_type === "contains") return `${col} ILIKE ${lit("%" + rule.pattern + "%")}`;
  if (rule.match_type === "regex") return `${col} ~* ${lit(rule.pattern)}`;
  throw new Error(`unknown match_type: ${rule.match_type}`);
}

console.log(`> source: rpt_${sourceSlug}`);
console.log(`> kind:   ${kindSlug}`);
console.log(`> mode:   ${execute ? "EXECUTE" : "dry-run"}`);

// --- 1. Look up source metadata.
const sourceTypes = await q(
  `select id, table_name, key_columns from public.report_types where slug = ${lit(sourceSlug)};`,
);
if (sourceTypes.length === 0) {
  console.error(`source report_type not found: ${sourceSlug}`);
  process.exit(1);
}
const {
  id: sourceTypeId,
  table_name: sourceTable,
  key_columns: keyColumns,
} = sourceTypes[0];
console.log(`  source table: ${sourceTable}`);
console.log(`  key columns:  ${JSON.stringify(keyColumns)}`);

const sourceColumns = await q(
  `select column_name, source_header, data_type, is_key, position
   from public.report_columns
   where report_type_id = ${lit(sourceTypeId)}
   order by position asc;`,
);
if (!sourceColumns.some((c) => c.column_name === "campaign_name")) {
  console.error("source has no campaign_name column — cannot route.");
  process.exit(1);
}
const columnList = sourceColumns.map((c) => ident(c.column_name)).join(", ");

// --- 2. Brand catalog + ordered rules.
const brands = await q(
  `select id, slug, display_name from public.brands order by display_name;`,
);
if (brands.length === 0) {
  console.error("no brands registered.");
  process.exit(1);
}
const brandById = new Map(brands.map((b) => [b.id, b]));

const rules = await q(
  `select id, brand_id, match_type, pattern, priority
   from public.brand_rules
   order by priority desc, char_length(pattern) desc, created_at asc;`,
);
if (rules.length === 0) {
  console.error("no brand_rules registered.");
  process.exit(1);
}

// CASE expression that assigns each row to the brand of the first matching rule.
const caseWhens = rules
  .map((r) => {
    const b = brandById.get(r.brand_id);
    if (!b) return null;
    return `WHEN (${ruleWhere(r)}) THEN ${lit(b.slug)}`;
  })
  .filter(Boolean)
  .join("\n      ");
const caseExpr = `CASE\n      ${caseWhens}\n      ELSE NULL END`;

// --- 3. Distribution preview.
const distrib = await q(
  `select ${caseExpr} as brand_slug, count(*)::int as n
   from public.${ident(sourceTable)}
   group by brand_slug
   order by n desc;`,
);
const [{ total }] = await q(
  `select count(*)::int as total from public.${ident(sourceTable)};`,
);
let totalRoutable = 0;
console.log(`\ndistribution:`);
for (const d of distrib) {
  if (d.brand_slug == null) continue;
  const b = brands.find((x) => x.slug === d.brand_slug);
  console.log(
    `  · ${(b?.display_name ?? d.brand_slug).padEnd(16)} ${String(d.n).padStart(8)} rows`,
  );
  totalRoutable += d.n;
}
const unmatched = Number(total) - totalRoutable;
console.log(`  ---`);
console.log(`  routable: ${totalRoutable} / ${total} (unmatched: ${unmatched})`);

if (unmatched > 0) {
  console.log(`\n  unmatched sample (up to 20 distinct campaign names):`);
  const sample = await q(
    `select distinct campaign_name
     from public.${ident(sourceTable)}
     where (${caseExpr}) is null
     limit 20;`,
  );
  for (const r of sample) console.log(`    - ${r.campaign_name}`);
}

if (!execute) {
  console.log(`\n(dry-run) add --execute to actually copy.`);
  process.exit(0);
}

// --- 4. For each brand with rows, ensure destination + INSERT SELECT.
const brandsWithRows = distrib
  .filter((d) => d.brand_slug != null && d.n > 0)
  .map((d) => d.brand_slug);

for (const brandSlug of brandsWithRows) {
  const brand = brands.find((b) => b.slug === brandSlug);
  const destSlug = `${kindSlug}__${brandSlug}`;
  const destTable = `rpt_${destSlug}`;
  console.log(`\n> ${brand.display_name} → ${destTable}`);

  const existing = await q(
    `select id from public.report_types where slug = ${lit(destSlug)};`,
  );
  let destId;
  if (existing.length > 0) {
    destId = existing[0].id;
    console.log(`  reusing existing report_type ${destSlug}`);
  } else {
    const colsSql = sourceColumns
      .map((c) => `${ident(c.column_name)} ${pgTypeOf(c.data_type)}`)
      .join(",\n  ");
    const uniq = keyColumns?.length
      ? `,\n  unique (${keyColumns.map((k) => ident(k)).join(", ")})`
      : "";
    await q(`
      create table if not exists public.${ident(destTable)} (
        id bigserial primary key,
        upload_id uuid,
        ${colsSql}${uniq}
      );
    `);
    await q(`notify pgrst, 'reload schema';`);

    const [typeRow] = await q(
      `insert into public.report_types (slug, display_name, table_name, key_columns, brand, kind)
       values (${lit(destSlug)}, ${lit(brand.display_name + " · " + kindSlug)},
               ${lit(destTable)}, ${pgArrayLit(keyColumns)},
               ${lit(brand.display_name)}, ${lit(kindSlug)})
       returning id;`,
    );
    destId = typeRow.id;

    for (const c of sourceColumns) {
      await q(
        `insert into public.report_columns
           (report_type_id, column_name, source_header, data_type, is_key, position)
         values (${lit(destId)}, ${lit(c.column_name)}, ${lit(c.source_header)},
                 ${lit(c.data_type)}, ${c.is_key}, ${c.position});`,
      );
    }
    console.log(`  created ${destTable} + metadata`);
  }

  const [uploadRow] = await q(
    `insert into public.report_uploads (report_type_id, file_name, row_count)
     values (${lit(destId)}, ${lit(`[split-by-brand] from ${sourceSlug}`)}, 0)
     returning id;`,
  );
  const uploadId = uploadRow.id;

  const conflictCols = (keyColumns ?? []).map((k) => ident(k)).join(", ");
  const updateSet = sourceColumns
    .filter((c) => !keyColumns?.includes(c.column_name))
    .map((c) => `${ident(c.column_name)} = excluded.${ident(c.column_name)}`)
    .join(", ");
  const onConflict =
    conflictCols && updateSet
      ? `on conflict (${conflictCols}) do update set ${updateSet}`
      : "";

  await q(`
    insert into public.${ident(destTable)} (upload_id, ${columnList})
    select ${lit(uploadId)}::uuid, ${columnList}
    from public.${ident(sourceTable)}
    where (${caseExpr}) = ${lit(brandSlug)}
    ${onConflict};
  `);
  const [{ count: inserted }] = await q(
    `select count(*)::int as count from public.${ident(destTable)}
     where upload_id = ${lit(uploadId)}::uuid;`,
  );
  await q(
    `update public.report_uploads set row_count = ${Number(inserted)}
     where id = ${lit(uploadId)}::uuid;`,
  );
  console.log(`  inserted ${inserted} rows under upload_id=${uploadId}`);
}

console.log(`\ndone. source table kept intact (nothing deleted).`);
