/**
 * AutoGrader · ReviewResult 数据契约（全系统枢纽）
 * ============================================================================
 * 本文件同时约束四件事，四者必须严格一致：
 *   1. LearnBuddy 侧五 Agent 流水线（Parser → Evidence → Grader → Reviewer → Feedback）
 *      最终产出的 JSON 结构；
 *   2. **冻结契约** contract/ReviewResult.schema.json（1.2.0）—— 机器可读真源；
 *      `scripts/contract-check.mjs` 会在构建期核对两侧字段集合是否**双向相等**，
 *      任一不等即让构建失败（防止这里与真源漂移）；
 *   3. 前端 TypeScript 类型（由 z.infer 推导，禁止另写一份重复定义）；
 *   4. 仓库内静态资产 web/public/results/*.json。
 *
 * 设计前提（不可违背）：
 *   - AI 推理只发生在 LearnBuddy 对话侧（开发时），Web 端运行时零 AI 调用、零后端、零数据库；
 *   - 运行时依赖仅允许 zod，禁止 openai / anthropic / langchain-* 等第三方 AI 依赖；
 *   - 全部对象使用 .strict()：未知字段一律拒绝，防止 AI 自由发挥导致资产腐化。
 *
 * 与 v0.1 的关系：本文件是 v0.1 Zod 契约（589 行）的**向后兼容超集**，
 *   1.2.0 新增字段一律 optional，故 12 份 1.0.0 历史资产一行不改继续通过。
 *
 * 人类可读的口径说明（总分算法、置信度分级、版本递增规范、13 条不变式）见 docs/contract.md。
 *
 * @see docs/contract.md
 * @see contract/ReviewResult.schema.json
 */

import { z } from 'zod';

/* ==========================================================================
 * 0. 全局常量：Schema 版本 / 置信度 / 评分档位
 * ========================================================================== */

/**
 * 本前端实现所对齐的契约版本号（= contract/ReviewResult.schema.json 的 $id 尾段）。
 * 递增规范见 docs/contract.md「schemaVersion 递增规范」一节。
 *
 * ⚠️ 不要拿它去**断言资产里的值**：仓库内 12 份历史资产写的是 "1.0.0"，
 *   而 1.2.0 是向后兼容超集，二者并存是刻意的。校验用的是下面的
 *   SchemaVersionSchema（形状校验），不是这个常量（版本断言）。
 */
export const CONTRACT_VERSION = '1.2.0';

/** 兼容旧引用名；语义等同 CONTRACT_VERSION */
export const SCHEMA_VERSION = CONTRACT_VERSION;

/**
 * schema 版本号的形状校验：MAJOR.MINOR.PATCH。
 * 与冻结契约 `#/$defs/SchemaVersion` 的 pattern 一致。
 */
export const SchemaVersionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'schema 版本号须形如 MAJOR.MINOR.PATCH，如 1.2.0');

/**
 * 任务类型：决定这次评阅走哪条链路。
 * 三模式（模式 4「教学分析」本期不做，见项目总纲第十节）。
 */
export const TaskTypeSchema = z.enum(['rubric-build', 'review', 'replay']);

/** 任务类型的中文标签（前端展示用） */
export const TASK_TYPE_LABELS: Readonly<Record<z.infer<typeof TaskTypeSchema>, string>> = {
  'rubric-build': '模式 1 · 建标',
  review: '模式 2 · 评阅',
  replay: '模式 3 · 复核（只读回放）',
} as const;


/**
 * 置信度：统一为 0–1 浮点数（0 = 完全无把握，1 = 完全确定）。
 * 禁止使用 0–100 整数或百分比字符串，避免前后端口径分裂。
 */
export const ConfidenceSchema = z
  .number()
  .min(0, '置信度必须在 0–1 之间')
  .max(1, '置信度必须在 0–1 之间');

/** 置信度分级阈值：取值区间的下界（含） */
export const CONFIDENCE_THRESHOLD = {
  /** 高置信度下界：≥ 0.80，判定可直接采信 */
  HIGH: 0.8,
  /** 中置信度下界：≥ 0.60 且 < 0.80，需 Reviewer 复核后方可采信 */
  MEDIUM: 0.6,
  /** 触发复核的阈值：低于 HIGH 下界（即 < 0.80）即需进入 Reviewer 环节 */
  REVIEW: 0.8,
} as const;

/** 置信度分级标识 */
export type ConfidenceGrade = 'high' | 'medium' | 'low';

/** 各置信度分级的语义说明（前端 UI 可直接展示） */
export const CONFIDENCE_SEMANTICS: Readonly<Record<ConfidenceGrade, string>> = {
  high: '证据充分且与评分点直接对应，判定可直接采信，无需复核',
  medium: '证据存在但不完整或存在歧义，须经 Reviewer 复核后方可采信',
  low: '证据薄弱或未找到有效证据，必须复核；复核后仍低于 0.60 的项须在界面显著标注并建议教师人工确认',
} as const;

/**
 * 将置信度数值映射为分级。
 * 纯函数，无副作用；输入应为 0–1 数值，越界时按边界处理。
 */
export function gradeConfidence(confidence: number): ConfidenceGrade {
  if (confidence >= CONFIDENCE_THRESHOLD.HIGH) return 'high';
  if (confidence >= CONFIDENCE_THRESHOLD.MEDIUM) return 'medium';
  return 'low';
}

