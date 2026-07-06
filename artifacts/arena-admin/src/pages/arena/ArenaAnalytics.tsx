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

// Brand presentation for a tracker card (keyed by the "anchor" row key)
const BRAND: Record<string, { name: string; color: string; glyph: string }> = {
  meta_pixel_id: { name: 'Meta Pixel', color: '#1877F2', glyph: 'f' },
  gtm_id: { name: 'Google Tag Manager', color: '#5F6368', glyph: 'G' },
  tiktok_pixel_id: { name: 'TikTok Pixel', color: '#010101', glyph: '♪' },
}

// Field-level presentation keyed by arena_tracking_config.key
const FIELD: Record<string, { label: string; placeholder: string; password?: boolean; help?: string }> = {
  meta_pixel_id: { label: 'Meta Pixel ID', placeholder: 'XXXXXXXXXXXXXXXXXX' },
  meta_capi_access_token: { label: 'CAPI Access Token', placeholder: 'EAAxxxxxxxx...', password: true, help: 'Dari Meta Business Manager → Settings → Conversions API' },
  meta_capi_test_event_code: { label: 'Test Event Code', placeholder: 'TEST12345', help: 'Opsional — hanya untuk testing di Meta Events Manager' },
  gtm_id: { label: 'GTM Container ID', placeholder: 'GTM-XXXXXXX' },
  tiktok_pixel_id: { label: 'TikTok Pixel ID', placeholder: 'XXXXXXXXXXXXXXXXXX' },
}

// The 3 rows managed together in the Meta card (anchored by meta_pixel_id)
const META_KEYS = ['meta_pixel_id', 'meta_capi_access_token', 'meta_capi_test_event_code']

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, boxShadow: 'var(--shadow-card)',
}
const neutralBadge: React.CSSProperties = {
  background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)',
}
const iconStyle = (color: string): React.CSSProperties => ({
  width: 40, height: 40, borderRadius: 8, background: color, color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, flexShrink: 0,
})

type Draft = { value: string; is_active: boolean }

