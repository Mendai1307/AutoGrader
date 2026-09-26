#!/usr/bin/env node
/**
 * AutoGrader · 本地静态预览服务器（零依赖）
 * ===========================================================================
 * 为什么需要它？
 * ---------------------------------------------------------------------------
 * `frontend/out/` 是 Next.js 静态导出产物（`output: 'export'` + `trailingSlash: true`），
 * 默认构建时 basePath/assetPrefix = `/AutoGrader`（GitHub Pages 项目子路径），
 * 也就是说 **产物内部的资源地址被硬编码成了 `/AutoGrader/_next/...`**。
 *
 * 因此把 `out/` 目录直接挂在网站根路径下（例如 `npx serve frontend/out`，
 * 或 `python -m http.server --directory out`）会得到：
 *     GET /                        → 200（返回 index.html）
 *     GET /AutoGrader/_next/...    → 404（资源全挂，页面白屏且无样式）
 *     GET /AutoGrader/             → 404（子目录根本不存在）
 * 这正是「README 里的启动方式失效」的直接原因。
 *
 * 本脚本的做法：
 *   1. **自动识别**产物内固化的子路径前缀 —— 直接解析 `out/index.html` 中第一个
 *      形如 `.../_next/...` 的资源地址，取它前面那一段。产物怎么构建的，就怎么服务，
 *      不需要人工同步 basePath，也不会再出现「构建用子路径、服务用根路径」的错配。
 *   2. 按该前缀提供服务：`/` 会 302 到 `<base>/`，其余路径必须是 `<base>/...`，
 *      否则返回自定义 404 页（复刻 GitHub Pages 的行为）。
 *   3. 补贴 `trailingSlash` 目录跳转、MIME、路径穿越防护、HEAD 请求。
 *   4. `--check` 模式：起服务后自动跑一轮冒烟校验（首页 / 资源 / 各路由 / 404 / 穿越），
 *      全部通过才退出 0，可直接用于 CI 或交付前自检。
 *
 * 用法：
 *   node scripts/serve.mjs                  # 自动识别前缀，默认 http://localhost:3000
 *   node scripts/serve.mjs --port 8080      # 换端口
 *   node scripts/serve.mjs --base ""        # 强制按根路径服务（用于根路径构建产物）
 *   node scripts/serve.mjs --base /AutoGrader
 *   node scripts/serve.mjs --check          # 冒烟自检后退出（随机端口，不占用 3000）
 *   node scripts/serve.mjs --help
 * ===========================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, '..');

/* ==========================================================================
 * 命令行参数
 * ========================================================================== */

const HELP = `
AutoGrader 本地静态预览服务器（零依赖）

用法: node scripts/serve.mjs [选项]

选项:
  --dir <path>     静态产物目录（默认 frontend/out）
  --port <number>  监听端口（默认 3000，也可用环境变量 PORT）
  --host <host>    监听地址（默认 127.0.0.1）
  --base <path>    强制指定子路径前缀；传空串表示按根路径服务
                   （默认 auto：从产物的 index.html 自动识别）
  --check          启动后跑一轮冒烟自检并退出（退出码 0 = 全部通过）
  -h, --help       显示本帮助
`.trim();

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{dir: string, port: number, host: string, base: string|null, check: boolean, help: boolean}} */
  const opts = {
    dir: path.join(FRONTEND_DIR, 'out'),
    port: Number(process.env.PORT ?? 3000),
    host: '127.0.0.1',
    base: null,
    check: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`[serve] 参数 ${arg} 缺少取值`);
        process.exit(2);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--dir':
        opts.dir = path.resolve(process.cwd(), next());
        break;
      case '--port':
        opts.port = Number(next());
        break;
      case '--host':
        opts.host = next();
        break;
      case '--base':
        opts.base = next();
        break;
      case '--check':
        opts.check = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('--base=')) {
          opts.base = arg.slice('--base='.length);
        } else if (arg.startsWith('--port=')) {
          opts.port = Number(arg.slice('--port='.length));
        } else if (arg.startsWith('--dir=')) {
          opts.dir = path.resolve(process.cwd(), arg.slice('--dir='.length));
        } else {
          console.error(`[serve] 未知参数：${arg}\n`);
          console.error(HELP);
          process.exit(2);
        }
    }
  }

  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error(`[serve] 端口非法：${opts.port}`);
    process.exit(2);
  }
  return opts;
}

