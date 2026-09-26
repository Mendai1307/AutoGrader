#!/usr/bin/env node
/**
 * AutoGrader · 资产同步（构建期第一步）
 * ===========================================================================
 * 把工作区里**其余目录**的数据资产复制进 `web/`，使 `web/` 自包含：
 * 产物提交进仓库后，即使只有 `web/` 这一个目录（例如评委 clone 后只想跑前端，
 * 或 CI 只 checkout 了子目录），`npm run build` 仍然能过。
 *
 * 同步内容
 * ---------------------------------------------------------------------------
 *   backend/autograder-expert/agents/tools/assets/template/*.json  → public/assets/rubric.json
 *   backend/autograder-expert/agents/tools/assets/gold/manifest.json → public/assets/gold-manifest.json
 *   backend/autograder-expert/agents/tools/assets/sample/*.md      → public/assets/samples/
 *                                                                  → public/assets/corpus/（查重语料）
 *   backend/autograder-expert/agents/tools/rules/default.rules.json → public/assets/default.rules.json
 *                                                                  → lib/rules.generated.ts
 *   backend/autograder-expert/agents/evaluations/baselines/*.json  → public/assets/eval-baseline.json
 *   五件套文档（agent / skills / tools / workflow / evaluations）  → lib/agent-kit.generated.json
 *
 * 两条纪律
 * ---------------------------------------------------------------------------
 *   1. **不做破坏性操作**：只写不删。残留文件只报告，要清理须显式传 --prune。
 *      （本项目在 build_expert.py 上已经踩过"装配器具备破坏性"的坑。）
 *   2. **源目录缺失不等于失败**：若源不存在但目标产物齐全，说明这是"自包含构建"，
 *      打印提示后正常退出 0；只有"源与产物都没有"才算错误（退出 1）。
 *
 * 用法
 * ---------------------------------------------------------------------------
 *   node scripts/sync-assets.mjs                 # 同步（源缺失且产物齐全时跳过）
 *   node scripts/sync-assets.mjs --force         # 源缺失也报错（CI 上想强校验时用）
 *   node scripts/sync-assets.mjs --prune         # 额外删除目标目录里的残留文件
 *   AUTOGRADER_BACKEND=/path/to/agents node scripts/sync-assets.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_DIR = path.resolve(WEB_DIR, '..');

/** 五件套源目录（可用环境变量覆盖，便于在其他机器上复用） */
const AGENTS_DIR = process.env.AUTOGRADER_BACKEND
  ? path.resolve(process.env.AUTOGRADER_BACKEND)
  : path.join(REPO_DIR, 'backend', 'autograder-expert', 'agents');

const PUBLIC_ASSETS = path.join(WEB_DIR, 'public', 'assets');
const LIB_DIR = path.join(WEB_DIR, 'lib');

const args = process.argv.slice(2);
const OPT = {
  force: args.includes('--force'),
  prune: args.includes('--prune'),
};

/** 本次写入的文件相对路径（用于残留报告） */
const written = new Set();

function log(msg) {
  console.log(msg);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
  written.add(path.relative(WEB_DIR, absPath).split(path.sep).join('/'));
}

function copyFile(srcAbs, dstAbs) {
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  fs.copyFileSync(srcAbs, dstAbs);
  written.add(path.relative(WEB_DIR, dstAbs).split(path.sep).join('/'));
}

function listFiles(dir, filter) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .filter((name) => (filter ? filter(name) : true))
    .sort();
}

/* ==========================================================================
 * 0. 源目录可用性判定
 * ========================================================================== */

/** 产物清单：只要这些都在，就认为"自包含构建"可成立 */
const REQUIRED_TARGETS = [
  'public/assets/rubric.json',
  'public/assets/gold-manifest.json',
  'public/assets/default.rules.json',
  'public/assets/eval-baseline.json',
  'lib/rules.generated.ts',
  'lib/corpus.generated.ts',
  'lib/agent-kit.generated.json',
  'public/results/result-sample-01.json',
];

