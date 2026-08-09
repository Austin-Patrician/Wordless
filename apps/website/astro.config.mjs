import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'

const zhSidebar = [
  {
    label: '开始使用',
    translations: { en: 'Start here' },
    items: ['docs', 'docs/installation', 'docs/getting-started', 'docs/models'],
  },
  { label: '核心概念', translations: { en: 'Core concepts' }, items: ['docs/core-concepts'] },
  { label: '技术架构', translations: { en: 'Architecture' }, items: ['docs/architecture', 'docs/pi-agent'] },
  {
    label: 'Agent 工作流',
    translations: { en: 'Agent workflows' },
    items: [
      'docs/workflows/general',
      'docs/workflows/presentation',
      'docs/workflows/spreadsheet',
      'docs/workflows/data-analysis',
      'docs/workflows/code',
    ],
  },
  { label: '扩展与连接', translations: { en: 'Extensions' }, items: ['docs/skills-mcp'] },
  { label: '安全与隐私', translations: { en: 'Security & privacy' }, items: ['docs/security-privacy'] },
  { label: '设置与更新', translations: { en: 'Settings & updates' }, items: ['docs/settings-updates'] },
  { label: '故障排查', translations: { en: 'Troubleshooting' }, items: ['docs/troubleshooting'] },
  { label: '商务合作', translations: { en: 'Commercial' }, items: ['docs/business'] },
]

export default defineConfig({
  output: 'static',
  site: 'https://wordless.20250230.xyz',
  integrations: [
    react(),
    starlight({
      title: { 'zh-CN': 'Wordless 文档', en: 'Wordless Docs' },
      description: 'Wordless desktop agent user manual and workflow guides.',
      favicon: '/favicon.png',
      customCss: ['./src/styles/docs.css'],
      components: {
        SiteTitle: './src/components/docs/SiteTitle.astro',
        Footer: './src/components/docs/DocsFooter.astro',
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Austin-Patrician/Wordless' }],
      lastUpdated: true,
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
        en: { label: 'English', lang: 'en' },
      },
      defaultLocale: 'root',
      sidebar: zhSidebar,
    }),
  ],
})
