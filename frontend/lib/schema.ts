/**
 * AutoGrader · ReviewResult 数据契约（全系统枢纽）
 * ============================================================================
 * 本文件同时约束三件事，三者必须严格一致：
 *   1. LearnBuddy 侧五 Agent 流水线（Parser → Evidence → Grader → Reviewer → Feedback）
 *      最终产出的 JSON 结构；
 *   2. 前端 TypeScript 类型（由 z.infer 推导，禁止另写一份重复定义）；
 *   3. 仓库内静态资产 frontend/public/results/*.json。
 *
 * 设计前提（不可违背）：
 *   - AI 推理只发生在 LearnBuddy 对话侧（开发时），Web 端运行时零 AI 调用、零后端、零数据库；
 *   - 运行时依赖仅允许 zod，禁止 openai / anthropic / langchain-* 等第三方 AI 依赖；
 *   - 全部对象使用 .strict()：未知字段一律拒绝，防止 AI 自由发挥导致资产腐化。
 *
 * 人类可读的口径说明（总分算法、置信度分级、版本递增规范）见 docs/contract.md。
 *
 * @see docs/contract.md
 */

import { z } from 'zod';

/* ==========================================================================
 * 0. 全局常量：Schema 版本 / 置信度 / 评分档位
 * ========================================================================== */

/**
 * 当前契约版本号，遵循语义化版本 MAJOR.MINOR.PATCH。
 * 递增规范见 docs/contract.md「schemaVersion 递增规范」一节。
 */
export const SCHEMA_VERSION = '1.0.0';

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
    /** 该项得分，取值 0–maxScore，保留 2 位小数 */
    score: z.number().min(0, '得分不能为负数'),
    /** 扣分理由：说明为何未得满分；满分时为 null */
    deductionReason: z.string().nullable(),
    /** 引用的证据数组；未找到证据时允许为空数组（此时应置为未达标档并说明） */
    evidence: z.array(EvidenceSchema),
    /** 该项判定的置信度 0–1 */
    confidence: ConfidenceSchema,
    /** 是否触发复核：置信度 < 0.80、证据缺失或档位存在争议时为 true */
    needsReview: z.boolean(),
  })
  .strict()
  .refine((item) => item.score <= item.maxScore, {
    message: '得分不得超出该项满分',
    path: ['score'],
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
 * 7. ReviewProvenance：溯源与审计信息
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
    /** 生成该结果时使用的契约版本，应与 ReviewResult.schemaVersion 一致 */
    schemaVersion: z.string().min(1, 'schema 版本不能为空'),
  })
  .strict();

/* ==========================================================================
 * 8. ReviewResult：顶层对象
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
    /** 本结果遵循的契约版本，如 "1.0.0" */
    schemaVersion: z.string().min(1, 'schema 版本不能为空'),
    /** 报告元信息 */
    report: ReportMetaSchema,
    /** 引用的 rubric 版本号（纯版本号，如 "1.2.0"） */
    rubricVersion: z.string().min(1, 'rubric 版本号不能为空'),
    /** rubric 完整快照：可选，建议随结果一起固化，使资产自洽可独立渲染 */
    rubric: RubricSchema.optional(),
    /** 逐项评分结果，至少 1 项；rubricItemId 不得重复 */
    scores: z.array(ScoreItemSchema).min(1, '至少需要 1 项评分'),
    /** 加权总分 0–100，口径见 computeWeightedTotal */
    totalScore: z
      .number()
      .min(0, '总分不能为负数')
      .max(100, '总分不得超过 100'),
    /** 复核记录 */
    review: ReviewRecordSchema,
    /** 面向学生的评语 */
    feedback: ReviewFeedbackSchema,
    /** 五 Agent 流水线步骤，建议 5 步（Parser→Evidence→Grader→Reviewer→Feedback） */
    steps: z.array(ReviewStepSchema).min(1, '至少需要 1 个流水线步骤'),
    /** 溯源与审计信息 */
    provenance: ReviewProvenanceSchema,
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

    // 若内嵌 rubric，则其版本与权重和也需自洽
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
  });

/* ==========================================================================
 * 9. 导出类型（由 schema 推导，禁止另写重复定义）
 * ========================================================================== */

export type Confidence = number;
export type ScoreLevel = z.infer<typeof ScoreLevelSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type FeedbackTone = z.infer<typeof FeedbackToneSchema>;

export type RubricItemLevel = z.infer<typeof RubricItemLevelSchema>;
export type RubricItem = z.infer<typeof RubricItemSchema>;
export type Rubric = z.infer<typeof RubricSchema>;

export type EvidenceLocation = z.infer<typeof EvidenceLocationSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export type ScoreItem = z.infer<typeof ScoreItemSchema>;
export type ReviewStep = z.infer<typeof ReviewStepSchema>;
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;
export type ReviewAdjustment = z.infer<typeof ReviewAdjustmentSchema>;
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;
export type ReviewProvenance = z.infer<typeof ReviewProvenanceSchema>;
export type ReportMeta = z.infer<typeof ReportMetaSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/* ==========================================================================
 * 10. 校验入口与口径复算（纯函数，不含业务逻辑）
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
 * 加权总分口径：
 *   total = Σ (score_i / maxScore_i × weight_i)，即先归一化到得分率再乘以权重百分比，
 *   结果落在 0–100，保留 2 位小数（四舍五入）。
 * 特例：当教师令 maxScore_i = weight_i 时，公式退化为 total = Σ score_i。
 */
export function computeWeightedTotal(scores: readonly ScoreItem[]): number {
  const raw = scores.reduce(
    (sum, item) => sum + (item.score / item.maxScore) * item.weight,
    0,
  );
  return round2(raw);
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
 */
export function verifyTotalScore(result: ReviewResult): TotalScoreCheck {
  const expected = computeWeightedTotal(result.scores);
  const delta = Math.abs(expected - result.totalScore);
  return { expected, actual: result.totalScore, delta, ok: delta <= WEIGHT_SUM_TOLERANCE };
}

/** 单项得分是否符合"满分 × 档位系数"（容差 0.01） */
export function verifyItemScore(item: ScoreItem): boolean {
  return Math.abs(item.score - computeItemScore(item.maxScore, item.levelScoreRatio)) <= WEIGHT_SUM_TOLERANCE;
}
