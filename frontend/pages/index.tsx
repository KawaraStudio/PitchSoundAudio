import { useState, useEffect, useRef, useCallback } from 'react'
import {
  fetchInfo, startProcess, pollStatus, downloadUrl, uploadToRoblox,
  formatTime, platformIcon, platformName,
  type JobStatus, type TrackInfo,
} from '../src/lib/api'

// ─── Types ────────────────────────────────────────────────
interface Track {
  id: string
  url: string
  info: TrackInfo | null
  jobId: string | null
  status: 'fetching_info' | 'ready' | 'queued' | 'processing' | 'done' | 'error'
  progress: number
  error: string | null
  // Roblox
  robloxStatus: 'idle' | 'uploading' | 'done' | 'error'
  robloxAssetId: string | null
  robloxError: string | null
}

type Toast = { id: number; msg: string; type: 'ok' | 'err' | 'warn' | '' }

// ─── Helpers ─────────────────────────────────────────────
let toastSeq = 0
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((msg: string, type: Toast['type'] = '') => {
    const id = ++toastSeq
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500)
  }, [])
  return { toasts, push }
}

// ─── Component ───────────────────────────────────────────
export default function Dashboard() {
  const [tracks, setTracks]         = useState<Track[]>([])
  const [targetMin, setTargetMin]   = useState(7)
  const [targetSec, setTargetSec]   = useState(0)
  const [amp, setAmp]               = useState(1.0)
  const [linkInput, setLinkInput]   = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [tab, setTab]               = useState<'link' | 'roblox'>('link')
  // Roblox panel
  const [rbCookie, setRbCookie]     = useState('')
  const [rbCreatorId, setRbCreatorId] = useState('')
  const [showCookieHelp, setShowCookieHelp] = useState(false)
  const pollRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const { toasts, push } = useToast()

  const targetSecs = targetMin * 60 + targetSec

  // ── Mutate single track ──
  const setTrack = useCallback((id: string, patch: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  // ── Poll job status ──
  const startPolling = useCallback((trackId: string, jobId: string) => {
    const poll = async () => {
      try {
        const s: JobStatus = await pollStatus(jobId)
        setTrack(trackId, { progress: s.progress, status: s.status as Track['status'] })
        if (s.status === 'done') {
          clearInterval(pollRefs.current[trackId])
          delete pollRefs.current[trackId]
        } else if (s.status === 'error') {
          clearInterval(pollRefs.current[trackId])
          delete pollRefs.current[trackId]
          setTrack(trackId, { error: s.error || 'Gagal diproses' })
        }
      } catch (e) {
        // keep polling — network hiccup
      }
    }
    pollRefs.current[trackId] = setInterval(poll, 1500)
  }, [setTrack])

  // ── Add link ──
  const addLink = useCallback(async () => {
    const url = linkInput.trim()
    if (!url) return
    try { new URL(url) } catch { push('URL tidak valid', 'err'); return }
    setLinkInput('')

    const id = `${Date.now()}-${Math.random()}`
    const track: Track = {
      id, url, info: null, jobId: null,
      status: 'fetching_info', progress: 0,
      error: null, robloxStatus: 'idle',
      robloxAssetId: null, robloxError: null,
    }
    setTracks(prev => [...prev, track])

    try {
      const info = await fetchInfo(url)
      setTrack(id, { info, status: 'ready' })
    } catch (e: any) {
      setTrack(id, { status: 'error', error: e.message })
      push(`Gagal ambil info: ${e.message}`, 'err')
    }
  }, [linkInput, push, setTrack])

  // ── Process one track ──
  const processTrack = useCallback(async (track: Track) => {
    if (!track.info) return
    setTrack(track.id, { status: 'queued', progress: 0, error: null })
    try {
      const { job_id } = await startProcess({
        url: track.url,
        target_secs: targetSecs,
        amp,
        duration: track.info.duration || 0,
      })
      setTrack(track.id, { jobId: job_id, status: 'queued' })
      startPolling(track.id, job_id)
    } catch (e: any) {
      setTrack(track.id, { status: 'error', error: e.message })
      push(`Error: ${e.message}`, 'err')
    }
  }, [targetSecs, amp, push, setTrack, startPolling])

  // ── Process all ready ──
  const processAll = useCallback(async () => {
    const ready = tracks.filter(t => t.status === 'ready')
    if (!ready.length) return
    setIsProcessing(true)
    for (const t of ready) {
      await processTrack(t)
      await new Promise(r => setTimeout(r, 300))
    }
    setIsProcessing(false)
  }, [tracks, processTrack])

  // ── Roblox upload ──
  const uploadRoblox = useCallback(async (track: Track) => {
    if (!track.jobId || track.status !== 'done') return
    if (!rbCookie || !rbCreatorId) { push('Isi Cookie & Creator ID dulu', 'warn'); return }
    setTrack(track.id, { robloxStatus: 'uploading', robloxError: null })
    try {
      const res = await uploadToRoblox({
        job_id: track.jobId,
        roblox_cookie: rbCookie,
        creator_id: rbCreatorId,
        asset_name: track.info?.title || 'NADA Audio',
      })
      if (res.error) throw new Error(res.error)
      setTrack(track.id, {
        robloxStatus: 'done',
        robloxAssetId: res.asset_id || null,
      })
      push(`✓ Upload berhasil! Asset ID: ${res.asset_id}`, 'ok')
    } catch (e: any) {
      setTrack(track.id, { robloxStatus: 'error', robloxError: e.message })
      push(`Upload gagal: ${e.message}`, 'err')
    }
  }, [rbCookie, rbCreatorId, push, setTrack])

  // ── Cleanup on unmount ──
  useEffect(() => () => {
    Object.values(pollRefs.current).forEach(clearInterval)
  }, [])

  // ── Derived stats ──
  const readyCount = tracks.filter(t => t.status === 'ready').length
  const doneCount  = tracks.filter(t => t.status === 'done').length
  const speedRatioExample = tracks[0]?.info?.duration
    ? (tracks[0].info.duration / targetSecs).toFixed(2) : '—'

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      {/* ── Background glows ── */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 600px 500px at 80% -10%, rgba(232,255,71,0.05) 0%, transparent 70%),
          radial-gradient(ellipse 400px 400px at -5% 80%, rgba(71,255,232,0.04) 0%, transparent 70%),
          radial-gradient(ellipse 300px 300px at 50% 50%, rgba(155,89,182,0.03) 0%, transparent 70%)
        `
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 920, margin: '0 auto', padding: '40px 20px 100px' }}>

        {/* ═══ HEADER ═══ */}
        <header style={{ marginBottom: 48, borderBottom: '1px solid var(--border)', paddingBottom: 28, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 52, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: 'var(--accent)' }}>
              NADA<span style={{ color: 'var(--text)' }}> STUDIO</span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '4px', marginTop: 6, textTransform: 'uppercase' }}>
              Audio Converter · Pitch Engine · Roblox Uploader
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['YouTube', 'SoundCloud', 'TikTok', 'Roblox'].map(p => (
              <span key={p} style={{
                fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 10px',
                borderRadius: 20, background: 'var(--surface2)',
                border: '1px solid var(--border2)', color: 'var(--muted)',
                letterSpacing: 1
              }}>{p}</span>
            ))}
          </div>
        </header>

        {/* ═══ TABS ═══ */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 4 }}>
          {(['link', 'roblox'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px 20px', borderRadius: 10, border: tab === t ? '1px solid var(--border2)' : '1px solid transparent',
              background: tab === t ? 'var(--surface3)' : 'transparent',
              color: tab === t ? 'var(--text)' : 'var(--muted)',
              fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {t === 'link' ? '🔗 Input & Proses' : '🎮 Upload ke Roblox'}
            </button>
          ))}
        </div>

        {/* ═══ TAB: LINK ═══ */}
        {tab === 'link' && (
          <>
            {/* ── Target + Amp Controls ── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20,
            }}>
              {/* Target duration */}
              <div style={{ background: 'var(--surface)', border: '1px solid rgba(232,255,71,0.15)', borderRadius: 18, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 6 }}>🎯 Target Durasi</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 32, color: 'var(--accent)', letterSpacing: 1 }}>
                    {targetMin}:{String(targetSec).padStart(2, '0')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" value={targetMin} min={1} max={60}
                    onChange={e => setTargetMin(Math.max(1, Math.min(60, +e.target.value)))}
                    style={inputStyle} />
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 20 }}>:</span>
                  <input type="number" value={targetSec} min={0} max={59}
                    onChange={e => setTargetSec(Math.max(0, Math.min(59, +e.target.value)))}
                    style={inputStyle} />
                </div>
              </div>

              {/* Amplitude */}
              <div style={{ background: 'var(--surface)', border: '1px solid rgba(71,255,232,0.12)', borderRadius: 18, padding: '18px 22px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 6 }}>🔊 Amplifikasi</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="range" min={0.5} max={3} step={0.05} value={amp}
                    onChange={e => setAmp(+e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--accent2)' }} />
                  <span style={{ fontFamily: 'var(--display)', fontSize: 28, color: 'var(--accent2)', minWidth: 60, textAlign: 'right' }}>
                    {amp.toFixed(2)}×
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                  1.00 = normal · 2.00 = 2× lebih keras
                </div>
              </div>
            </div>

            {/* ── Link Input ── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  value={linkInput}
                  onChange={e => setLinkInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addLink()}
                  placeholder="Paste link YouTube / SoundCloud / TikTok..."
                  style={{
                    flex: 1, background: 'var(--surface2)', border: '1px solid var(--border2)',
                    borderRadius: 12, padding: '12px 16px', color: 'var(--text)',
                    fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
                  }}
                />
                <button onClick={addLink} style={accentBtn}>+ Tambah</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['▶ YouTube', '☁ SoundCloud', '♪ TikTok', 'Enter untuk tambah'].map(b => (
                  <span key={b} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border2)', color: 'var(--muted)' }}>{b}</span>
                ))}
              </div>
            </div>

            {/* ── Track Queue ── */}
            {tracks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {tracks.map(track => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    targetSecs={targetSecs}
                    onRemove={() => {
                      if (pollRefs.current[track.id]) {
                        clearInterval(pollRefs.current[track.id])
                        delete pollRefs.current[track.id]
                      }
                      setTracks(p => p.filter(t => t.id !== track.id))
                    }}
                    onProcess={() => processTrack(track)}
                    onDownload={() => {
                      if (!track.jobId) return
                      const a = document.createElement('a')
                      a.href = downloadUrl(track.jobId)
                      a.download = `${track.info?.title || 'audio'}.mp3`
                      a.click()
                    }}
                  />
                ))}
              </div>
            )}

            {/* ── Batch Stats ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { val: tracks.length, lbl: 'Total' },
                { val: readyCount, lbl: 'Siap Proses' },
                { val: doneCount, lbl: 'Selesai' },
                { val: `${targetMin}:${String(targetSec).padStart(2,'0')}`, lbl: 'Target' },
              ].map(({ val, lbl }) => (
                <div key={lbl} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 28, color: 'var(--accent2)', letterSpacing: 1 }}>{val}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 2, marginTop: 4 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* ── Process Button ── */}
            <button
              onClick={processAll}
              disabled={readyCount === 0 || isProcessing}
              style={{
                width: '100%', padding: '20px', borderRadius: 18,
                background: readyCount === 0 ? 'var(--surface2)' : 'var(--accent)',
                color: readyCount === 0 ? 'var(--muted)' : '#04040a',
                fontFamily: 'var(--display)', fontSize: 20, letterSpacing: 3,
                border: 'none', cursor: readyCount === 0 ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {isProcessing ? '⟳ MEMPROSES...' : `⚡ PROSES SEMUA (${readyCount} TRACK)`}
            </button>
          </>
        )}

        {/* ═══ TAB: ROBLOX ═══ */}
        {tab === 'roblox' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Cookie help toggle */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 18, padding: 24 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 16 }}>
                🎮 Konfigurasi Roblox Account
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Creator ID (User ID Roblox kamu)
                </label>
                <input
                  value={rbCreatorId}
                  onChange={e => setRbCreatorId(e.target.value)}
                  placeholder="Contoh: 123456789"
                  style={{ ...inputFieldStyle, width: '100%' }}
                />
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  Buka roblox.com/users → angka di URL-nya
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                    .ROBLOSECURITY Cookie
                  </label>
                  <button
                    onClick={() => setShowCookieHelp(p => !p)}
                    style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 8, padding: '2px 10px', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}
                  >
                    {showCookieHelp ? 'Sembunyikan' : '? Cara Ambil'}
                  </button>
                </div>
                <input
                  type="password"
                  value={rbCookie}
                  onChange={e => setRbCookie(e.target.value)}
                  placeholder="Paste cookie .ROBLOSECURITY di sini..."
                  style={{ ...inputFieldStyle, width: '100%' }}
                />
              </div>

              {showCookieHelp && (
                <div style={{ background: 'var(--surface2)', border: '1px solid rgba(232,255,71,0.15)', borderRadius: 12, padding: 18, animation: 'fadeUp 0.3s ease' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
                    ⚠ Cara Ambil Cookie (Chrome)
                  </div>
                  {[
                    ['1', 'Buka roblox.com dan login'],
                    ['2', 'Tekan F12 → tab Application'],
                    ['3', 'Kiri: Storage → Cookies → https://www.roblox.com'],
                    ['4', 'Cari .ROBLOSECURITY → copy Value-nya'],
                    ['5', 'Paste di kolom di atas'],
                  ].map(([n, t]) => (
                    <div key={n} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--accent)', flexShrink: 0, width: 20 }}>{n}</span>
                      <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{t}</span>
                    </div>
                  ))}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--danger)', marginTop: 8, padding: '8px 12px', background: 'rgba(255,71,87,0.08)', borderRadius: 8 }}>
                    ⚠ JANGAN share cookie ini ke siapapun. Cookie = akses penuh ke akun kamu.
                  </div>
                </div>
              )}
            </div>

            {/* Track list for roblox upload */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 20 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 14 }}>
                Track Siap Upload ({tracks.filter(t => t.status === 'done').length} selesai diproses)
              </div>
              {tracks.filter(t => t.status === 'done').length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  Belum ada track yang selesai diproses.<br />
                  <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setTab('link')}>
                    → Proses track dulu di tab Input & Proses
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tracks.filter(t => t.status === 'done').map(track => (
                    <div key={track.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px',
                    }}>
                      <span style={{ fontSize: 16 }}>{platformIcon(track.url)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track.info?.title || track.url}
                        </div>
                        {track.robloxAssetId && (
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent2)', marginTop: 2 }}>
                            ✓ Asset ID: {track.robloxAssetId}
                          </div>
                        )}
                        {track.robloxError && (
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>
                            ✗ {track.robloxError}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => uploadRoblox(track)}
                        disabled={track.robloxStatus === 'uploading' || track.robloxStatus === 'done'}
                        style={{
                          padding: '8px 16px', borderRadius: 10, border: 'none', cursor: track.robloxStatus === 'done' ? 'default' : 'pointer',
                          background: track.robloxStatus === 'done' ? 'var(--accent2-dim)'
                            : track.robloxStatus === 'uploading' ? 'var(--surface3)'
                            : 'rgba(232,255,71,0.12)',
                          color: track.robloxStatus === 'done' ? 'var(--accent2)'
                            : track.robloxStatus === 'uploading' ? 'var(--muted)'
                            : 'var(--accent)',
                          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
                          border: '1px solid',
                          borderColor: track.robloxStatus === 'done' ? 'rgba(71,255,232,0.3)' : 'rgba(232,255,71,0.2)',
                        }}
                      >
                        {track.robloxStatus === 'done' ? '✓ Done' : track.robloxStatus === 'uploading' ? '⟳ Upload...' : '↑ Upload'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ FOOTER ═══ */}
        <footer style={{ marginTop: 80, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
            Built by <span style={{ color: 'var(--accent)' }}>NADA STUDIO</span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>
            v1.0.0 · yt-dlp + FFmpeg
          </div>
        </footer>
      </div>

      {/* ═══ TOASTS ═══ */}
      <div style={{ position: 'fixed', bottom: 32, right: 32, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 10000 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: 'var(--surface2)',
            border: `1px solid ${t.type === 'ok' ? 'rgba(232,255,71,0.4)' : t.type === 'err' ? 'rgba(255,71,87,0.4)' : t.type === 'warn' ? 'rgba(255,165,2,0.4)' : 'var(--border2)'}`,
            color: t.type === 'ok' ? 'var(--accent)' : t.type === 'err' ? 'var(--danger)' : t.type === 'warn' ? 'var(--warn)' : 'var(--text)',
            borderRadius: 12, padding: '12px 20px',
            fontFamily: 'var(--mono)', fontSize: 12,
            animation: 'fadeUp 0.3s ease',
            maxWidth: 340,
          }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── TrackRow component ───────────────────────────────────
function TrackRow({ track, targetSecs, onRemove, onProcess, onDownload }: {
  track: Track
  targetSecs: number
  onRemove: () => void
  onProcess: () => void
  onDownload: () => void
}) {
  const speedRatio = track.info?.duration ? track.info.duration / targetSecs : null
  const isActive = ['queued', 'downloading', 'converting', 'processing'].includes(track.status)

  const statusLabel = {
    fetching_info: '⟳ Mengambil info...',
    ready: '✓ Siap',
    queued: '⟳ Antre...',
    downloading: `⟳ Download ${track.progress}%`,
    converting: `⟳ Convert ${track.progress}%`,
    processing: `⟳ Proses ${track.progress}%`,
    done: '✓ Selesai',
    error: '✗ Error',
  }[track.status]

  const statusColor = {
    ready: 'var(--accent2)', done: 'var(--accent2)', error: 'var(--danger)',
    fetching_info: 'var(--muted)',
  }[track.status] || 'var(--accent)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--surface2)',
      border: `1px solid ${track.status === 'done' ? 'rgba(71,255,232,0.25)' : track.status === 'error' ? 'rgba(255,71,87,0.25)' : track.status === 'ready' ? 'rgba(232,255,71,0.15)' : 'var(--border)'}`,
      borderRadius: 12, padding: '12px 14px', position: 'relative', overflow: 'hidden', transition: 'border-color 0.3s',
    }}>
      {/* Progress bar bg */}
      {isActive && (
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${track.progress}%`, background: 'rgba(232,255,71,0.04)',
          transition: 'width 0.4s ease', pointerEvents: 'none',
        }} />
      )}

      <span style={{ fontSize: 16, flexShrink: 0, zIndex: 1 }}>{platformIcon(track.url)}</span>

      <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.info?.title || track.url}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 3, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
            {track.info?.duration ? formatTime(track.info.duration) : '—'}
          </span>
          {speedRatio && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 4, padding: '1px 6px' }}>
              ×{speedRatio.toFixed(2)}
            </span>
          )}
          {track.info?.uploader && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
              {track.info.uploader}
            </span>
          )}
          {track.error && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--danger)' }}>
              {track.error.slice(0, 60)}
            </span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', color: statusColor, flexShrink: 0, zIndex: 1,
        whiteSpace: 'nowrap',
      }}>
        {statusLabel}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, zIndex: 1 }}>
        {track.status === 'ready' && (
          <button onClick={onProcess} style={{
            padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(232,255,71,0.3)',
            background: 'var(--accent-dim)', color: 'var(--accent)',
            fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer', fontWeight: 700,
          }}>Proses</button>
        )}
        {track.status === 'done' && (
          <button onClick={onDownload} style={{
            padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(71,255,232,0.3)',
            background: 'var(--accent2-dim)', color: 'var(--accent2)',
            fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer', fontWeight: 700,
          }}>⬇ MP3</button>
        )}
        <button onClick={onRemove} style={{
          background: 'none', border: 'none', color: 'var(--muted)',
          cursor: 'pointer', fontSize: 12, padding: '4px 6px',
        }}>✕</button>
      </div>
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border3)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--accent)', fontFamily: 'var(--mono)',
  fontSize: 18, fontWeight: 700, width: 60, textAlign: 'center', outline: 'none',
}

const inputFieldStyle: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 10,
  padding: '10px 14px', color: 'var(--text)', fontFamily: 'var(--mono)',
  fontSize: 13, outline: 'none',
}

const accentBtn: React.CSSProperties = {
  background: 'var(--accent)', border: 'none', borderRadius: 12,
  padding: '12px 20px', color: '#04040a', fontFamily: 'var(--font)',
  fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
}