/* ==========================================================================
 * 子路径识别
 * ========================================================================== */

/** 归一化子路径：'/AutoGrader/' → '/AutoGrader'；'' / '/' → '' */
function normalizeBase(raw) {
  if (raw === null || raw === undefined) return '';
  let value = String(raw).trim();
  if (value === '' || value === '/') return '';
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+$/, '');
}

/**
 * 从产物首页中识别固化的子路径前缀。
 *
 * 产物里资源地址形如：
 *   basePath = '/AutoGrader' → src="/AutoGrader/_next/static/chunks/xxx.js"
 *   basePath = ''            → src="/_next/static/chunks/xxx.js"
 *
 * 正则 `"(\/[^"]*?)\/_next\/"` 取 "/_next/" 之前那一段（惰性匹配），
 * 根路径产物因为只有一个前导斜杠，匹配失败，返回 ''。
 */
function detectBasePath(outDir) {
  const indexFile = path.join(outDir, 'index.html');
  if (!fs.existsSync(indexFile)) return { base: '', reason: '未找到 index.html，按根路径处理' };
  const html = fs.readFileSync(indexFile, 'utf8');
  const match = /"(\/[^"]*?)\/_next\//.exec(html);
  if (!match) return { base: '', reason: '首页资源地址无子路径前缀' };
  return { base: normalizeBase(match[1]), reason: `识别自首页资源地址 "…${match[1]}/_next/…"` };
}

/* ==========================================================================
 * 静态服务
 * ========================================================================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 统计产物文件数，仅用于启动横幅 */
function countFiles(dir, limit = 5000) {
  let count = 0;
  const walk = (current) => {
    if (count >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= limit) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

/** @param {http.ServerResponse} res */
function sendText(res, status, type, body) {
  const buffer = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buffer);
}

/** @param {http.ServerResponse} res */
function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-cache' });
  res.end();
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

/**
 * 创建静态服务器。
 * @param {{outDir: string, base: string, quiet?: boolean, log?: (line: string) => void}} config
 */
function createStaticServer({ outDir, base, quiet = false, log = console.log }) {
  const rootAbs = path.resolve(outDir);

  /** 把 URL 路径映射为根目录内的绝对文件路径；越界返回 null */
  function toFilePath(urlPath) {
    const rel = urlPath.replace(/^\/+/, '');
    const abs = path.resolve(rootAbs, rel === '' ? '.' : rel);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
    return abs;
  }

  function notFound(res, extra) {
    const fallback = path.join(rootAbs, '404.html');
    if (fs.existsSync(fallback)) {
      const buffer = fs.readFileSync(fallback);
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-cache',
      });
      res.end(buffer);
      return;
    }
    sendText(res, 404, 'text/plain; charset=utf-8', extra ? `404 Not Found\n${extra}\n` : '404 Not Found\n');
  }

  function sendFile(req, res, filePath, stat) {
    const headers = {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, 'text/plain; charset=utf-8', '405 Method Not Allowed\n');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      sendText(res, 400, 'text/plain; charset=utf-8', '400 Bad Request\n');
      return;
    }
    pathname = pathname.replace(/\/{2,}/g, '/');

    const original = pathname;

    // ---- 子路径前缀处理 ----
    if (base !== '') {
      if (pathname === '/' || pathname === base) {
        if (!quiet) log(`  302  ${original} → ${base}/`);
        sendRedirect(res, `${base}/`);
        return;
      }
      if (!pathname.startsWith(`${base}/`)) {
        if (!quiet) log(`  404  ${original}  （不在子路径 ${base}/ 下）`);
        notFound(res, `本站子路径为 ${base}/，正确地址示例：${base}${pathname}`);
        return;
      }
      pathname = pathname.slice(base.length); // 现在以 '/' 开头
    }

    // ---- 路径穿越防护 ----
    let filePath = toFilePath(pathname);
    if (filePath === null) {
      if (!quiet) log(`  403  ${original}  （路径越界）`);
      sendText(res, 403, 'text/plain; charset=utf-8', '403 Forbidden\n');
      return;
    }

    let stat = safeStat(filePath);

    // ---- 目录 → 补斜杠 → index.html ----
    if (stat !== null && stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const target = base === '' ? `${pathname}/` : `${base}${pathname}/`;
        if (!quiet) log(`  302  ${original} → ${target}`);
        sendRedirect(res, target);
        return;
      }
      filePath = path.join(filePath, 'index.html');
      stat = safeStat(filePath);
    }

    if (stat === null || !stat.isFile()) {
      if (!quiet) log(`  404  ${original}`);
      notFound(res);
      return;
    }

    const relative = path.relative(rootAbs, filePath).split(path.sep).join('/');
    if (!quiet) log(`  200  ${original}  (${relative}, ${stat.size} B)`);
    sendFile(req, res, filePath, stat);
  });

  return server;
}

