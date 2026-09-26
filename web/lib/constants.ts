/**
 * AutoGrader · 界面常量与语义标签映射
 * ---------------------------------------------------------------------------
 * 仅承载「展示用」的枚举中文名与视觉映射，不承载任何业务口径。
 * 口径类常量（置信度阈值、档位枚举、总分公式）一律以 lib/schema.ts 为准。
 *
 * 色彩策略（本项目硬规定）
 * ---------------------------------------------------------------------------
 *   **单强调色 + 灰阶**：暖棕(primary) 是唯一强调色，暖杏金(accent) 只用于"选中/命中"。
 *   数据语义（档位 / 置信度 / 难度档）**不用红绿**，改用三条正交手段表达：
 *     ① 序数符号：`●●●●` / `●●●○` / `●●○○` / `●○○○`（等宽，纵向可比）
 *     ② 字重：600 / 400
 *     ③ 灰阶：foreground → foreground/70 → muted-foreground → rule
 *   理由：红绿在色觉障碍下不可辨；且参考设计本身是单色体系，引入第二色系会破调性。
 *   `destructive`（低饱和赭石）**只留给"真的出错"**：构建失败、契约校验不通过。
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
  { href: '/agents', label: '智能体构成', description: 'Prompt / Skills / Tools / Workflow / Evaluation 五件套' },
  { href: '/grade', label: '评阅工作台', description: '样例报告与评阅状态' },
  { href: '/upload', label: '上传核查', description: '上传报告即时做确定性核查' },
  { href: '/eval', label: '一致性评测', description: 'AI 评分与教师金标准分对比' },
  { href: '/trace', label: '溯源与指纹', description: '中间产物、契约不变式与结果指纹' },
];

/** 评阅结果文件的命名约定 */
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
    inputHint: '报告原文（docx / pdf / md / txt）',
    outputHint: '章节树 · 结构块 · 统计摘要',
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

/* ==========================================================================
 * 序数符号：4 格 / 3 格刻度（只用 ● 与 ○，二者均在 GB2312 内，字体必然覆盖）
 * ========================================================================== */

/**
 * 生成 n 格刻度的第 k 级（k 从 1 起，越大越"满"）。
 * 纯字符串拼装，无 glyph 依赖风险：● U+25CF 与 ○ U+25CB 都在 GB2312 里。
 */
export function meterSymbol(level: number, cells: number): string {
  const filled = Math.max(0, Math.min(cells, level));
  return '●'.repeat(filled) + '○'.repeat(cells - filled);
}

/** 档位的中文名与视觉映射 */
export interface LevelMeta {
  label: string;
  /** 序数符号：4 格刻度，等宽可直接纵向比对 */
  symbol: string;
  /** 徽章样式 */
  chip: string;
  /** 进度条填充样式 */
  bar: string;
  /** 纯文本样式（含字重） */
  text: string;
}

/**
 * 四档档位的视觉映射。
 * 有序性由 `symbol`（刻度格数）承载，颜色只表达层级深浅 —— 故不出现红/绿/蓝。
 */
