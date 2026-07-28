// Tab "Scan Postur" (EMR) — Stage 2. Capture foto depan/belakang → PoseLandmarker
// (lazy, lib/pose) → 33 landmark → 3 sudut → overlay SVG → simpan ke Storage + DB →
// render ulang dari data tersimpan. Perbandingan antar-waktu = Stage 3 (belum dibuat).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'
import { detectPose, computeAngles, keyVisibility, type PoseLandmark, type PoseAngles } from '../../lib/pose'

const BUCKET = 'clinic-posture'
const SIGNED_TTL = 3600
const VIS_THRESHOLD = 0.5   // ambang keyakinan deteksi (rata-rata visibility landmark kunci, skala 0..1)
const LEVEL_OK_DEG = 2      // ambang "lurus" untuk panduan level HP (±derajat)

type ViewKey = 'depan' | 'belakang'
const VIEWS: { key: ViewKey; label: string; instruksi: string }[] = [
  {
    key: 'depan',
    label: 'Depan',
    instruksi: 'Berdiri tegak MENGHADAP kamera. Kaki selebar bahu, lengan rileks di samping badan, pandangan lurus. Pastikan seluruh tubuh (kepala–kaki) masuk frame, pencahayaan cukup.',
  },
  {
    key: 'belakang',
    label: 'Belakang',
    instruksi: 'Berdiri tegak MEMBELAKANGI kamera. Posisi sama: kaki selebar bahu, lengan rileks, seluruh tubuh masuk frame.',
  },
]

interface Scan {
  id?: string
  imageUrl: string          // object URL (lokal, belum simpan) atau signed URL (dari Storage)
  landmarks: PoseLandmark[]
  angles: PoseAngles
  w: number                 // dimensi asli gambar (0 = belum diketahui, diisi saat <img> load)
  h: number
  saved: boolean
  file?: File               // file asli menunggu upload
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar tidak bisa dimuat (format tidak didukung browser?)'))
    img.src = src
  })
}

// Deteksi HEIC/HEIF secara robust: utamakan MIME. Kalau MIME sudah gambar non-heic (mis. iOS
// Safari kadang auto-convert ke JPEG), JANGAN konversi walau ekstensi .heic. Tebak dari
// ekstensi HANYA kalau MIME kosong/tak dikenal.
function isHeic(f: File): boolean {
  const t = f.type.toLowerCase()
  if (t === 'image/heic' || t === 'image/heif') return true
  if (t.startsWith('image/')) return false
  return /\.(heic|heif)$/i.test(f.name)
}

