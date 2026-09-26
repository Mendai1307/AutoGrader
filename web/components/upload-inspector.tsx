'use client';

/**
 * AutoGrader · 上传核查器（Client Component）
 * ===========================================================================
 * 对应规划书路径二 2.5：「上传新报告 → 确定性核查即时反馈 ——
 * 上传后即时给出章节/代码/统计/查重结果」。
 *
 * 这条链路的全部计算都发生在**浏览器本地**：解压 docx、切结构块、跑规则引擎、
 * 算相似度。没有后端、没有 AI 调用、上传的文件也不离开这台机器 ——
 * 界面上必须把这一点说清楚，否则"上传"这个动作会让人以为数据去了哪里。
 *
 * 与工具链的一致性
 * ---------------------------------------------------------------------------
 *   · 解析：lib/parse.ts（md/txt）与 lib/docx.ts（docx）是 T1 的移植；
 *   · 核查：lib/rules-engine.ts 是 T2 的移植，出参与 T2 逐字段同形。
 *   `npm run audit:cross-end` 用 12 份样例对两侧做逐条比对（阶段 A 解析 / 阶段 B 规则）。
 *
 * 能力边界（页面上原样告知，不做假承诺）
 * ---------------------------------------------------------------------------
 *   · 支持 md / txt / docx；**不支持 PDF**（浏览器端无法保证与工具链一致）；
 *   · docx 需要浏览器的 `DecompressionStream('deflate-raw')`（Chrome/Edge 103+、
 *     Safari 16.4+、Firefox 113+），不支持时明确提示改用 md / txt；
 *   · 文件上限 8 MB。**为什么不做 Web Worker**：docx 解析依赖 `DOMParser`，
 *     而 **Worker 作用域里没有 DOMParser**，无法把这条最重的路径搬到后台线程；
 *     md/txt 是逐行处理，本身很快。故改用"超限即拒绝并说明"来避免主线程长时间阻塞。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { CircleAlert, FileUp, Loader2, Play, RotateCcw, SquareTerminal } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { parseTextDocument, type ParsedDocument, type TextFormat } from '@/lib/parse';
import { DocxFormatError, DocxUnsupportedError, isDocxSupported, parseDocxDocument } from '@/lib/docx';
import {
  runRules,
  sha256Hex,
  type RuleInspectionResult,
} from '@/lib/rules-engine';
import { DEFAULT_RULE_SET } from '@/lib/rules.generated';
import { cn, formatNumber, formatScore } from '@/lib/utils';

const MAX_FILE_MB = 8;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

type Status = 'idle' | 'reading' | 'parsing' | 'inspecting' | 'done' | 'error';

interface Outcome {
  document: ParsedDocument;
  inspection: RuleInspectionResult & { corpusSize: number };
  /** 文件名 */
  fileName: string;
  /** 文件字节数 */
  fileSize: number;
  /** 耗时（毫秒），用于说明"即时"到底有多快 */
  elapsedMs: number;
  /** 走的是哪条解析分支 */
  via: 'markdown' | 'plaintext' | 'docx';
}

const VIA_LABEL: Record<Outcome['via'], string> = {
  markdown: 'Markdown 分支（lib/parse.ts）',
  plaintext: '纯文本分支（lib/parse.ts）',
  docx: 'DOCX 分支（lib/docx.ts · 浏览器内解压）',
};

/** 判断走哪条解析分支 */
function resolveVia(fileName: string): 'markdown' | 'plaintext' | 'docx' {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext === 'docx') return 'docx';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'plaintext';
}

export interface UploadInspectorProps {
  /** 语料份数（服务端已知道，用于界面文案；语料正文按需加载） */
  corpusSize: number;
  /** 内置规则条数 */
  ruleCount: number;
  /** 可选：一份可直接试跑的样例文本（点击"填入样例"时用） */
  sampleName: string | null;
  sampleText: string | null;
}

