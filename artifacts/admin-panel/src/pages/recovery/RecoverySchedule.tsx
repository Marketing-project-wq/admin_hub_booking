import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// RECOVERY CENTER — Jadwal. Mengatur jam operasional Recovery Center per hari.
// KHUSUS Recovery (terpisah dari slot Sports Clinic / clinic_slots).
//
// Data via RPC (jangan query tabel langsung):
//   recovery_schedule_list()  -> 7 baris (weekday 0=Minggu..6=Sabtu), waktu "HH:MM:SS"
//   recovery_schedule_upsert(p_weekday,p_is_open,p_open_time,p_close_time,p_interval,p_capacity)
//     -> { ok:true, weekday } | { ok:false, error, message? }
// Ketersediaan slot dihitung app dari config ini (recovery_availability / create_recovery_booking).

interface Row {
  weekday: number
  is_open: boolean
  open_time: string   // HH:MM (untuk <input type=time>)
  close_time: string  // HH:MM
  slot_interval_minutes: number
  capacity: number
  updated_at: string | null
}

// Tampilkan Senin dulu biar enak dibaca; simpan tetap pakai angka weekday Postgres.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABEL: Record<number, string> = {
  0: 'Minggu', 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu',
}

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '')

const rowError = (r: Row): string | null => {
  if (r.is_open) {
    if (!r.open_time || !r.close_time) return 'Isi jam buka & tutup'
    if (r.open_time >= r.close_time) return 'Jam buka harus sebelum jam tutup'
  }
  if (!Number.isFinite(r.slot_interval_minutes) || r.slot_interval_minutes < 5 || r.slot_interval_minutes > 240)
    return 'Interval 5–240 menit'
  if (!Number.isFinite(r.capacity) || r.capacity < 0) return 'Kapasitas minimal 0'
  return null
}

const sameRow = (a: Row, b: Row) =>
  a.is_open === b.is_open && a.open_time === b.open_time && a.close_time === b.close_time &&
  a.slot_interval_minutes === b.slot_interval_minutes && a.capacity === b.capacity