export const LEVEL_META: Readonly<Record<ScoreLevel, LevelMeta>> = {
  excellent: {
    label: '优秀',
    symbol: meterSymbol(4, 4),
    chip: 'border-primary/45 bg-primary/5 text-foreground',
    bar: 'bg-foreground',
    text: 'font-semibold text-foreground',
  },
  meeting: {
    label: '达标',
    symbol: meterSymbol(3, 4),
    chip: 'border-border bg-card text-foreground',
    bar: 'bg-foreground/70',
    text: 'text-foreground',
  },
  partial: {
    label: '部分达标',
    symbol: meterSymbol(2, 4),
    chip: 'border-border bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
  notMet: {
    label: '未达标',
    symbol: meterSymbol(1, 4),
    chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
    bar: 'bg-rule',
    text: 'text-muted-foreground',
  },
};

/** 难度档位（manifest.tier）的中文名与视觉映射 */
export interface TierMeta {
  chip: string;
  symbol: string;
  desc: string;
}

export const TIER_META: Readonly<Record<string, TierMeta>> = {
  优: {
    symbol: meterSymbol(4, 4),
    chip: 'border-primary/45 bg-primary/5 text-foreground',
    desc: '结构完整、数据量化、反思到位',
  },
  良: {
    symbol: meterSymbol(3, 4),
    chip: 'border-border bg-card text-foreground',
    desc: '主体正确，分析或规范存在明显短板',
  },
  中: {
    symbol: meterSymbol(2, 4),
    chip: 'border-border bg-muted text-muted-foreground',
    desc: '关键环节缺失，证据不足',
  },
  差: {
    symbol: meterSymbol(1, 4),
    chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
    desc: '篇幅严重不足或核心机制未实现',
  },
};

export const TIER_ORDER: readonly string[] = ['优', '良', '中', '差'];

/** 证据类型的中文名 */
export const EVIDENCE_KIND_META: Readonly<Record<EvidenceKind, string>> = {
  text: '正文',
  code: '代码',
  figure: '截图',
  table: '表格',
};

/**
 * 置信度分级的视觉映射（3 格刻度）。
 * 分级阈值（0.80 / 0.60）是契约口径，定义在 lib/schema.ts 的 CONFIDENCE_THRESHOLD。
 */
export const CONFIDENCE_GRADE_META = {
  high: {
    label: '高置信度',
    symbol: meterSymbol(3, 3),
    chip: 'border-primary/45 bg-primary/5 text-foreground',
    bar: 'bg-foreground',
  },
  medium: {
    label: '中置信度',
    symbol: meterSymbol(2, 3),
    chip: 'border-border bg-muted text-muted-foreground',
    bar: 'bg-foreground/70',
  },
  low: {
    label: '低置信度',
    symbol: meterSymbol(1, 3),
    chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
    bar: 'bg-rule',
  },
} as const;

/* ==========================================================================
 * 两个正交标记：needsReview（需人过目）vs pending（无终值）
 * ---------------------------------------------------------------------------
 * ⚠️ 契约要求二者**语义正交、不得合并**：
 *   needsReview —— 需教师看一眼，**不影响总分**；
 *   pending     —— 尚无终值，**不计入求和**，权重进 total.weightExcluded。
 * 因此二者必须**视觉可区分**：一个用 ※（形似注记），一个用 □（形似空缺）。
 * ========================================================================== */

export const NEEDS_REVIEW_META = {
  label: '待过目',
  symbol: '※',
  description: '需教师看一眼；不影响总分',
  chip: 'border-dashed border-rule bg-transparent text-muted-foreground',
} as const;

export const PENDING_META = {
  label: '无终值',
  symbol: '□',
  description: '尚无终值；不计入总分求和，权重计入已排除',
  chip: 'border-rule bg-secondary/60 text-foreground',
} as const;

/** 评语语气风格的中文名 */
export const TONE_META: Readonly<Record<string, string>> = {
  encouraging: '鼓励式',
  neutral: '中性客观',
  critical: '严格指出问题',
};

/**
 * 状态徽章：已有评阅结果 / 校验未通过 / 待生成。
 * 只有 `invalid`（契约校验真的没通过）用 destructive —— 这是"真的出错"。
 */
export const STATUS_META = {
  ok: { label: '已有评阅结果', chip: 'border-primary/45 bg-primary/5 text-foreground', symbol: '●' },
  invalid: { label: '结果校验未通过', chip: 'border-destructive/50 bg-destructive/5 text-destructive', symbol: '×' },
  missing: { label: '待生成', chip: 'border-dashed border-rule bg-transparent text-muted-foreground', symbol: '□' },
} as const;

/* ==========================================================================
 * 契约口径的展示文案（措辞与 docs/contract.md 保持一致，不得弱化）
 * ========================================================================== */

/** 总分公式（写死，不得改写） */
export const TOTAL_FORMULA = '总分 = Σ (score / maxScore) × weight';

/** 权重序列（和 = 100） */
export const WEIGHT_SEQUENCE: readonly number[] = [5, 12, 5, 7, 20, 10, 11, 13, 7, 5, 3, 2];

/** 上界口径（写死）：不是 100 − weightExcluded */
export const UPPER_BOUND_NOTE = '上界 = Σ已计入 weight（= weightIncluded），不是 100 − weightExcluded';

/** 部分分语义说明 */
export const PARTIAL_SCORE_NOTE =
  '待复核项（pending）不计入求和、不做归一化，故总分是部分分（下界），须连同已排除权重一起看';

/** 分数复算容差 */
export const SCORE_TOLERANCE = 0.01;

/* ==========================================================================
 * 深链唤起 LearnBuddy（2.6）
 * ==========================================================================
 * 平台侧事实（现场复核过，写死在这里，不要在别处再猜一遍）：
 *   · 协议名是 `learnbuddy://`（**不是** `workbuddy://`）
 *   · 形态 `learnbuddy://task?action=start&prompt=<encodeURIComponent>`，
 *     行为是**草稿预填，不自动执行** —— 用户还要在 LearnBuddy 里按一下发送
 *   · `prompt` 解码后上限 8000 字符；深链总长受 Windows 命令行 32767 上限约束
 *   · 网页端必须用**顶层真实 `<a>` 点击**，`location.href` 会被丢弃
 * ========================================================================== */

/** 深链协议。写死，因为它是平台事实而不是可配置项。 */
export const DEEP_LINK_SCHEME = 'learnbuddy://task';

/** 平台对 `prompt` 解码后的字符上限 */
export const DEEP_LINK_PROMPT_LIMIT = 8000;

/**
 * 仓库 raw 根，供深链 prompt 里的智能体用内置 `WebFetch` 读取系统提示词全文。
 *
 * ⚠️ **留空是正常状态，不要填一个假仓库名**：
 *   - 运行时若站点托管在 GitHub Pages（`<owner>.github.io/<repo>/`），
 *     `DeepLinkButton` 会**自动推导**出 `https://raw.githubusercontent.com/<owner>/<repo>/HEAD`；
 *   - 若推导不出来（本地预览、自定义域名），深链 prompt 会**降级**为
 *     「请向用户索取系统提示词」，不会产生死按钮。
 *   - 仓库建好后若要固定指向，在这里填绝对 URL（不带结尾斜杠）。
 */
export const REPO_RAW_BASE: string = '';

/** 系统提示词在仓库里的路径（深链 prompt 只给路径，不内联全文） */
export const SYSTEM_PROMPT_REPO_PATH = 'backend/autograder-expert/agents/agent/SYSTEM_PROMPT.md';

/** 深链 prompt 里的动作词，与平台三模式口径一致 */
export const DEEP_LINK_ACTIONS: Readonly<Record<'review' | 'recheck', string>> = {
  review: '按模式 2（评阅）',
  recheck: '按模式 3（复核）',
};

/* ==========================================================================
 * 三档语义色的**唯一写法来源**
 * ==========================================================================
 * 设计裁决：**单强调色 + 灰阶**，数据语义靠「字重 / 深浅阶 / 符号」表达，
 * **不引入红绿**；`--destructive` 只留给"真的出错"。
 *
 * 这里的三档与 `components/ui/badge.tsx` 的 accent / warning / danger 变体**逐字一致** ——
 * 页面上不要再手写 `text-emerald-*` / `text-amber-*` / `text-rose-*`：
 *   · ok     —— 完成 / 命中 / 已就绪         → 正文深色（靠字重强调），图标用唯一强调色
 *   · notice —— 需注意但**不是**错误         → 弱字色 + 强调细线（靠"形"而非"色"提示）
 *   · bad    —— 真的出错（构建失败 / 契约不合规 / 复算不一致）→ 低饱和赭石
 * ========================================================================== */

export const TONE = {
  ok: {
    text: 'text-foreground',
    icon: 'text-primary',
    card: 'border-border bg-secondary/30',
    bar: 'bg-foreground/70',
    badge: 'border-primary/45 bg-primary/5 text-foreground',
  },
  notice: {
    text: 'text-muted-foreground',
    icon: 'text-muted-foreground',
    card: 'border-rule bg-secondary/60',
    bar: 'bg-rule',
    badge: 'border-dashed border-rule bg-transparent text-muted-foreground',
  },
  bad: {
    text: 'text-destructive',
    icon: 'text-destructive',
    card: 'border-destructive/40 bg-destructive/5',
    bar: 'bg-destructive/60',
    badge: 'border-destructive/50 bg-destructive/5 text-destructive',
  },
} as const;

export type ToneKey = keyof typeof TONE;

/**
 * 偏差三档 → 语义 key。
 * 阈值留在调用处（不同指标的量纲不同），这里只做"绝对值 → 档位"的映射。
 */
export function deltaTone(abs: number, okMax: number, noticeMax: number): ToneKey {
  if (abs <= okMax) return 'ok';
  if (abs <= noticeMax) return 'notice';
  return 'bad';
}

/**
 * 比例三档 → 语义 key（比例越高越好时用）。
 * 用于命中率、一致率这类"越大越好"的指标。
 */
export function ratioTone(ratio: number, okMin: number, noticeMin: number): ToneKey {
  if (ratio >= okMin) return 'ok';
  if (ratio >= noticeMin) return 'notice';
  return 'bad';
}

