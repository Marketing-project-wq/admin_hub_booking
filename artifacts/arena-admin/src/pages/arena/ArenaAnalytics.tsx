import React, { useState, useEffect, useCallback } from 'react'
import { supabase, fmtDateTime, useAuth } from '@workspace/admin-shared'

interface TrackingRow {
  id: string
  key: string
  value: string | null
  is_active: boolean
  description: string | null
  updated_at: string | null
  updated_by: string | null
}

interface TrackerMeta {
  name: string
  label: string
  placeholder: string
  color: string
  glyph: string
}

// Per-tracker presentation keyed by arena_tracking_config.key
const TRACKER_META: Record<string, TrackerMeta> = {
  meta_pixel_id: { name: 'Meta Pixel', label: 'Meta Pixel ID', placeholder: 'XXXXXXXXXXXXXXXXXX', color: '#1877F2', glyph: 'f' },
  gtm_id: { name: 'Google Tag Manager', label: 'GTM Container ID', placeholder: 'GTM-XXXXXXX', color: '#5F6368', glyph: 'G' },
  tiktok_pixel_id: { name: 'TikTok Pixel', label: 'TikTok Pixel ID', placeholder: 'XXXXXXXXXXXXXXXXXX', color: '#010101', glyph: '♪' },
}

const metaFor = (row: TrackingRow): TrackerMeta =>
  TRACKER_META[row.key] || {
    name: row.description || row.key,
    label: 'Value',
    placeholder: '',
    color: '#C0392B',
    glyph: (row.key[0] || '?').toUpperCase(),
  }

type Draft = { value: string; is_active: boolean }

export default function ArenaAnalytics() {
  const { user } = useAuth()
  const [rows, setRows] = useState<TrackingRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase
      .from('arena_tracking_config')
      .select('*')
      .order('key')
    if (err) { setError(err.message); setLoading(false); return }
    const list = (data || []) as TrackingRow[]
    setRows(list)
    const map: Record<string, Draft> = {}
    for (const r of list) map[r.id] = { value: r.value || '', is_active: r.is_active }
    setDrafts(map)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))

  const handleSave = async (row: TrackingRow) => {
    const draft = drafts[row.id]
    if (!draft) return
    setSavingId(row.id); setError('')
    const nowIso = new Date().toISOString()
    const updatedBy = user?.full_name || user?.email || 'admin'
    const nextValue = draft.value.trim() || null
    const { error: err } = await supabase
      .from('arena_tracking_config')
      .update({ value: nextValue, is_active: draft.is_active, updated_at: nowIso, updated_by: updatedBy })
      .eq('id', row.id)
    setSavingId(null)
    if (err) { setError(err.message); return }
    setRows(rs => rs.map(r => r.id === row.id
      ? { ...r, value: nextValue, is_active: draft.is_active, updated_at: nowIso, updated_by: updatedBy }
      : r))
    setSavedId(row.id)
    window.setTimeout(() => setSavedId(s => (s === row.id ? null : s)), 2500)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics &amp; Tracking</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Kelola tracking pixel untuk customer booking app
          </p>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Memuat konfigurasi…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Belum ada konfigurasi tracking.</p>
      ) : (
        <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
          {rows.map(row => {
            const meta = metaFor(row)
            const draft = drafts[row.id] || { value: row.value || '', is_active: row.is_active }
            const isSaving = savingId === row.id
            const isSaved = savedId === row.id
            return (
              <div key={row.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, boxShadow: 'var(--shadow-card)' }}>
                {/* Tracker header + toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: meta.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
                    {meta.glyph}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{meta.name}</div>
                    {row.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</div>}
                  </div>
                  <label className="toggle" style={{ flexShrink: 0 }}>
                    <span className={`toggle-track ${draft.is_active ? 'on' : ''}`}><span className="toggle-thumb" /></span>
                    <input type="checkbox" checked={draft.is_active} onChange={e => patchDraft(row.id, { is_active: e.target.checked })} style={{ display: 'none' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: draft.is_active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {draft.is_active ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>

                {/* Value input */}
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {meta.label}
                    {!draft.is_active && (
                      <span className="badge" style={{ background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Tidak Aktif</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={draft.value}
                    onChange={e => patchDraft(row.id, { value: e.target.value })}
                    placeholder={meta.placeholder}
                    disabled={!draft.is_active}
                    style={{ fontFamily: 'monospace', opacity: draft.is_active ? 1 : 0.55 }}
                  />
                </div>

                {/* Footer: last updated + save */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {row.updated_at
                      ? `Terakhir diupdate: ${fmtDateTime(row.updated_at)} oleh ${row.updated_by || '—'}`
                      : 'Belum pernah diupdate'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isSaved && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Tersimpan</span>}
                    <button className="btn-primary" onClick={() => handleSave(row)} disabled={isSaving}>
                      {isSaving ? 'Menyimpan…' : 'Simpan'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