/**
 * 是否因置信度不足而需要触发 Reviewer 复核。
 * 规则：confidence < CONFIDENCE_THRESHOLD.HIGH（0.80）即触发。
 * 注：ScoreItem.needsReview 还可能因"证据缺失""档位跨两级争议"等原因置为 true，
 * 本函数只表达置信度这一条触发条件。
 */
export function needsReviewByConfidence(confidence: number): boolean {
  return confidence < CONFIDENCE_THRESHOLD.REVIEW;
}

/**
 * 判定档位：优秀 / 达标 / 部分达标 / 未达标（四档）。
 * 具体每一档的判定标准与得分系数由 RubricItemLevel 定义，允许教师按评分点微调系数。
 */
export const ScoreLevelSchema = z.enum(['excellent', 'meeting', 'partial', 'notMet']);

/** 档位的中文标签（前端展示用） */
export const SCORE_LEVEL_LABELS: Readonly<Record<ScoreLevel, string>> = {
  excellent: '优秀',
  meeting: '达标',
  partial: '部分达标',
  notMet: '未达标',
} as const;

/**
 * ISO8601 时间字符串。
 * 使用 Date.parse 校验而非 z.string().datetime()，以同时接受
 * "2026-09-20T10:24:36Z" 与 "2026-09-20T10:24:36+08:00" 两种合法写法。
 */
const Iso8601Schema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: '必须为合法的 ISO8601 时间字符串（如 2026-09-20T10:24:36+08:00）',
  });

/* ==========================================================================
 * 1. Rubric：评分点定义
 * ========================================================================== */

/** 单个判定档位的定义 */
export const RubricItemLevelSchema = z
  .object({
    /** 档位标识：优秀 / 达标 / 部分达标 / 未达标 */
    level: ScoreLevelSchema,
    /** 档位中文名，如"优秀"，用于前端展示（可与标准标签不同，如"优秀（超额完成）"） */
    label: z.string().min(1, '档位名称不能为空'),
    /** 该档位的判定标准：达到什么条件才算命中这一档 */
    criterion: z.string().min(1, '判定标准不能为空'),
    /** 该档位的得分系数 0–1：得分 = 该项满分 × scoreRatio（保留 2 位小数） */
    scoreRatio: z
      .number()
      .min(0, '得分系数必须在 0–1 之间')
      .max(1, '得分系数必须在 0–1 之间'),
  })
  .strict();

/** 单个评分点 */
export const RubricItemSchema = z
  .object({
    /** 评分点唯一 id，如 "R3"；同一 rubric 内不可重复 */
    id: z.string().min(1, '评分点 id 不能为空'),
    /** 评分点名称，如"核心代码正确性与规范" */
    name: z.string().min(1, '评分点名称不能为空'),
    /** 权重（百分比数值 0–100），同一 rubric 内所有评分点权重之和必须为 100 */
    weight: z
      .number()
      .min(0, '权重必须在 0–100 之间')
      .max(100, '权重必须在 0–100 之间'),
    /** 该评分点的满分（教师自定标度，如 10 / 20 / 5），得分不得超出该值 */
    maxScore: z.number().gt(0, '满分必须大于 0'),
    /** 证据要求说明：命中该评分点需要什么样的证据（章节、代码 API、截图内容等） */
    evidenceRequirement: z.string().min(1, '证据要求说明不能为空'),
    /** 判定等级档位，建议四档齐全（优秀/达标/部分达标/未达标） */
    levels: z.array(RubricItemLevelSchema).min(1, '至少需要一个判定档位'),
    /** 扣分梯度说明：在档位基础上如何浮动作出扣分（如"缺少环境版本扣 2 分"） */
    deductionNotes: z.string().min(1, '扣分梯度说明不能为空'),
  })
  .strict();

/** 一份完整的评分量规 */
export const RubricSchema = z
  .object({
    /** rubric 唯一 id，如 "rubric-os-thread-lab" */
    id: z.string().min(1, 'rubric id 不能为空'),
    /** rubric 版本号，如 "1.2.0"；ReviewResult.rubricVersion 必须与此一致 */
    version: z.string().min(1, 'rubric 版本号不能为空'),
    /** rubric 标题，如"操作系统实验报告通用 Rubric（实验三）" */
    title: z.string().min(1, 'rubric 标题不能为空'),
    /** 评分点列表，各点权重之和必须为 100 */
    items: z.array(RubricItemSchema).min(1, '至少需要 1 个评分点'),
  })
  .strict();

/* ==========================================================================
 * 2. Evidence：证据
 * ========================================================================== */

/** 证据类型：正文文字 / 代码块 / 实验截图 / 表格 */
export const EvidenceKindSchema = z.enum(['text', 'code', 'figure', 'table']);

/** 证据在报告中的来源位置 */
export const EvidenceLocationSchema = z
  .object({
    /** 章节标题或编号，如 "3 实验步骤" */
    section: z.string().min(1).optional(),
    /** 起始行号（从 1 开始，闭区间） */
    lineStart: z.number().int().nonnegative().optional(),
    /** 结束行号（闭区间，须 ≥ lineStart） */
    lineEnd: z.number().int().nonnegative().optional(),
    /** 图号，如 "图3-2"；kind === 'figure' 时应当提供 */
    figureNo: z.string().min(1).optional(),
    /** 表号，如 "表5-1"；kind === 'table' 时应当提供 */
    tableNo: z.string().min(1).optional(),
  })
  .strict()
  // 与冻结契约的 minProperties: 1 对齐 —— 位置信息至少要有一样，空对象等于没给位置
  .refine((loc) => Object.keys(loc).length >= 1, {
    message: '证据位置至少要提供 section / lineStart / lineEnd / figureNo / tableNo 之一',
  });

