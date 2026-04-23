// Quick unit test for detectHeaderRow across several shapes.
import { detectHeaderRow } from "../lib/reports/parse.ts";

const cases = [
  {
    name: "normal CSV — header on row 0",
    aoa: [
      ["Date", "Campaign", "Impressions", "Clicks"],
      ["2025-01-01", "Camp A", 1000, 50],
      ["2025-01-02", "Camp B", 2000, 80],
    ],
    expected: 0,
  },
  {
    name: "Excel pivot — user's reported shape",
    aoa: [
      ["Units sold", "(다중 항목)", null, null, null, null, null, null],
      ["행 레이블", "합계: Impressions", "합계: Clicks", "합계: CPC", "합계: Total cost", "합계: Sales", "합계: ROAS", "개수: CTR"],
      ["Camp A", 12345, 678, 0.25, 169.5, 1234.5, 7.28, 0.055],
      ["Camp B", 9876, 543, 0.3, 162.9, 890.3, 5.47, 0.055],
    ],
    expected: 1,
  },
  {
    name: "report with 3 title rows then header",
    aoa: [
      ["Amazon Advertising Report"],
      ["Generated: 2025-01-15"],
      ["Account: egongegong"],
      [],
      ["Date", "Campaign", "Spend"],
      ["2025-01-01", "Camp A", 100],
      ["2025-01-02", "Camp B", 200],
    ],
    expected: 4,
  },
  {
    name: "single row (edge case)",
    aoa: [["A", "B", "C"]],
    expected: 0,
  },
];

let pass = 0;
for (const c of cases) {
  const got = detectHeaderRow(c.aoa);
  const ok = got === c.expected;
  console.log(`${ok ? "✓" : "✗"} ${c.name}: got ${got}, expected ${c.expected}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