export default function ArenaAnalytics() {
  const { user } = useAuth()
  const [rows, setRows] = useState<TrackingRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [showToken, setShowToken] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

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

  const draftOf = (row: TrackingRow): Draft => drafts[row.id] || { value: row.value || '', is_active: row.is_active }

  const lastUpdatedText = (list: TrackingRow[]) => {
    const dated = list.filter(r => r.updated_at)
    if (dated.length === 0) return 'Belum pernah diupdate'
    const latest = dated.reduce((a, b) => (a.updated_at! > b.updated_at! ? a : b))
    return `Terakhir diupdate: ${fmtDateTime(latest.updated_at)} oleh ${latest.updated_by || '—'}`
  }

  // Save one or more rows at once (Meta card saves all 3 Meta rows together)
  const saveRows = async (groupKey: string, groupRows: TrackingRow[]) => {
    setSavingKey(groupKey); setError('')
    const nowIso = new Date().toISOString()
    const updatedBy = user?.full_name || user?.email || 'admin'
    const payloads = groupRows.map(row => {
      const draft = draftOf(row)
      return { id: row.id, value: draft.value.trim() || null, is_active: draft.is_active }
    })
    const results = await Promise.all(payloads.map(p =>
      supabase
        .from('arena_tracking_config')
        .update({ value: p.value, is_active: p.is_active, updated_at: nowIso, updated_by: updatedBy })
        .eq('id', p.id)
        .then(res => res.error)
    ))
    setSavingKey(null)
    const firstErr = results.find(Boolean)
    if (firstErr) { setError(firstErr.message); return }
    setRows(rs => rs.map(r => {
      const p = payloads.find(x => x.id === r.id)
      return p ? { ...r, value: p.value, is_active: p.is_active, updated_at: nowIso, updated_by: updatedBy } : r
    }))
    setSavedKey(groupKey)
    window.setTimeout(() => setSavedKey(k => (k === groupKey ? null : k)), 2500)
  }

  const renderToggle = (row: TrackingRow) => {
    const draft = draftOf(row)
    return (
      <label className="toggle" style={{ flexShrink: 0 }}>
        <span className={`toggle-track ${draft.is_active ? 'on' : ''}`}><span className="toggle-thumb" /></span>
        <input type="checkbox" checked={draft.is_active} onChange={e => patchDraft(row.id, { is_active: e.target.checked })} style={{ display: 'none' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: draft.is_active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {draft.is_active ? 'ON' : 'OFF'}
        </span>
      </label>
    )
  }

  const renderInput = (row: TrackingRow) => {
    const draft = draftOf(row)
    const field = FIELD[row.key] || { label: 'Value', placeholder: '' }
    const isPw = !!field.password
    const show = !!showToken[row.id]
    const inputEl = (
      <input
        type={isPw && !show ? 'password' : 'text'}
        value={draft.value}
        onChange={e => patchDraft(row.id, { value: e.target.value })}
        placeholder={field.placeholder}
        disabled={!draft.is_active}
        style={{ width: '100%', fontFamily: 'monospace', opacity: draft.is_active ? 1 : 0.55, ...(isPw ? { paddingRight: 92 } : null) }}
      />
    )
    if (!isPw) return inputEl
    return (
      <div style={{ position: 'relative' }}>
        {inputEl}
        <button
          type="button"
          onClick={() => setShowToken(s => ({ ...s, [row.id]: !s[row.id] }))}
          disabled={!draft.is_active}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12,
            cursor: draft.is_active ? 'pointer' : 'default', padding: 4, fontFamily: 'inherit',
          }}
        >
          {show ? 'Sembunyikan' : 'Lihat'}
        </button>
      </div>
    )
  }

  // A CAPI sub-field: its own inline toggle + labelled input + helper text
  const renderCapiField = (row: TrackingRow) => {
    const draft = draftOf(row)
    const field = FIELD[row.key] || { label: 'Value', placeholder: '' }
    return (
      <div key={row.id} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            {field.label}
            {!draft.is_active && <span className="badge" style={neutralBadge}>Tidak Aktif</span>}
          </span>
          {renderToggle(row)}
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          {renderInput(row)}
        </div>
        {field.help && <small style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{field.help}</small>}
      </div>
    )
  }

  const renderFooter = (groupKey: string, groupRows: TrackingRow[]) => {
    const isSaving = savingKey === groupKey
    const isSaved = savedKey === groupKey
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{lastUpdatedText(groupRows)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isSaved && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Tersimpan</span>}
          <button className="btn-primary" onClick={() => saveRows(groupKey, groupRows)} disabled={isSaving}>
            {isSaving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    )
  }

  // Composite Meta card: Pixel ID + Conversions API (CAPI) fields, one Save for all
  const renderMetaCard = (byKey: Record<string, TrackingRow>) => {
    const pixel = byKey.meta_pixel_id
    const capiToken = byKey.meta_capi_access_token
    const capiTest = byKey.meta_capi_test_event_code
    const brand = BRAND.meta_pixel_id
    const pixelDraft = draftOf(pixel)
    const metaRows = [pixel, capiToken, capiTest].filter(Boolean) as TrackingRow[]
    return (
      <div key="meta" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={iconStyle(brand.color)}>{brand.glyph}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{brand.name}</div>
            {pixel.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pixel.description}</div>}
          </div>
          {renderToggle(pixel)}
        </div>

        <div className="form-group" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {FIELD.meta_pixel_id.label}
            {!pixelDraft.is_active && <span className="badge" style={neutralBadge}>Tidak Aktif</span>}
          </label>
          {renderInput(pixel)}
        </div>

        {(capiToken || capiTest) && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 14 }}>
              Conversions API (CAPI)
            </div>
            {capiToken && renderCapiField(capiToken)}
            {capiTest && renderCapiField(capiTest)}
          </div>
        )}

        {renderFooter('meta', metaRows)}
      </div>
    )
  }

  // Single-field card (GTM, TikTok, or any other tracker)
  const renderSingleCard = (row: TrackingRow) => {
    const brand = BRAND[row.key] || { name: row.description || row.key, color: '#C0392B', glyph: (row.key[0] || '?').toUpperCase() }
    const field = FIELD[row.key] || { label: 'Value', placeholder: '' }
    const draft = draftOf(row)
    return (
      <div key={row.id} style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={iconStyle(brand.color)}>{brand.glyph}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{brand.name}</div>
            {row.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</div>}
          </div>
          {renderToggle(row)}
        </div>
        <div className="form-group" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {field.label}
            {!draft.is_active && <span className="badge" style={neutralBadge}>Tidak Aktif</span>}
          </label>
          {renderInput(row)}
        </div>
        {renderFooter(row.key, [row])}
      </div>
    )
  }

  const byKey: Record<string, TrackingRow> = {}
  for (const r of rows) byKey[r.key] = r
  const hasMeta = !!byKey.meta_pixel_id
  const singleRows = rows.filter(r => !(hasMeta && META_KEYS.includes(r.key)))

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
          {hasMeta && renderMetaCard(byKey)}
          {singleRows.map(renderSingleCard)}
        </div>
      )}
    </div>
  )
}
