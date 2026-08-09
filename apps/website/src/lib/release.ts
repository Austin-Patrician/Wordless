export type ReleaseAsset = {
  name: string
  browser_download_url: string
  size: number
}

export type LatestRelease = {
  tagName: string
  name: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

const releaseApi = 'https://api.github.com/repos/Austin-Patrician/Wordless/releases/latest'
const releaseManifest = 'https://download.wordless.20250230.xyz/releases/releases.json'
export const releaseFallback = 'https://github.com/Austin-Patrician/Wordless/releases/latest'

let cachedRelease: LatestRelease | null | undefined

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  if (cachedRelease !== undefined) return cachedRelease

  try {
    const response = await fetch(releaseManifest, { signal: requestSignal(signal, 3500), headers: { Accept: 'application/json' } })
    if (response.ok) {
      const payload = (await response.json()) as {
        schemaVersion?: number
        releases?: Array<{
          version?: string
          title?: string
          publishedAt?: string
          htmlUrl?: string
          assets?: Array<{ name?: string; size?: number; urls?: string[] }>
        }>
      }
      const latest = payload.schemaVersion === 1 ? payload.releases?.[0] : undefined
      if (latest?.version && Array.isArray(latest.assets)) {
        cachedRelease = {
          tagName: `v${latest.version.replace(/^v/i, '')}`,
          name: latest.title ?? `Wordless ${latest.version}`,
          publishedAt: latest.publishedAt ?? '',
          htmlUrl: latest.htmlUrl ?? releaseFallback,
          assets: latest.assets.flatMap((asset) => asset.name && asset.urls?.[0]
            ? [{ name: asset.name, size: asset.size ?? 0, browser_download_url: asset.urls[0] }]
            : []),
        }
        return cachedRelease
      }
    }
  } catch {
    // GitHub remains available as the release metadata fallback.
  }

  try {
    const response = await fetch(releaseApi, {
      signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`)
    const payload = (await response.json()) as {
      tag_name?: string
      name?: string
      published_at?: string
      html_url?: string
      assets?: ReleaseAsset[]
    }
    cachedRelease = {
      tagName: payload.tag_name ?? 'Latest',
      name: payload.name ?? payload.tag_name ?? 'Latest release',
      publishedAt: payload.published_at ?? '',
      htmlUrl: payload.html_url ?? releaseFallback,
      assets: payload.assets ?? [],
    }
  } catch {
    cachedRelease = null
  }
  return cachedRelease
}

function requestSignal(signal: AbortSignal | undefined, timeout: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
}

export function getPlatformAsset(release: LatestRelease | null, platform: string): ReleaseAsset | undefined {
  if (!release) return undefined
  const matchers: Record<string, RegExp> = {
    mac: /\.(dmg|zip)$/i,
    win: /\.exe$/i,
  }
  const matcher = matchers[platform]
  return matcher ? release.assets.find((asset) => matcher.test(asset.name)) : undefined
}

export function detectPlatform() {
  const platform = navigator.userAgent.toLowerCase()
  if (platform.includes('mac')) return 'mac'
  if (platform.includes('win')) return 'win'
  return 'other'
}
