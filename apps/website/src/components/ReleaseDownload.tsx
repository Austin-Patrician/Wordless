import { ArrowDownRight, ArrowUpRight, Cpu, Laptop, LoaderCircle, MonitorDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { detectPlatform, fetchLatestRelease, getReleaseAsset, releaseFallback, type DesktopDownloadTarget, type LatestRelease, type ReleaseAsset } from '../lib/release'

type ReleaseCopy = {
  label: string
  loading: string
  fallback: string
  releaseNotes: string
}

type DownloadCopy = {
  primary: string
  secondary: string
  unsupported: string
  choose: string
  appleSilicon: string
  appleSiliconDetail: string
  intelMac: string
  intelMacDetail: string
  windows: string
  windowsDetail: string
  directSource: string
  fallbackSource: string
}

type DownloadOption = {
  target: DesktopDownloadTarget
  title: string
  detail: string
  icon: typeof Cpu
  detected: boolean
}

function formatSize(asset: ReleaseAsset | undefined): string {
  if (!asset?.size) return ''
  return `${Math.round(asset.size / 1024 / 1024)} MB`
}

export function ReleaseDownload({ compact = false, releaseCopy, downloadCopy }: { compact?: boolean; releaseCopy: ReleaseCopy; downloadCopy: DownloadCopy }) {
  const [release, setRelease] = useState<LatestRelease | null>(null)
  const [loading, setLoading] = useState(true)
  const platform = useMemo(detectPlatform, [])

  useEffect(() => {
    if (compact) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 7000)
    void fetchLatestRelease(controller.signal)
      .then(setRelease)
      .catch(() => setRelease(null))
      .finally(() => {
        window.clearTimeout(timeout)
        setLoading(false)
      })
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [compact])

  if (compact) {
    return (
      <div className="release-download release-download--compact">
        <div className="download-actions">
          <a className="action-button action-button--primary" href="#download">
            <span>{downloadCopy.choose}</span>
            <ArrowDownRight size={17} strokeWidth={1.7} />
          </a>
        </div>
      </div>
    )
  }

  const options: DownloadOption[] = [
    { target: 'mac-arm64', title: downloadCopy.appleSilicon, detail: downloadCopy.appleSiliconDetail, icon: Cpu, detected: false },
    { target: 'mac-x64', title: downloadCopy.intelMac, detail: downloadCopy.intelMacDetail, icon: Laptop, detected: false },
    { target: 'win-x64', title: downloadCopy.windows, detail: downloadCopy.windowsDetail, icon: MonitorDown, detected: platform === 'win' },
  ]

  return (
    <div className="release-download release-download--selector">
      <div className="release-meta">
        <span>{releaseCopy.label}</span>
        {loading ? (
          <span className="release-loading"><LoaderCircle size={13} /> {releaseCopy.loading}</span>
        ) : (
          <strong>{release?.tagName ?? releaseCopy.fallback}</strong>
        )}
      </div>
      <div className="download-options">
        {options.map((option) => {
          const asset = getReleaseAsset(release, option.target)
          const href = asset?.browser_download_url ?? (loading ? undefined : release?.htmlUrl ?? releaseFallback)
          const direct = asset?.browser_download_url.startsWith('https://download.wordless.20250230.xyz/') === true
          const Icon = option.icon
          return (
            <a
              className={`download-option${option.detected ? ' download-option--detected' : ''}${href ? '' : ' download-option--disabled'}`}
              href={href}
              aria-disabled={!href}
              key={option.target}
            >
              <span className="download-option__icon"><Icon size={18} strokeWidth={1.55} /></span>
              <span className="download-option__copy">
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              <span className="download-option__meta">
                <b>{formatSize(asset)}</b>
                <small>{asset ? (direct ? downloadCopy.directSource : downloadCopy.fallbackSource) : loading ? releaseCopy.loading : releaseCopy.fallback}</small>
              </span>
              <ArrowDownRight className="download-option__arrow" size={17} strokeWidth={1.6} />
            </a>
          )
        })}
      </div>
      <div className="download-footer">
        <p className="download-fallback">{downloadCopy.unsupported}</p>
        <a className="action-button action-button--ghost" href={release?.htmlUrl ?? releaseFallback} target="_blank" rel="noreferrer">
          <span>{releaseCopy.releaseNotes}</span>
          <ArrowUpRight size={16} strokeWidth={1.7} />
        </a>
      </div>
    </div>
  )
}