/**
 * 块引用：把证据锚回 T1 文档解析器的结构块（契约 1.2.0 新增，optional）。
 * 支撑「两次点击内可复现凭据」——blockId 指到块、anchor 指到位置、digest 防篡改。
 */
export const BlockRefSchema = z
  .object({
    /** T1 的块 id，形如 "b00042" */
    blockId: z.string().min(1, '块 id 不能为空'),
    /** 块锚点，形如 "12.3" */
    anchor: z.string().min(1, '块锚点不能为空'),
    /** 块内容摘要（T3 产出的 blockTextDigest）*/
    digest: z.string().min(1, '块摘要不能为空'),
  })
  .strict();

/** 一条证据：评分判断的事实依据 */
export const EvidenceSchema = z
  .object({
    /** 证据唯一 id，如 "E3"；供 ScoreItem 与 ReviewStep 交叉引用 */
    id: z.string().min(1, '证据 id 不能为空'),
    /** 证据类型 */
    kind: EvidenceKindSchema,
    /** 来源位置：章节 / 行号 / 图号 / 表号，至少提供一项 */
    location: EvidenceLocationSchema,
    /** 原文片段：逐字摘录，不得改写；截图类证据填写图中可辨识的关键信息 */
    quote: z.string().min(1, '原文片段不能为空'),
    /** 该条证据本身的置信度 0–1（低清截图、OCR 歧义等情形取低值） */
    confidence: ConfidenceSchema,
    /** 备注：补充说明证据的局限（可选） */
    note: z.string().optional(),
    /**
     * 引用是否忠实（契约 1.2.0 新增，optional）。
     * 由 T3 引用解析器逐字比对得出；false 表示该引用与原文不符，证据应作废。
     * 缺省（undefined）表示「未做逐字校验」，与 false 不是一回事。
     */
    citationValid: z.boolean().optional(),
    /** 结构块引用（契约 1.2.0 新增，optional）：供前端做两次点击内的溯源跳转 */
    blockRef: BlockRefSchema.optional(),
  })
  .strict();

/* ==========================================================================
 * 3. ScoreItem：单项评分
 * ========================================================================== */

/** 单个评分点的评分结果 */
export const ScoreItemSchema = z
  .object({
    /** 对应的评分点 id，须存在于所引用的 rubric 中 */
    rubricItemId: z.string().min(1, '评分点 id 不能为空'),
    /** 评分点名称快照：冗余存储，使结果文件脱离 rubric 也能独立渲染 */
    itemName: z.string().min(1, '评分点名称快照不能为空'),
    /** 权重快照（百分比数值），用于独立复算总分 */
    weight: z
      .number()
      .min(0, '权重必须在 0–100 之间')
      .max(100, '权重必须在 0–100 之间'),
    /** 该项满分快照 */
    maxScore: z.number().gt(0, '满分必须大于 0'),
    /** 命中的判定档位 */
    level: ScoreLevelSchema,
    /** 命中档位的得分系数快照：用于前端校验 score 是否等于 maxScore × levelScoreRatio */
    levelScoreRatio: z
      .number()
      .min(0, '档位得分系数必须在 0–1 之间')
      .max(1, '档位得分系数必须在 0–1 之间'),
    /**
     * 该项得分（**终值**），取值 0–maxScore，保留 2 位小数。
     * 契约 1.2.0 起允许为 null：表示尚无终值（配合 pending: true 使用）。
     */
    score: z.number().min(0, '得分不能为负数').nullable(),
    /**
     * 专家建议分（契约 1.2.0 新增，optional）。
     * 与 score 的关系见不变式 I7：overriddenByTeacher 为 true 时，
     * 本字段必须存在且不等于 score。终值由教师或 S4 落定，不由本字段充当。
     */
    suggestedScore: z.number().min(0, '建议分不能为负数').optional(),
    /** 该评分点是否被教师改过分（契约 1.2.0 新增，optional） */
    overriddenByTeacher: z.boolean().optional(),
    /** 扣分理由：说明为何未得满分；满分时为 null */
    deductionReason: z.string().nullable(),
    /** 引用的证据数组；未找到证据时允许为空数组（此时应置为未达标档并说明） */
    evidence: z.array(EvidenceSchema),
    /** 该项判定的置信度 0–1 */
    confidence: ConfidenceSchema,
    /**
     * 是否**需要教师过目**（required）。
     * ⚠️ 与 pending 语义正交，**不得合并**：
     *   needsReview = 需要人看一眼 —— **不影响总分**；
     *   pending     = 尚无终值     —— **不计入求和**，其权重进 total.weightExcluded。
     * v0.1 曾把两者混为一谈；合并会让 12 份历史资产的总分全部改变。
     */
    needsReview: z.boolean(),
    /**
     * 是否尚无终值（契约 1.2.0 新增，optional）。
     * 为 true 时该项不计入总分求和，权重计入 total.weightExcluded，
     * 并使总分表现为「部分分（下界）」。
     */
    pending: z.boolean().optional(),
  })
  .strict()
  .refine((item) => item.score === null || item.score <= item.maxScore, {
    message: '得分不得超出该项满分',
    path: ['score'],
  })
  // 不变式 I7：被教师改过的项必须能看出"改之前是多少"
  .refine(
    (item) =>
      item.overriddenByTeacher !== true ||
      (item.suggestedScore !== undefined && item.suggestedScore !== item.score),
    {
      message:
        'overriddenByTeacher 为 true 时，必须提供 suggestedScore 且它与终值 score 不同（不变式 I7）',
      path: ['suggestedScore'],
    },
  )
  // 不变式 I6：pending ⟹ needsReview（尚无终值的项必然需要人过目）
  .refine((item) => item.pending !== true || item.needsReview === true, {
    message: 'pending 为 true 时 needsReview 必须也为 true（不变式 I6）',
    path: ['needsReview'],
  });

