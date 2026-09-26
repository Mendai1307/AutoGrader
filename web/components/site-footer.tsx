/**
 * AutoGrader · 页脚（Server Component）
 * 固定重申 AI 能力来源与静态架构前提。
 */

import { AI_SOURCE_STATEMENT, SITE_NAME, SITE_POSITIONING } from '@/lib/constants';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-secondary/40">
      <div className="container flex flex-col gap-2 py-8 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">{AI_SOURCE_STATEMENT}</p>
        <p>
          {SITE_NAME} · {SITE_POSITIONING}
        </p>
        <p>
          Web 端为 Next.js 静态导出产物（output: &apos;export&apos;）：运行时零 AI 调用、零后端、零数据库，
          全部页面由构建期读取仓库内静态 JSON 资产后确定性渲染。
        </p>
      </div>
    </footer>
  );
}
