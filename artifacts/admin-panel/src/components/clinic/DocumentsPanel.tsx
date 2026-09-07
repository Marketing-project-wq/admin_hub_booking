import React, { useCallback, useEffect, useState } from 'react'
import { fmtDateTime } from '../../lib/format'
import {
  listPatientDocuments, uploadDocument, deleteDocument, signedDocUrl,
  isImageDoc, docIcon, docCategoryLabel, humanFileSize,
  DOC_CATEGORIES, DOC_ACCEPT,
  type ClinicDocument,
} from '../../lib/clinicDocuments'

// Panel Dokumen pasien — upload + daftar + buka + hapus. Reusable:
//   • tab "Document" di modal EMR ClinicDokter (patientId + visitId)
//   • halaman "Dokumen" (ClinicDocuments) untuk admin/kasir/registrasi (patientId saja)
// Bucket privat → signed URL untuk thumbnail & buka. Pola storage = PostureScanPanel.

export default function DocumentsPanel({ patientId, visitId = null, uploadedBy = null }: {
  patientId: string | null
  visitId?: string | null
  uploadedBy?: string | null
}) {
  const [docs, setDocs] = useState<ClinicDocument[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({}) // id → signed URL (gambar saja)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form upload
  const [category, setCategory] = useState('umum')
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState('')          // teks progress; '' = idle
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!patientId) { setDocs([]); setThumbs({}); return }
    setLoading(true)
    setError('')
    try {
      const rows = await listPatientDocuments(patientId)
      setDocs(rows)
      // Signed URL hanya untuk gambar (thumbnail). File lain dibuka on-demand.
      const pairs = await Promise.all(
        rows.filter(isImageDoc).map(async r => [r.id, await signedDocUrl(r.file_path)] as const),
      )
      const map: Record<string, string> = {}
      for (const [id, url] of pairs) if (url) map[id] = url
      setThumbs(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat dokumen')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!patientId) { setError('Pasien belum dipilih.'); return }
    setError('')
    const list = Array.from(files)
    try {
      for (let i = 0; i < list.length; i++) {
        setUploading(list.length > 1 ? `Mengunggah ${i + 1}/${list.length}…` : 'Mengunggah…')
        await uploadDocument({
          patientId, visitId, category,
          title: title.trim() || null,
          file: list[i],
          uploadedBy,
        })
      }
      setTitle('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengunggah dokumen')
    } finally {
      setUploading('')
    }
  }

  const openDoc = async (doc: ClinicDocument) => {
    // Buka tab dulu (sinkron dgn gesture klik → tidak diblok popup), lalu isi URL.
    const w = window.open('', '_blank')
    const url = await signedDocUrl(doc.file_path)
    if (!url) { if (w) w.close(); setError('Gagal membuka dokumen'); return }
    if (w) w.location.href = url
    else window.open(url, '_blank')
  }

  const doDelete = async (doc: ClinicDocument) => {
    setDeletingId(doc.id)
    setError('')
    try {
      await deleteDocument(doc)
      setConfirmDeleteId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus dokumen')
    } finally {
      setDeletingId(null)
    }
  }

  if (!patientId) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Pilih pasien untuk melihat &amp; mengunggah dokumen.</p>
  }

  return (
    <div>
      {/* ── Form upload ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--bg-elevated)', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Kategori</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={fieldStyle}>
              {DOC_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '2 1 240px', minWidth: 200 }}>
            <label style={labelStyle}>Keterangan (opsional)</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="mis. Hasil MRI lumbal 2026" style={fieldStyle} />
          </div>
          <div style={{ flexShrink: 0 }}>
            <label className="btn-primary" style={{ width: 'auto', padding: '9px 16px', cursor: uploading ? 'default' : 'pointer', display: 'inline-block', opacity: uploading ? 0.6 : 1 }}>
              {uploading || '⬆ Pilih & Unggah'}
              <input type="file" accept={DOC_ACCEPT} multiple disabled={!!uploading} style={{ display: 'none' }}
                onChange={e => { onPick(e.target.files); e.target.value = '' }} />
            </label>
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
          Gambar, PDF, atau dokumen (doc/docx/xls/xlsx/txt) — maks 20 MB per file. Bisa pilih beberapa file sekaligus.
          Untuk <strong>Foto Postur</strong>, pilih kategori “Foto Postur” lalu unggah foto depan/belakang.
        </p>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* ── Daftar dokumen ── */}
      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 30 }}>Memuat dokumen…</p>
      ) : docs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 36, border: '1px dashed var(--border-strong)', borderRadius: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
          <div style={{ fontSize: 13 }}>Belum ada dokumen untuk pasien ini.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {docs.map(d => {
            const img = thumbs[d.id]
            const fromThisVisit = !!visitId && d.visit_id === visitId
            return (
              <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <button type="button" onClick={() => openDoc(d)} title="Buka dokumen"
                  style={{ border: 'none', padding: 0, cursor: 'pointer', background: '#000', height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {img
                    ? <img src={img} alt={d.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <span style={{ fontSize: 46 }}>{docIcon(d)}</span>}
                </button>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 10 }}>{docCategoryLabel(d.category)}</span>
                    {fromThisVisit && <span className="badge" style={{ background: 'rgba(29,78,216,0.15)', color: '#1D4ED8', fontSize: 10 }}>Kunjungan ini</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                    {d.title || d.file_name}
                  </div>
                  {d.title && <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word' }}>{d.file_name}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {humanFileSize(d.file_size)}{d.file_size ? ' · ' : ''}{fmtDateTime(d.created_at)}
                  </div>
                  {d.uploaded_by && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>oleh {d.uploaded_by}</div>}

                  <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '5px 12px', fontSize: 12, flex: 1 }} onClick={() => openDoc(d)}>Buka</button>
                    {confirmDeleteId === d.id ? (
                      <>
                        <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '5px 10px', fontSize: 12, color: 'var(--red)', borderColor: 'var(--red)' }}
                          disabled={deletingId === d.id} onClick={() => doDelete(d)}>
                          {deletingId === d.id ? '…' : 'Ya'}
                        </button>
                        <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                          disabled={deletingId === d.id} onClick={() => setConfirmDeleteId(null)}>Batal</button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }} title="Hapus dokumen"
                        onClick={() => setConfirmDeleteId(d.id)}>🗑</button>
                    )}
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

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4,
}
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border-strong)', borderRadius: 8,
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--bg-card)', color: 'var(--text-primary)',
}
