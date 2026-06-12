import React, { useState, useEffect, useCallback } from 'react'
import { fmtTime } from '../../lib/format'
import ConfirmModal from '../../components/arena/ConfirmModal'
import {
  getSlotsByDate, addSlot, deleteSlot, bulkAddSlots, todayISO, shiftDay,
  type ClinicSlot,
} from '../../lib/clinic'

// Start-time options 07:00 → 21:00, hourly. End auto = start + 1h.
const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i) // 7..21
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const nextHour = (start: string) => hh(parseInt(start.slice(0, 2)) + 1)

const DOW = [
  { idx: 1, label: 'Sen' }, { idx: 2, label: 'Sel' }, { idx: 3, label: 'Rab' },
  { idx: 4, label: 'Kam' }, { idx: 5, label: 'Jum' }, { idx: 6, label: 'Sab' },
  { idx: 0, label: 'Min' },
]

const fmtLongID = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

/** Green / yellow / red by is_active + remaining availability. */
function availabilityStyle(slot: ClinicSlot) {
  const left = slot.quota - slot.booked_count
  if (!slot.is_active) return { color: '#6B7280', label: `Nonaktif — ${slot.booked_count} / ${slot.quota}` }
  if (left <= 0) return { color: '#DC2626', label: `Penuh — 0 / ${slot.quota} tersedia` }
  if (left === 1) return { color: '#D97706', label: `${left} / ${slot.quota} tersedia` }
  return { color: '#059669', label: `${left} / ${slot.quota} tersedia` }
}

