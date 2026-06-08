const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export interface JobStatus {
  id: string
  url: string
  status: 'queued' | 'downloading' | 'converting' | 'processing' | 'done' | 'error'
  progress: number
  title: string | null
  duration: number | null
  error: string | null
  has_file: boolean
}

export interface TrackInfo {
  title: string | null
  duration: number | null
  thumbnail: string | null
  uploader: string | null
  platform: string | null
}

export async function fetchInfo(url: string): Promise<TrackInfo> {
  const r = await fetch(`${BASE}/api/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function startProcess(params: {
  url: string
  target_secs: number
  amp: number
  duration: number
}): Promise<{ job_id: string }> {
  const r = await fetch(`${BASE}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function pollStatus(job_id: string): Promise<JobStatus> {
  const r = await fetch(`${BASE}/api/status/${job_id}`)
  const data = await r.json()
  if (data.error) throw new Error(data.error)
  return data
}

export function downloadUrl(job_id: string): string {
  return `${BASE}/api/download/${job_id}`
}

export async function uploadToRoblox(params: {
  job_id: string
  roblox_cookie: string
  creator_id: string
  asset_name: string
}): Promise<{ success: boolean; asset_id?: string; operation_id?: string; error?: string }> {
  const r = await fetch(`${BASE}/api/roblox/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return r.json()
}

export function formatTime(secs: number): string {
  const s = Math.floor(secs || 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function platformIcon(url: string): string {
  if (/youtube|youtu\.be/i.test(url)) return '▶'
  if (/soundcloud/i.test(url)) return '☁'
  if (/tiktok/i.test(url)) return '♪'
  return '🔗'
}

export function platformName(url: string): string {
  if (/youtube|youtu\.be/i.test(url)) return 'YouTube'
  if (/soundcloud/i.test(url)) return 'SoundCloud'
  if (/tiktok/i.test(url)) return 'TikTok'
  return 'Link'
}