/* ==========================================================================
 * 冒烟自检（--check）
 * ========================================================================== */

/** 从首页 HTML 中收集所有 /_next/ 静态资源地址 */
function collectAssetUrls(html) {
  const urls = new Set();
  const re = /(?:src|href)="([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const url = match[1];
    if (url.startsWith('/') && url.includes('/_next/')) urls.add(url);
  }
  return [...urls];
}

/** @param {string} origin @param {string} base */
async function runChecks(origin, base) {
  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const results = [];

  const fetchPath = async (p, init = {}) => {
    const res = await fetch(new URL(p, origin), { redirect: 'manual', ...init });
    let body = '';
    try {
      body = await res.text();
    } catch {
      body = '';
    }
    return { status: res.status, location: res.headers.get('location') ?? '', body };
  };

  const record = (name, ok, detail) => results.push({ name, ok, detail });

  // 1. 根路径：子路径模式下应 302 到 <base>/；根路径模式下应直接 200
  if (base !== '') {
    const r = await fetchPath('/');
    record(
      `GET /             → 302 ${base}/`,
      r.status === 302 && r.location === `${base}/`,
      `status=${r.status} location=${r.location || '(无)'}`,
    );
  } else {
    const r = await fetchPath('/');
    record('GET /             → 200 首页 HTML', r.status === 200 && r.body.includes('<html'), `status=${r.status} bytes=${r.body.length}`);
  }

  // 2. 首页
  const home = await fetchPath(`${base}/`);
  record(
    `GET ${base}/ → 200 首页 HTML`,
    home.status === 200 && home.body.includes('<html'),
    `status=${home.status} bytes=${home.body.length}`,
  );

  // 3. 首页引用的全部 /_next 静态资源
  const assets = collectAssetUrls(home.body);
  const broken = [];
  for (const url of assets) {
    const r = await fetchPath(url);
    if (r.status !== 200) broken.push(`${url} → ${r.status}`);
  }
  record(
    `首页引用的 ${assets.length} 个 /_next 资源全部 200`,
    assets.length > 0 && broken.length === 0,
    broken.length === 0 ? `共 ${assets.length} 个` : broken.slice(0, 4).join('; '),
  );

  // 4. 各路由页面
  const routes = ['grade/', 'eval/', 'trace/', 'report/sample-01/', 'report/sample-12/'];
  for (const route of routes) {
    const r = await fetchPath(`${base}/${route}`);
    record(`GET ${base}/${route} → 200 HTML`, r.status === 200 && r.body.includes('<html'), `status=${r.status} bytes=${r.body.length}`);
  }

  // 5. 静态结果资产
  const jsonRes = await fetchPath(`${base}/results/result-sample-01.json`);
  let jsonOk = false;
  try {
    JSON.parse(jsonRes.body);
    jsonOk = true;
  } catch {
    jsonOk = false;
  }
  record(
    `GET ${base}/results/result-sample-01.json → 200 且 JSON 可解析`,
    jsonRes.status === 200 && jsonOk,
    `status=${jsonRes.status} json=${jsonOk}`,
  );

  // 6. 未知路径 → 自定义 404 页
  const notFoundRes = await fetchPath(`${base}/__definitely_missing__/`);
  record(
    'GET 未知路径      → 404（自定义 404 页）',
    notFoundRes.status === 404,
    `status=${notFoundRes.status}`,
  );

  // 7. 路径穿越（用 %2e%2e 绕过 URL 解析器的归一化，真正打到服务器上）
  const escapeRes = await fetchPath(`${base}/%2e%2e/package.json`);
  record(
    'GET 路径穿越      → 被拒绝（403/404）',
    escapeRes.status === 403 || escapeRes.status === 404,
    `status=${escapeRes.status}`,
  );

  return results;
}

