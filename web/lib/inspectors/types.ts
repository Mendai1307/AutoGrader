/**
 * AutoGrader · 浏览器端确定性核查器 —— 统一类型契约
 * ============================================================================
 * 本目录下的全部模块都是「非 AI、真实运行」的客观核查器：
 *   - 纯函数、确定性：同样输入必然得到逐字节相同的输出；
 *   - 零 AI / 零网络 / 零 DOM / 零 Node API：可在构建期（Node）与运行时（浏览器）两端运行；
 *   - 只读输入字符串，不修改任何外部状态，不产生副作用。
 *
 * 语义层评阅（理解、归因、生成评语）由 LearnBuddy 对话侧完成并产出 JSON（Compile-time AI）；
 * 本目录只负责「机器能确切判定的事实」——章节、代码、统计量、图表引用、查重指纹。
 *
 * @see docs/contract.md
 */

/* ==========================================================================
 * 0. 基础枚举：核查级别与核查类别
 * ========================================================================== */

/** 单条核查结论的严重级别 */
export type InspectionLevel = 'info' | 'warn' | 'error';

/** 核查类别：与四个子核查器一一对应 */
export type InspectionCategory = 'chapters' | 'code' | 'stats' | 'figures';

/** 级别取值清单（导出供 UI 做确定性排序 / 渲染色映射） */
export const INSPECTION_LEVELS: readonly InspectionLevel[] = ['error', 'warn', 'info'];

/** 类别取值清单（导出供 UI 做分组顺序，顺序即展示顺序） */
export const INSPECTION_CATEGORIES: readonly InspectionCategory[] = [
  'chapters',
  'code',
  'stats',
  'figures',
];

/* ==========================================================================
 * 1. InspectionFinding：一条核查结论
 * ========================================================================== */

/**
 * 一条客观核查结论。
 * 注意：这不是 AI 判分，而是「机器可确切判定」的事实陈述，
 * 因此 detail 中只允许陈述检测到的事实与口径，不得出现评分或主观推断。
 */
export interface InspectionFinding {
  /** 结论唯一 id，形如 "chapters:missing:analysis"；同一份报告内唯一且稳定 */
  id: string;
  /** 所属核查类别 */
  category: InspectionCategory;
  /** 严重级别：info = 通过 / 供参考，warn = 需注意，error = 明确缺陷 */
  level: InspectionLevel;
  /** 一句话结论（中文，简短，可直接展示在核查面板） */
  title: string;
  /** 结论细节：口径、数量、判定规则说明 */
  detail: string;
  /** 证据：原文片段或行号定位；无证据时可省略 */
  evidence?: string;
}

/* ==========================================================================
 * 2. 章节完整性（chapters.ts）
 * ========================================================================== */

/** 章节命中的方式 */
export type ChapterMatchMode = 'heading' | 'keyword' | 'none';

/** 单个必备章节的核查结果 */
export interface ChapterHit {
  /** 章节键，如 "purpose" */
  key: string;
  /** 章节中文名，如 "实验目的" */
  label: string;
  /** 是否在报告中找到 */
  present: boolean;
  /** 命中所在行号（1 起）；未命中为 null */
  line: number | null;
  /** 命中的原始行文本（已 trim）；未命中为 null */
  source: string | null;
  /** 命中方式：标题行 / 关键词回退 / 未命中 */
  matchedBy: ChapterMatchMode;
  /** 实际命中的别名，如 "实验原理"；未命中为 null */
  alias: string | null;
}

/** 章节完整性核查结果 */
export interface ChapterInspection {
  /** 必备章节总数 */
  required: number;
  /** 已找到的章节数 */
  found: number;
  /** 缺失章节数 */
  missingCount: number;
  /** 逐项结果，顺序与 CHAPTER_RULES 一致（确定性） */
  items: ChapterHit[];
  /** 缺失章节的键列表（按 CHAPTER_RULES 顺序） */
  missingKeys: string[];
}

/* ==========================================================================
 * 3. 代码分析（code.ts）
 * ========================================================================== */

