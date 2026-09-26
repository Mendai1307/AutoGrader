/**
 * AutoGrader · 核查器 ②：代码分析
 * ============================================================================
 * 只做「机器可确切判定」的代码事实，不做正确性判断（那属于语义层，由 LearnBuddy 完成）：
 *   1. 代码块数量、语言分布、总行数；
 *   2. 关键 API / 算法调用检测——按可配置关键词表在代码块内做词边界匹配，
 *      命中项回指到具体代码块与行号。
 *
 * 关键词表按三个实验主题分组：进程/线程同步、Socket 网络编程、排序算法性能对比。
 * 表结构本身是导出的常量，新增关键词只需扩展 KEYWORD_CATALOG，无需改动匹配逻辑。
 *
 * 纯函数、确定性、零依赖。
 */

import type { CodeBlockInfo, CodeHit, CodeInspection, LanguageStat } from './types';
import { escapeRegExp, scanDocument } from './markdown';

/** 关键词类别 */
export type KeywordKind = 'api' | 'algorithm';

/** 单个关键词定义 */
export interface KeywordSpec {
  /** 关键词原文（仅由字母、数字、下划线组成，匹配时自动加词边界） */
  keyword: string;
  /** 中文说明 */
  label: string;
  /** 类别 */
  kind: KeywordKind;
}

/** 一个实验主题下的关键词组 */
export interface KeywordGroup {
  /** 主题 id */
  topic: string;
  /** 主题中文名 */
  topicLabel: string;
  /** 关键词清单 */
  keywords: readonly KeywordSpec[];
}

/**
 * 关键 API / 算法关键词目录（可配置）。
 * 顺序即输出顺序，保证结果确定性。
 */