/* ==========================================================================
 * 4. ReviewStep：五 Agent 流水线中间产物
 * ========================================================================== */

/** 流水线中的 Agent 名称 */
export const AgentNameSchema = z.enum([
  'parser',
  'evidence',
  'grader',
  'reviewer',
  'feedback',
]);

/** 流水线每一步的中间产物（供 /trace 溯源页展示，回答"AI 是不是黑箱"） */
export const ReviewStepSchema = z
  .object({
    /** 步骤序号，从 1 开始，与五 Agent 的执行顺序一致 */
    step: z.number().int().min(1),
    /** 执行该步骤的 Agent 名称 */
    agent: AgentNameSchema,
    /** 输入摘要：该步骤拿到了什么（报告、章节树、评分明细等） */
    inputSummary: z.string().min(1, '输入摘要不能为空'),
    /** 输出摘要：该步骤产出了什么（章节树、证据条数、档位分布等） */
    outputSummary: z.string().min(1, '输出摘要不能为空'),
    /** 该步骤整体置信度 0–1 */
    confidence: ConfidenceSchema,
    /** 备注：异常、局限或需要人工介入的提示（可选） */
    note: z.string().optional(),
  })
  .strict();

/* ==========================================================================
 * 5. ReviewFeedback：面向学生的评语
 * ========================================================================== */

/** 评语语气风格标记 */
export const FeedbackToneSchema = z.enum(['encouraging', 'neutral', 'critical']);

/** 语气风格的中文标签 */
export const FEEDBACK_TONE_LABELS: Readonly<Record<FeedbackTone, string>> = {
  encouraging: '鼓励式（先肯定再指出改进）',
  neutral: '中性客观（只陈述事实与建议）',
  critical: '严格指出问题（适用于反复出现同类错误的报告）',
} as const;

/** 面向学生的个性化评语 */
export const ReviewFeedbackSchema = z
  .object({
    /** 总体评价：一段话概括完成度与主要短板 */
    overall: z.string().min(1, '总体评价不能为空'),
    /** 亮点列表：至少 1 条，须对应到具体证据 */
    strengths: z.array(z.string().min(1)).min(1, '至少列出 1 条亮点'),
    /** 改进建议列表：至少 1 条，须可操作 */
    improvements: z.array(z.string().min(1)).min(1, '至少列出 1 条改进建议'),
    /** 语气风格标记，决定前端的措辞与配色 */
    tone: FeedbackToneSchema,
  })
  .strict();

/* ==========================================================================
 * 6. ReviewRecord：Reviewer 复核记录
 * ========================================================================== */

/** 单个评分点的复核调整记录 */
export const ReviewAdjustmentSchema = z
  .object({
    /** 被复核的评分点 id */
    rubricItemId: z.string().min(1, '评分点 id 不能为空'),
    /** 复核意见：Reviewer 对该项判定的看法 */
    opinion: z.string().min(1, '复核意见不能为空'),
    /** 复核前置信度 */
    confidenceBefore: ConfidenceSchema,
    /** 复核后置信度 */
    confidenceAfter: ConfidenceSchema,
    /** 复核前得分；未调整分数时为 null */
    scoreBefore: z.number().min(0).nullable(),
    /** 复核后得分；未调整分数时为 null */
    scoreAfter: z.number().min(0).nullable(),
    /** 是否实际改动了判定结果（档位或得分变化） */
    changed: z.boolean(),
  })
  .strict();

/** 复核环节的整体记录 */
export const ReviewRecordSchema = z
  .object({
    /** 是否触发了复核（存在置信度 < 0.80 的评分点时为 true） */
    triggered: z.boolean(),
    /** 触发复核的原因；未触发时为 null */
    triggerReason: z.string().nullable(),
    /** 复核总体意见 */
    opinion: z.string().min(1, '复核总体意见不能为空'),
    /** 复核前的整体置信度：各 ScoreItem 置信度的算术平均，保留 2 位小数 */
    overallConfidenceBefore: ConfidenceSchema,
    /** 复核后的整体置信度：同上口径 */
    overallConfidenceAfter: ConfidenceSchema,
    /** 逐项复核记录；未触发复核时可为空数组 */
    adjustments: z.array(ReviewAdjustmentSchema),
  })
  .strict();