/** 单个代码块的结构信息 */
export interface CodeBlockInfo {
  /** 代码块序号，从 1 开始，按出现顺序 */
  index: number;
  /** 原始语言标注（围栏后的第一个词，未标注则为空串） */
  language: string;
  /** 归一化后的语言名，如 "c" / "python" / "shell" / "unknown" */
  languageKey: string;
  /** 是否带语言标注 */
  hasLanguageTag: boolean;
  /** 围栏起始行号（1 起） */
  startLine: number;
  /** 围栏结束行号（1 起）；未闭合时为最后一行 */
  endLine: number;
  /** 围栏是否正确闭合 */
  closed: boolean;
  /** 代码正文行数（不含围栏行） */
  lineCount: number;
  /** 代码正文中非空行数 */
  nonEmptyLineCount: number;
}

/** 单个语言的汇总统计 */
export interface LanguageStat {
  /** 归一化语言名 */
  languageKey: string;
  /** 该语言的代码块数 */
  blocks: number;
  /** 该语言的代码行数 */
  lines: number;
}

/** 关键 API / 算法命中项 */
export interface CodeHit {
  /** 命中的关键词，如 "pthread_mutex_lock" */
  keyword: string;
  /** 关键词中文说明 */
  label: string;
  /** 所属主题 id，如 "os-thread-sync" */
  topic: string;
  /** 所属主题中文名 */
  topicLabel: string;
  /** 类别：系统调用 / 库函数（api）或算法实现（algorithm） */
  kind: 'api' | 'algorithm';
  /** 命中总次数 */
  occurrences: number;
  /** 命中所在的代码块序号（升序去重） */
  blocks: number[];
  /** 命中所在的绝对行号（升序去重，1 起） */
  lines: number[];
}

/** 代码分析结果 */
export interface CodeInspection {
  /** 代码块总数 */
  blockCount: number;
  /** 代码正文总行数 */
  codeLines: number;
  /** 代码块正文中非空行总数 */
  nonEmptyCodeLines: number;
  /** 未标注语言的代码块数 */
  untaggedBlockCount: number;
  /** 未闭合的代码块数 */
  unclosedBlockCount: number;
  /** 语言分布（按行数降序、语言名字典序升序，确定性） */
  languages: LanguageStat[];
  /** 逐块结构信息（按出现顺序） */
  blocks: CodeBlockInfo[];
  /** 关键 API / 算法命中项（按主题目录顺序，确定性） */
  hits: CodeHit[];
  /** 有命中的主题 id 列表（按主题目录顺序） */
  hitTopics: string[];
  /** 命中项总数 */
  hitCount: number;
  /** 命中总次数 */
  hitOccurrences: number;
}

/* ==========================================================================
 * 4. 统计量（stats.ts）
 * ========================================================================== */

/**
 * 正文统计量。
 *
 * 口径（与 demo/sample-reports/manifest.json 的 wordCountBasis 对齐）：
 *   正文字数 = 汉字数 + 英文单词数，不计代码块内容、不计 Markdown 标记与空白。
 * 补充约定（本实现明确固定，避免口径漂移）：
 *   - 图片与链接的 URL 不计入，但图片题注（alt 文本）与链接文字计入；
 *   - 围栏代码块的围栏行与代码正文都不计入；
 *   - 英文单词 = 连续 [A-Za-z] 字母串，数字不计为单词。
 */
export interface StatsInspection {
  /** 汉字字符数（含 CJK 扩展 A 与兼容汉字区） */
  cjkChars: number;
  /** 英文单词数 */
  englishWords: number;
  /** 正文字数 = cjkChars + englishWords */
  wordCount: number;
  /** 文档总行数（含代码块与空行） */
  totalLines: number;
  /** 非空行数（含代码块内的非空行） */
  nonEmptyLines: number;
  /** 正文行数（围栏代码块之外的行） */
  proseLines: number;
  /** 标题行数 */
  headingCount: number;
  /** 代码块数 */
  codeBlockCount: number;
  /** 代码正文行数 */
  codeLines: number;
  /** 图片引用数（Markdown 图片语法） */
  imageRefs: number;
  /** 表格数（按 Markdown 表格分隔行计） */
  tableCount: number;
  /** 表格数据行数（不含表头与分隔行） */
  tableRows: number;
  /** Markdown 链接数（不含图片） */
  linkRefs: number;
}