export default function ClinicSlots() {
  const [date, setDate] = useState(todayISO)
  const [slots, setSlots] = useState<ClinicSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add-slot form
  const [startTime, setStartTime] = useState('07:00')
  const [quota, setQuota] = useState(3)
  const [saving, setSaving] = useState(false)

  // Bulk add (collapsed by default)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkStart, setBulkStart] = useState(todayISO)
  const [bulkEnd, setBulkEnd] = useState(todayISO)
  const [bulkDays, setBulkDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [bulkTimes, setBulkTimes] = useState<string[]>([])
  const [bulkQuota, setBulkQuota] = useState(3)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<ClinicSlot | null>(null)

  const fetchSlots = useCallback(async () => {
    setLoading(true)
    try {
      setSlots(await getSlotsByDate(date))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat slot')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await addSlot({ slot_date: date, start_time: hh(parseInt(startTime)), end_time: nextHour(startTime), quota })
      setStartTime('07:00'); setQuota(3)
      fetchSlots()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah slot')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (slot: ClinicSlot) => {
    try {
      await deleteSlot(slot.id)
      setConfirmDelete(null); fetchSlots()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus slot')
    }
  }

  const toggleBulkDay = (idx: number) =>
    setBulkDays(d => d.includes(idx) ? d.filter(x => x !== idx) : [...d, idx])
  const toggleBulkTime = (t: string) =>
    setBulkTimes(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t])

  const handleBulkAdd = async () => {
    setBulkMsg('')
    if (bulkDays.length === 0 || bulkTimes.length === 0) {
      setBulkMsg('Pilih minimal satu hari dan satu jam'); return
    }
    if (bulkEnd < bulkStart) { setBulkMsg('Tanggal selesai harus setelah tanggal mulai'); return }
    setBulkSaving(true)
    try {
      const n = await bulkAddSlots({
        startDate: bulkStart, endDate: bulkEnd, daysOfWeek: bulkDays,
        times: bulkTimes.map(t => ({ start_time: hh(parseInt(t)), end_time: nextHour(t) })),
        quota: bulkQuota,
      })
      setBulkMsg(`${n} slot berhasil dibuat`)
      fetchSlots()
    } catch (err) {
      setBulkMsg(err instanceof Error ? err.message : 'Gagal membuat slot')
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Clinic Slots</h2>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* ── Date navigation ──────────────────────────────────────────────────── */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn-secondary" onClick={() => setDate(d => shiftDay(d, -1))} aria-label="Hari sebelumnya">← Sebelumnya</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtLongID(date)}</div>
          {date !== todayISO() && (
            <button
              onClick={() => setDate(todayISO())}
              style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 12, cursor: 'pointer', marginTop: 2 }}
            >
              Kembali ke hari ini
            </button>
          )}
        </div>
        <button className="btn-secondary" onClick={() => setDate(d => shiftDay(d, 1))} aria-label="Hari berikutnya">Berikutnya →</button>
      </div>

      {/* ── Slot list ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        {loading ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Memuat...</div>
        ) : slots.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            Belum ada slot untuk tanggal ini. Tambah slot di bawah.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map(s => {
              const av = availabilityStyle(s)
              return (
                <div
                  key={s.id}
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, minWidth: 90 }}>{fmtTime(s.start_time)} WIB</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: av.color }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: av.color, display: 'inline-block' }} />
                      {av.label}
                    </span>
                  </div>
                  {s.booked_count === 0 ? (
                    <button className="action-btn cancel" onClick={() => setConfirmDelete(s)}>Hapus</button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.booked_count} booking</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add slot ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Tambah Slot</h3>
        <form onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>Tanggal</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Jam Mulai</label>
              <select value={startTime} onChange={e => setStartTime(e.target.value)}>
                {HOURS.map(h => <option key={h} value={hh(h)}>{hh(h)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Jam Selesai</label>
              <input type="text" value={nextHour(startTime)} readOnly disabled style={{ background: '#f3f4f6' }} />
            </div>
            <div className="form-group">
              <label>Kuota</label>
              <input type="number" min={1} value={quota} onChange={e => setQuota(Math.max(1, Number(e.target.value)))} />
            </div>
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Tambah'}
          </button>
        </form>
      </div>

      {/* ── Bulk add (accordion) ─────────────────────────────────────────────── */}
      <div className="card">
        <button
          onClick={() => setBulkOpen(o => !o)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', padding: 0,
          }}
        >
          <span>Buat Slot Massal (Opsional)</span>
          <span style={{ transition: 'transform 0.15s', transform: bulkOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>

        {bulkOpen && (
          <div style={{ marginTop: 16 }}>
            <div className="form-row">
              <div className="form-group">
                <label>Tanggal Mulai</label>
                <input type="date" value={bulkStart} onChange={e => setBulkStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Tanggal Selesai</label>
                <input type="date" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Kuota per Slot</label>
                <input type="number" min={1} value={bulkQuota} onChange={e => setBulkQuota(Math.max(1, Number(e.target.value)))} />
              </div>
            </div>

            <div className="form-group">
              <label>Hari</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DOW.map(d => (
                  <button
                    type="button" key={d.idx} onClick={() => toggleBulkDay(d.idx)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                      border: `1.5px solid ${bulkDays.includes(d.idx) ? 'var(--text-primary)' : 'var(--border)'}`,
                      background: bulkDays.includes(d.idx) ? 'var(--text-primary)' : '#fff',
                      color: bulkDays.includes(d.idx) ? '#fff' : 'var(--text-primary)',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Jam (durasi 1 jam)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {HOURS.map(h => {
                  const t = hh(h)
                  const on = bulkTimes.includes(t)
                  return (
                    <button
                      type="button" key={h} onClick={() => toggleBulkTime(t)}
                      style={{
                        padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        border: `1.5px solid ${on ? 'var(--text-primary)' : 'var(--border)'}`,
                        background: on ? 'var(--text-primary)' : '#fff',
                        color: on ? '#fff' : 'var(--text-primary)',
                      }}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button className="btn-primary" onClick={handleBulkAdd} disabled={bulkSaving}>
                {bulkSaving ? 'Membuat...' : 'Buat Slot Massal'}
              </button>
              {bulkMsg && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{bulkMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Hapus Slot"
          message={`Hapus slot ${fmtTime(confirmDelete.start_time)} – ${fmtTime(confirmDelete.end_time)}?`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  )
}