/* ==========================================================================
 * 7. 装配层对象（契约 1.2.0 新增，全部 optional）
 * ========================================================================== */

/**
 * rubric 引用（rubricRef）：只带 id 与摘要，不带全文。
 * 与 `rubric`（完整快照）二选一即可 —— 结果页想脱离 rubric 独立渲染时用前者，
 * 想完全自洽（离线可复算）时用后者。
 */
export const RubricRefSchema = z
  .object({
    /** rubric 唯一 id */
    id: z.string().min(1, 'rubric id 不能为空'),
    /** rubric 内容摘要，用于判断"这份结果当时用的是哪一版标准" */
    digest: z.string().min(1, 'rubric 摘要不能为空'),
  })
  .strict();

/**
 * 总分汇总（total）。**注意 total 里没有 value**：
 *   数值分在顶层 totalScore；total 只描述"这个分是怎么来的、覆盖了多少权重"。
 *
 * 关键口径（冻结，不得改写）：
 *   - 总分 = Σ (score / maxScore) × weight —— **不是** Σ (score × weight / 100)；
 *   - pending 项不计入求和，其权重进 weightExcluded；
 *   - 上界 upperBound = **Σ已计入 weight（= weightIncluded）**，**不是** 100 − weightExcluded
 *     （后者在权重和 < 100 时会给出偏大的上界）；
 *   - grade 仅在 weightExcluded === 0 且 weightIncluded === 100 时才映射，否则为 null。
 */
export const TotalSchema = z
  .object({
    /** 已计入求和的权重合计 */
    weightIncluded: z.number().min(0).max(100),
    /** 被排除的权重合计（pending 项） */
    weightExcluded: z.number().min(0).max(100),
    /** 可能达到的上界 = 已计入权重合计 */
    upperBound: z.number().min(0),
    /** 是否为部分分（weightExcluded > 0） */
    isPartial: z.boolean(),
    /**
     * 整体等级名或 null。
     * ⚠️ 取值域是**开放的字符串**，与 scores[].level 的 ScoreLevel 不是同一个东西：
     *   ScoreLevel 是逐评分点的四项语义档位（excellent/meeting/partial/notMet）；
     *   grade 是 T4 按档位线映射出的等级名，默认序列 A/B/C/D/F（跳过 E），
     *   --grade-bands 还允许教师自定义档位名。故此处不能收窄成枚举。
     *   （契约 1.2.0 相对 1.1.0 的唯一改动就是放宽这一处。）
     */
    grade: z.string().nullable(),
  })
  .strict();

/** 评阅元信息：这次评阅是教师参与的还是一键生成、当前是草稿还是已确认 */
export const ReviewMetaSchema = z
  .object({
    mode: z.enum(['teacher-participated', 'ai-only']).optional(),
    status: z.enum(['draft', 'confirmed']).optional(),
  })
  .strict();

/** 一条疑点：专家拿不准、需要教师定夺的地方 */
export const DoubtSchema = z
  .object({
    rubricItemId: z.string().min(1, '评分点 id 不能为空'),
    detail: z.string().min(1, '疑点说明不能为空'),
    /** 疑点类型标签（如 evidence-missing / level-ambiguous） */
    kind: z.string().optional(),
  })
  .strict();

/**
 * 复核清单的一项（S7 入口 A 的产物）。
 * rankKey 是 T4 给出的复核排序键：**先排 pending、再按置信度升序**，
 * 保证教师从上往下看就是"最该先看的在上面"。
 */
