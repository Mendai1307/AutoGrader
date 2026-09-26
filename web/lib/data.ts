/**
 * AutoGrader · 构建期数据访问层（仅供 Server Component 引入）
 * ===========================================================================
 * 架构前提：Web 端运行时零 AI 调用、零后端、零数据库。
 * 因此所有数据都在 **构建期** 用 Node fs 从 `web/` 内部读取，随静态产物固化。
 *
 * 与 v0.1 的关键差异
 * ---------------------------------------------------------------------------
 *   v0.1 读的是仓库外的 `../demo/`，本版一律读 `web/public/assets/` ——
 *   那些文件由 `scripts/sync-assets.mjs` 从工具链资产同步进来并提交进仓库，
 *   使 `web/` **自包含**：只有 `web/` 一个目录也能构建。
 *
 * 数据来源
 * ---------------------------------------------------------------------------
 *   public/assets/rubric.json          评分点定义（R1–R12，权重和 100）
 *   public/assets/gold-manifest.json   12 份样例报告元信息 + 教师金标准逐项分
 *   public/assets/samples/sample-XX.md 12 份样例报告原文
 *   public/assets/default.rules.json   13 条内置核查规则（工具链 T2 同源）
 *   public/assets/eval-baseline.json   Evaluation 层的实测基线
 *   public/results/result-{id}.json    评阅结果（按契约 ReviewResult）
 *
 * 降级策略：任何一份报告缺少结果文件时返回 status: 'missing'，
 * 由页面渲染「评阅结果待生成」空态，绝不抛异常、绝不白屏。
 */

import fs from 'node:fs';
import path from 'node:path';

import { checkFingerprint, type FingerprintCheck } from '@/lib/fingerprint';
import {
  RubricSchema,
  recomputeTotals,
  validateReviewResult,
  verifyItemScore,
  verifyTotalScore,
  type ReviewResult,
  type Rubric,
  type ScoreLevel,
  type TotalScoreCheck,
  type ValidationIssue,
} from '@/lib/schema';
import {
  inspectReport,
  pairwiseSimilarities,
  type InspectionReport,
  type SimilarityPair,
} from '@/lib/inspectors';

/* ==========================================================================
 * 路径解析
 * ========================================================================== */

const WEB_ROOT = process.cwd();
const ASSETS_DIR = path.join(WEB_ROOT, 'public', 'assets');
const SAMPLES_DIR = path.join(ASSETS_DIR, 'samples');
const CORPUS_DIR = path.join(ASSETS_DIR, 'corpus');
const RESULTS_DIR = path.join(WEB_ROOT, 'public', 'results');

/** 结果文件绝对路径（约定：result-{reportId}.json） */
export function resultFilePath(reportId: string): string {
  return path.join(RESULTS_DIR, `result-${reportId}.json`);
}

/* ==========================================================================
 * manifest：样例报告元信息（含教师金标准）
 * ========================================================================== */

/** 教师金标准分的逐项标注（与 RubricItem 对齐） */
export interface GoldItemScore {
  rubricItemId: string;
  itemName: string;
  level: ScoreLevel;
  levelScoreRatio: number;
  maxScore: number;
  weight: number;
  score: number;
}

/** 单份样例报告的元信息 */
export interface SampleReport {
  id: string;
  fileName: string;
  title: string;
  course: string;
  topicId: string;
  topic: string;
  /** 难度档位：优 / 良 / 中 / 差 */
  tier: string;
  /** 正文字数（汉字数 + 英文单词数，不计代码块） */
  wordCount: number;
  codeBlockCount: number;
  figureCount: number;
  /** 教师金标准分（人工核算，口径与契约一致） */
  goldTotalScore: number;
  expectedItemScores: GoldItemScore[];
  summary: string;
}

/** gold-manifest.json 的结构 */
export interface SampleManifest {
  rubricId: string;
  rubricVersion: string;
  schemaVersion: string;
  generatedBy: string;
  totalScoreFormula: string;
  wordCountBasis: string;
  note: string;
  reports: SampleReport[];
}

