import { ArrowDownRight, ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { detectPlatform, fetchLatestRelease, getPlatformAsset, releaseFallback, type LatestRelease } from '../lib/release'

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
}

export function ReleaseDownload({ compact = false, releaseCopy, downloadCopy }: { compact?: boolean; releaseCopy: ReleaseCopy; downloadCopy: DownloadCopy }) {
  const [release, setRelease] = useState<LatestRelease | null>(null)
  const [loading, setLoading] = useState(true)
  const platform = useMemo(detectPlatform, [])

  useEffect(() => {
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
  }, [])

  const asset = getPlatformAsset(release, platform)
  const platformName = platform === 'mac' ? 'macOS' : platform === 'win' ? 'Windows' : ''
  const downloadHref = asset?.browser_download_url ?? release?.htmlUrl ?? releaseFallback
  const label = platformName ? `${downloadCopy.primary} ${platformName}` : downloadCopy.secondary

  return (
    <div className={compact ? 'release-download release-download--compact' : 'release-download'}>
      {!compact && (
        <div className="release-meta">
          <span>{releaseCopy.label}</span>
          {loading ? (
            <span className="release-loading"><LoaderCircle size={13} /> {releaseCopy.loading}</span>
          ) : (
            <strong>{release?.tagName ?? releaseCopy.fallback}</strong>
          )}
        </div>
      )}
      <div className="download-actions">
        <a className="action-button action-button--primary" href={downloadHref} target="_blank" rel="noreferrer">
          <span>{label}</span>
          <ArrowDownRight size={17} strokeWidth={1.7} />
        </a>
        {!compact && (
          <a className="action-button action-button--ghost" href={release?.htmlUrl ?? releaseFallback} target="_blank" rel="noreferrer">
            <span>{releaseCopy.releaseNotes}</span>
            <ArrowUpRight size={16} strokeWidth={1.7} />
          </a>
        )}
      </div>
      {!compact && platform === 'other' && <p className="download-fallback">{downloadCopy.unsupported}</p>}
    </div>
  )
}