const hasSource = fs.existsSync(path.join(AGENTS_DIR, 'tools'));
const targetsOk = REQUIRED_TARGETS.every((rel) => fs.existsSync(path.join(WEB_DIR, rel)));

if (!hasSource) {
  if (targetsOk && !OPT.force) {
    log('  [sync-assets] 未找到五件套源目录，但 web/ 内产物齐全 → 按自包含构建继续。');
    log(`                源目录：${AGENTS_DIR}`);
    log('                （如需强制校验源，追加 --force；或用 AUTOGRADER_BACKEND 指定源）');
    process.exit(0);
  }
  console.error('[sync-assets] 失败：既找不到源目录，web/ 内产物也不齐全。');
  console.error(`  源目录：${AGENTS_DIR}`);
  console.error('  可用 AUTOGRADER_BACKEND=<agents 目录> 指定源，或先补齐 web/public/assets。');
  process.exit(1);
}

log('  [sync-assets] 源目录：' + AGENTS_DIR);

/* ==========================================================================
 * 1. Rubric 样板
 * ========================================================================== */

const templateDir = path.join(AGENTS_DIR, 'tools', 'assets', 'template');
const templateFiles = listFiles(templateDir, (n) => n.endsWith('.json'));
if (templateFiles.length === 0) {
  console.error('[sync-assets] 失败：template/ 下没有 json 样板');
  process.exit(1);
}
copyFile(path.join(templateDir, templateFiles[0]), path.join(PUBLIC_ASSETS, 'rubric.json'));

/* ==========================================================================
 * 2. 金标准 manifest
 * ========================================================================== */

const goldManifest = path.join(AGENTS_DIR, 'tools', 'assets', 'gold', 'manifest.json');
if (!fs.existsSync(goldManifest)) {
  console.error('[sync-assets] 失败：缺少 gold/manifest.json');
  process.exit(1);
}
copyFile(goldManifest, path.join(PUBLIC_ASSETS, 'gold-manifest.json'));

/* ==========================================================================
 * 3. 12 份样例报告 → samples/ 与 corpus/
 *     corpus 是同内容的另一份副本：查重语料与"可下载样例"语义不同，
 *     将来若要换成真实语料，改 corpus 即可，不必动 samples。
 * ========================================================================== */

const sampleDir = path.join(AGENTS_DIR, 'tools', 'assets', 'sample');
const sampleFiles = listFiles(sampleDir, (n) => n.endsWith('.md'));
if (sampleFiles.length === 0) {
  console.error('[sync-assets] 失败：sample/ 下没有 md 样例');
  process.exit(1);
}
for (const name of sampleFiles) {
  copyFile(path.join(sampleDir, name), path.join(PUBLIC_ASSETS, 'samples', name));
  copyFile(path.join(sampleDir, name), path.join(PUBLIC_ASSETS, 'corpus', name));
}

/* ==========================================================================
 * 4. 规则集 → public 资产 + lib/rules.generated.ts
 * ========================================================================== */

const rulesFile = path.join(AGENTS_DIR, 'tools', 'rules', 'default.rules.json');
if (!fs.existsSync(rulesFile)) {
  console.error('[sync-assets] 失败：缺少 rules/default.rules.json');
  process.exit(1);
}
copyFile(rulesFile, path.join(PUBLIC_ASSETS, 'default.rules.json'));

const ruleSet = readJson(rulesFile);
if (!Array.isArray(ruleSet.rules)) {
  console.error('[sync-assets] 失败：default.rules.json 结构异常（rules 不是数组）');
  process.exit(1);
}

const rulesTs = `/**
 * AutoGrader · 内置核查规则（自动生成，请勿手改）
 * ============================================================================
 * 由 scripts/sync-assets.mjs 从
 *   backend/autograder-expert/agents/tools/rules/default.rules.json
 * 生成。源文件是规则的唯一真源（工具链 T2 与浏览器端规则引擎共用同一份）。
 *
 * 生成时间与来源摘要见 scripts/ 的同步日志；改规则请改源文件后重新同步。
 *
 * 规则集：${ruleSet.ruleSetId ?? '(未命名)'} v${ruleSet.version ?? '?'}，共 ${ruleSet.rules.length} 条
 */

import type { RuleSet } from '@/lib/rules-engine';

export const DEFAULT_RULE_SET = ${JSON.stringify(ruleSet, null, 2)} as unknown as RuleSet;

/** 内置规则集的条数（供界面显示"共 N 条规则"） */
export const DEFAULT_RULE_COUNT = ${ruleSet.rules.length};
`;
writeText(path.join(LIB_DIR, 'rules.generated.ts'), rulesTs);

