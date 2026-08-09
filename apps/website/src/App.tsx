import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUpRight, Check, GitBranch, Globe2, Mail, Menu, MoveDown, Play, ShieldCheck, X } from 'lucide-react'
import { ReleaseDownload } from './components/ReleaseDownload'
import { WebsiteLoader } from './components/WebsiteLoader'
import { copy, type Locale } from './content/site-content'
const SceneBackdrop = lazy(() => import('./scene/SceneBackdrop'))
const SectionModel = lazy(() => import('./scene/SectionModel'))

const githubUrl = 'https://github.com/Austin-Patrician/Wordless'
const contactEmail = '15014915381z@gmail.com'
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
  const [sceneProgress, setSceneProgress] = useState(1)
  const [scenePhase, setScenePhase] = useState('INITIALIZING SPACE')
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneFailed, setSceneFailed] = useState(false)
  const t = copy[locale]
  const legal = locale === 'zh'
    ? { privacy: '隐私政策', terms: '服务条款', privacyHref: '/zh/privacy/', termsHref: '/zh/terms/' }
    : { privacy: 'Privacy', terms: 'Terms', privacyHref: '/privacy/', termsHref: '/terms/' }
  const activeVideo = demoVideo && !videoFailed ? demoVideo : undefined
  const signals = useMemo(() => t.capabilities.items.map((item) => item.signal), [t.capabilities.items])
  const handleSceneProgress = useCallback((progress: number, phase: string) => {
    setSceneProgress((current) => Math.max(current, progress))
    setScenePhase(phase)
  }, [])
  const handleSceneReady = useCallback(() => setSceneReady(true), [])
  const handleSceneError = useCallback(() => setSceneFailed(true), [])

  return (
    <main>
      <WebsiteLoader
        progress={sceneProgress}
        phase={scenePhase}
        ready={sceneReady}
        failed={sceneFailed}
        onContinue={() => setSceneReady(true)}
      />
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
        <div className={`hero-static-fallback${sceneReady && !sceneFailed ? ' hero-static-fallback--loaded' : ''}`} aria-hidden="true" />
        <div className="hero-raster" aria-hidden="true" />
        <div className="hero-content page-grid">
          <div className="hero-copy reveal">
            <p className="section-index">{t.hero.index}</p>
            <h1>{t.hero.heading}</h1>
            <p className="hero-description">{t.hero.body}</p>
            <div className="hero-actions">
              <ReleaseDownload compact releaseCopy={t.release} downloadCopy={t.download} />
              <a className="text-link" href="#modes">
                <span>{t.hero.secondary}</span>
                <ArrowDown size={16} strokeWidth={1.7} />
              </a>
            </div>
            <p className="availability"><span />{t.hero.availability}</p>
          </div>

          <div className="hero-product reveal reveal--late">
            <div className="hero-scene">
              <Suspense fallback={null}>
                <SceneBackdrop onProgress={handleSceneProgress} onReady={handleSceneReady} onError={handleSceneError} />
              </Suspense>
            </div>
            <div className="hero-model-caption"><span>WORDLESS / CORE</span><b>LIVE OBJECT</b></div>
            <div className="hero-model-axis" aria-hidden="true"><i /><i /><i /></div>
            <div className="product-coordinates">
              <span>OBJECT / 01</span>
              <span>POINTER / LINKED</span>
              <span>CONTEXT / ACTIVE</span>
            </div>
          </div>
        </div>
        <a className="scroll-signal" href="#modes"><MoveDown size={18} /><span>SCROLL TO EXPLORE</span></a>
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
          <div className="mode-signal-strip__track">
            {Array.from({ length: 4 }, (_, cycle) => signals.map((signal, index) => <span key={`${cycle}-${signal}-${index}`}>{signal}<i /></span>))}
          </div>
        </div>
        <div className="mode-artifact page-grid">
          <Suspense fallback={<div className="model-placeholder" />}>
            <SectionModel src="/glb/optimized/geometric-sculpture.glb" label="CONTEXT LATTICE / MULTI-FORM CORE" variant="lattice" />
          </Suspense>
          <p>ONE CONTEXT<br /><span>MULTIPLE FORMS</span></p>
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
            <Suspense fallback={<div className="model-placeholder" />}>
              <SectionModel src="/glb/optimized/context-ribbon.glb" label="CONTEXT RIBBON / LOCAL SIGNAL" variant="wide" />
            </Suspense>
            <span className="architecture-tag architecture-tag--one">FILES</span>
            <span className="architecture-tag architecture-tag--two">MODEL</span>
            <span className="architecture-tag architecture-tag--three">CONTROL</span>
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

      <section className="control-section section-shell" id="control">
        <div className="control-grid page-grid">
          <div className="control-copy">
            <p className="section-index">{t.approval.index}</p>
            <p className="eyebrow">{t.approval.eyebrow}</p>
            <h2>{t.approval.heading}</h2>
            <p className="section-description">{t.approval.body}</p>
          </div>
          <div className="control-visual">
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

      <section className="contact-section" aria-labelledby="contact-heading">
        <div className="contact-panel page-grid">
          <div>
            <p className="section-index">{t.contact.index}</p>
            <p className="eyebrow">{t.contact.eyebrow}</p>
          </div>
          <div className="contact-panel__content">
            <h2 id="contact-heading">{t.contact.heading}</h2>
            <p>{t.contact.body}</p>
          </div>
          <a className="contact-email" href={`mailto:${contactEmail}`} aria-label={`${t.contact.action}: ${contactEmail}`}>
            <span className="contact-email__label"><Mail size={16} strokeWidth={1.6} />{t.contact.action}</span>
            <span className="contact-email__address">{contactEmail}</span>
            <ArrowUpRight size={19} strokeWidth={1.6} aria-hidden="true" />
          </a>
        </div>
      </section>

      <footer className="site-footer page-grid">
        <a className="brand" href="#top"><span className="brand-mark"><img src="/images/wordless.webp" alt="" /></span><span>Wordless</span></a>
        <div className="footer-center">
          <p>{t.footer}</p>
          <nav className="footer-legal" aria-label={locale === 'zh' ? '法律链接' : 'Legal links'}>
            <a href={legal.privacyHref}>{legal.privacy}</a>
            <span aria-hidden="true">·</span>
            <a href={legal.termsHref}>{legal.terms}</a>
          </nav>
        </div>
        <a className="footer-github" href={githubUrl} target="_blank" rel="noreferrer"><GitBranch size={16} />GitHub <ArrowUpRight size={15} /></a>
      </footer>
    </main>
  )
}

export default App
