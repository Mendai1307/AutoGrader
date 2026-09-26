/**
 * AutoGrader · 浏览器端 DOCX 解析（零依赖）
 * ===========================================================================
 * ⚠️ 本文件是 `document_parser.py` 的 **docx 分支移植**（md/txt 分支见 lib/parse.ts）。
 *    两侧必须切出同样的块，否则「上传核查」与智能体侧的结论会分叉。
 *
 * 为什么必须零依赖
 * ---------------------------------------------------------------------------
 * docx 就是一个 ZIP。浏览器原生具备解压能力（`DecompressionStream('deflate-raw')`），
 * 所以不必引入 JSZip/mammoth 之类；引入第三方库既增加体积，也让"结果可被第三方
 * 独立复算"这句话变难验证。
 *
 * 复刻的两条关键路径（**只走一条会全盘漏检**）
 * ---------------------------------------------------------------------------
 *   ① `tencent-local-office-edit` 等生成器产出的 docx **全部段落没有 `w:pStyle`**，
 *      标题只由**段落级 `w:outlineLvl`**（0–8，**9 = 正文**）标记；
 *   ② 真实 Word 文件的 `w:pStyle val` 是**数字 styleId**，真名在 `word/styles.xml`
 *      （`1` → `heading 1`），且样式可能沿 `w:basedOn` 上溯才带 outlineLvl。
 *
 *   判定顺序（与 T1 完全一致）：
 *     段落级 outlineLvl → 样式级 outlineLvl（沿 basedOn 上溯，上限 4 跳）→ 样式名 `heading N` / `标题 N`。
 *   `outlineLvl == 9` 表示正文，**直接判为非标题且不再退化到样式名判定**。
 *
 * 能力边界（页面上必须如实告知，不做假承诺）
 * ---------------------------------------------------------------------------
 *   · 需要 `DecompressionStream('deflate-raw')`：Chrome/Edge 103+、Safari 16.4+、Firefox 113+。
 *     不支持时抛 `DocxUnsupportedError`，由界面降级提示改用 md / txt。
 *   · 不支持 `.doc`（旧版 OLE 二进制格式，不是 ZIP）。
 *   · **不做 PDF**：PDF 的文字层抽取在浏览器端无法保证与工具链一致，页面上不提供该入口。
 */

import { cleanText, createBuilder, summarize, type ParsedDocument } from './parse.ts';

/* ==========================================================================
 * 常量（与 T1 一致）
 * ========================================================================== */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** outlineLvl ≥ 9 表示正文，不算标题 */
const DOCX_OUTLINE_BODY = 9;
/** `w:basedOn` 上溯的最大跳数（防样式表里出现环） */
const DOCX_BASED_ON_MAX_HOPS = 4;

/**
 * 样式名匹配：heading 1 / 标题 1 / 標題 1（大小写不敏感）。
 *
 * ⚠️ 这里刻意用 `\uXXXX` 转义写"标题 / 標題"，而不是直接写汉字：
 *    这些字只用于**匹配样式名**，永远不会被渲染出来。写成字面量会让
 *    `scripts/check-fonts.mjs` 把"源码里出现了子集外的字"报成告警 ——
 *    告警本身没错，但那是误报，会让真正的掉字风险淹没在噪声里。
 */
const RE_DOCX_HEADING_NAME = new RegExp('^\\s*(?:heading|\\u6807\\u9898|\\u6A19\\u984C)\\s*([1-9])\\s*$', 'i');

/** ZIP 结构签名 */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/* ==========================================================================
 * 错误类型（界面据此给出可读提示，而不是抛裸异常）
 * ========================================================================== */

export class DocxUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxUnsupportedError';
  }
}

export class DocxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxFormatError';
  }
}

/* ==========================================================================
 * ZIP 读取
 * ========================================================================== */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** 本环境是否具备 deflate-raw 解压能力 */
export function isDocxSupported(): boolean {
  return typeof DecompressionStream === 'function';
}

/**
 * 扫描 ZIP 的**中央目录**（而不是逐个扫 local header）。
 * 理由：local header 里的 size 字段在"流式写入"产生的包里可能为 0，
 * 真实长度只写在中央目录（并用 data descriptor 补充）；按中央目录找才稳。
 */
function readCentralDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // EOCD 在文件尾部，注释最长 65535 字节 → 从末尾往前找签名
  const minOffset = Math.max(0, bytes.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new DocxFormatError('不是有效的 ZIP 结构（未找到中央目录结尾记录）。若是 .doc 旧格式请另存为 .docx。');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name = '';
    try {
      name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    } catch {
      name = '';
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0) throw new DocxFormatError('ZIP 中央目录为空或已损坏。');
  return entries;
}