/* ==========================================================================
 * 4b. 查重语料 → lib/corpus.generated.ts
 * ---------------------------------------------------------------------------
 * 为什么不把语料塞进 /upload 页面的 props：12 份样例正文合计约 150 KB，
 * 内联进 RSC 载荷会让该页首屏 HTML 明显变大。做成独立模块后由客户端
 * `await import()` 按需加载 —— 用户不点上传就不下载。
 * ========================================================================== */

const corpusEntries = sampleFiles.map((name) => ({
  name,
  text: fs.readFileSync(path.join(sampleDir, name), 'utf8'),
}));

const corpusTs = `/**
 * AutoGrader · 查重语料（自动生成，请勿手改）
 * ============================================================================
 * 由 scripts/sync-assets.mjs 从
 *   backend/autograder-expert/agents/tools/assets/sample/
 * 生成，共 ${corpusEntries.length} 份，与 public/assets/corpus/ 同源。
 *
 * 用途：浏览器端规则引擎跑 similarity 规则时作为比对语料。
 * 单独成模块以便客户端按需 \`await import()\`：不触发上传就不下载这份文本。
 *
 * 注意：语料是**样例报告**，不是"全部学生作业"。相似度只表示两篇文本的指纹接近，
 * 不判定谁抄谁，也不构成任何抄袭结论 —— 界面文案必须保持这一措辞。
 */

import type { CorpusEntry } from '@/lib/rules-engine';

export const CORPUS: readonly CorpusEntry[] = ${JSON.stringify(corpusEntries)};

/** 语料份数 */
export const CORPUS_SIZE = ${corpusEntries.length};
`;
writeText(path.join(LIB_DIR, 'corpus.generated.ts'), corpusTs);

/* ==========================================================================
 * 5. 评测基线 → public 资产
 * ========================================================================== */

const baselineDir = path.join(AGENTS_DIR, 'evaluations', 'baselines');
const baselineFiles = listFiles(baselineDir, (n) => n.endsWith('.json')).sort();
if (baselineFiles.length === 0) {
  console.error('[sync-assets] 失败：evaluations/baselines/ 下没有 json');
  process.exit(1);
}
// 取文件名最大者（约定为最新日期）
const latestBaseline = baselineFiles[baselineFiles.length - 1];
copyFile(path.join(baselineDir, latestBaseline), path.join(PUBLIC_ASSETS, 'eval-baseline.json'));

/* ==========================================================================
 * 6. 五件套元数据 → lib/agent-kit.generated.json
 * ---------------------------------------------------------------------------
 * 只做**机械抽取**，不做任何判断或润色：
 *   - 每个文档取一级标题作为 title、取标题后第一段非空文本作为 summary；
 *   - 技能 / 工具条目额外抽出编号（S0…S7 / T1…T6）与"一句话"；
 *   - 计数与文件名一律如实反映磁盘现状（页面据此显示"8 个技能 / 6 个工具"）。
 * ========================================================================== */

/** 读取 md，抽出 title / summary / 二级标题清单 / 行数 */
function digestDoc(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let title = '';
  let summary = '';
  const sections = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (title === '' && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      // title 之后找第一段非空、非标题、非表格、非引用/分隔线/代码围栏的正文
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j].trim();
        if (candidate === '' || candidate.startsWith('#') || candidate.startsWith('>') ||
            candidate.startsWith('---') || candidate.startsWith('```') ||
            candidate.startsWith('|')) continue;
        summary = candidate;
        break;
      }
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) sections.push(h2[1].trim());
  }

  return { title, summary, sections, lineCount: lines.length };
}

