import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime } from '../../lib/format'

// Fase 2 — panel redeem paket coaching (dijadwalkan staf), tampil di
// BookingDetailModal untuk booking slot ber-rent_type open_arena_coach /
// open_arena_head_coach. Melacak saldo sesi (terpakai vs total), menjadwalkan
// tiap sesi + assign coach, dan mengubah status sesi. Integritas (over-pakai /
// masa berlaku / paket belum lunas) di-enforce trigger DB; pesan errornya
// diterjemahkan di sini.

interface Props {
  bookingId: string
  sessionsTotal: number
  validUntil: string | null
  packageStatus: string       // status booking induk (arena_bookings.status)
  onChanged?: () => void
}

interface CoachSession {
  id: string
  session_date: string
  session_time: string | null
  coach_id: string | null
  coach_name: string | null
  status: string
  notes: string | null
}

interface CoachOpt { id: string; name: string }

const SESSION_STATUS: { value: string; label: string }[] = [
  { value: 'scheduled', label: 'Terjadwal' },
  { value: 'completed', label: 'Selesai' },
  { value: 'no_show', label: 'No Show' },
  { value: 'cancelled', label: 'Batal' },
]

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Terjemahkan pesan error trigger DB → bahasa yang ramah staf.
function translateErr(msg: string): string {
  if (msg.includes('COACH_SESSION_FULL')) return 'Semua sesi paket ini sudah terpakai.'
  if (msg.includes('COACH_SESSION_EXPIRED')) return 'Tanggal sesi melewati masa berlaku paket.'
  if (msg.includes('COACH_SESSION_UNPAID')) return 'Paket belum lunas — konfirmasi pembayaran dulu sebelum menjadwalkan sesi.'
  if (msg.includes('COACH_SESSION_NOT_PACKAGE')) return 'Booking ini bukan paket coaching.'
  return msg
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
}

export default function CoachPackagePanel({ bookingId, sessionsTotal, validUntil, packageStatus, onChanged }: Props) {
  const [sessions, setSessions] = useState<CoachSession[]>([])
  const [coaches, setCoaches] = useState<CoachOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ session_date: todayIso(), session_time: '', coach_id: '', notes: '' })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase
        .from('open_arena_coach_sessions')
        .select('*')
        .eq('booking_id', bookingId)
        .order('session_date', { ascending: true }),
      supabase.from('arena_coaches').select('id, name').eq('is_active', true).order('name', { ascending: true }),
    ])
    setSessions((s || []) as CoachSession[])
    setCoaches((c || []) as CoachOpt[])
    setLoading(false)
  }, [bookingId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const used = sessions.filter(s => s.status !== 'cancelled').length
  const remaining = Math.max(0, sessionsTotal - used)
  const expired = !!validUntil && todayIso() > validUntil
  const confirmed = packageStatus === 'confirmed'
  const canSchedule = confirmed && remaining > 0 && !expired

  const addSession = async () => {
    setError('')
    if (!form.session_date) { setError('Tanggal sesi wajib diisi'); return }
    setSaving(true)
    const coach = coaches.find(c => c.id === form.coach_id)
    const { error: err } = await supabase.from('open_arena_coach_sessions').insert({
      booking_id: bookingId,
      session_date: form.session_date,
      session_time: form.session_time || null,
      coach_id: form.coach_id || null,
      coach_name: coach?.name || null,
      status: 'scheduled',
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    if (err) { setError(translateErr(err.message)); return }
    setForm({ session_date: todayIso(), session_time: '', coach_id: '', notes: '' })
    await fetchAll()
    onChanged?.()
  }

  const setStatus = async (id: string, status: string) => {
    setError('')
    const { error: err } = await supabase
      .from('open_arena_coach_sessions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (err) { setError(translateErr(err.message)); return }
    await fetchAll()
    onChanged?.()
  }

  return (
    <div className="modal-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Paket Coaching
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          {used} / {sessionsTotal} sesi terpakai
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · sisa {remaining}</span>
        </span>
      </div>

      <div className="detail-row">
        <span className="detail-label">Masa berlaku</span>
        <span className="detail-value">
          {validUntil ? fmtDate(validUntil) : 'Sesi tunggal (tanpa masa berlaku)'}
          {expired && <span className="badge badge-cancelled" style={{ marginLeft: 8 }}>Kedaluwarsa</span>}
        </span>
      </div>

      {!confirmed && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '8px 10px', fontSize: 12, margin: '8px 0' }}>
          Paket belum lunas (status: {packageStatus}). Konfirmasi pembayaran dulu sebelum menjadwalkan sesi.
        </div>
      )}

      {/* Daftar sesi terjadwal */}
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>Memuat sesi…</div>
      ) : sessions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>Belum ada sesi dijadwalkan.</div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {sessions.map((s, i) => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
              borderTop: '1px solid var(--border)', fontSize: 13,
              opacity: s.status === 'cancelled' ? 0.55 : 1,
            }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0, width: 18 }}>{i + 1}.</span>
              <span style={{ flexShrink: 0 }}>{fmtDate(s.session_date)}{s.session_time ? ` ${fmtTime(s.session_time)}` : ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                {s.coach_name || 'Coach TBD'}{s.notes ? ` · ${s.notes}` : ''}
              </span>
              <select value={s.status} onChange={e => setStatus(s.id, e.target.value)}
                style={{ flexShrink: 0, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}>
                {SESSION_STATUS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Form jadwalkan sesi baru */}
      {canSchedule ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Jadwalkan sesi</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Tanggal</label>
              <input type="date" value={form.session_date} min={todayIso()} max={validUntil || undefined}
                onChange={e => setForm(p => ({ ...p, session_date: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Jam (opsional)</label>
              <input type="time" value={form.session_time}
                onChange={e => setForm(p => ({ ...p, session_time: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Coach</label>
            <select value={form.coach_id} onChange={e => setForm(p => ({ ...p, coach_id: e.target.value }))} style={inputStyle}>
              <option value="">— Pilih coach —</option>
              {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Catatan (opsional)</label>
            <input type="text" value={form.notes} placeholder="mis. fokus mobility"
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={inputStyle} />
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</p>}
          <button className="btn-primary" disabled={saving} onClick={addSession} style={{ width: '100%' }}>
            {saving ? 'Menyimpan…' : 'Jadwalkan sesi'}
          </button>
        </div>
      ) : (
        error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>
      )}

      {confirmed && remaining === 0 && !expired && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Semua sesi paket sudah terpakai.</div>
      )}
    </div>
  )
}
