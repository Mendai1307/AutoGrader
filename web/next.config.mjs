/**
 * AutoGrader · Next.js 配置
 * ---------------------------------------------------------------------------
 * 架构前提（不可违背）：
 *   - 纯静态：output: 'export'，产物为 out/ 下的静态文件；
 *   - 运行时零 AI 调用、零后端、零数据库，只做确定性渲染；
 *   - 部署目标为 GitHub Pages 项目子路径，但 **本地默认按根路径构建**。
 *
 * basePath 覆盖规则（由环境变量 NEXT_PUBLIC_BASE_PATH 控制）
 * ---------------------------------------------------------------------------
 *   | NEXT_PUBLIC_BASE_PATH | 解析结果 | 适用场景                             |
 *   |-----------------------|----------|--------------------------------------|
 *   | 未设置                 | ''       | 本地开发 / 本地预览 / 根路径托管（默认）|
 *   | '/AutoGrader_rebirth'  | 该值     | GitHub Pages 项目子路径（CI 里显式传入）|
 *   | '/' 或 '  '            | ''       | 显式表示根路径                        |
 *
 * ⚠️ 与 v0.1 的关键差异：v0.1 把默认值写成 '/AutoGrader'，导致
 *   「本地构建 → 本地起静态服务 → 首页白屏无样式」成为默认路径（产物里的资源地址
 *   被硬编码成 /AutoGrader/_next/...，而本地服务挂在根路径下）。
 *   本版把默认值改为**空串**：本地所见即所得，子路径只在 CI 显式传入时生效。
 *
 * ⚠️ 必须区分「未设置」与「显式置空」：写成 `process.env.X || '/X'` 时，
 *   空串在 JS 中为 falsy，会把「显式置空」静默回退成默认子路径。
 */

/** 归一化 basePath：undefined / ''/ '/'/空白 → ''；'X' → '/X'；'/X/' → '/X' */
function resolveBasePath(raw) {
  if (raw === undefined || raw === null) return '';
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