export const ChecklistEntrySchema = z
  .object({
    rubricItemId: z.string().min(1, '评分点 id 不能为空'),
    confidence: ConfidenceSchema,
    /** 复核排序键（数值越小越优先） */
    rankKey: z.number().min(0).optional(),
    pending: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();

/** 自检项的三种状态。skipped 表示"这一项没跑"，与 fail 不是一回事。 */
export const CheckStatusSchema = z.enum(['pass', 'fail', 'skipped']);

/**
 * 装配自检结果（对应工具链 T5 的六项检查）。
 * schema / recompute / fingerprint 三态；skipped 与 errors 逐条保留，信息不丢。
 */
export const SelfCheckSchema = z
  .object({
    schema: CheckStatusSchema,
    recompute: CheckStatusSchema,
    fingerprint: CheckStatusSchema,
    /** 被跳过的检查名（不适用 ≠ 降级；不适用不应记进这里） */
    skipped: z.array(z.string()).optional(),
    /** 错误清单：每项一句话，可驱动限定轮次的重试 */
    errors: z.array(z.string()).optional(),
  })
  .strict();

/* ==========================================================================
 * 8. ReviewProvenance：溯源与审计信息
 * ========================================================================== */

/**
 * 溯源与审计信息。
 * 支撑赛事要求「结果可审计、可回溯到具体对话轮次」：
 *   generatorAgent + generatedAt  → 谁在什么时候生成的；
 *   sourceConversationId/ TurnId  → 回溯到 LearnBuddy 的哪一段对话；
 *   resultFingerprint             → 结果是否被篡改（指纹不一致即视为被修改过）；
 *   schemaVersion                 → 用哪一版契约生成的，决定如何解析。
 */
export const ReviewProvenanceSchema = z
  .object({
    /** 生成智能体标识，如 "learnbuddy://expert/autograder-reviewer" */
    generatorAgent: z.string().min(1, '生成智能体标识不能为空'),
    /** 生成时间，ISO8601（建议带时区偏移） */
    generatedAt: Iso8601Schema,
    /** 来源对话标识：对应 LearnBuddy 中产生本次评阅的对话 id */
    sourceConversationId: z.string().min(1, '来源对话标识不能为空'),
    /** 来源对话轮次标识：精确定位到第几轮产出本结果（可选但强烈建议提供） */
    sourceTurnId: z.string().optional(),
    /**
     * 结果指纹：形如 "sha256:<64位十六进制>"。
     * 算法：将本 ReviewResult 对象按字典序递归排序键、provenance.resultFingerprint 置为 ""，
     *       序列化为无空格 UTF-8 JSON 后取 SHA-256 十六进制小写。
     * 前端可用 Web Crypto 复算，不一致即提示"结果已被修改"。
     */
    resultFingerprint: z
      .string()
      .regex(/^(sha256:)?[0-9a-f]{8,128}$/i, '结果指纹须形如 sha256:<64位十六进制>'),
    /** 生成该结果时使用的契约版本，应与 ReviewResult.schemaVersion 一致（不变式 I5） */
    schemaVersion: SchemaVersionSchema,
  })
  .strict();

/* ==========================================================================
 * 9. ReviewResult：顶层对象
 * ========================================================================== */

/** 报告元信息 */
export const ReportMetaSchema = z
  .object({
    /** 报告唯一 id，如 "lab-report-2026-os-017" */
    reportId: z.string().min(1, '报告 id 不能为空'),
    /** 报告标题 */
    title: z.string().min(1, '报告标题不能为空'),
    /** 所属课程 */
    course: z.string().min(1, '课程名称不能为空'),
    /** 学生代号：泛指代号如"学生A"，严禁出现真实姓名 / 学号 */
    studentCode: z.string().min(1, '学生代号不能为空'),
  })
  .strict();

/** 权重求和的容差（用于浮点比较） */
const WEIGHT_SUM_TOLERANCE = 0.01;

/** 顶层评阅结果 */
export const ReviewResultSchema = z
  .object({
    /** 本结果遵循的契约版本。形状校验（不锁具体版本），因为 1.0.0 历史资产仍合法 */
    schemaVersion: SchemaVersionSchema,
    /** 任务类型：建标 / 评阅 / 复核（契约 1.2.0 新增，optional） */
    taskType: TaskTypeSchema.optional(),
    /** 报告元信息 */
    report: ReportMetaSchema,
    /** 引用的 rubric 版本号（纯版本号，如 "1.2.0"） */
    rubricVersion: z.string().min(1, 'rubric 版本号不能为空'),
    /** rubric 引用（id + 摘要），与 rubric 完整快照二选一（契约 1.2.0 新增，optional） */
    rubricRef: RubricRefSchema.optional(),
    /** rubric 完整快照：可选，建议随结果一起固化，使资产自洽可独立渲染 */
    rubric: RubricSchema.optional(),
    /** 逐项评分结果，至少 1 项；rubricItemId 不得重复 */
    scores: z.array(ScoreItemSchema).min(1, '至少需要 1 项评分'),
    /** 加权总分 0–100，口径见 computeWeightedTotal（部分分时即下界） */
    totalScore: z
      .number()
      .min(0, '总分不能为负数')
      .max(100, '总分不得超过 100'),
    /** 总分汇总：权重覆盖情况、上界、等级（契约 1.2.0 新增，optional） */
    total: TotalSchema.optional(),
    /** 复核记录 */
    review: ReviewRecordSchema,
    /** 面向学生的评语 */
    feedback: ReviewFeedbackSchema,
    /** 五 Agent 流水线步骤，建议 5 步（Parser→Evidence→Grader→Reviewer→Feedback） */
    steps: z.array(ReviewStepSchema).min(1, '至少需要 1 个流水线步骤'),
    /** 溯源与审计信息 */
    provenance: ReviewProvenanceSchema,
    /** 评阅元信息：教师参与与否、草稿还是已确认（契约 1.2.0 新增，optional） */
    reviewMeta: ReviewMetaSchema.optional(),
    /** 疑点清单（契约 1.2.0 新增，optional） */
    doubts: z.array(DoubtSchema).optional(),
    /** 复核清单（S7 入口 A，契约 1.2.0 新增，optional） */
    reviewChecklist: z.array(ChecklistEntrySchema).optional(),
    /** 装配自检结果（契约 1.2.0 新增，optional） */
    selfCheck: SelfCheckSchema.optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    // 权重合计必须为 100（浮点容差 0.01）
    const weightSum = result.scores.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(weightSum - 100) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scores'],
        message: `各评分点权重之和必须为 100，当前为 ${weightSum}`,
      });
    }

    // 同一评分点不得重复评分
    const seen = new Set<string>();
    result.scores.forEach((item, index) => {
      if (seen.has(item.rubricItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scores', index, 'rubricItemId'],
          message: `评分点 ${item.rubricItemId} 重复出现`,
        });
      }
      seen.add(item.rubricItemId);
    });

    // 若内嵌 rubric，则其版本与权重和也需自洽（I2 / I4）
    if (result.rubric !== undefined) {
      if (result.rubric.version !== result.rubricVersion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rubricVersion'],
          message: `rubricVersion(${result.rubricVersion}) 与内嵌 rubric.version(${result.rubric.version}) 不一致`,
        });
      }
      const rubricWeightSum = result.rubric.items.reduce((sum, item) => sum + item.weight, 0);
      if (Math.abs(rubricWeightSum - 100) > WEIGHT_SUM_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rubric', 'items'],
          message: `rubric 各评分点权重之和必须为 100，当前为 ${rubricWeightSum}`,
        });
      }
    }

    // ---- I5：顶层 schemaVersion 必须等于 provenance.schemaVersion ----
    if (result.schemaVersion !== result.provenance.schemaVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schemaVersion'],
        message:
          `顶层 schemaVersion(${result.schemaVersion}) 与 provenance.schemaVersion` +
          `(${result.provenance.schemaVersion}) 不一致（不变式 I5）`,
      });
    }

    // ---- I12：逐项得分必须等于 round2(maxScore × levelScoreRatio) ----
    result.scores.forEach((item, index) => {
      if (item.score === null) return; // 无终值时无可比对
      const expected = computeItemScore(item.maxScore, item.levelScoreRatio);
      if (Math.abs(item.score - expected) > WEIGHT_SUM_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scores', index, 'score'],
          message:
            `得分 ${item.score} 与档位口径不符：maxScore(${item.maxScore}) × ` +
            `levelScoreRatio(${item.levelScoreRatio}) = ${expected}（不变式 I12）`,
        });
      }
    });

    // ---- I8 / I9 / I10 / I13：total 存在时的四项自洽 ----
    if (result.total !== undefined) {
      const recomputed = recomputeTotals(result.scores);

      // I13：weightIncluded / weightExcluded 必须等于复算值。
      // 这条是"反证时补上的"：不加它，I9 只比对 upperBound 与 weightIncluded 彼此，
      // 两者可以一起写错而互相自洽。
      if (Math.abs(result.total.weightIncluded - recomputed.weightIncluded) > WEIGHT_SUM_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total', 'weightIncluded'],
          message:
            `weightIncluded 声明 ${result.total.weightIncluded}，复算值 ${recomputed.weightIncluded}` +
            '（不变式 I13）',
        });
      }
      if (Math.abs(result.total.weightExcluded - recomputed.weightExcluded) > WEIGHT_SUM_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total', 'weightExcluded'],
          message:
            `weightExcluded 声明 ${result.total.weightExcluded}，复算值 ${recomputed.weightExcluded}` +
            '（不变式 I13）',
        });
      }

      // I8：isPartial 等价于 weightExcluded > 0
      if (result.total.isPartial !== recomputed.weightExcluded > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total', 'isPartial'],
          message:
            `isPartial(${result.total.isPartial}) 与 weightExcluded(${recomputed.weightExcluded}) ` +
            '不一致：应为 weightExcluded > 0（不变式 I8）',
        });
      }

      // I9：上界 = 已计入权重合计（不是 100 − weightExcluded）
      if (Math.abs(result.total.upperBound - recomputed.weightIncluded) > WEIGHT_SUM_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total', 'upperBound'],
          message:
            `upperBound 应等于已计入权重合计 ${recomputed.weightIncluded}，` +
            `声明为 ${result.total.upperBound}（不变式 I9：上界 = Σ已计入 weight）`,
        });
      }

      // I10：只有满权重时才允许映射等级
      if (
        result.total.grade !== null &&
        !(recomputed.weightExcluded === 0 && recomputed.weightIncluded === 100)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total', 'grade'],
          message:
            `grade(${result.total.grade}) 在权重不完整时不得映射：` +
            `需 weightExcluded = 0 且 weightIncluded = 100，` +
            `当前为 ${recomputed.weightExcluded} / ${recomputed.weightIncluded}（不变式 I10）`,
        });
      }
    }
  });

