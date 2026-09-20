/**
 * AutoGrader · Next.js 配置
 * ---------------------------------------------------------------------------
 * 架构前提（不可违背）：
 *   - 纯静态：output: 'export'，产物为 out/ 下的静态文件；
 *   - 运行时零 AI 调用、零后端、零数据库，只做确定性渲染；
 *   - 部署于 GitHub Pages 项目子路径 https://<user>.github.io/AutoGrader/，
 *     因此默认设置 basePath / assetPrefix = /AutoGrader。
 *
 * basePath 覆盖规则（由环境变量 NEXT_PUBLIC_BASE_PATH 控制）：
 *   | NEXT_PUBLIC_BASE_PATH | 解析结果      | 适用场景                          |
 *   |-----------------------|---------------|-----------------------------------|
 *   | 未设置                 | /AutoGrader   | GitHub Pages 项目子路径（默认）    |
 *   | 空串 ``               | ''（无前缀）   | 网站根路径部署 / 本地根路径预览     |
 *   | /自定义               | /自定义        | 其他子路径部署                     |
 *
 * ⚠️ 这里必须区分「未设置」与「显式置空」：
 *    早期实现写作 `process.env.X || '/AutoGrader'`，而空串在 JS 中是 falsy，
 *    导致 `NEXT_PUBLIC_BASE_PATH= npm run dev` 被静默回退成 /AutoGrader —— 即
 *    README 承诺的「置空 basePath 按根路径预览」实际从未生效，根路径访问一律 404。
 *    正确写法是判断 `undefined`，并对结果做归一化（去尾斜杠、非空则补前导斜杠）。
 */

/** 子路径默认值：与 GitHub 仓库名 / Pages 项目站点路径一致 */
const DEFAULT_BASE_PATH = '/AutoGrader';

/**
 * 归一化 basePath：
 *   - undefined → DEFAULT_BASE_PATH（未设置，走默认子路径）
 *   - '' / '/' / '  ' → ''（显式置空，表示部署在根路径）
 *   - 'AutoGrader' → '/AutoGrader'（补前导斜杠）
 *   - '/AutoGrader/' → '/AutoGrader'（去尾斜杠）
 */
function resolveBasePath(raw) {
  if (raw === undefined) return DEFAULT_BASE_PATH;
  let value = String(raw).trim();
  if (value === '' || value === '/') return '';
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+$/, '');
}

const basePath = resolveBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：构建产出 out/，不依赖 Node 服务端运行时
  output: 'export',

  // 静态导出下 Next.js 图片优化服务不可用，必须关闭
  images: {
    unoptimized: true,
  },

  // 每个路由输出为 <route>/index.html，利于静态托管直接命中
  trailingSlash: true,

  // 构建期不因 ESLint 告警中断（lint 由 npm run lint 单独把关）
  eslint: {
    ignoreDuringBuilds: true,
  },

  // 仅在存在子路径时输出 basePath / assetPrefix；根路径部署时完全省略，
  // 避免产出 "<link href="//_next/...">" 这类双斜杠资源地址。
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