/** 取出某个条目的**原始数据区**（未解压） */
function readEntryRaw(buffer: ArrayBuffer, entry: ZipEntry): Uint8Array {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const base = entry.localHeaderOffset;
  if (view.getUint32(base, true) !== SIG_LOCAL) {
    throw new DocxFormatError(`条目 ${entry.name} 的本地头签名不合法（文件可能被截断）。`);
  }
  const nameLength = view.getUint16(base + 26, true);
  const extraLength = view.getUint16(base + 28, true);
  const start = base + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) {
    throw new DocxFormatError(`条目 ${entry.name} 的数据区超出文件末尾（文件可能被截断）。`);
  }
  return bytes.subarray(start, end);
}

/** deflate-raw 解压（docx 内部条目不带 zlib 头） */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 读取并解码一个文本条目（entry 为 null 时返回 null，而不是抛错） */
async function readTextEntry(
  buffer: ArrayBuffer,
  entry: ZipEntry | undefined,
  label: string,
): Promise<string | null> {
  if (entry === undefined) return null;
  const raw = readEntryRaw(buffer, entry);
  let data: Uint8Array;
  if (entry.method === 0) {
    data = raw; // stored，未压缩
  } else if (entry.method === 8) {
    data = await inflateRaw(raw);
  } else {
    throw new DocxFormatError(`${label} 使用了不支持的压缩方式（method=${entry.method}）。`);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

/* ==========================================================================
 * XML 遍历小工具（对齐 ElementTree 的语义）
 * ========================================================================== */

/** 元素名是否匹配（命名空间 + 本地名） */
function isW(node: Node | null, localName: string): node is Element {
  return (
    node !== null &&
    node.nodeType === 1 &&
    (node as Element).localName === localName &&
    (node as Element).namespaceURI === W
  );
}

/** 直接子元素中匹配 `w:<localName>` 的第一个 */
function findWChild(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (isW(child, localName)) return child;
  }
  return null;
}

/** 直接子元素中匹配 `w:<localName>` 的全部 */
function findWChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((child) => isW(child, localName));
}

/** `w:val` 属性（去掉首尾空白），无则返回 '' */
function wVal(element: Element | null): string {
  if (element === null) return '';
  return (element.getAttributeNS(W, 'val') ?? '').trim();
}

/**
 * 前序遍历全部后代（**含自身**），与 Python 的 `Element.iter()` 一致。
 * 顺序很关键：`w:t`、`w:tab`、`w:br` 在文档中的先后顺序决定拼出的文本。
 */
function walkSelfAndDescendants(root: Element, visit: (node: Element) => void): void {
  visit(root);
  for (const child of Array.from(root.children)) walkSelfAndDescendants(child, visit);
}

/* ==========================================================================
 * 样式表
 * ========================================================================== */

export interface DocxStyles {
  /** styleId → 样式名 */
  names: Map<string, string>;
  /** styleId → 样式级 outlineLvl */
  outline: Map<string, number>;
  /** styleId → basedOn 的 styleId */
  basedOn: Map<string, string>;
}

/** 解析 `word/styles.xml`。读不到 / 解析失败时返回空表（退化为按段落级 outlineLvl 判定）。 */
function loadDocxStyles(stylesXml: string | null): DocxStyles {
  const names = new Map<string, string>();
  const outline = new Map<string, number>();
  const basedOn = new Map<string, string>();
  if (stylesXml === null) return { names, outline, basedOn };

  let root: Element;
  try {
    const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('parsererror');
    root = doc.documentElement;
  } catch {
    return { names, outline, basedOn };
  }
  if (root === null) return { names, outline, basedOn };

  // Python 用 root.findall(W+"style")，只取**直接子元素**
  for (const style of findWChildren(root, 'style')) {
    const styleId = (style.getAttributeNS(W, 'styleId') ?? '').trim();
    if (!styleId) continue;

    const nameEl = findWChild(style, 'name');
    if (nameEl !== null) names.set(styleId, (nameEl.getAttributeNS(W, 'val') ?? '').trim());

    const basedOnEl = findWChild(style, 'basedOn');
    const basedOnVal = wVal(basedOnEl);
    if (basedOnVal) basedOn.set(styleId, basedOnVal);

    const pPr = findWChild(style, 'pPr');
    if (pPr !== null) {
      const outlineEl = findWChild(pPr, 'outlineLvl');
      const value = wVal(outlineEl);
      if (/^\d+$/.test(value)) outline.set(styleId, Number(value));
    }
  }

  return { names, outline, basedOn };
}