// Konversi HEIC→JPEG di browser (heic2any = libheif wasm). Dynamic import → chunk terpisah,
// TIDAK masuk initial bundle (pola sama MediaPipe).
async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import('heic2any')).default
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  const blob = (Array.isArray(out) ? out[0] : out) as Blob
  const name = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const fmtDeg = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}°`

// Overlay garis bahu/pinggul/tegak + label derajat. Pola sama body-diagram: SVG absolut
// di atas <img>. viewBox = dimensi asli → koordinat piksel; preserveAspectRatio none supaya
// pas menutupi gambar (aspek sama, jadi tidak distorsi).
function Overlay({ scan }: { scan: Scan }) {
  const { landmarks: lm, w, h } = scan
  if (w === 0 || lm.length < 29) return null
  const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h })
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const lsh = P(11), rsh = P(12), lhip = P(23), rhip = P(24), lank = P(27), rank = P(28)
  const msh = mid(lsh, rsh), mank = mid(lank, rank)
  const S = Math.max(w, h)
  const sw = S / 260, r = sw * 1.4, fs = S / 24
  const Label = ({ x, y, text, color }: { x: number; y: number; text: string; color: string }) => (
    <text x={clamp(x, fs, w - fs * 3.5)} y={clamp(y, fs, h - fs * 0.3)} fontSize={fs} fill={color}
      stroke="#000" strokeWidth={fs / 12} paintOrder="stroke" fontWeight={700}>{text}</text>
  )
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <line x1={lsh.x} y1={lsh.y} x2={rsh.x} y2={rsh.y} stroke="#ef4444" strokeWidth={sw} />
      <line x1={lhip.x} y1={lhip.y} x2={rhip.x} y2={rhip.y} stroke="#3b82f6" strokeWidth={sw} />
      <line x1={msh.x} y1={msh.y} x2={mank.x} y2={mank.y} stroke="#22c55e" strokeWidth={sw} />
      {[lsh, rsh, lhip, rhip, lank, rank].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r} fill="#fff" stroke="#111" strokeWidth={sw * 0.4} />
      ))}
      <Label x={Math.max(lsh.x, rsh.x) + fs * 0.3} y={Math.min(lsh.y, rsh.y) - fs * 0.3} text={fmtDeg(scan.angles.shoulder_tilt_deg)} color="#ef4444" />
      <Label x={Math.max(lhip.x, rhip.x) + fs * 0.3} y={Math.max(lhip.y, rhip.y) + fs} text={fmtDeg(scan.angles.hip_tilt_deg)} color="#3b82f6" />
      <Label x={mank.x + fs * 0.3} y={(msh.y + mank.y) / 2} text={fmtDeg(scan.angles.lateral_deviation_deg)} color="#22c55e" />
    </svg>
  )
}

function AngleRow({ color, label, deg }: { color: string; label: string; deg: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 12, height: 3, background: color, borderRadius: 2, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{fmtDeg(deg)}</span>
    </div>
  )
}

// ── Tren riwayat scan pasien (Stage 3) — murni tabel + delta, tanpa chart ────
interface TrendRow {
  id: string
  view: ViewKey
  created_at: string
  visit_date: string | null   // dari join clinic_visits; fallback created_at
  angles: PoseAngles
}

// Delta netral vs baris sebelumnya: ▲ naik / ▼ turun / = sama. TANPA warna
// merah/hijau — kita tidak menilai arah perubahan sebagai baik/buruk.
function fmtDelta(cur: number, prev: number): string {
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return '='
  return `${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(1)}`
}

const trendTh: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const trendTd: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}

function TrendTable({ label, rows }: { label: string; rows: TrendRow[] }) {
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      {/* Tabel bisa > lebar modal di HP → scroll horizontal di wrapper (pola table-wrap) */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={trendTh}>Tanggal</th>
              <th style={trendTh}>Bahu (°)</th>
              <th style={trendTh}>Pinggul (°)</th>
              <th style={trendTh}>Dev. Lateral (°)</th>
              <th style={trendTh}>Keyakinan</th>
              <th style={trendTh}>Δ vs sebelumnya</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = i > 0 ? rows[i - 1] : null
              const a = r.angles
              const conf = a.detection_confidence
              return (
                <tr key={r.id}>
                  <td style={trendTd}>{fmtDate(r.visit_date ?? r.created_at)}</td>
                  <td style={{ ...trendTd, fontFamily: 'monospace' }}>{a.shoulder_tilt_deg.toFixed(1)}</td>
                  <td style={{ ...trendTd, fontFamily: 'monospace' }}>{a.hip_tilt_deg.toFixed(1)}</td>
                  <td style={{ ...trendTd, fontFamily: 'monospace' }}>{a.lateral_deviation_deg.toFixed(1)}</td>
                  <td style={{ ...trendTd, fontFamily: 'monospace' }}>{conf != null ? `${Math.round(conf * 100)}%` : '—'}</td>
                  <td style={{ ...trendTd, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {prev
                      ? `B ${fmtDelta(a.shoulder_tilt_deg, prev.angles.shoulder_tilt_deg)} · P ${fmtDelta(a.hip_tilt_deg, prev.angles.hip_tilt_deg)} · L ${fmtDelta(a.lateral_deviation_deg, prev.angles.lateral_deviation_deg)}`
                      : '— (scan pertama)'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Panduan level HP (opsional): indikator kemiringan device via DeviceOrientationEvent.
// - iOS 13+ butuh requestPermission() lewat gesture user → tombol dulu.
// - Device tanpa sensor (banyak desktop) → sembunyikan total, TIDAK memblok upload.
// - Murni panduan visual saat motret; TIDAK disimpan & TIDAK memengaruhi kalkulasi sudut.
function LevelGuide() {
  const [phase, setPhase] = useState<'unknown' | 'need-permission' | 'listening' | 'unsupported'>('unknown')
  const [tilt, setTilt] = useState<number | null>(null)

  // Deteksi dukungan + apakah butuh izin (iOS).
  useEffect(() => {
    const DOE: unknown = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined
    if (!DOE) { setPhase('unsupported'); return }
    const needsPerm = typeof (DOE as { requestPermission?: unknown }).requestPermission === 'function'
    setPhase(needsPerm ? 'need-permission' : 'listening')
  }, [])

  // Pasang listener saat fase 'listening'. Kalau tak ada bacaan valid dalam 1.5s → anggap tak didukung.
  useEffect(() => {
    if (phase !== 'listening') return
    let got = false
    const handler = (e: DeviceOrientationEvent) => {
      if (e.gamma == null) return
      got = true
      setTilt(e.gamma)
    }
    window.addEventListener('deviceorientation', handler)
    const t = window.setTimeout(() => { if (!got) setPhase('unsupported') }, 1500)
    return () => { window.removeEventListener('deviceorientation', handler); window.clearTimeout(t) }
  }, [phase])

  const requestIOS = async () => {
    try {
      const fn = (window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission
      const res = await fn()
      setPhase(res === 'granted' ? 'listening' : 'unsupported')
    } catch {
      setPhase('unsupported')
    }
  }

  if (phase === 'unknown' || phase === 'unsupported') return null
  if (phase === 'need-permission') {
    return (
      <button type="button" className="btn-secondary" onClick={requestIOS}
        style={{ width: 'auto', padding: '6px 12px', marginBottom: 12, fontSize: 12 }}>
        Aktifkan panduan level HP
      </button>
    )
  }
  if (tilt == null) return null // listening tapi belum ada bacaan

  const g = tilt
  const level = Math.abs(g) <= LEVEL_OK_DEG
  const color = level ? '#22c55e' : Math.abs(g) <= 6 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Level HP</span>
      <div style={{ position: 'relative', flex: 1, height: 22, minWidth: 120, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 2, background: 'var(--border-strong)' }} />
        <div style={{ position: 'absolute', top: 10, left: '12%', right: '12%', height: 3, background: color, borderRadius: 2, transform: `rotate(${-g}deg)`, transformOrigin: 'center' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color, minWidth: 52, textAlign: 'right' }}>
        {level ? 'Lurus' : `${g > 0 ? '+' : ''}${g.toFixed(0)}°`}
      </span>
    </div>
  )
}

export default function PostureScanPanel({ visitId, patientId }: { visitId: string; patientId: string }) {
  const [scans, setScans] = useState<Partial<Record<ViewKey, Scan>>>({})
  const [busy, setBusy] = useState<Partial<Record<ViewKey, string>>>({})
  const [err, setErr] = useState<Partial<Record<ViewKey, string>>>({})
  const [loading, setLoading] = useState(true)
  // Konfirmasi ekstra sebelum simpan saat keyakinan deteksi rendah (per view).
  const [confirming, setConfirming] = useState<Partial<Record<ViewKey, boolean>>>({})
  // Tren riwayat scan pasien (semua visit). null = masih memuat.
  const [trend, setTrend] = useState<TrendRow[] | null>(null)
  const [trendRefresh, setTrendRefresh] = useState(0)

  // Muat SEMUA scan milik pasien ini (lintas visit) untuk tabel tren — terpisah dari
  // loader per-visit di bawah, tidak menyentuh alur capture/simpan.
  useEffect(() => {
    if (!patientId) { setTrend([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('clinic_posture_scans')
          .select('id, view, created_at, angles, visit:clinic_visits(visit_date)')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: true })
        if (cancelled) return
        setTrend(((data ?? []) as unknown as { id: string; view: ViewKey; created_at: string; angles: PoseAngles; visit: { visit_date: string } | null }[]).map(r => ({
          id: r.id, view: r.view, created_at: r.created_at,
          visit_date: r.visit?.visit_date ?? null, angles: r.angles,
        })))
      } catch {
        if (!cancelled) setTrend([])
      }
    })()
    return () => { cancelled = true }
  }, [patientId, trendRefresh])

  const setBusyFor = (v: ViewKey, msg?: string) => setBusy(b => ({ ...b, [v]: msg }))
  const setErrFor = (v: ViewKey, msg: string) => setErr(e => ({ ...e, [v]: msg }))

  // Muat scan tersimpan (terbaru per view) saat tab dibuka → render dari data DB + Storage.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('clinic_posture_scans')
          .select('id, view, image_path, landmarks, angles')
          .eq('visit_id', visitId)
          .order('created_at', { ascending: false })
        const next: Partial<Record<ViewKey, Scan>> = {}
        for (const row of (data ?? []) as { id: string; view: ViewKey; image_path: string; landmarks: PoseLandmark[]; angles: PoseAngles }[]) {
          if (next[row.view]) continue // sudah ada yang lebih baru (order desc)
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.image_path, SIGNED_TTL)
          if (!signed?.signedUrl) continue
          next[row.view] = {
            id: row.id, imageUrl: signed.signedUrl,
            landmarks: row.landmarks ?? [], angles: row.angles,
            w: 0, h: 0, saved: true,
          }
        }
        if (!cancelled) setScans(next)
      } catch (e) {
        if (!cancelled) setErrFor('depan', e instanceof Error ? e.message : 'Gagal memuat scan tersimpan')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [visitId])

  const onPick = async (view: ViewKey, file: File | null) => {
    if (!file) return
    setErrFor(view, '')
    setConfirming(c => ({ ...c, [view]: false }))
    let work = file
    // iPhone HEIC/HEIF → konversi ke JPEG DULU: deteksi PoseLandmarker & file yang diupload
    // ke Storage sama-sama JPEG, bukan HEIC mentah (browser tak bisa render HEIC).
    if (isHeic(file)) {
      setBusyFor(view, 'Mengonversi HEIC → JPEG… (bisa beberapa detik)')
      try {
        work = await convertHeicToJpeg(file)
      } catch {
        setBusyFor(view, undefined)
        setErrFor(view, 'Gagal mengonversi HEIC → JPEG. File mungkin rusak atau bukan HEIC valid. Coba foto lain atau ekspor sebagai JPG.')
        return
      }
    }
    setBusyFor(view, 'Memproses foto & mendeteksi postur…')
    const url = URL.createObjectURL(work)
    try {
      const img = await loadImage(url)
      const landmarks = await detectPose(img)
      if (landmarks.length === 0) {
        URL.revokeObjectURL(url)
        setErrFor(view, 'Tubuh tidak terdeteksi. Pastikan seluruh badan tampak jelas & pencahayaan cukup.')
        return
      }
      // Kalkulasi 3 sudut TIDAK diubah; hanya ditambah detection_confidence (rata-rata visibility).
      const angles: PoseAngles = {
        ...computeAngles(landmarks, img.naturalWidth, img.naturalHeight),
        detection_confidence: Math.round(keyVisibility(landmarks) * 100) / 100,
      }
      setScans(s => ({ ...s, [view]: { imageUrl: url, landmarks, angles, w: img.naturalWidth, h: img.naturalHeight, saved: false, file: work } }))
    } catch (e) {
      URL.revokeObjectURL(url)
      setErrFor(view, e instanceof Error ? e.message : 'Gagal memproses foto')
    } finally {
      setBusyFor(view, undefined)
    }
  }

  const onSave = async (view: ViewKey) => {
    const scan = scans[view]
    if (!scan || !scan.file || scan.saved) return
    if (!patientId) { setErrFor(view, 'patient_id tidak tersedia untuk visit ini'); return }
    setErrFor(view, '')
    setConfirming(c => ({ ...c, [view]: false }))
    setBusyFor(view, 'Mengunggah & menyimpan…')
    try {
      const ext = (scan.file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${visitId}/${view}-${Date.now()}.${ext}`
      // Upload foto ASLI (bukan yang sudah digambar garis).
      const up = await supabase.storage.from(BUCKET).upload(path, scan.file, {
        contentType: scan.file.type || 'image/jpeg', upsert: false,
      })
      if (up.error) throw up.error
      // Insert baris + ambil kembali landmarks/angles tersimpan (verifikasi round-trip jsonb).
      const ins = await supabase.from('clinic_posture_scans').insert({
        visit_id: visitId, patient_id: patientId, view,
        image_path: path, landmarks: scan.landmarks, angles: scan.angles,
      }).select('id, image_path, landmarks, angles').single()
      if (ins.error) throw ins.error
      const row = ins.data as { id: string; image_path: string; landmarks: PoseLandmark[]; angles: PoseAngles }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.image_path, SIGNED_TTL)
      URL.revokeObjectURL(scan.imageUrl)
      // Render ulang MURNI dari data tersimpan (foto Storage + landmarks/angles dari DB).
      setScans(s => ({
        ...s,
        [view]: { id: row.id, imageUrl: signed?.signedUrl ?? scan.imageUrl, landmarks: row.landmarks ?? [], angles: row.angles, w: 0, h: 0, saved: true },
      }))
      setTrendRefresh(n => n + 1)   // scan baru tersimpan → muat ulang tabel tren
    } catch (e) {
      setErrFor(view, e instanceof Error ? e.message : 'Gagal menyimpan')
    } finally {
      setBusyFor(view, undefined)
    }
  }

  const onImgLoad = (view: ViewKey, img: HTMLImageElement) => {
    const s = scans[view]
    if (s && s.w === 0 && img.naturalWidth > 0) {
      setScans(prev => ({ ...prev, [view]: { ...prev[view]!, w: img.naturalWidth, h: img.naturalHeight } }))
    }
  }

  const fileInput = (view: ViewKey, label: string) => (
    <label className="btn-secondary" style={{ width: 'auto', padding: '8px 14px', cursor: 'pointer', display: 'inline-block' }}>
      {label}
      <input type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { onPick(view, e.target.files?.[0] ?? null); e.target.value = '' }} />
    </label>
  )

  if (loading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Memuat scan postur…</p>

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.15)', color: '#6EE7B7', fontSize: 12, fontWeight: 700 }}>Scan Postur</span>
      </label>
      {!patientId && (
        <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>Data pasien tidak tersedia — scan tidak bisa disimpan.</p>
      )}

      {/* ── Tren riwayat scan pasien (Stage 3) — di atas area capture ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Riwayat Scan Postur</div>
        {trend === null ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Memuat riwayat scan…</p>
        ) : trend.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Belum ada riwayat scan sebelumnya.</p>
        ) : (
          <>
            <TrendTable label="Depan" rows={trend.filter(r => r.view === 'depan')} />
            <TrendTable label="Belakang" rows={trend.filter(r => r.view === 'belakang')} />
          </>
        )}
      </div>

      {/* Panduan level HP (opsional; sembunyi kalau device tak punya sensor). */}
      <LevelGuide />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {VIEWS.map(v => {
          const scan = scans[v.key]
          const status = busy[v.key]
          const error = err[v.key]
          const conf = scan?.angles.detection_confidence
          const low = conf != null && conf < VIS_THRESHOLD
          return (
            <div key={v.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{v.label}</span>
                {scan?.saved && <span className="badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#6EE7B7' }}>Tersimpan</span>}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.4 }}>{v.instruksi}</p>

              {scan ? (
                <>
                  <div style={{ position: 'relative', display: 'block', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                    <img src={scan.imageUrl} alt={`postur ${v.key}`} onLoad={e => onImgLoad(v.key, e.currentTarget)}
                      style={{ width: '100%', display: 'block' }} />
                    {scan.w > 0 && <Overlay scan={scan} />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: 12 }}>
                    <AngleRow color="#ef4444" label="Kemiringan bahu" deg={scan.angles.shoulder_tilt_deg} />
                    <AngleRow color="#3b82f6" label="Kemiringan pinggul" deg={scan.angles.hip_tilt_deg} />
                    <AngleRow color="#22c55e" label="Deviasi lateral (tegak)" deg={scan.angles.lateral_deviation_deg} />
                    {conf != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ width: 12, height: 3, background: 'var(--text-muted)', borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)', flex: 1 }}>Keyakinan deteksi</span>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: low ? 'var(--red)' : 'var(--text-primary)' }}>{Math.round(conf * 100)}%</span>
                      </div>
                    )}
                  </div>

                  {low && (
                    <p style={{ fontSize: 12, color: 'var(--text-primary)', background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.4 }}>
                      ⚠ Deteksi kurang jelas — pastikan pencahayaan cukup dan seluruh tubuh (bahu sampai kaki) terlihat di foto. Disarankan foto ulang.
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {!scan.saved && !confirming[v.key] && (
                      <button type="button" className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }}
                        disabled={!!status || !patientId}
                        onClick={() => { if (low) setConfirming(c => ({ ...c, [v.key]: true })); else onSave(v.key) }}>Simpan</button>
                    )}
                    {!scan.saved && confirming[v.key] && (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Simpan meski deteksi kurang jelas?</span>
                        <button type="button" className="btn-primary" style={{ width: 'auto', padding: '8px 14px' }}
                          disabled={!!status || !patientId} onClick={() => onSave(v.key)}>Ya, simpan</button>
                        <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '8px 14px' }}
                          onClick={() => setConfirming(c => ({ ...c, [v.key]: false }))}>Batal</button>
                      </>
                    )}
                    {fileInput(v.key, scan.saved ? 'Scan ulang' : 'Ganti foto')}
                  </div>
                </>
              ) : (
                <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                  {fileInput(v.key, '+ Pilih foto')}
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>JPG/PNG/WebP, maks 5 MB</p>
                </div>
              )}

              {status && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>{status}</p>}
              {error && <p style={{ fontSize: 12, color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
