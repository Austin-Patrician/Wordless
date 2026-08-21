import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'

const zhSidebar = [
  {
    label: '入门指南',
    translations: { en: 'Get started' },
    items: [
      { slug: 'docs', label: '简介', translations: { en: 'Overview' } },
      { slug: 'docs/installation', label: '快速开始', translations: { en: 'Quick start' } },
      { slug: 'docs/models', label: '配置模型', translations: { en: 'Configure a model' } },
      { slug: 'docs/getting-started', label: '完成首次任务', translations: { en: 'Your first task' } },
      { slug: 'docs/sessions', label: '对话管理', translations: { en: 'Manage conversations' } },
      { slug: 'docs/changelog', label: '更新日志', translations: { en: 'Changelog' } },
    ],
  },
  {
    label: '从入门到精通',
    translations: { en: 'From basics to mastery' },
    items: [
      { slug: 'docs/core-concepts', label: '核心概念', translations: { en: 'Core concepts' } },
      { slug: 'docs/tasks', label: '任务管理', translations: { en: 'Manage tasks' } },
      { slug: 'docs/image-generation', label: '图片生成', translations: { en: 'Image generation' } },
      {
        label: '工作流',
        translations: { en: 'Workflows' },
        items: [
          'docs/workflows/general',
          'docs/workflows/presentation',
          'docs/workflows/spreadsheet',
          'docs/workflows/data-analysis',
          'docs/workflows/code',
        ],
      },
      { slug: 'docs/automation', label: '自动化', translations: { en: 'Automation' } },
      { slug: 'docs/digital-employees', label: '数字员工', translations: { en: 'Digital employees' } },
      { slug: 'docs/skills-mcp', label: '技能与 MCP', translations: { en: 'Skills & MCP' } },
      { slug: 'docs/security-privacy', label: '安全与隐私', translations: { en: 'Security & privacy' } },
      { slug: 'docs/settings-updates', label: '设置', translations: { en: 'Settings' } },
      {
        label: '技术架构',
        translations: { en: 'Architecture' },
        collapsed: true,
        items: ['docs/architecture', 'docs/pi-agent'],
      },
      { slug: 'docs/troubleshooting', label: '故障排查', translations: { en: 'Troubleshooting' } },
      { slug: 'docs/business', label: '商务合作', translations: { en: 'Commercial' } },
    ],
  },
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
