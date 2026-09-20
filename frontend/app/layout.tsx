import type { Metadata } from 'next';
import './globals.css';

/**
 * AutoGrader · 根布局
 * 纯静态渲染，不引入任何运行时数据请求。
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
