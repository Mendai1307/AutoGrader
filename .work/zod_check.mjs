/**
 * C5 的 Zod 侧验收台：用 v0.1 的 Zod 契约（schema.ts）校验 12 份历史资产。
 *
 * 只读 v0.1 仓库，不写入任何文件。
 * 用法：node --experimental-strip-types zod_check.mjs <schema.ts> <resultsDir>
 */
const schemaUrl = process.argv[2];
const resultsDir = process.argv[3];

const mod = await import(schemaUrl);
const fs = await import('node:fs/promises');
const path = await import('node:path');

const files = (await fs.readdir(resultsDir))
  .filter((f) => f.startsWith('result-sample-') && f.endsWith('.json'))
  .sort();

let ok = 0;
let bad = 0;
for (const f of files) {
  const doc = JSON.parse(await fs.readFile(path.join(resultsDir, f), 'utf8'));

  const parsed = mod.validateReviewResult(doc);
  const total = mod.verifyTotalScore(doc);
  const badItems = doc.scores.filter((s) => !mod.verifyItemScore(s));

  const problems = [];
  if (!parsed.ok) problems.push('schema: ' + JSON.stringify(parsed.issues.slice(0, 3)));
  if (!total.ok) problems.push('totalScore: ' + JSON.stringify(total));
  if (badItems.length) {
    problems.push('verifyItemScore 失败项: ' + badItems.map((s) => s.rubricItemId).join(','));
  }

  if (problems.length === 0) {
    ok += 1;
  } else {
    bad += 1;
    console.log(f + ' → ' + problems.join(' | '));
  }
}

console.log(
  JSON.stringify(
    {
      tool: 'zod_check',
      schemaVersion: mod.SCHEMA_VERSION,
      files: files.length,
      zodPass: ok,
      zodFail: bad,
      weightSumTolerance: 0.01,
    },
    null,
    2,
  ),
);
process.exit(bad === 0 && files.length === 12 ? 0 : 1);