/** 目录下按文件名排序的 md 文档摘要 */
function digestDir(dir, filter) {
  return listFiles(dir, (n) => n.endsWith('.md') && (filter ? filter(n) : true))
    .map((name) => {
      const abs = path.join(dir, name);
      const d = digestDoc(abs);
      return { file: name, ...d };
    });
}

const skillsDir = path.join(AGENTS_DIR, 'skills');
const toolsDir = path.join(AGENTS_DIR, 'tools');
const workflowDir = path.join(AGENTS_DIR, 'workflow');
const evalDir = path.join(AGENTS_DIR, 'evaluations');

/** 从文件名里抽编号，如 `S0-routing.md` → `S0`；`T1-document-parser.md` → `T1` */
function extractId(file) {
  const m = /^([ST]\d+)/.exec(file);
  return m ? m[1] : null;
}

const agentKit = {
  generatedBy: 'web/scripts/sync-assets.mjs',
  sourceRoot: path.relative(REPO_DIR, AGENTS_DIR).split(path.sep).join('/'),
  pieces: {
    prompt: (() => {
      const abs = path.join(AGENTS_DIR, 'agent', 'SYSTEM_PROMPT.md');
      if (!fs.existsSync(abs)) return null;
      return { file: 'SYSTEM_PROMPT.md', ...digestDoc(abs) };
    })(),
    skills: digestDir(skillsDir, (n) => n !== 'README.md').map((d) => ({
      id: extractId(d.file),
      ...d,
    })),
    skillsIndex: digestDir(skillsDir, (n) => n === 'README.md')[0] ?? null,
    tools: digestDir(toolsDir, (n) => /^T\d+/.test(n)).map((d) => ({ id: extractId(d.file), ...d })),
    toolsIndex: digestDir(toolsDir, (n) => n === 'README.md')[0] ?? null,
    workflow: digestDir(workflowDir),
    evaluations: digestDir(evalDir),
  },
  /** 评测脚本清单（不读内容，只记文件名与行数） */
  evaluationScripts: listFiles(path.join(evalDir, 'scripts'), (n) => n.endsWith('.py')).map((name) => ({
    file: name,
    lineCount: fs.readFileSync(path.join(evalDir, 'scripts', name), 'utf8').split(/\r?\n/).length,
  })),
  counts: {
    skills: listFiles(skillsDir, (n) => n.endsWith('.md') && n !== 'README.md').length,
    tools: listFiles(toolsDir, (n) => /^T\d+.*\.md$/.test(n)).length,
    workflowDocs: listFiles(workflowDir, (n) => n.endsWith('.md')).length,
    rules: ruleSet.rules.length,
    samples: sampleFiles.length,
  },
};

writeText(path.join(LIB_DIR, 'agent-kit.generated.json'), JSON.stringify(agentKit, null, 2) + '\n');

/* ==========================================================================
 * 7. 残留报告（默认不删）
 * ========================================================================== */

const stale = [];
for (const sub of ['samples', 'corpus']) {
  const dir = path.join(PUBLIC_ASSETS, sub);
  for (const name of listFiles(dir)) {
    const rel = `public/assets/${sub}/${name}`;
    if (!written.has(rel)) stale.push(rel);
  }
}
if (stale.length > 0) {
  log(`  [sync-assets] 目标目录有 ${stale.length} 个残留文件（默认保留）`);
  if (OPT.prune) {
    for (const rel of stale) {
      fs.unlinkSync(path.join(WEB_DIR, rel));
    }
    log(`  [sync-assets] --prune 已删除 ${stale.length} 个残留文件`);
  } else {
    log('                如需清理请追加 --prune');
  }
}

log(
  `  [sync-assets] 完成：rubric 1 · gold 1 · sample ${sampleFiles.length} · corpus ${sampleFiles.length} · ` +
    `rules ${ruleSet.rules.length} · 五件套元数据 1（skills ${agentKit.counts.skills} / tools ${agentKit.counts.tools}）`,
);