export function UploadInspector({
  corpusSize,
  ruleCount,
  sampleName,
  sampleText,
}: UploadInspectorProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastedName, setPastedName] = useState('pasted-report.md');
  const [pastedText, setPastedText] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** 语料只在真正要跑核查时才加载（避免首屏多下载 80 KB） */
  const loadCorpus = useCallback(async () => {
    const module = await import('@/lib/corpus.generated');
    return { entries: module.CORPUS, size: module.CORPUS_SIZE };
  }, []);

  /** 核心链路：解析 → 核查 */
  const inspectBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string, via: Outcome['via']) => {
      const startedAt = performance.now();
      setError(null);
      setOutcome(null);

      setStatus('parsing');
      let document: ParsedDocument;
      if (via === 'docx') {
        // docx 的摘要取**文件原始字节**，与 T1 的 sha256_bytes 同源
        const digest = 'sha256:' + sha256Hex(new Uint8Array(buffer));
        document = await parseDocxDocument(buffer, fileName, digest);
      } else {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        document = parseTextDocument(text, fileName, via as TextFormat);
      }

      setStatus('inspecting');
      const corpus = await loadCorpus();
      const inspection = runRules(document, {
        defaultRules: DEFAULT_RULE_SET,
        corpus: corpus.entries,
      });

      setOutcome({
        document,
        inspection: { ...inspection, corpusSize: corpus.size },
        fileName,
        fileSize: buffer.byteLength,
        elapsedMs: Math.round(performance.now() - startedAt),
        via,
      });
      setStatus('done');
    },
    [loadCorpus],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const via = resolveVia(file.name);
      if (via === 'docx' && !isDocxSupported()) {
        setStatus('error');
        setError(
          '当前浏览器不支持流式解压（DecompressionStream deflate-raw），无法在本地解析 docx。' +
            '请改用 md / txt，或把正文粘贴到下方文本框。',
        );
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStatus('error');
        setError(
          `文件 ${(file.size / 1048576).toFixed(1)} MB 超过 ${MAX_FILE_MB} MB 上限。` +
            '这一限制是为了避免在浏览器主线程上长时间解析；请上传更小的文件。',
        );
        return;
      }
      setStatus('reading');
      try {
        await inspectBuffer(await file.arrayBuffer(), file.name, via);
      } catch (caught) {
        setStatus('error');
        if (caught instanceof DocxUnsupportedError || caught instanceof DocxFormatError) {
          setError(caught.message);
        } else {
          setError(`解析失败：${(caught as Error).message}`);
        }
      }
    },
    [inspectBuffer],
  );

  const handlePasted = useCallback(async () => {
    const text = pastedText.trim();
    if (text === '') {
      setStatus('error');
      setError('文本框是空的。请粘贴报告正文，或点「填入一份样例」。');
      return;
    }
    const via = resolveVia(pastedName);
    const bytes = new TextEncoder().encode(text);
    // 复制到独立的 ArrayBuffer，避免把编码后的视图共享给摘要与解码两处
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    try {
      await inspectBuffer(buffer, pastedName, via === 'docx' ? 'plaintext' : via);
    } catch (caught) {
      setStatus('error');
      setError(`解析失败：${(caught as Error).message}`);
    }
  }, [inspectBuffer, pastedName, pastedText]);

  const reset = useCallback(() => {
    setStatus('idle');
    setOutcome(null);
    setError(null);
  }, []);

  const busy = status === 'reading' || status === 'parsing' || status === 'inspecting';
  const statusText = useMemo(() => {
    switch (status) {
      case 'reading':
        return '读取文件…';
      case 'parsing':
        return '解析结构（切分章节 / 代码块 / 图表）…';
      case 'inspecting':
        return `按 ${ruleCount} 条规则核查并比对语料…`;
      case 'done':
        return '完成';
      default:
        return '';
    }
  }, [ruleCount, status]);

  return (
    <div className="space-y-4">
      {/* ==================== 输入区 ==================== */}
      <Card className="p-5">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file !== undefined) void handleFile(file);
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-md border border-dashed px-5 py-8 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-rule bg-secondary/30',
          )}
        >
          <FileUp className="h-5 w-5 text-primary" />
          <p className="text-[13px] font-medium">把报告拖到这里，或选择文件</p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            支持 <code className="font-mono">.md</code> / <code className="font-mono">.txt</code> /{' '}
            <code className="font-mono">.docx</code>，上限 {MAX_FILE_MB} MB。
            <span className="text-foreground">文件不会离开这台机器</span>
            —— 解压、切分、核查全部在浏览器本地完成，没有后端、没有 AI 调用、没有网络请求。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="micro inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy || status === 'idle'}
              className="micro inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              清空
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.text,.docx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void handleFile(file);
              event.target.value = '';
            }}
          />
        </div>

        {/* 粘贴通道：任何环境下都能跑通的那条路 */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-medium">或直接粘贴正文</span>
            <input
              value={pastedName}
              onChange={(event) => setPastedName(event.target.value)}
              className="w-52 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="粘贴内容的文件名（决定按 Markdown 还是纯文本解析）"
            />
            <span className="text-[11px] text-muted-foreground">
              文件名决定解析分支：.md 走 Markdown（识别标题 / 代码围栏），其余按纯文本
            </span>
          </div>
          <textarea
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            rows={6}
            spellCheck={false}
            placeholder="# 实验报告：多线程共享计数器的同步与互斥&#10;&#10;## 一、实验原理&#10;…"
            className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/40"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePasted()}
              disabled={busy}
              className="micro inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              开始核查
            </button>
            {sampleText === null ? null : (
              <button
                type="button"
                onClick={() => {
                  setPastedName(sampleName ?? 'sample.md');
                  setPastedText(sampleText);
                }}
                disabled={busy}
                className="micro inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] transition-colors hover:bg-secondary disabled:opacity-50"
              >
                填入一份样例
              </button>
            )}
            {statusText === '' ? null : (
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {statusText}
              </span>
            )}
          </div>
        </div>
      </Card>

      {error === null ? null : (
        <Card className="flex items-start gap-2 border-destructive/50 bg-destructive/5 p-4">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-destructive">无法完成核查</p>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground">{error}</p>
          </div>
        </Card>
      )}

      {outcome === null ? null : (
        <InspectionResult outcome={outcome} corpusSize={corpusSize} />
      )}
    </div>
  );
}

