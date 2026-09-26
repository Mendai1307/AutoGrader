/**
 * AutoGrader · 部署子路径（basePath）
 * ============================================================================
 * 为什么需要这个模块
 * ---------------------------------------------------------------------------
 * 有两类资源地址，Next.js 只会替**它自己产出**的资源加上 basePath：
 *   1. `/_next/...` 下的 JS/CSS —— Next 自动处理，无需关心；
 *   2. `public/` 下的静态文件（字体、结果 JSON、样例报告……）——
 *      Next **不会**改写它们的引用，得由我们自己拼前缀。
 *
 * 本模块就是第 2 类地址的唯一来源。归一化逻辑与 `next.config.mjs`
 * 的 `resolveBasePath()` 保持一致（两边必须同口径，否则本地与 CI 会分叉）。
 *
 * 读写约定：只在构建期（服务端组件 / 脚本）读取 `process.env`。
 * 由于 `NEXT_PUBLIC_` 前缀的变量会被 Next 在构建时内联，客户端组件引用同一
 * 常量也能拿到正确值。
 */

/** 归一化：undefined / ''/ '/'/ 空白 → ''；'X' → '/X'；'/X/' → '/X' */
export function normalizeBasePath(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  let value = String(raw).trim();
  if (value === '' || value === '/') return '';
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+$/, '');
}

/**
 * 本次构建生效的子路径前缀（默认空 = 部署在根路径）。
 * CI 部署 GitHub Pages 项目站点时，由 workflow 显式传入
 * `NEXT_PUBLIC_BASE_PATH=/<仓库名>`。
 */
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/** 把 `public/` 下的静态路径拼成可用的 URL（如 staticUrl('/fonts/misans.css')） */
export function staticUrl(publicPath: string): string {
  const normalized = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  return `${BASE_PATH}${normalized}`;
}