/* ==========================================================================
 * 10. 导出类型（由 schema 推导，禁止另写重复定义）
 * ========================================================================== */

export type Confidence = number;
export type ScoreLevel = z.infer<typeof ScoreLevelSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type FeedbackTone = z.infer<typeof FeedbackToneSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;

export type RubricItemLevel = z.infer<typeof RubricItemLevelSchema>;
export type RubricItem = z.infer<typeof RubricItemSchema>;
export type Rubric = z.infer<typeof RubricSchema>;

export type EvidenceLocation = z.infer<typeof EvidenceLocationSchema>;
export type BlockRef = z.infer<typeof BlockRefSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export type ScoreItem = z.infer<typeof ScoreItemSchema>;
export type ReviewStep = z.infer<typeof ReviewStepSchema>;
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;
export type ReviewAdjustment = z.infer<typeof ReviewAdjustmentSchema>;
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;
export type ReviewProvenance = z.infer<typeof ReviewProvenanceSchema>;
export type ReportMeta = z.infer<typeof ReportMetaSchema>;

export type RubricRef = z.infer<typeof RubricRefSchema>;
export type Total = z.infer<typeof TotalSchema>;
export type ReviewMeta = z.infer<typeof ReviewMetaSchema>;
export type Doubt = z.infer<typeof DoubtSchema>;
export type ChecklistEntry = z.infer<typeof ChecklistEntrySchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type SelfCheck = z.infer<typeof SelfCheckSchema>;

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/* ==========================================================================
 * 11. 校验入口与口径复算（纯函数，不含业务逻辑）
 * ========================================================================== */