export const KEYWORD_CATALOG: readonly KeywordGroup[] = [
  {
    topic: 'os-thread-sync',
    topicLabel: '进程 / 线程同步',
    keywords: [
      { keyword: 'fork', label: '创建子进程', kind: 'api' },
      { keyword: 'waitpid', label: '等待子进程结束', kind: 'api' },
      { keyword: 'pthread_create', label: '创建线程', kind: 'api' },
      { keyword: 'pthread_join', label: '等待线程结束', kind: 'api' },
      { keyword: 'pthread_mutex_init', label: '初始化互斥量', kind: 'api' },
      { keyword: 'pthread_mutex_lock', label: '加锁进入临界区', kind: 'api' },
      { keyword: 'pthread_mutex_unlock', label: '解锁离开临界区', kind: 'api' },
      { keyword: 'pthread_mutex_destroy', label: '销毁互斥量', kind: 'api' },
      { keyword: 'pthread_cond_wait', label: '条件变量等待', kind: 'api' },
      { keyword: 'pthread_cond_signal', label: '条件变量唤醒单个等待者', kind: 'api' },
      { keyword: 'pthread_cond_broadcast', label: '条件变量唤醒全部等待者', kind: 'api' },
      { keyword: 'sem_init', label: '初始化信号量', kind: 'api' },
      { keyword: 'sem_wait', label: '信号量 P 操作', kind: 'api' },
      { keyword: 'sem_post', label: '信号量 V 操作', kind: 'api' },
      { keyword: 'sem_trywait', label: '信号量非阻塞 P 操作', kind: 'api' },
      { keyword: 'sem_destroy', label: '销毁信号量', kind: 'api' },
      { keyword: 'sleep', label: '睡眠等待（非同步原语）', kind: 'api' },
    ],
  },
  {
    topic: 'socket-network',
    topicLabel: 'Socket 网络编程',
    keywords: [
      { keyword: 'socket', label: '创建套接字', kind: 'api' },
      { keyword: 'bind', label: '绑定地址与端口', kind: 'api' },
      { keyword: 'listen', label: '进入监听状态', kind: 'api' },
      { keyword: 'accept', label: '接受连接', kind: 'api' },
      { keyword: 'connect', label: '发起连接', kind: 'api' },
      { keyword: 'send', label: '发送数据', kind: 'api' },
      { keyword: 'sendto', label: '发送数据报', kind: 'api' },
      { keyword: 'recv', label: '接收数据', kind: 'api' },
      { keyword: 'recvfrom', label: '接收数据报', kind: 'api' },
      { keyword: 'shutdown', label: '关闭连接的一个方向', kind: 'api' },
      { keyword: 'close', label: '关闭描述符', kind: 'api' },
      { keyword: 'setsockopt', label: '设置套接字选项', kind: 'api' },
      { keyword: 'getaddrinfo', label: '地址解析', kind: 'api' },
      { keyword: 'inet_pton', label: '点分十进制转二进制地址', kind: 'api' },
      { keyword: 'inet_ntop', label: '二进制地址转点分十进制', kind: 'api' },
      { keyword: 'htons', label: '主机序转网络序（16 位）', kind: 'api' },
      { keyword: 'htonl', label: '主机序转网络序（32 位）', kind: 'api' },
      { keyword: 'ntohs', label: '网络序转主机序（16 位）', kind: 'api' },
      { keyword: 'ntohl', label: '网络序转主机序（32 位）', kind: 'api' },
      { keyword: 'select', label: 'I/O 多路复用（select）', kind: 'api' },
      { keyword: 'poll', label: 'I/O 多路复用（poll）', kind: 'api' },
      { keyword: 'epoll_create', label: '创建 epoll 实例', kind: 'api' },
      { keyword: 'epoll_wait', label: '等待 epoll 事件', kind: 'api' },
      { keyword: 'SO_REUSEADDR', label: '地址复用选项', kind: 'api' },
      { keyword: 'sockaddr_in', label: 'IPv4 地址结构体', kind: 'api' },
    ],
  },
  {
    topic: 'sort-bench',
    topicLabel: '排序算法性能对比',
    keywords: [
      { keyword: 'qsort', label: '标准库排序函数', kind: 'api' },
      { keyword: 'malloc', label: '堆分配内存', kind: 'api' },
      { keyword: 'calloc', label: '堆分配并清零', kind: 'api' },
      { keyword: 'realloc', label: '调整已分配内存大小', kind: 'api' },
      { keyword: 'free', label: '释放内存', kind: 'api' },
      { keyword: 'memcpy', label: '内存拷贝', kind: 'api' },
      { keyword: 'memmove', label: '内存搬移（允许重叠）', kind: 'api' },
      { keyword: 'memset', label: '内存置位', kind: 'api' },
      { keyword: 'clock_gettime', label: '高精度计时', kind: 'api' },
      { keyword: 'gettimeofday', label: '计时', kind: 'api' },
      { keyword: 'rand', label: '生成随机数据', kind: 'api' },
      { keyword: 'swap', label: '元素交换', kind: 'algorithm' },
      { keyword: 'partition', label: '快排分区', kind: 'algorithm' },
      { keyword: 'quicksort', label: '快速排序（自实现）', kind: 'algorithm' },
      { keyword: 'quick_sort', label: '快速排序（自实现）', kind: 'algorithm' },
      { keyword: 'mergesort', label: '归并排序（自实现）', kind: 'algorithm' },
      { keyword: 'merge_sort', label: '归并排序（自实现）', kind: 'algorithm' },
      { keyword: 'merge', label: '归并合并步骤', kind: 'algorithm' },
      { keyword: 'bubblesort', label: '冒泡排序（自实现）', kind: 'algorithm' },
      { keyword: 'bubble_sort', label: '冒泡排序（自实现）', kind: 'algorithm' },
      { keyword: 'insertion_sort', label: '插入排序（自实现）', kind: 'algorithm' },
      { keyword: 'selection_sort', label: '选择排序（自实现）', kind: 'algorithm' },
      { keyword: 'heap_sort', label: '堆排序（自实现）', kind: 'algorithm' },
      { keyword: 'sift_down', label: '堆下沉调整', kind: 'algorithm' },
    ],
  },
];

/** 语言标注归一化映射表（键为小写原始标注） */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  c: 'c',
  h: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  python: 'python',
  py: 'python',
  python3: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  java: 'java',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
  shell: 'shell',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  makefile: 'makefile',
  cmake: 'cmake',
  text: 'text',
  plaintext: 'text',
  plain: 'text',
};

/** 未标注语言时使用的语言名 */
export const UNKNOWN_LANGUAGE = 'unknown';

/** 归一化语言标注 */
export function normalizeLanguage(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === '') return UNKNOWN_LANGUAGE;
  return LANGUAGE_ALIASES[key] ?? key;
}

/** 语言名 → 中文显示名（未收录时原样返回） */
export function languageLabel(languageKey: string): string {
  const labels: Readonly<Record<string, string>> = {
    c: 'C',
    cpp: 'C++',
    python: 'Python',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    java: 'Java',
    go: 'Go',
    rust: 'Rust',
    shell: 'Shell',
    sql: 'SQL',
    json: 'JSON',
    yaml: 'YAML',
    xml: 'XML',
    html: 'HTML',
    makefile: 'Makefile',
    cmake: 'CMake',
    text: '纯文本',
    [UNKNOWN_LANGUAGE]: '未标注',
  };
  return labels[languageKey] ?? languageKey;
}

/**
 * 在文本中统计关键词出现次数与行号。
 * 关键词按词边界匹配：`pthread_mutex_lock` 不会命中 `pthread_mutex_lock_impl`，
 * `recv` 不会命中 `recv_exact`（后者需单独登记为关键词）。
 */