export default function RecoverySchedule() {
  const [rows, setRows] = useState<Row[]>([])
  const [orig, setOrig] = useState<Record<number, Row>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [rowMsg, setRowMsg] = useState<Record<number, { ok: boolean; text: string }>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('recovery_schedule_list')
    if (err) { setError(err.message); setLoading(false); return }
    const mapped: Row[] = ((data as Row[]) || []).map(r => ({
      weekday: r.weekday,
      is_open: r.is_open,
      open_time: hhmm(r.open_time),
      close_time: hhmm(r.close_time),
      slot_interval_minutes: r.slot_interval_minutes,
      capacity: r.capacity,
      updated_at: r.updated_at,
    }))
    setRows(mapped)
    const o: Record<number, Row> = {}
    for (const r of mapped) o[r.weekday] = { ...r }
    setOrig(o)
    setError(''); setRowMsg({}); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const ordered = useMemo(
    () => DAY_ORDER.map(w => rows.find(r => r.weekday === w)).filter(Boolean) as Row[],
    [rows],
  )

  const setRow = (weekday: number, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => r.weekday === weekday ? { ...r, ...patch } : r))
    setRowMsg(prev => { const n = { ...prev }; delete n[weekday]; return n })
  }

  const isDirty = (r: Row) => { const o = orig[r.weekday]; return !o || !sameRow(r, o) }

  // Panggil RPC upsert untuk 1 baris. Return null bila sukses, atau pesan error.
  const saveOne = async (r: Row): Promise<string | null> => {
    const { data, error: err } = await supabase.rpc('recovery_schedule_upsert', {
      p_weekday: r.weekday,
      p_is_open: r.is_open,
      p_open_time: r.open_time,
      p_close_time: r.close_time,
      p_interval: Number(r.slot_interval_minutes),
      p_capacity: Number(r.capacity),
    })
    if (err) return err.message
    const res = data as { ok?: boolean; error?: string; message?: string } | null
    if (res && res.ok === false) return res.message || res.error || 'Gagal menyimpan'
    return null
  }

  const handleSaveRow = async (r: Row) => {
    const ve = rowError(r)
    if (ve) { setRowMsg(prev => ({ ...prev, [r.weekday]: { ok: false, text: ve } })); return }
    setSavingRow(r.weekday)
    const err = await saveOne(r)
    setSavingRow(null)
    if (err) { setRowMsg(prev => ({ ...prev, [r.weekday]: { ok: false, text: err } })); return }
    setOrig(prev => ({ ...prev, [r.weekday]: { ...r } }))
    setRowMsg(prev => ({ ...prev, [r.weekday]: { ok: true, text: 'Tersimpan' } }))
  }

  const dirtyRows = rows.filter(isDirty)

  const handleSaveAll = async () => {
    setError('')
    // Validasi semua baris yang berubah dulu
    for (const r of dirtyRows) {
      const ve = rowError(r)
      if (ve) { setRowMsg(prev => ({ ...prev, [r.weekday]: { ok: false, text: ve } })); setError(`${DAY_LABEL[r.weekday]}: ${ve}`); return }
    }
    setSavingAll(true)
    const failures: string[] = []
    const nextOrig = { ...orig }
    const nextMsg = { ...rowMsg }
    for (const r of dirtyRows) {
      const err = await saveOne(r)
      if (err) { failures.push(`${DAY_LABEL[r.weekday]}: ${err}`); nextMsg[r.weekday] = { ok: false, text: err } }
      else { nextOrig[r.weekday] = { ...r }; nextMsg[r.weekday] = { ok: true, text: 'Tersimpan' } }
    }
    setOrig(nextOrig); setRowMsg(nextMsg); setSavingAll(false)
    if (failures.length) setError(`Sebagian gagal — ${failures.join(' · ')}`)
    else await fetchData()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Jadwal Recovery Center</h2>
        <button className="btn-primary" onClick={handleSaveAll} disabled={savingAll || dirtyRows.length === 0}>
          {savingAll ? 'Menyimpan...' : `Simpan Semua${dirtyRows.length ? ` (${dirtyRows.length})` : ''}`}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Jam operasional Recovery Center per hari. Slot booking dihitung otomatis dari jam buka–tutup dengan
        langkah <b>interval</b>, dan tiap slot muat <b>kapasitas</b> booking paralel. Khusus Recovery — terpisah
        dari jadwal Sports Clinic.
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Hari</th><th>Status</th><th>Jam Buka</th><th>Jam Tutup</th>
              <th>Interval (mnt)</th><th>Kapasitas</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={7}>Memuat data...</td></tr>
            ) : ordered.map(r => {
              const msg = rowMsg[r.weekday]
              const dirty = isDirty(r)
              return (
              <tr key={r.weekday}>
                <td style={{ fontWeight: 600 }}>{DAY_LABEL[r.weekday]}</td>
                <td>
                  <label className="toggle" style={{ fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className={`toggle-track ${r.is_open ? 'on' : ''}`}><span className="toggle-thumb" /></span>
                    <input type="checkbox" checked={r.is_open} onChange={e => setRow(r.weekday, { is_open: e.target.checked })} style={{ display: 'none' }} />
                    <span style={{ color: r.is_open ? 'var(--green, #047857)' : 'var(--text-muted)' }}>{r.is_open ? 'Buka' : 'Tutup'}</span>
                  </label>
                </td>
                <td>
                  <input type="time" value={r.open_time} disabled={!r.is_open}
                    onChange={e => setRow(r.weekday, { open_time: e.target.value })}
                    style={{ width: 120, opacity: r.is_open ? 1 : 0.5 }} />
                </td>
                <td>
                  <input type="time" value={r.close_time} disabled={!r.is_open}
                    onChange={e => setRow(r.weekday, { close_time: e.target.value })}
                    style={{ width: 120, opacity: r.is_open ? 1 : 0.5 }} />
                </td>
                <td>
                  <input type="number" min={5} max={240} step={5} value={r.slot_interval_minutes}
                    onChange={e => setRow(r.weekday, { slot_interval_minutes: e.target.value === '' ? 0 : Number(e.target.value) })}
                    style={{ width: 90 }} />
                </td>
                <td>
                  <input type="number" min={0} value={r.capacity}
                    onChange={e => setRow(r.weekday, { capacity: e.target.value === '' ? 0 : Number(e.target.value) })}
                    style={{ width: 80 }} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => handleSaveRow(r)}
                    disabled={savingRow === r.weekday || !dirty}>
                    {savingRow === r.weekday ? '...' : 'Simpan'}
                  </button>
                  {msg && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: msg.ok ? '#047857' : 'var(--red)' }}>
                      {msg.ok ? '✓ ' : ''}{msg.text}
                    </span>
                  )}
                  {!msg && dirty && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>belum disimpan</span>}
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
