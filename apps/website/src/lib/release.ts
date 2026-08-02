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
export const releaseFallback = 'https://github.com/Austin-Patrician/Wordless/releases/latest'

let cachedRelease: LatestRelease | null | undefined

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  if (cachedRelease !== undefined) return cachedRelease

  const response = await fetch(releaseApi, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  })

  if (!response.ok) {
    cachedRelease = null
    return cachedRelease
  }

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

  return cachedRelease
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