/* ==========================================================================
 * 结果区
 * ========================================================================== */

function InspectionResult({ outcome, corpusSize }: { outcome: Outcome; corpusSize: number }) {
  const { document, inspection } = outcome;
  const { summary } = document;
  const notCoveredCount = inspection.notCovered.length;
  const errorFacts = inspection.facts.filter((f) => {
    if (f.kind === 'structure') return f.value === false;
    if (f.threshold === undefined) return false;
    return typeof f.value === 'number' && f.value < f.threshold;
  });
  const passedFacts = inspection.facts.filter(
    (f) => !errorFacts.includes(f) && (f.value === true || f.value === false || typeof f.value === 'number'),
  );

  return (
    <div className="space-y-4">
      {/* ---- 概览 ---- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
          <SquareTerminal className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">核查结果</h2>
          <Badge variant="accent">{VIA_LABEL[outcome.via]}</Badge>
          <Badge variant="outline">非 AI · 浏览器本地计算</Badge>
          <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">
            {outcome.fileName} · {(outcome.fileSize / 1024).toFixed(1)} KB
          </span>
        </div>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Metric label="耗时" value={`${outcome.elapsedMs} ms`} hint="从点下到出结果的全部时间" />
            <Metric label="结构块" value={formatNumber(summary.blockCount)} hint={`标题 ${summary.headings} · 表格 ${summary.tables} · 图 ${summary.figures}`} />
            <Metric label="正文字数" value={formatNumber(summary.textChars)} hint="汉字 + 英文单词（与工具链 T1 同口径）" />
            <Metric label="代码" value={`${summary.codeBlocks} 块`} hint={`${summary.codeLines} 行 · 测试用例 ${summary.testCases}`} />
            <Metric
              label="规则覆盖"
              value={`${inspection.facts.length} 条`}
              hint={notCoveredCount === 0 ? `规则集共 ${inspection.rulesetDigest.ruleCount} 条，全部覆盖` : `另有 ${notCoveredCount} 条不适用`}
            />
          </div>

          {/* 解析状态：有正文却识别不到标题时必须显式说出来 */}
          {document.status !== 'ok' ? (
            <p className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-rule p-3 text-[12px] leading-relaxed text-muted-foreground">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                解析状态为 <code className="font-mono text-foreground">{document.status}</code>
                {document.failures.length === 0 ? '。' : `：${document.failures.map((f) => f.reason).join('；')}`}
                {document.status === 'partial' && document.failures.some((f) => f.reason.startsWith('structure-not-recognized'))
                  ? ' —— 此时**章节存在性无法判定**，下面的结构规则会全部标注为「不适用」，而不是判定为「缺失」。'
                  : null}
              </span>
            </p>
          ) : null}

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            文件指纹 <code className="break-all font-mono">{document.sourceFile.digest || '（未计算）'}</code>
            ；规则集摘要 <code className="font-mono">{inspection.rulesetDigest.rulesetDigest.slice(0, 22)}…</code>。
            这两者与工具链 T2 的输出应当逐字相同（构建期由 <code className="font-mono">npm run audit:cross-end</code> 复核）。
          </p>
        </div>
      </Card>

      {/* ---- 不适用项：先说不适用，再说结论 ---- */}
      {notCoveredCount === 0 ? null : (
        <Card className="p-4">
          <h3 className="text-[13px] font-semibold">不适用 / 无法判定的规则（{notCoveredCount} 条）</h3>
          <ul className="mt-2 space-y-1.5">
            {inspection.notCovered.map((ruleId) => (
              <li key={ruleId} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                <code className="font-mono text-foreground">{ruleId}</code>
                <span className="text-muted-foreground">{inspection.notCoveredReasons[ruleId]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
            「不适用」与「不通过」是两件事：前者是这条规则在当前输入上无法判定，
            后者才表示核查发现了问题。把两者混为一谈，会把「没解析出来」误报成「学生没写」。
          </p>
        </Card>
      )}

      {/* ---- 逐条事实 ---- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
          <h3 className="text-sm font-semibold">逐条事实（{inspection.facts.length} 条）</h3>
          <span className="text-[11px] text-muted-foreground">
            按 ruleId 确定性排序；每条都给出取值、阈值与在原文中的锚点
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Badge variant="warning">
              <span aria-hidden>※</span> 未达成 {errorFacts.length}
            </Badge>
            <Badge variant="accent">
              <span aria-hidden>●</span> 已核查 {passedFacts.length}
            </Badge>
          </span>
        </div>
        <ul className="divide-y divide-border">
          {inspection.facts.map((fact) => (
            <FactRow key={fact.ruleId} fact={fact} />
          ))}
        </ul>
      </Card>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        相似度是与内置语料库（{corpusSize} 份样例报告）比对得出的**文本指纹接近度**，
        只表示「值得看一眼」，<span className="text-foreground">不构成任何抄袭结论</span>；
        最终判断须由教师结合原创性评分点完成。
      </p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum text-base font-semibold">{value}</div>
      {hint === undefined ? null : (
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function FactRow({ fact }: { fact: RuleInspectionResult['facts'][number] }) {
  // 拆成两个具名的窄化值，避免用 boolean 变量去"窄化"联合类型（TS 不会跟着收窄）
  const numericValue = typeof fact.value === 'number' ? fact.value : null;
  const threshold = fact.threshold ?? null;
  const isThreshold = numericValue !== null && threshold !== null;
  const unmet = numericValue !== null && threshold !== null ? numericValue < threshold : fact.value === false;
  const ratio =
    numericValue !== null && threshold !== null ? Math.min(1, numericValue / Math.max(1, threshold)) : null;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn(
            unmet
              ? 'border-dashed border-rule bg-transparent text-muted-foreground'
              : 'border-primary/45 bg-primary/5 text-foreground',
          )}
        >
          <span aria-hidden>{unmet ? '※' : '●'}</span>
          {unmet ? '未达成' : '已核查'}
        </Badge>
        <code className="font-mono text-[11.5px] text-foreground">{fact.ruleId}</code>
        <span className="text-[11px] text-muted-foreground">
          {fact.kind}
          {fact.bestMatch === undefined || fact.bestMatch === null ? '' : ` · 最相似语料 ${fact.bestMatch}`}
        </span>
        {fact.evidenceAnchor === null || fact.evidenceAnchor === undefined ? null : (
          <span className="font-mono text-[11px] text-muted-foreground">锚点 {fact.evidenceAnchor}</span>
        )}
        {fact.matchedHeading === undefined ? null : (
          <span className="text-[11px] text-muted-foreground">
            命中标题「{fact.matchedHeading}」（模式「{fact.matchedPattern}」）
          </span>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-foreground">{fact.fact}</p>
      {ratio === null || numericValue === null || threshold === null ? null : (
        <Progress
          value={numericValue}
          max={Math.max(1, threshold)}
          barClassName={unmet ? 'bg-rule' : 'bg-foreground'}
          label={fact.ruleId}
        />
      )}
      {isThreshold && numericValue !== null && threshold !== null ? (
        <p className="tnum text-[11px] text-muted-foreground">
          取值 {formatScore(numericValue)} / 要求 ≥ {formatScore(threshold)}
        </p>
      ) : null}
    </li>
  );
}