/* ==========================================================================
 * 主流程
 * ========================================================================== */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  const outDir = path.resolve(opts.dir);
  if (!fs.existsSync(outDir) || !fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error(`[serve] 静态产物不存在或缺少 index.html：${outDir}`);
    console.error('        请先在 frontend/ 下执行 `npm run build` 生成产物。');
    process.exit(1);
  }

  const detected = detectBasePath(outDir);
  const base = opts.base === null ? detected.base : normalizeBase(opts.base);
  const baseSource = opts.base === null ? `自动识别（${detected.reason}）` : '命令行 --base 指定';

  const server = createStaticServer({ outDir, base, quiet: opts.check });

  const port = opts.check && opts.port === 3000 ? 0 : opts.port;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  const origin = `http://${opts.host}:${actualPort}`;

  if (!opts.check) {
    const fileCount = countFiles(outDir);
    console.log('');
    console.log('  AutoGrader · 本地静态预览');
    console.log('  ─────────────────────────────────────────────────────────');
    console.log(`  静态产物    ${outDir}`);
    console.log(`  产物规模    ${fileCount} 个文件`);
    console.log(`  子路径前缀  ${base === '' ? '(无，站点部署在根路径)' : base}    ← ${baseSource}`);
    console.log('  ─────────────────────────────────────────────────────────');
    console.log(`  ➜ 访问地址   ${origin}${base}/`);
    if (base !== '') {
      console.log(`     （注意：必须带 ${base}/ 前缀，根路径 ${origin}/ 会 302 跳转过去；`);
      console.log('       这是复刻 GitHub Pages 项目站点的真实行为）');
    }
    console.log('  ─────────────────────────────────────────────────────────');
    console.log('  按 Ctrl+C 停止');
    console.log('');
    return;
  }

  // ---- --check 模式 ----
  console.log('');
  console.log('  AutoGrader · 本地启动冒烟自检');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  静态产物    ${outDir}`);
  console.log(`  子路径前缀  ${base === '' ? '(无，根路径)' : base}    ← ${baseSource}`);
  console.log(`  临时服务    ${origin}`);
  console.log('  ─────────────────────────────────────────────────────────');

  let results;
  try {
    results = await runChecks(origin, base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  let failed = 0;
  for (const item of results) {
    const mark = item.ok ? '  ✓' : '  ✗';
    if (!item.ok) failed += 1;
    console.log(`${mark}  ${item.name.padEnd(46, ' ')} ${item.ok ? '' : `← ${item.detail}`}`);
  }

  console.log('  ─────────────────────────────────────────────────────────');
  if (failed === 0) {
    console.log(`  全部通过（${results.length} 项）`);
    console.log('');
    process.exit(0);
  }
  console.log(`  ${failed} / ${results.length} 项未通过`);
  console.log('');
  process.exit(1);
}

main().catch((error) => {
  console.error('[serve] 启动失败：', error);
  process.exit(1);
});
