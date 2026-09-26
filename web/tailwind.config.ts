import type { Config } from 'tailwindcss';

/**
 * AutoGrader · Tailwind 配置
 * ---------------------------------------------------------------------------
 * 颜色**只以 CSS 变量承载**（`hsl(var(--x))` 间接层），不在本文件里写具体色值：
 *   - 换肤的唯一落点是 app/globals.css 的 :root；
 *   - 保留其「三元组」形式（而非 hex），是为了让 Tailwind 的透明度修饰
 *     （bg-secondary/40、text-primary/50 等）继续可用。
 *
 * ⚠️ 已知例外：v0.1 遗留的 6 个文件里有约 94 处**硬编码调色板**
 *   （amber / emerald / rose / sky / slate）。它们不受 CSS 变量影响，
 *   且与「单强调色 + 灰阶」的色彩策略冲突，已在本版逐个改写为
 *   token 类 + 灰度阶 + 符号，不再出现在代码中。
 *
 * 设计 token 来源：参考项目 LBEILC/RhineLabUI 的 DESIGN.md
 *   （暖灰白底 / 近黑正文 / 暖灰辅助文字 / 灰色细线 / 暖棕强调）。
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1200px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        /** 强调分隔线：比 border 更深一档，用于「细线 + 刻度」的排版骨架 */
        rule: 'hsl(var(--rule))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 1px)',
        sm: 'calc(var(--radius) - 2px)',
      },
      fontFamily: {
        // MiSans 四档（300/400/600/700）由 public/fonts/misans.css 提供；
        // 后备栈覆盖未安装 MiSans 且分片未覆盖的字符。
        sans: [
          'MiSans',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        // 正文基准 15px（参考项目的正文规格）
        base: ['15px', { lineHeight: '1.65' }],
      },
      transitionTimingFunction: {
        /** 微过渡统一缓动：起手快、收尾稳 */
        micro: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
      },
      transitionDuration: {
        micro: '180ms',
      },
    },
  },
  plugins: [],
};

export default config;
