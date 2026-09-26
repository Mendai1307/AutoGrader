import type { Metadata, Viewport } from 'next';

import { BootCurtain } from '@/components/boot-curtain';
import { BASE_PATH } from '@/lib/base-path';

import './globals.css';

/**
 * AutoGrader · 根布局
 * ===========================================================================
 * 纯静态渲染，不引入任何运行时数据请求。
 *
 * 两件容易踩的事都在这里处理掉：
 *
 *  ① **字体怎么进来**：MiSans 是自托管的裁剪子集（225 个分片 / 5.3 MB，
 *     见 scripts/sync_fonts.py 与 public/fonts/）。它必须用 `<link>` 引，
 *     不能写进 globals.css —— 因为 CSS 里的 `url()` 走的是 public 静态目录，
 *     而 Next 只会为它自己产出的 `/_next/...` 资源加 basePath。
 *     这里用 staticUrl() 拼前缀，本地（无前缀）与 GitHub Pages 子路径都能命中。
 *
 *  ② **白场入场**：参考设计的开场是一段白场。本版收敛为一层可跳过的
 *     ≤1.2s 白色遮罩（BootstrapCurtain），首帧即可点击跳过、不阻塞任何内容。
 */
export const metadata: Metadata = {
  title: {
    default: 'AutoGrader 智能评阅平台',
    template: '%s · AutoGrader',
  },
  description: '面向高校计算机专业实验报告的 AI 智能评阅助手',
  applicationName: 'AutoGrader',
  keywords: ['AutoGrader', '实验报告', '智能评阅', '计算机专业', 'AI 评阅'],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#F3F0EB',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 自托管 MiSans 四档（300/400/600/700）；未经此 link 则全体回退到系统字体栈 */}
        <link rel="stylesheet" href={`${BASE_PATH}/fonts/misans.css`} />
        {/* 字体分片按需加载，提前建立连接可省一次往返 */}
        <link rel="preload" as="style" href={`${BASE_PATH}/fonts/misans.css`} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <BootCurtain />
        {children}
      </body>
    </html>
  );
}