/** 样式级 outlineLvl，沿 `w:basedOn` 上溯（有界，防止样式表出现环） */
function styleOutlineLevel(styleId: string, styles: DocxStyles): number | null {
  let current = styleId;
  for (let hop = 0; hop < DOCX_BASED_ON_MAX_HOPS; hop += 1) {
    if (!current) return null;
    const found = styles.outline.get(current);
    if (found !== undefined) return found;
    current = styles.basedOn.get(current) ?? '';
  }
  return null;
}

/** 样式名归一：全角空格与连续空白折叠（不改实质字符） */
function normStyleName(name: string): string {
  return name.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 判定段落的标题级别；不是标题返回 null。
 * 顺序：段落级 outlineLvl → 样式级 outlineLvl → 样式名匹配。
 * `outlineLvl == 9` 表示正文，**直接返回 null 且不再退化到样式名判定**。
 */
export function docxHeadingLevel(
  styleId: string,
  paraOutline: number | null,
  styles: DocxStyles,
): number | null {
  let level = paraOutline;
  if (level === null) level = styleOutlineLevel(styleId, styles);
  if (level !== null) return level >= DOCX_OUTLINE_BODY ? null : level + 1;

  // 样式名（没有 styles.xml 时，直接拿 pStyle 的 val 当名字试一次）
  const name = normStyleName(styles.names.get(styleId) ?? styleId);
  const matched = RE_DOCX_HEADING_NAME.exec(name);
  return matched ? Number(matched[1]) : null;
}

/* ==========================================================================
 * 主流程
 * ========================================================================== */

/** 解析一个段落元素，产出标题 / 代码 / 正文 / 图片块 */
function parseParagraph(paragraph: Element, builder: ReturnType<typeof createBuilder>, styles: DocxStyles): void {
  const texts: string[] = [];
  let hasDrawing = false;

  walkSelfAndDescendants(paragraph, (node) => {
    if (isW(node, 't')) texts.push(node.textContent ?? '');
    else if (isW(node, 'drawing')) hasDrawing = true;
    else if (isW(node, 'tab')) texts.push('\t');
    else if (isW(node, 'br')) texts.push('\n');
  });

  let style = '';
  let paraOutline: number | null = null;
  const pPr = findWChild(paragraph, 'pPr');
  if (pPr !== null) {
    style = wVal(findWChild(pPr, 'pStyle'));
    const outlineValue = wVal(findWChild(pPr, 'outlineLvl'));
    if (/^\d+$/.test(outlineValue)) paraOutline = Number(outlineValue);
  }

  const raw = texts.join('');
  const text = cleanText(raw);

  const level = docxHeadingLevel(style, paraOutline, styles);
  if (level !== null) {
    // 标题：text 为空时退回 raw.strip()（与 T1 一致，避免丢掉只有空格的标题）
    builder.addHeading(level, text || raw.trim(), raw);
    return;
  }

  // 样式名里含 Code / 代码 → 当作代码块（整段保留缩进，只 rstrip）
  if (style.includes('Code') || style.includes('代码')) {
    const body = raw.replace(/\s+$/, '');
    builder.addBlock('code', body, null, body);
    return;
  }

  if (text) builder.addBlock('text', text, null, raw);
  // 有图但没文字：产出一个占位图块，使"图片数"可被统计
  if (hasDrawing) builder.addBlock('figure', '[图片]', null, '[图片]');
}

/** 解析一个表格元素：每行拼成 `单元格 | 单元格` 的表格块 */
function parseTable(table: Element, builder: ReturnType<typeof createBuilder>): void {
  for (const row of findWChildren(table, 'tr')) {
    const cells: string[] = [];
    for (const cell of findWChildren(row, 'tc')) {
      const parts: string[] = [];
      for (const paragraph of findWChildren(cell, 'p')) {
        let cellText = '';
        walkSelfAndDescendants(paragraph, (node) => {
          if (isW(node, 't')) cellText += node.textContent ?? '';
        });
        parts.push(cleanText(cellText));
      }
      cells.push(parts.join(' '));
    }
    const line = cells.join(' | ').trim();
    // 只保留非空行（等价 Python 的 row.strip("| ")）
    if (line.replace(/[|\s]/g, '') !== '') builder.addBlock('table', line, null, line);
  }
}

/** 找不到正文体时使用：在文档里按名字找 `w:body` */
function findBody(root: Element): Element | null {
  const direct = findWChild(root, 'body');
  if (direct !== null) return direct;
  const all = root.getElementsByTagNameNS(W, 'body');
  return all.length > 0 ? all[0]! : null;
}

/**
 * 解析 .docx（或任何 docx 内容的 ArrayBuffer），产出与 T1 同形状的报告对象。
 *
 * @param buffer      docx 文件的字节内容
 * @param sourceName  来源文件名（写入 sourceFile.path）
 * @param fileDigest  文件原始字节的 SHA-256（**由调用方计算**）。
 *                    注意不能用"解压后文本"的摘要冒充：T1 对 docx 取的正是文件字节摘要
 *                    （`sha256_bytes(open(path,'rb').read())`），两者不同源。
 * @throws DocxUnsupportedError 环境不支持 deflate-raw 解压
 * @throws DocxFormatError      不是有效 docx / 已损坏
 */
export async function parseDocxDocument(
  buffer: ArrayBuffer,
  sourceName: string,
  fileDigest: string,
): Promise<ParsedDocument> {
  if (!isDocxSupported()) {
    throw new DocxUnsupportedError(
      '当前浏览器不支持流式解压（DecompressionStream deflate-raw），无法在本地解析 docx。' +
        '请改用 md / txt，或把内容粘贴为文本。',
    );
  }

  const builder = createBuilder();

  const documentXmlEntry = await (async () => {
    const entries = readCentralDirectory(buffer);
    const documentEntry = entries.find((e) => e.name === 'word/document.xml');
    if (documentEntry === undefined) {
      throw new DocxFormatError('不是有效的 docx：压缩包里没有 word/document.xml。');
    }
    const stylesEntry = entries.find((e) => e.name === 'word/styles.xml');
    const [documentXml, stylesXml] = await Promise.all([
      readTextEntry(buffer, documentEntry, 'word/document.xml'),
      readTextEntry(buffer, stylesEntry, 'word/styles.xml'),
    ]);
    return { documentXml, stylesXml };
  })();

  const styles = loadDocxStyles(documentXmlEntry.stylesXml);

  let root: Element;
  try {
    const doc = new DOMParser().parseFromString(documentXmlEntry.documentXml ?? '', 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('parsererror');
    root = doc.documentElement;
  } catch (error) {
    builder.fail(`docx-xml-parse-failed: ${(error as Error).message}`);
    return finish(builder, sourceName, fileDigest);
  }

  const body = findBody(root);
  if (body === null) {
    builder.fail('docx-no-body');
    return finish(builder, sourceName, fileDigest);
  }

  for (const child of Array.from(body.children)) {
    if (isW(child, 'p')) parseParagraph(child, builder, styles);
    else if (isW(child, 'tbl')) parseTable(child, builder);
  }

  return finish(builder, sourceName, fileDigest);
}

/**
 * 收尾：跑静默失败闸门并组装报告。
 * 与 T1 的 run() 尾部逻辑一致 —— 有正文却无标题时必须显式降级，不得报成功。
 */
function finish(
  builder: ReturnType<typeof createBuilder>,
  sourceName: string,
  fileDigest: string,
): ParsedDocument {
  const hasBody = builder.blocks.some(
    (b) => b.kind === 'text' || b.kind === 'code' || b.kind === 'table',
  );
  if (builder.headings.length === 0 && hasBody) {
    builder.fail(
      'structure-not-recognized: 未识别到任何标题，章节存在性**无法判定**（按未知处理，禁止当成「缺失」）',
    );
  }

  const failureCount = builder.failures.length;
  const status: ParsedDocument['status'] =
    builder.blocks.length === 0 && failureCount > 0 ? 'failed' : failureCount > 0 ? 'partial' : 'ok';

  return {
    tool: 'T1',
    status,
    sourceFile: { path: sourceName, digest: fileDigest },
    structure: builder.tree(),
    blocks: builder.blocks,
    failures: builder.failures,
    // 统计口径直接复用 parse.ts 的 summarize，绝不在这里另写一份（两处实现必然漂移）
    summary: summarize(builder.blocks),
    emptyHeadingParagraphs: builder.emptyHeadingParagraphs,
    exitCode: status === 'failed' ? 2 : status === 'partial' ? 1 : 0,
  };
}
