import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { fmtDate } from '../../lib/format'
import { listPatients, type ClinicPatient } from '../../lib/clinic'
import DocumentsPanel from '../../components/clinic/DocumentsPanel'

// Menu "Dokumen" (admin/kasir/registrasi): cari pasien → unggah & kelola dokumen
// (PDF/gambar/dokumen) termasuk kategori "Foto Postur". Dokumen tersimpan per pasien
// dan tampil juga di tab "Document" pada modal EMR dokter. Layout dua-panel meniru
// tab Riwayat Pasien pada Panel Dokter.

const ageFromDob = (dob: string | null): string => {
  if (!dob) return '-'
  const d = new Date(dob)
  if (isNaN(d.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const mo = now.getMonth() - d.getMonth()
  if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--
  return `${age} th`
}

export default function ClinicDocuments() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClinicPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ClinicPatient | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  const handleQuery = (val: string) => {
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await listPatients(val.trim()))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pencarian gagal')
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Dokumen Pasien</h2>
        {user?.full_name && (
          <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{user.full_name}</span>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: -6, marginBottom: 14 }}>
        Cari pasien lalu unggah dokumen (hasil lab, rujukan, resep, identitas, foto postur, dll). File tampil juga di rekam medis dokter.
      </p>

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, No. identitas, atau nomor HP…"
          value={query} onChange={e => handleQuery(e.target.value)} style={{ minWidth: 300 }}
        />
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Hasil pencarian */}
        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          {searching ? (
            <p style={{ color: 'var(--text-muted)' }}>Mencari…</p>
          ) : results.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{query.trim() ? 'Tidak ada pasien ditemukan.' : 'Ketik untuk mencari pasien.'}</p>
          ) : results.map(p => (
            <div key={p.id} onClick={() => setSelected(p)}
              style={{
                background: selected?.id === p.id ? 'rgba(192,57,43,0.12)' : 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderLeft: selected?.id === p.id ? '4px solid var(--red)' : '1px solid var(--border)',
                borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer',
              }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <span style={{ fontFamily: 'monospace' }}>{p.patient_code}</span> · {p.phone} · {ageFromDob(p.date_of_birth)}
              </div>
            </div>
          ))}
        </div>

        {/* Panel dokumen pasien terpilih */}
        <div style={{ flex: '2 1 420px', minWidth: 300 }}>
          {!selected ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px dashed var(--border-strong)', borderRadius: 12 }}>
              Pilih pasien untuk mengelola dokumen
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{selected.full_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px 16px', fontSize: 13, marginTop: 8, marginBottom: 16 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>Kode: </span><span style={{ fontFamily: 'monospace' }}>{selected.patient_code}</span></div>
                <div><span style={{ color: 'var(--text-muted)' }}>HP: </span>{selected.phone}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Tgl Lahir: </span>{fmtDate(selected.date_of_birth)} ({ageFromDob(selected.date_of_birth)})</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Gender: </span>{selected.gender || '-'}</div>
              </div>
              <DocumentsPanel patientId={selected.id} uploadedBy={user?.full_name ?? null} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