/** 单条校验问题 */
export interface ValidationIssue {
  /** 出问题字段的路径，如 "scores.2.confidence" */
  path: string;
  /** 人类可读的错误说明（中文） */
  message: string;
}

/** 校验结果：成功时附带已解析的数据，失败时附带问题清单 */
export type ValidationResult =
  | { ok: true; data: ReviewResult }
  | { ok: false; issues: ValidationIssue[] };

/**
 * 校验入口：判断任意输入是否符合 ReviewResult 契约。
 * 纯函数，不做任何业务处理、不抛异常、不写文件。
 */
export function validateReviewResult(input: unknown): ValidationResult {
  const parsed = ReviewResultSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { ok: false, issues };
}

/** 保留 2 位小数（四舍五入，half-up） */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 单项应得分数：满分 × 档位得分系数，保留 2 位小数。
 * 用于前端核查 AI 给出的 score 是否符合档位口径。
 */
export function computeItemScore(maxScore: number, levelScoreRatio: number): number {
  return round2(maxScore * levelScoreRatio);
}

/**
 * 加权总分口径（**写死，不得改写**）：
 *   total = Σ (score_i / maxScore_i × weight_i)
 * 即：先归一化到得分率，再乘以权重百分比；结果落在 0–100，保留 2 位小数。
 *   ✗ 错误写法：Σ (score_i × weight_i / 100) —— 各评分点的 maxScore 是教师自定标度
 *     （5 / 10 / 15 / 20 不等），标度大小不影响占比，占比只由 weight 决定。
 *
 * 哪些项不计入求和：
 *   - `pending === true`（尚无终值）—— 其权重进 weightExcluded；
 *   - `score === null`（无终值）—— 同上。
 *   此时返回的是**部分分（下界）**，不是"打折后的总分"。
 *
 * 特例：当教师令 maxScore_i = weight_i 时，公式退化为 total = Σ score_i。
 */
export function computeWeightedTotal(scores: readonly ScoreItem[]): number {
  return recomputeTotals(scores).value;
}

/** 某个评分项是否计入总分求和 */
export function isCountedInTotal(item: ScoreItem): boolean {
  return item.pending !== true && item.score !== null;
}

/** recomputeTotals 的完整产物 */
export interface RecomputedTotals {
  /** 部分分 / 满分（下界口径） */
  value: number;
  /** 已计入求和的权重合计 = 可能达到的上界 */
  weightIncluded: number;
  /** 被排除的权重合计（pending / 无终值项） */
  weightExcluded: number;
  /** 上界 = weightIncluded（**不是** 100 − weightExcluded） */
  upperBound: number;
  /** 是否为部分分 */
  isPartial: boolean;
  /** 计入求和的项数 */
  countedCount: number;
  /** 未计入求和的评分点 id（供界面逐条说明"为什么没算进去"） */
  excludedIds: string[];
}

/**
 * 从逐项评分**独立复算**总分与权重覆盖情况。
 * 前端用它与结果文件里声明的 total / totalScore 做比对（不变式 I9 / I13），
 * 口径与工具链 T4 完全一致；不读任何声明值，只信 scores。
 */
export function recomputeTotals(scores: readonly ScoreItem[]): RecomputedTotals {
  let raw = 0;
  let weightIncluded = 0;
  let weightExcluded = 0;
  let countedCount = 0;
  const excludedIds: string[] = [];

  for (const item of scores) {
    if (isCountedInTotal(item)) {
      raw += ((item.score as number) / item.maxScore) * item.weight;
      weightIncluded += item.weight;
      countedCount += 1;
    } else {
      weightExcluded += item.weight;
      excludedIds.push(item.rubricItemId);
    }
  }

  weightIncluded = round2(weightIncluded);
  weightExcluded = round2(weightExcluded);

  return {
    value: round2(raw),
    weightIncluded,
    weightExcluded,
    upperBound: weightIncluded,
    isPartial: weightExcluded > 0,
    countedCount,
    excludedIds,
  };
}

/** 总分一致性核查结果 */
export interface TotalScoreCheck {
  /** 按口径复算出的总分 */
  expected: number;
  /** 结果文件中声明的总分 */
  actual: number;
  /** 两者差值（绝对值） */
  delta: number;
  /** 差值在容差内即为通过 */
  ok: boolean;
}

/**
 * 核查结果文件声明的 totalScore 是否与加权口径一致（容差 0.01）。
 * 供前端渲染前使用，属于契约级核查，不修改任何数据。
 * 注：含 pending 项时，比较的是**部分分（下界）**。
 */
export function verifyTotalScore(result: ReviewResult): TotalScoreCheck {
  const expected = computeWeightedTotal(result.scores);
  const delta = Math.abs(expected - result.totalScore);
  return { expected, actual: result.totalScore, delta, ok: delta <= WEIGHT_SUM_TOLERANCE };
}

/** 单项得分是否符合"满分 × 档位系数"（容差 0.01）；无终值时返回 null（不适用） */
export function verifyItemScore(item: ScoreItem): boolean | null {
  if (item.score === null) return null;
  return (
    Math.abs(item.score - computeItemScore(item.maxScore, item.levelScoreRatio)) <=
    WEIGHT_SUM_TOLERANCE
  );
}
