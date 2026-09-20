/**
 * AutoGrader · 构建期数据访问层（仅 Server Component 可引入）
 * ---------------------------------------------------------------------------
 * 架构前提：Web 端运行时零 AI 调用、零后端、零数据库。
 * 因此所有数据都在 **构建期** 用 Node fs 从仓库内静态资产读取，随静态产物固化：
 *
 *   - demo/sample-reports/manifest.json   12 份样例报告元信息（含教师金标准分）
 *   - demo/sample-reports/sample-XX.md    12 份样例报告原文
 *   - demo/rubric/rubric.json             12 个评分点定义
 *   - public/results/result-{id}.json     评阅结果（按契约 ReviewResult）
 *
 * 结果文件扫描规则：**排除以 `_` 开头的文件**（`_example.json` 只是契约格式示例，
 * 不是任何真实报告的评阅结果，不得当作真实结果渲染）。
 *
 * 降级策略：任何一份报告缺少结果文件时，返回 status: 'missing'，
 * 由页面渲染「评阅结果待生成」空态，绝不抛异常、绝不白屏。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  RubricSchema,
  validateReviewResult,
  type ReviewResult,
  type Rubric,
  type ScoreLevel,
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

/** 定位仓库内的 demo 目录（构建期 cwd 为 frontend/） */
function findDemoDir(): string {
  const primary = path.resolve(process.cwd(), '..', 'demo');
  if (fs.existsSync(path.join(primary, 'sample-reports', 'manifest.json'))) return primary;
  const fallback = path.resolve(process.cwd(), 'demo');
  if (fs.existsSync(path.join(fallback, 'sample-reports', 'manifest.json'))) return fallback;
  return primary;
}

const DEMO_DIR = findDemoDir();
const REPORTS_DIR = path.join(DEMO_DIR, 'sample-reports');
const RUBRIC_FILE = path.join(DEMO_DIR, 'rubric', 'rubric.json');
const RESULTS_DIR = path.join(process.cwd(), 'public', 'results');

/** 结果文件绝对路径（约定：result-{reportId}.json） */
export function resultFilePath(reportId: string): string {
  return path.join(RESULTS_DIR, `result-${reportId}.json`);
}

/* ==========================================================================
 * manifest：样例报告元信息
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

/** manifest.json 的结构 */
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

/** 读取 manifest（构建期一次，进程内缓存） */
export function getManifest(): SampleManifest {
  if (manifestCache !== null) return manifestCache;
  const raw = fs.readFileSync(path.join(REPORTS_DIR, 'manifest.json'), 'utf8');
  const parsed = JSON.parse(raw) as SampleManifest;
  if (!Array.isArray(parsed.reports)) {
    throw new Error('manifest.json 结构异常：reports 不是数组');
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
  const file = path.join(REPORTS_DIR, report.fileName);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

/* ==========================================================================
 * rubric：评分点定义
 * ========================================================================== */

let rubricCache: Rubric | null = null;

/** 读取并校验 rubric（构建期一次） */
export function getRubric(): Rubric {
  if (rubricCache !== null) return rubricCache;
  const raw = fs.readFileSync(RUBRIC_FILE, 'utf8');
  const parsed = RubricSchema.parse(JSON.parse(raw));
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
 * 规则：仅 .json，且**排除以 `_` 开头的文件**（如 `_example.json`）。
 */
export function listResultFiles(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .sort();
}

/** 已产出评阅结果的报告 id 列表（仅统计能对应到样例报告的 id） */
export function getGeneratedReportIds(): string[] {
  const known = new Set(getSampleReports().map((item) => item.id));
  return listResultFiles()
    .map((name) => /^result-(.+)\.json$/.exec(name)?.[1] ?? '')
    .filter((id) => id.length > 0 && known.has(id));
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

/* ==========================================================================
 * 构建期确定性核查：lib/inspectors/
 * ---------------------------------------------------------------------------
 * 核查器（章节 / 代码 / 统计量 / 图表引用 / 相似度）是不依赖任何数据源的纯函数，
 * 本层只负责「取原文 → 调用 → 进程内缓存」，保证 12 个详情页共享同一份计算结果：
 * 同一次构建中每份报告只核查一次，两两相似度的 C(12,2)=66 对也只算一次。
 *
 * 全部计算发生在构建期，结果随 HTML 固化进静态产物；运行时不需要任何计算。
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
 * 契约示例：public/results/_example.json
 * ========================================================================== */

/**
 * 读取契约格式示例（`_example.json`）。
 * 它**不是任何真实报告的评阅结果**，仅用于 /trace 展示一份完整的溯源链样例。
 * 读取失败或校验不通过时返回 null，由页面降级。
 */
export function getContractExample(): ReviewResult | null {
  const absolute = path.join(RESULTS_DIR, '_example.json');
  if (!fs.existsSync(absolute)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    const validation = validateReviewResult(parsed);
    return validation.ok ? validation.data : null;
  } catch {
    return null;
  }
}
