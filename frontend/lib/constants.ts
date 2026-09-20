/**
 * AutoGrader · 界面常量与语义标签映射
 * ---------------------------------------------------------------------------
 * 仅承载「展示用」的枚举中文名与配色，不承载任何业务口径。
 * 口径类常量（置信度阈值、档位枚举、总分公式）一律以 lib/schema.ts 为准。
 *
 * 注意：本文件中的 Tailwind 类名需被 tailwind.config.ts 的 content 扫描到，
 * 其 content 已包含 lib 目录下的 ts / tsx 文件，故写在这里的类名不会被裁剪。
 */

import type { AgentName, EvidenceKind, ScoreLevel } from '@/lib/schema';

/** 站点产品名与一句话定位 */
export const SITE_NAME = 'AutoGrader 智能评阅平台';
export const SITE_TAGLINE = '面向高校计算机专业实验报告的 AI 智能评阅平台';
export const SITE_POSITIONING =
  '教师定义评分点（Rubric），系统逐项提取证据、评分、复核，产出可溯源、可审计的评语。';

/** AI 能力来源声明（首页与页脚共用，措辞不可弱化） */
export const AI_SOURCE_STATEMENT = '智能评阅能力由 LearnBuddy 提供，Web 端零 AI 调用。';

/** 顶部导航 */
export interface NavItem {
  href: string;
  label: string;
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: '首页', description: '产品定位与流水线总览' },
  { href: '/grade', label: '评阅工作台', description: '样例报告与评阅状态' },
  { href: '/eval', label: '一致性评测', description: 'AI 评分与教师金标准分对比' },
  { href: '/trace', label: '工作流溯源', description: '五 Agent 中间产物与审计信息' },
];

/** 判阅结果文件的命名约定 */
export const RESULT_FILE_CONVENTION = 'result-{reportId}.json';

/* ==========================================================================
 * 五 Agent 流水线
 * ========================================================================== */

export interface AgentMeta {
  key: AgentName;
  /** 英文名（与契约 AgentNameSchema 取值一致） */
  name: string;
  /** 中文职能名 */
  role: string;
  /** 该 Agent 的职责一句话 */
  responsibility: string;
  /** 该步骤的输入摘要（示意） */
  inputHint: string;
  /** 该步骤的产出摘要（示意） */
  outputHint: string;
}

export const AGENTS: readonly AgentMeta[] = [
  {
    key: 'parser',
    name: 'Parser',
    role: '报告解析',
    responsibility: '把原始实验报告切分为结构化章节树，并定位代码块与插图',
    inputHint: '报告原文（Markdown / PDF 文本）',
    outputHint: '章节树 · 代码块 · 插图索引',
  },
  {
    key: 'evidence',
    name: 'Evidence',
    role: '证据提取',
    responsibility: '对齐评分点，逐点定位可引用的原文片段，逐字摘录不改写',
    inputHint: '章节树 + Rubric 评分点',
    outputHint: '证据条目（正文 / 代码 / 截图 / 表格）+ 证据置信度',
  },
  {
    key: 'grader',
    name: 'Grader',
    role: '逐项评分',
    responsibility: '按档位判定标准与扣分梯度给出档位、得分与判定置信度',
    inputHint: '证据条目 + 档位标准与扣分梯度',
    outputHint: '逐项得分 + 加权总分 + 置信度分布',
  },
  {
    key: 'reviewer',
    name: 'Reviewer',
    role: '复核质检',
    responsibility: '对置信度低于 0.80 的判定做二次比对，上调置信度或改判档位',
    inputHint: '低置信度判定 + 其证据原文',
    outputHint: '复核意见 + 置信度变化（before → after）',
  },
  {
    key: 'feedback',
    name: 'Feedback',
    role: '评语生成',
    responsibility: '汇总评分明细与复核意见，产出面向学生的亮点与可执行改进建议',
    inputHint: '评分明细 + 复核意见 + 证据摘要',
    outputHint: '评语（总体评价 / 亮点 / 改进建议）',
  },
];

/** 判分档位的中文名与配色 */
export interface LevelMeta {
  label: string;
  /** 徽章样式 */
  chip: string;
  /** 进度条样式 */
  bar: string;
  /** 纯文本色 */
  text: string;
}

export const LEVEL_META: Readonly<Record<ScoreLevel, LevelMeta>> = {
  excellent: {
    label: '优秀',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  meeting: {
    label: '达标',
    chip: 'border-sky-200 bg-sky-50 text-sky-700',
    bar: 'bg-sky-500',
    text: 'text-sky-700',
  },
  partial: {
    label: '部分达标',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
  },
  notMet: {
    label: '未达标',
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
    bar: 'bg-rose-500',
    text: 'text-rose-700',
  },
};

/** 难度档位（manifest.tier）的中文名与配色 */
export interface TierMeta {
  chip: string;
  desc: string;
}

export const TIER_META: Readonly<Record<string, TierMeta>> = {
  优: { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', desc: '结构完整、数据量化、反思到位' },
  良: { chip: 'border-sky-200 bg-sky-50 text-sky-700', desc: '主体正确，分析或规范存在明显短板' },
  中: { chip: 'border-amber-200 bg-amber-50 text-amber-700', desc: '关键环节缺失，证据不足' },
  差: { chip: 'border-rose-200 bg-rose-50 text-rose-700', desc: '篇幅严重不足或核心机制未实现' },
};

export const TIER_ORDER: readonly string[] = ['优', '良', '中', '差'];

/** 证据类型的中文名 */
export const EVIDENCE_KIND_META: Readonly<Record<EvidenceKind, string>> = {
  text: '正文',
  code: '代码',
  figure: '截图',
  table: '表格',
};

/** 置信度分级配色 */
export const CONFIDENCE_GRADE_META = {
  high: { label: '高置信度', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  medium: { label: '中置信度', chip: 'border-amber-200 bg-amber-50 text-amber-700', bar: 'bg-amber-500' },
  low: { label: '低置信度', chip: 'border-rose-200 bg-rose-50 text-rose-700', bar: 'bg-rose-500' },
} as const;

/** 评语语气风格的中文名 */
export const TONE_META: Readonly<Record<string, string>> = {
  encouraging: '鼓励式',
  neutral: '中性客观',
  critical: '严格指出问题',
};

/** 状态徽章：已有评阅结果 / 待生成 */
export const STATUS_META = {
  ok: { label: '已有评阅结果', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  invalid: { label: '结果校验未通过', chip: 'border-rose-200 bg-rose-50 text-rose-700' },
  missing: { label: '待生成', chip: 'border-border bg-muted text-muted-foreground' },
} as const;