/* ==========================================================================
 * 5. 图表引用核查（figures.ts）
 * ========================================================================== */

/** 图片被正文引用的方式 */
export type FigureReferenceMode = 'number' | 'generic' | 'none';

/** 单张图片的核查结果 */
export interface FigureRef {
  /** 图片序号，从 1 开始，按出现顺序 */
  index: number;
  /** 图片所在行号（1 起） */
  line: number;
  /** 题注（Markdown alt 文本，已 trim） */
  alt: string;
  /** 图片路径（Markdown 链接目标） */
  url: string;
  /** 从题注中解析出的图号数字部分，如 "3-1"；无编号为 null */
  number: string | null;
  /** 带前缀的图号标签，如 "图3-1"；无编号为 null */
  numberLabel: string | null;
  /** 是否有题注（alt 非空） */
  captioned: boolean;
  /** 是否被正文引用 */
  referenced: boolean;
  /** 引用方式：按图号 / 泛指（如图中所示）/ 未引用 */
  referenceMode: FigureReferenceMode;
  /** 引用所在行号；未引用为 null */
  referenceLine: number | null;
  /** 引用所在行的原文片段；未引用为 null */
  referenceText: string | null;
}

/** 图表引用核查结果 */
export interface FigureInspection {
  /** 图片总数 */
  count: number;
  /** 被正文引用的图片数 */
  referencedCount: number;
  /** 未被正文引用的图片数 */
  unreferencedCount: number;
  /** 仅凭泛指措辞（如图中所示）被引用的图片数，属于弱证据 */
  genericReferenceCount: number;
  /** 缺少图号的图片数 */
  unnumberedCount: number;
  /** 缺少题注的图片数 */
  uncaptionedCount: number;
  /** 逐张图片结果（按出现顺序） */
  figures: FigureRef[];
  /** 未被引用的图片序号（升序） */
  unreferencedIndexes: number[];
}

/* ==========================================================================
 * 6. 相似度比对（similarity.ts）
 * ========================================================================== */

/** 一对报告的相似度结果 */
export interface SimilarityPair {
  /** 报告 A 的 id */
  a: string;
  /** 报告 B 的 id */
  b: string;
  /** 汉明距离（0–64） */
  distance: number;
  /** 相似度 0–1（= 1 - distance / 64） */
  similarity: number;
  /** 相似度分级 */
  grade: SimilarityGrade;
}

/** 相似度分级：照抄嫌疑 / 需人工复核 / 正常区分 */
export type SimilarityGrade = 'duplicate' | 'suspicious' | 'distinct';

/** 参与相似度比对的输入项 */
export interface SimilarityInput {
  /** 报告 id */
  id: string;
  /** 报告全文（Markdown 原文） */
  text: string;
}

/* ==========================================================================
 * 7. InspectionReport：顶层输出
 * ========================================================================== */

/**
 * 一份报告的完整核查结果。
 *
 * generatedAt 故意不由 inspectReport 填写：写入时间会破坏「同样输入必须得到
 * 完全相同输出」的确定性约束，因此由调用方（UI 层）在展示时按需补充。
 */
export interface InspectionReport {
  /** 报告 id */
  reportId: string;
  /** 章节完整性核查结果 */
  chapters: ChapterInspection;
  /** 代码分析结果 */
  codes: CodeInspection;
  /** 正文统计量 */
  stats: StatsInspection;
  /** 图表引用核查结果 */
  figures: FigureInspection;
  /** 全部核查结论，按「类别顺序 → 结论 id 字典序」确定性排序 */
  findings: InspectionFinding[];
  /** 生成时间（ISO8601）；由调用方按需填写，核查器本身不写入 */
  generatedAt?: string;
}
