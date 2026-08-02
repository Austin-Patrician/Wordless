import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type WebsiteLoaderProps = {
  progress: number
  phase: string
  ready: boolean
  failed: boolean
  onContinue: () => void
}

export function WebsiteLoader({ progress, phase, ready, failed, onContinue }: WebsiteLoaderProps) {
  const [timedOut, setTimedOut] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(1)
  const [dismissed, setDismissed] = useState(false)
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const progressRef = useRef(progress)
  const readyRef = useRef(ready)

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    readyRef.current = ready
  }, [ready])

  useEffect(() => {
    const startedAt = performance.now()
    let frame = 0
    let minimumTimer = 0
    const animate = (now: number) => {
      const elapsed = now - startedAt
      const timeProgress = Math.min(100, (elapsed / 1800) * 100)
      setDisplayProgress((current) => {
        const target = readyRef.current
          ? Math.min(100, Math.max(progressRef.current, timeProgress))
          : Math.min(94, Math.max(progressRef.current, timeProgress))
        return current + (target - current) * 0.14
      })
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    minimumTimer = window.setTimeout(() => setMinimumElapsed(true), 1800)
    const timeout = window.setTimeout(() => setTimedOut(true), 12_000)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(minimumTimer)
      window.clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    if (!ready || !minimumElapsed) return
    const exitTimer = window.setTimeout(() => setDismissed(true), 260)
    return () => window.clearTimeout(exitTimer)
  }, [minimumElapsed, ready])

  const continueToSite = () => {
    setDismissed(true)
    onContinue()
  }

  return (
    <div className={`website-loader${dismissed ? ' website-loader--ready' : ''}`} aria-live="polite" aria-busy={!dismissed}>
      <div className="loader-brand">
        <span className="loader-brand__mark"><img src="/images/wordless.webp" alt="" /></span>
        <span>WORDLESS</span>
      </div>
      <div className="loader-center">
        <p>ENTERING THE WORKSPACE</p>
        <strong>{Math.round(Math.min(100, displayProgress)).toString().padStart(3, '0')}<small>%</small></strong>
        <div className="loader-track"><i style={{ transform: `scaleX(${Math.max(0.01, displayProgress / 100)})` }} /></div>
        <span>{failed ? '3D SCENE UNAVAILABLE' : phase}</span>
      </div>
      {(timedOut || failed) && !ready && (
        <button className="loader-continue" onClick={continueToSite}>
          <span>Continue with static view</span><ArrowRight size={16} />
        </button>
      )}
      <p className="loader-footnote">WEBGL / LOCAL-FIRST AGENT WORKSPACE</p>
    </div>
  )
}
