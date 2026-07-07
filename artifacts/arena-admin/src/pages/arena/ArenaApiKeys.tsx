import React, { useState, useEffect, useCallback } from 'react'
import { supabase, fmtDateTime, useAuth } from '@workspace/admin-shared'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used: string | null
  created_by: string | null
  created_at: string
}

const sha256 = async (text: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const generateApiKey = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const random = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => chars[b % chars.length]).join('')
  return `20fit_live_${random}`
}

export default function ArenaApiKeys() {
  const { user } = useAuth()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('arena_api_keys')
      .select('id, name, key_prefix, is_active, last_used, created_by, created_at')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setKeys((data as ApiKey[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const handleGenerate = async () => {
    if (!newName.trim()) { setError('Nama key wajib diisi'); return }
    setSaving(true)
    setError('')
    const key = generateApiKey()
    const key_hash = await sha256(key)
    const key_prefix = key.substring(0, 16) + '...'
    const { error } = await supabase.from('arena_api_keys').insert({
      name: newName.trim(),
      key_hash,
      key_prefix,
      is_active: true,
      created_by: user?.full_name || user?.email || null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setGeneratedKey(key)
    setNewName('')
    fetchKeys()
  }

  const handleCopy = async () => {
    if (!generatedKey) return
    try {
      await navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Gagal copy ke clipboard')
    }
  }

  const closeCreate = () => {
    setShowCreate(false)
    setGeneratedKey(null)
    setNewName('')
    setError('')
    setCopied(false)
  }

  const toggleActive = async (k: ApiKey) => {
    await supabase
      .from('arena_api_keys')
      .update({ is_active: !k.is_active, updated_at: new Date().toISOString() })
      .eq('id', k.id)
    fetchKeys()
  }

  const handleDelete = async (k: ApiKey) => {
    if (!window.confirm(`Hapus API key "${k.name}"? Sistem yang memakai key ini akan langsung kehilangan akses.`)) return
    await supabase.from('arena_api_keys').delete().eq('id', k.id)
    fetchKeys()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">API Keys</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Generate Key</button>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16, maxWidth: 640 }}>
        API key untuk akses Arena Open API oleh sistem eksternal (member system) — read-only data
        transaksi member. Key hanya ditampilkan sekali saat generate; yang tersimpan di database
        hanya hash-nya.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Key Prefix</th>
              <th>Status</th>
              <th>Terakhir Dipakai</th>
              <th>Dibuat Oleh</th>
              <th>Dibuat</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={7}>Memuat data...</td></tr>
            ) : keys.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">Belum ada API key</td></tr>
            ) : keys.map(k => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{k.key_prefix}</td>
                <td>
                  <span className={`badge ${k.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {k.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {k.last_used ? fmtDateTime(k.last_used) : '—'}
                </td>
                <td style={{ fontSize: 12 }}>{k.created_by || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDateTime(k.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => toggleActive(k)}>
                    {k.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    className="action-btn"
                    style={{ marginLeft: 8, color: 'var(--danger, #C0392B)' }}
                    onClick={() => handleDelete(k)}
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Generate API Key</h3>
              <button onClick={closeCreate} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            {!generatedKey ? (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Nama Key
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: My20FIT Member System"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    style={{ width: '100%' }}
                    autoFocus
                  />
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    Beri nama yang menjelaskan sistem mana yang akan memakai key ini.
                  </p>
                </div>
                {error && <p style={{ color: 'var(--danger, #C0392B)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={closeCreate} disabled={saving}>Batal</button>
                  <button className="btn-primary" onClick={handleGenerate} disabled={saving}>
                    {saving ? 'Membuat...' : 'Generate'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: 'var(--warning-bg, #FFF8E1)',
                  border: '1px solid var(--warning-border, #F0C36D)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: 13,
                  marginBottom: 16,
                  color: 'var(--warning-text, #7A5C00)',
                }}>
                  ⚠️ Simpan key ini sekarang. Key <strong>tidak akan bisa dilihat lagi</strong> setelah
                  jendela ini ditutup — yang tersimpan di database hanya hash-nya.
                </div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  API Key
                </label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input
                    type="text"
                    readOnly
                    value={generatedKey}
                    onFocus={e => e.target.select()}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                  />
                  <button className="btn-secondary" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
                    {copied ? '✓ Tersalin' : 'Copy'}
                  </button>
                </div>
                <div className="modal-footer">
                  <button className="btn-primary" onClick={closeCreate}>Selesai</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