let manifestCache: SampleManifest | null = null;

/** 读取金标准 manifest（构建期一次，进程内缓存） */
export function getManifest(): SampleManifest {
  if (manifestCache !== null) return manifestCache;
  const file = path.join(ASSETS_DIR, 'gold-manifest.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SampleManifest;
  if (!Array.isArray(parsed.reports)) {
    throw new Error('gold-manifest.json 结构异常：reports 不是数组');
  }
  manifestCache = parsed;
  return parsed;
}

/** 12 份样例报告元信息，按 id 升序 */
export function getSampleReports(): SampleReport[] {
  return [...getManifest().reports].sort((a, b) => a.id.localeCompare(b.id));
}

/** 按 id 取单份样例报告元信息；不存在时返回 null（页面据此走 404） */
export function getSampleReport(reportId: string): SampleReport | null {
  return getSampleReports().find((item) => item.id === reportId) ?? null;
}

/** 样例报告原文（Markdown）；文件缺失时返回空串，绝不抛异常 */
export function getReportMarkdown(reportId: string): string {
  const report = getSampleReport(reportId);
  if (report === null) return '';
  const file = path.join(SAMPLES_DIR, report.fileName);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

/* ==========================================================================
 * rubric：评分点定义
 * ========================================================================== */

let rubricCache: Rubric | null = null;

/** 读取并校验 rubric（构建期一次）。校验不过直接抛，让构建失败。 */
export function getRubric(): Rubric {
  if (rubricCache !== null) return rubricCache;
  const file = path.join(ASSETS_DIR, 'rubric.json');
  const parsed = RubricSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  rubricCache = parsed;
  return parsed;
}

/* ==========================================================================
 * 评阅结果：public/results/result-{id}.json
 * ========================================================================== */

/** 结果加载状态：三种状态对应页面三种渲染分支 */
export type ResultState =
  | { status: 'ok'; file: string; data: ReviewResult }
  | { status: 'missing'; file: string }
  | { status: 'invalid'; file: string; issues: ValidationIssue[] };

/**
 * 列出 public/results/ 下所有真实结果文件。
 * 规则：仅 .json，且**排除以 `_` 开头的文件**（契约格式示例不作真实结果渲染）。
 */
export function listResultFiles(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .sort();
}

const resultCache = new Map<string, ResultState>();

/**
 * 加载某份报告的评阅结果。
 * - 文件不存在 → { status: 'missing' }，页面渲染空态；
 * - 文件存在但不符合契约 → { status: 'invalid', issues }，页面渲染契约错误面板；
 * - 文件存在且合法 → { status: 'ok', data }。
 */
export function getResultState(reportId: string): ResultState {
  const cached = resultCache.get(reportId);
  if (cached !== undefined) return cached;

  const file = `result-${reportId}.json`;
  const absolute = resultFilePath(reportId);

  let state: ResultState;
  if (!fs.existsSync(absolute)) {
    state = { status: 'missing', file };
  } else {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      const validation = validateReviewResult(parsed);
      state = validation.ok
        ? { status: 'ok', file, data: validation.data }
        : { status: 'invalid', file, issues: validation.issues };
    } catch (error) {
      state = {
        status: 'invalid',
        file,
        issues: [{ path: '(root)', message: `JSON 解析失败：${(error as Error).message}` }],
      };
    }
  }

  resultCache.set(reportId, state);
  return state;
}

/** 是否已有可用的评阅结果（供 /grade 列表显示状态徽章） */
export function hasResult(reportId: string): boolean {
  return getResultState(reportId).status === 'ok';
}

/** 已产出评阅结果的报告 id 列表（仅统计能对应到样例报告的 id） */
export function getGeneratedReportIds(): string[] {
  const known = new Set(getSampleReports().map((item) => item.id));
  return listResultFiles()
    .map((name) => /^result-(.+)\.json$/.exec(name)?.[1] ?? '')
    .filter((id) => id.length > 0 && known.has(id));
}

/**
 * 全部 12 份结果文件**构建期必须合法** —— 任何一份不合规就让构建失败。
 * 这是 2.2 判据「契约与数据层接入」最硬的一条：数据坏了就不许出包，
 * 而不是等到运行时在页面上报错。
 */
export function assertAllResultsValid(): { ok: number; invalid: string[] } {
  const invalid: string[] = [];
  let ok = 0;
  for (const report of getSampleReports()) {
    const state = getResultState(report.id);
    if (state.status === 'ok') ok += 1;
    if (state.status === 'invalid') {
      invalid.push(`${state.file}：${state.issues.map((i) => `${i.path} ${i.message}`).join('；')}`);
    }
  }
  return { ok, invalid };
}

/* ==========================================================================
 * 契约级复算（供结果页现场展示"这份分是怎么算出来的"）
 * ========================================================================== */

/** 一份结果的契约复算结论 */
export interface ContractAudit {
  /** 结果文件自己声明的总分 */
  declaredTotalScore: number;
  /** 按冻结口径独立复算出的总分 */
  recomputedTotalScore: number;
  /** 总分比对结论 */
  totalCheck: TotalScoreCheck;
  /** 已计入 / 已排除权重（复算值） */
  weightIncluded: number;
  weightExcluded: number;
  /** 上界（= 已计入权重合计） */
  upperBound: number;
  /** 是否部分分 */
  isPartial: boolean;
  /** 未计入求和的评分点 id */
  excludedIds: string[];
  /** 逐项得分与「满分 × 档位系数」不符的项（契约不变式 I12） */
  itemMismatches: { rubricItemId: string; declared: number; expected: number }[];
  /** total 块声明的值（缺失时为 null） */
  declaredTotal: ReviewResult['total'] | null;
}

/** 复算某份结果的关键口径（纯计算，不读文件） */
export function auditResult(result: ReviewResult): ContractAudit {
  const totals = recomputeTotals(result.scores);
  const itemMismatches: ContractAudit['itemMismatches'] = [];
  for (const item of result.scores) {
    const verdict = verifyItemScore(item);
    if (verdict === false && item.score !== null) {
      itemMismatches.push({
        rubricItemId: item.rubricItemId,
        declared: item.score,
        expected: Math.round((item.maxScore * item.levelScoreRatio + Number.EPSILON) * 100) / 100,
      });
    }
  }
  return {
    declaredTotalScore: result.totalScore,
    recomputedTotalScore: totals.value,
    totalCheck: verifyTotalScore(result),
    weightIncluded: totals.weightIncluded,
    weightExcluded: totals.weightExcluded,
    upperBound: totals.upperBound,
    isPartial: totals.isPartial,
    excludedIds: totals.excludedIds,
    itemMismatches,
    declaredTotal: result.total ?? null,
  };
}

const auditCache = new Map<string, ContractAudit | null>();

/** 某份结果的契约复算结论；结果不可用时返回 null */
export function getContractAudit(reportId: string): ContractAudit | null {
  if (auditCache.has(reportId)) return auditCache.get(reportId) ?? null;
  const state = getResultState(reportId);
  const audit = state.status === 'ok' ? auditResult(state.data) : null;
  auditCache.set(reportId, audit);
  return audit;
}

/* ==========================================================================
 * 结果指纹复算（构建期用 lib/fingerprint.ts 现算并比对）
 * ========================================================================== */

const fingerprintCache = new Map<string, FingerprintCheck | null>();

/**
 * 复算某份结果的指纹并与声明值比对。
 * 做成 async 是因为走 Web Crypto；在 Server Component 里 await 即可。
 */
export async function getFingerprintCheck(reportId: string): Promise<FingerprintCheck | null> {
  const cached = fingerprintCache.get(reportId);
  if (cached !== undefined) return cached;
  const state = getResultState(reportId);
  const check = state.status === 'ok' ? await checkFingerprint(state.data) : null;
  fingerprintCache.set(reportId, check);
  return check;
}

/* ==========================================================================
 * 构建期确定性核查：lib/inspectors/
 * ---------------------------------------------------------------------------
 * 核查器（章节 / 代码 / 统计量 / 图表引用 / 相似度）是不依赖任何数据源的纯函数，
 * 本层只负责「取原文 → 调用 → 进程内缓存」，保证 12 个详情页共享同一份计算结果：
 * 同一次构建中每份报告只核查一次，两两相似度的 C(12,2)=66 对也只算一次。
 * ========================================================================== */

const inspectionCache = new Map<string, InspectionReport>();

/** 某份报告的完整确定性核查结果（构建期缓存；原文缺失时对空串核查） */
export function getInspection(reportId: string): InspectionReport {
  const cached = inspectionCache.get(reportId);
  if (cached !== undefined) return cached;
  const inspection = inspectReport(getReportMarkdown(reportId), reportId);
  inspectionCache.set(reportId, inspection);
  return inspection;
}

let similarityCache: SimilarityPair[] | null = null;

/**
 * 全部样例报告的两两 SimHash 相似度（66 对，按相似度降序）。
 * 只纳入能读到原文的报告；原文全部缺失时返回空数组。
 */
export function getSimilarityPairs(): SimilarityPair[] {
  if (similarityCache !== null) return similarityCache;
  const inputs = getSampleReports()
    .map((report) => ({ id: report.id, text: getReportMarkdown(report.id) }))
    .filter((input) => input.text !== '');
  similarityCache = pairwiseSimilarities(inputs);
  return similarityCache;
}

/**
 * 某份报告与「其余报告」中相似度最高的一对。
 * getSimilarityPairs() 已按相似度降序，故第一条命中即为该报告的最高配对；
 * 报告中不足两份时返回 null。
 *
 * 注意：相似度只表示「两篇文本的指纹有多接近」，不判定谁抄谁，也不构成抄袭结论。
 */
export function getTopSimilarity(reportId: string): SimilarityPair | null {
  const pair = getSimilarityPairs().find((item) => item.a === reportId || item.b === reportId);
  return pair ?? null;
}

/* ==========================================================================
 * 上传核查（2.5）用的语料：构建期读入，随静态产物交付
 * ========================================================================== */

/** 查重语料：可直接打包给浏览器端规则引擎 */
export function getCorpusFiles(): { name: string; text: string }[] {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8') }));
}

/* ==========================================================================
 * 工具链资产：规则集与评测基线（供 /agents 与 /upload 展示口径）
 * ========================================================================== */

let rulesCache: unknown = null;

/** 内置规则集（原样读入，不做任何加工） */
export function getDefaultRuleSet(): unknown {
  if (rulesCache !== null) return rulesCache;
  const file = path.join(ASSETS_DIR, 'default.rules.json');
  rulesCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return rulesCache;
}

let baselineCache: unknown = null;

/** Evaluation 层实测基线 */
export function getEvalBaseline(): unknown {
  if (baselineCache !== null) return baselineCache;
  const file = path.join(ASSETS_DIR, 'eval-baseline.json');
  baselineCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return baselineCache;
}

/* ==========================================================================
 * 溯源页的示例结果
 * ========================================================================== */

/**
 * 取一份**真实**的评阅结果作为 /trace 的完整溯源样例。
 *
 * 与 v0.1 的差异：v0.1 用 `public/results/_example.json`（一份手写的契约格式示例）。
 * 本版改为直接取第一份已产出且通过校验的真实结果 —— 溯源页展示的应该是真实产物，
 * 而不是"为了演示而写的样板"，否则"可回溯"这件事本身就打了折。
 *
 * 取不到任何结果时返回 null，由页面降级。
 */
export function getTraceExample(): ReviewResult | null {
  for (const report of getSampleReports()) {
    const state = getResultState(report.id);
    if (state.status === 'ok') return state.data;
  }
  return null;
}
