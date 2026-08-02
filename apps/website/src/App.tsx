import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUpRight, Check, GitBranch, Globe2, Menu, MoveDown, Play, ShieldCheck, X } from 'lucide-react'
import { ReleaseDownload } from './components/ReleaseDownload'
import { copy, type Locale } from './content/site-content'
const SceneBackdrop = lazy(() => import('./scene/SceneBackdrop'))

const githubUrl = 'https://github.com/Austin-Patrician/Wordless'
const demoVideo = import.meta.env.VITE_WORKSPACE_VIDEO as string | undefined

function useLocale() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = window.localStorage.getItem('wordless-website-locale')
    return saved === 'zh' || saved === 'en' ? saved : 'en'
  })

  useEffect(() => {
    window.localStorage.setItem('wordless-website-locale', locale)
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  return [locale, setLocale] as const
}

function App() {
  const [locale, setLocale] = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const t = copy[locale]
  const activeVideo = demoVideo && !videoFailed ? demoVideo : undefined
  const signals = useMemo(() => t.capabilities.items.map((item) => item.signal), [t.capabilities.items])

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Wordless home">
          <span className="brand-mark"><img src="/images/wordless.webp" alt="" /></span>
          <span>Wordless</span>
        </a>

        <nav className={menuOpen ? 'primary-nav primary-nav--open' : 'primary-nav'} aria-label="Primary navigation">
          {t.navigation.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
        </nav>

        <div className="header-utilities">
          <button className="utility-button" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')} aria-label="Change language">
            <Globe2 size={15} strokeWidth={1.6} />
            <span>{t.utility.language}</span>
          </button>
          <a className="utility-button utility-button--github" href={githubUrl} target="_blank" rel="noreferrer">
            <GitBranch size={16} strokeWidth={1.6} />
            <span>{t.utility.github}</span>
          </a>
          <button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="Toggle menu">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <Suspense fallback={null}><SceneBackdrop /></Suspense>
        <div className="hero-raster" aria-hidden="true" />
        <div className="hero-content page-grid">
          <div className="hero-copy reveal">
            <p className="section-index">{t.hero.index}</p>
            <h1>{t.hero.heading}</h1>
            <p className="hero-description">{t.hero.body}</p>
            <div className="hero-actions">
              <ReleaseDownload compact releaseCopy={t.release} downloadCopy={t.download} />
              <a className="text-link" href="#system">
                <span>{t.hero.secondary}</span>
                <ArrowDown size={16} strokeWidth={1.7} />
              </a>
            </div>
            <p className="availability"><span />{t.hero.availability}</p>
          </div>

          <div className="hero-product reveal reveal--late">
            <div className="product-orbit product-orbit--one" />
            <div className="product-orbit product-orbit--two" />
            <div className="product-stage">
              <div className="product-stage__label"><span>WORDLESS / CORE</span><span>LOCAL 01</span></div>
              <img src="/images/wordless-workspace.webp" alt="Wordless agent workspace" />
              <div className="product-stage__scan" />
            </div>
            <div className="product-coordinates">
              <span>SYS / 01</span>
              <span>CONTEXT / ACTIVE</span>
              <span>37.7749 N</span>
            </div>
          </div>
        </div>
        <a className="scroll-signal" href="#system"><MoveDown size={18} /><span>SCROLL TO EXPLORE</span></a>
      </section>

      <section className="system-section section-shell" id="system">
        <div className="section-heading page-grid">
          <div>
            <p className="section-index">{t.architecture.index}</p>
            <p className="eyebrow">{t.architecture.eyebrow}</p>
          </div>
          <h2>{t.architecture.heading}</h2>
        </div>
        <div className="architecture-grid page-grid">
          <div className="architecture-visual">
            <div className="architecture-terminal">
              <div className="terminal-bar"><span /><span /><span /><b>WORDLESS / LOCAL SIGNAL</b></div>
              <div className="terminal-grid">
                <div className="terminal-core"><img src="/images/wordless.webp" alt="" /></div>
                <span className="terminal-line terminal-line--one" />
                <span className="terminal-line terminal-line--two" />
                <span className="terminal-line terminal-line--three" />
                <span className="terminal-node terminal-node--one">FILES</span>
                <span className="terminal-node terminal-node--two">MODEL</span>
                <span className="terminal-node terminal-node--three">CONTROL</span>
              </div>
            </div>
          </div>
          <div className="architecture-points">
            {t.architecture.points.map((point, index) => (
              <article className="architecture-point" key={point.title}>
                <span>0{index + 1}</span>
                <div><h3>{point.title}</h3><p>{point.description}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="modes-section section-shell" id="modes">
        <div className="section-heading page-grid">
          <div>
            <p className="section-index">{t.capabilities.index}</p>
            <p className="eyebrow">{t.capabilities.eyebrow}</p>
          </div>
          <div><h2>{t.capabilities.heading}</h2><p className="section-description">{t.capabilities.body}</p></div>
        </div>
        <div className="mode-signal-strip" aria-label="Available work modes">
          {[...signals, ...signals].map((signal, index) => <span key={`${signal}-${index}`}>{signal}<i /></span>)}
        </div>
        <div className="mode-grid page-grid">
          {t.capabilities.items.map((item) => (
            <article className="mode-item" key={item.title}>
              <div className="mode-topline"><span>{item.number}</span><span>{item.signal}</span></div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <ArrowUpRight className="mode-arrow" size={18} strokeWidth={1.5} />
            </article>
          ))}
        </div>
      </section>

      <section className="control-section section-shell" id="control">
        <div className="control-grid page-grid">
          <div className="control-copy">
            <p className="section-index">{t.approval.index}</p>
            <p className="eyebrow">{t.approval.eyebrow}</p>
            <h2>{t.approval.heading}</h2>
            <p className="section-description">{t.approval.body}</p>
          </div>
          <div className="approval-console">
            <div className="console-title"><ShieldCheck size={17} /><span>TOOL APPROVAL</span><em>LIVE</em></div>
            <div className="approval-track">
              {t.approval.steps.map((step, index) => (
                <article className={index === 2 ? 'approval-step approval-step--active' : 'approval-step'} key={step.name}>
                  <span className="approval-count">0{index + 1}</span>
                  <div><h3>{step.name}</h3><p>{step.description}</p></div>
                  {index < t.approval.steps.length - 1 && <i className="approval-path" />}
                </article>
              ))}
            </div>
            <div className="console-result"><Check size={16} /><span>execution state visible in thread</span></div>
          </div>
        </div>
      </section>

      <section className="showcase-section section-shell">
        <div className="section-heading page-grid">
          <div>
            <p className="section-index">{t.showcase.index}</p>
            <p className="eyebrow">{t.showcase.eyebrow}</p>
          </div>
          <div><h2>{t.showcase.heading}</h2><p className="section-description">{t.showcase.body}</p></div>
        </div>
        <div className="showcase-frame page-grid">
          <div className="showcase-screen">
            {activeVideo ? (
              <video autoPlay muted loop playsInline controls={false} onError={() => setVideoFailed(true)}>
                <source src={activeVideo} type="video/webm" />
              </video>
            ) : <img src="/images/wordless-workspace.webp" alt="Wordless workspace preview" />}
            <div className="screen-scanlines" />
            <div className="screen-label"><Play size={14} fill="currentColor" /><span>{t.showcase.videoLabel}</span><b>00:46</b></div>
          </div>
          <p className="video-note">{activeVideo ? '' : t.showcase.videoHint}</p>
        </div>
      </section>

      <section className="download-section" id="download">
        <div className="download-panel page-grid">
          <div>
            <p className="section-index">{t.download.index}</p>
            <p className="eyebrow">{t.download.eyebrow}</p>
            <h2>{t.download.heading}</h2>
          </div>
          <div className="download-panel__right">
            <p>{t.download.body}</p>
            <ReleaseDownload releaseCopy={t.release} downloadCopy={t.download} />
          </div>
        </div>
      </section>

      <footer className="site-footer page-grid">
        <a className="brand" href="#top"><span className="brand-mark"><img src="/images/wordless.webp" alt="" /></span><span>Wordless</span></a>
        <p>{t.footer}</p>
        <a className="footer-github" href={githubUrl} target="_blank" rel="noreferrer"><GitBranch size={16} />GitHub <ArrowUpRight size={15} /></a>
      </footer>
    </main>
  )
}

export default App