export function findKeywordOccurrences(
  text: string,
  keyword: string,
): { count: number; lineOffsets: number[] } {
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'g');
  const lines = text.split('\n');
  let count = 0;
  const lineOffsets: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const segment = lines[i] ?? '';
    const matched = segment.match(pattern);
    if (matched === null) continue;
    count += matched.length;
    lineOffsets.push(i);
  }
  return { count, lineOffsets };
}

/**
 * 分析报告代码块：结构统计 + 关键 API / 算法调用检测。
 */
export function inspectCode(rawText: string): CodeInspection {
  const doc = scanDocument(rawText);

  const blocks: CodeBlockInfo[] = doc.fences.map((fence) => {
    let nonEmptyLineCount = 0;
    for (const codeLine of fence.codeLines) {
      if (codeLine.trim() !== '') nonEmptyLineCount += 1;
    }
    return {
      index: fence.index,
      language: fence.language,
      languageKey: normalizeLanguage(fence.language),
      hasLanguageTag: fence.language.trim() !== '',
      startLine: fence.startLine,
      endLine: fence.endLine,
      closed: fence.closed,
      lineCount: fence.codeLines.length,
      nonEmptyLineCount,
    };
  });

  const languageMap = new Map<string, LanguageStat>();
  let codeLines = 0;
  let nonEmptyCodeLines = 0;
  let untaggedBlockCount = 0;
  let unclosedBlockCount = 0;

  for (const block of blocks) {
    codeLines += block.lineCount;
    nonEmptyCodeLines += block.nonEmptyLineCount;
    if (!block.hasLanguageTag) untaggedBlockCount += 1;
    if (!block.closed) unclosedBlockCount += 1;
    const isUnknown = block.languageKey === UNKNOWN_LANGUAGE;
    const entry = languageMap.get(block.languageKey) ?? {
      languageKey: block.languageKey,
      blocks: 0,
      lines: 0,
    };
    entry.blocks += 1;
    // 「未标注」只统计块数，不计入行数分布，避免与真实语言混淆
    entry.lines += isUnknown ? 0 : block.lineCount;
    languageMap.set(block.languageKey, entry);
  }

  const languages = Array.from(languageMap.values()).sort(compareLanguageStat);

  // 关键 API / 算法检测：逐块扫描，保证命中可以回指到代码块与绝对行号
  const hits: CodeHit[] = [];
  for (const group of KEYWORD_CATALOG) {
    for (const spec of group.keywords) {
      let occurrences = 0;
      const blockIndexes: number[] = [];
      const absoluteLines: number[] = [];
      for (const fence of doc.fences) {
        const found = findKeywordOccurrences(fence.code, spec.keyword);
        if (found.count === 0) continue;
        occurrences += found.count;
        if (!blockIndexes.includes(fence.index)) blockIndexes.push(fence.index);
        for (const offset of found.lineOffsets) {
          const absolute = fence.codeStartLine + offset;
          if (!absoluteLines.includes(absolute)) absoluteLines.push(absolute);
        }
      }
      if (occurrences === 0) continue;
      hits.push({
        keyword: spec.keyword,
        label: spec.label,
        topic: group.topic,
        topicLabel: group.topicLabel,
        kind: spec.kind,
        occurrences,
        blocks: blockIndexes.sort((left, right) => left - right),
        lines: absoluteLines.sort((left, right) => left - right),
      });
    }
  }

  const hitTopics: string[] = [];
  for (const group of KEYWORD_CATALOG) {
    if (hits.some((hit) => hit.topic === group.topic)) hitTopics.push(group.topic);
  }

  const hitOccurrences = hits.reduce((sum, hit) => sum + hit.occurrences, 0);

  return {
    blockCount: blocks.length,
    codeLines,
    nonEmptyCodeLines,
    untaggedBlockCount,
    unclosedBlockCount,
    languages,
    blocks,
    hits,
    hitTopics,
    hitCount: hits.length,
    hitOccurrences,
  };
}

/** 语言分布排序：行数降序 → 块数降序 → 语言名升序（确定性，不依赖插入顺序） */
function compareLanguageStat(left: LanguageStat, right: LanguageStat): number {
  if (left.lines !== right.lines) return right.lines - left.lines;
  if (left.blocks !== right.blocks) return right.blocks - left.blocks;
  return left.languageKey < right.languageKey ? -1 : left.languageKey > right.languageKey ? 1 : 0;
}

/** 关键词目录中全部主题 id（按目录顺序） */
export function catalogTopics(): string[] {
  return KEYWORD_CATALOG.map((group) => group.topic);
}
