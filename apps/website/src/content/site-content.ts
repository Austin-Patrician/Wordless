export type Locale = 'en' | 'zh'

type Copy = {
  navigation: { label: string; href: string }[]
  utility: { language: string; github: string }
  hero: {
    index: string
    heading: string
    body: string
    primary: string
    secondary: string
    availability: string
    platformFallback: string
  }
  release: {
    label: string
    loading: string
    fallback: string
    releaseNotes: string
  }
  capabilities: {
    index: string
    eyebrow: string
    heading: string
    body: string
    items: { number: string; title: string; description: string; signal: string }[]
  }
  architecture: {
    index: string
    eyebrow: string
    heading: string
    points: { title: string; description: string }[]
  }
  approval: {
    index: string
    eyebrow: string
    heading: string
    body: string
    steps: { name: string; description: string }[]
  }
  showcase: {
    index: string
    eyebrow: string
    heading: string
    body: string
    videoLabel: string
    videoHint: string
  }
  download: {
    index: string
    eyebrow: string
    heading: string
    body: string
    primary: string
    secondary: string
    unsupported: string
  }
  contact: {
    index: string
    eyebrow: string
    heading: string
    body: string
    action: string
  }
  footer: string
}

export const copy: Record<Locale, Copy> = {
  en: {
    navigation: [
      { label: 'Work modes', href: '#modes' },
      { label: 'System', href: '#system' },
      { label: 'Control', href: '#control' },
      { label: 'Download', href: '#download' },
      { label: 'Docs', href: '/en/docs/' },
    ],
    utility: { language: '中文', github: 'GitHub' },
    hero: {
      index: '01 / Agent workspace',
      heading: 'Work without losing the thread.',
      body: 'Wordless puts an adaptable agent, your tools, and the context of your workspace in one calm operating surface.',
      primary: 'Download Wordless',
      secondary: 'Explore the system',
      availability: 'Available for macOS and Windows',
      platformFallback: 'View releases',
    },
    release: {
      label: 'Latest build',
      loading: 'Checking latest release',
      fallback: 'GitHub releases',
      releaseNotes: 'Release notes',
    },
    capabilities: {
      index: '02 / Work modes',
      eyebrow: 'One agent. Multiple disciplines.',
      heading: 'Built to stay useful after the first prompt.',
      body: 'Move between focused work modes without leaving the workspace where your files and conversation already live.',
      items: [
        { number: '01', title: 'Everyday work', description: 'Research, drafts, planning, and practical tasks in a single thread.', signal: 'General' },
        { number: '02', title: 'Coding', description: 'Use workspace context to inspect, change, and explain code with intent.', signal: 'Code' },
        { number: '03', title: 'Presentation', description: 'Turn an outline into a structured slide workflow with visible tool activity.', signal: 'Decks' },
        { number: '04', title: 'Spreadsheet', description: 'Analyze structured data and build spreadsheet-ready results without losing context.', signal: 'Sheets' },
        { number: '05', title: 'Browser', description: 'Bring web research into the same conversation and approval flow.', signal: 'Web' },
        { number: '06', title: 'Media', description: 'Coordinate image and video work beside the rest of the project.', signal: 'Media' },
      ],
    },
    architecture: {
      index: '03 / Local first',
      eyebrow: 'Your workspace remains the center of gravity.',
      heading: 'Context belongs close to the work.',
      points: [
        { title: 'Workspace-aware', description: 'Reference the files and folders that matter directly from the conversation.' },
        { title: 'Model flexible', description: 'Use the model configuration that fits your work instead of a fixed provider surface.' },
        { title: 'Optional sync', description: 'Google cloud sync stays opt-in, so local work never depends on a network round trip.' },
        { title: 'Cross-platform', description: 'A consistent desktop workspace for macOS and Windows.' },
      ],
    },
    approval: {
      index: '04 / Controlled execution',
      eyebrow: 'Visible actions, deliberate control.',
      heading: 'The agent moves when you are ready.',
      body: 'Tool calls become legible checkpoints, with execution feedback held in the conversation instead of hidden behind it.',
      steps: [
        { name: 'Request', description: 'The task is understood in workspace context.' },
        { name: 'Review', description: 'The planned tool action is surfaced clearly.' },
        { name: 'Approve', description: 'Choose manual approval or session auto-approval.' },
        { name: 'Result', description: 'See the success or failure state where work happens.' },
      ],
    },
    showcase: {
      index: '05 / Workspace surface',
      eyebrow: 'See the operation, not just the answer.',
      heading: 'A composed place for ongoing work.',
      body: 'Product recordings can live here as focused proof points: a thread, a tool result, a document workflow, or a generated presentation.',
      videoLabel: 'Workspace walkthrough',
      videoHint: 'Add /public/media/workspace-tour.webm to replace this product still.',
    },
    download: {
      index: '06 / Get started',
      eyebrow: 'Run your workspace locally.',
      heading: 'Bring Wordless to your desktop.',
      body: 'Choose your platform. New releases remain optional and visible on GitHub.',
      primary: 'Download for',
      secondary: 'View all releases',
      unsupported: 'Desktop builds are currently available for macOS and Windows.',
    },
    contact: {
      index: '07 / Work together',
      eyebrow: 'Commercial collaboration & custom delivery.',
      heading: 'Put an agent workflow to work for your team.',
      body: 'Talk to us about commercial partnerships, bespoke agent workflows, or deployment and integration for your team.',
      action: 'Contact us',
    },
    footer: 'Wordless. An agent workspace for work that moves.',
  },
  zh: {
    navigation: [
      { label: '工作模式', href: '#modes' },
      { label: '系统', href: '#system' },
      { label: '控制流', href: '#control' },
      { label: '下载', href: '#download' },
      { label: '文档', href: '/docs/' },
    ],
    utility: { language: 'English', github: 'GitHub' },
    hero: {
      index: '01 / Agent 工作空间',
      heading: '让工作始终保持上下文',
      body: 'Wordless 将可适配的 Agent、工具能力与工作区上下文，组织进一个安静而连贯的操作界面',
      primary: '下载 Wordless',
      secondary: '探索系统',
      availability: '现已支持 macOS 与 Windows',
      platformFallback: '查看版本发布',
    },
    release: {
      label: '最新版本',
      loading: '正在获取最新发布',
      fallback: 'GitHub Releases',
      releaseNotes: '查看更新说明',
    },
    capabilities: {
      index: '02 / 工作模式',
      eyebrow: '一个 Agent，多种工作方式',
      heading: '不止回答第一句，而是持续推进工作',
      body: '在已经拥有文件与会话上下文的同一个工作空间中，切换不同的专注工作模式',
      items: [
        { number: '01', title: '日常办公', description: '研究、草稿、规划与日常任务，都在一个会话中完成。', signal: 'General' },
        { number: '02', title: '代码开发', description: '结合工作区上下文，理解、修改和解释代码。', signal: 'Code' },
        { number: '03', title: '演示文稿', description: '将提纲转化为有明确工具状态的幻灯片工作流。', signal: 'Decks' },
        { number: '04', title: '电子表格', description: '围绕结构化数据分析，并生成适合电子表格继续处理的结果。', signal: 'Sheets' },
        { number: '05', title: '浏览器', description: '将网页研究融入同一会话和审批流程。', signal: 'Web' },
        { number: '06', title: '媒体', description: '将图像和视频工作与项目上下文放在一起。', signal: 'Media' },
      ],
    },
    architecture: {
      index: '03 / 本地优先',
      eyebrow: '工作区始终是你的核心',
      heading: '上下文应当贴近工作发生的地方',
      points: [
        { title: '感知工作区', description: '从会话中直接引用真正相关的文件与文件夹' },
        { title: '模型可配置', description: '按工作需要选择模型配置，而不是被固定的提供商界面限制' },
        { title: '同步可选', description: 'Google 云同步为主动开启的能力，本地工作不依赖网络往返' },
        { title: '跨平台桌面端', description: 'macOS 与 Windows 保持一致的工作空间体验' },
      ],
    },
    approval: {
      index: '04 / 受控执行',
      eyebrow: '行动可见，控制明确',
      heading: '当你准备好时，Agent 才会执行',
      body: '工具调用成为会话中的清晰检查点，执行反馈不会被隐藏在工作过程之外',
      steps: [
        { name: '请求', description: '结合工作区上下文理解任务' },
        { name: '审阅', description: '清晰展示计划执行的工具操作' },
        { name: '批准', description: '选择手动批准或本次会话自动批准。' },
        { name: '结果', description: '在工作发生的位置看到成功或失败状态' },
      ],
    },
    showcase: {
      index: '05 / 工作空间界面',
      eyebrow: '看到执行过程，而不只是答案',
      heading: '为持续工作而组织的界面',
      body: '这里将放入产品录屏，用于展示会话、工具结果、文档工作流或演示文稿生成过程',
      videoLabel: '工作空间演示',
      videoHint: '将录屏放入 /public/media/workspace-tour.webm 后会自动替换当前静态画面',
    },
    download: {
      index: '06 / 开始使用',
      eyebrow: '在本地运行你的工作空间',
      heading: '将 Wordless 带到桌面端',
      body: '按你的平台下载。新的版本保持可选，并可在 GitHub 上查看',
      primary: '下载',
      secondary: '查看全部版本',
      unsupported: '桌面版本目前支持 macOS 与 Windows',
    },
    contact: {
      index: '07 / 合作联系',
      eyebrow: '商业合作与定制需求',
      heading: '把 Agent 工作流带进你的业务。',
      body: '无论是商业合作、定制 Agent 工作流，还是面向团队的部署与集成，都可以直接联系我们。',
      action: '联系我们',
    },
    footer: 'Wordless，一个让工作持续推进的 Agent 工作空间',
  },
}
