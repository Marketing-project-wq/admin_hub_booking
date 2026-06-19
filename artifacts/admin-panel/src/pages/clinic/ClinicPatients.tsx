import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtDate } from '../../lib/format'
import ClinicPatientForm, { type PatientFormValues } from './ClinicPatientForm'
import {
  listPatientsPaged, createPatient, updatePatient, deactivatePatient, listPatientPackages,
  type ClinicPatient, type ClinicPatientPackage,
} from '../../lib/clinic'

const PAGE_SIZE = 20

const GENDER_LABEL: Record<string, string> = { male: 'Laki-laki', female: 'Perempuan', other: 'Lainnya' }
const ID_TYPE_LABEL: Record<string, string> = { nik: 'NIK', ktp: 'KTP', sim: 'SIM', passport: 'Passport' }

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

export default function ClinicPatients() {
  const navigate = useNavigate()

  const [data, setData] = useState<ClinicPatient[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activeOnly, setActiveOnly] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<ClinicPatient | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { rows, count } = await listPatientsPaged({ search, page, pageSize: PAGE_SIZE, activeOnly })
      setData(rows); setTotal(count); setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data pasien')
    } finally {
      setLoading(false)
    }
  }, [search, page, activeOnly])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleCreate = async (values: PatientFormValues) => {
    setSaving(true); setFormError('')
    try {
      await createPatient(values)
      setShowAdd(false); setPage(0); fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pasien')
    } finally { setSaving(false) }
  }

  const handleUpdate = async (values: PatientFormValues) => {
    if (!selected) return
    setSaving(true); setFormError('')
    try {
      await updatePatient(selected.id, values)
      setEditing(false)
      setSelected({ ...selected, ...values })
      fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memperbarui pasien')
    } finally { setSaving(false) }
  }

  const handleDeactivate = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await deactivatePatient(selected.id)
      setConfirmDeactivate(false)
      setSelected({ ...selected, is_active: false })
      fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menonaktifkan pasien')
    } finally { setSaving(false) }
  }

  const closeDetail = () => { setSelected(null); setEditing(false); setFormError(''); setConfirmDeactivate(false) }

  const from = total > 0 ? page * PAGE_SIZE + 1 : 0
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Pasien Clinic</h2>
        <button className="btn-primary" onClick={() => { setFormError(''); setShowAdd(true) }}>+ Tambah Pasien</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode, telepon, email..."
          value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select value={activeOnly ? 'active' : 'all'} onChange={e => { setActiveOnly(e.target.value === 'active'); setPage(0) }}>
          <option value="all">Semua</option>
          <option value="active">Hanya Aktif</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode Pasien</th><th>Nama Lengkap</th><th>Gender</th><th>Usia</th>
              <th>Telepon</th><th>Email</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Tidak ada pasien</td></tr>
            ) : data.map(p => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => { setEditing(false); setFormError(''); setConfirmDeactivate(false); setSelected(p) }}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.patient_code}</td>
                <td style={{ fontWeight: 500 }}>{p.full_name}</td>
                <td>{p.gender ? (GENDER_LABEL[p.gender] || p.gender) : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{ageFromDob(p.date_of_birth)}</td>
                <td>{p.phone}</td>
                <td>{p.email || '-'}</td>
                <td>
                  <span className={`badge ${p.is_active === false ? 'badge-cancelled' : 'badge-confirmed'}`}>
                    {p.is_active === false ? 'Nonaktif' : 'Aktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  <button className="action-btn detail" onClick={() => { setEditing(true); setFormError(''); setConfirmDeactivate(false); setSelected(p) }}>Edit</button>
                  {p.is_active !== false && (
                    <button className="action-btn cancel" onClick={() => { setFormError(''); setEditing(false); setSelected(p); setConfirmDeactivate(true) }}>Nonaktifkan</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>

      {/* ── Add modal ────────────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Tambah Pasien</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <ClinicPatientForm
              onSubmit={handleCreate}
              onCancel={() => setShowAdd(false)}
              saving={saving}
              error={formError}
              submitLabel="Simpan Pasien"
            />
          </div>
        </div>
      )}

      {/* ── Detail / edit modal ──────────────────────────────────────────────── */}
      {selected && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editing ? 'Edit Pasien' : 'Detail Pasien'}</h3>
              <button onClick={closeDetail} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            {editing ? (
              <ClinicPatientForm
                initial={selected}
                onSubmit={handleUpdate}
                onCancel={() => { setEditing(false); setFormError('') }}
                saving={saving}
                error={formError}
                submitLabel="Simpan Perubahan"
              />
            ) : confirmDeactivate ? (
              <>
                <p style={{ fontSize: 14, marginBottom: 8 }}>
                  Nonaktifkan pasien <strong>{selected.full_name}</strong>?
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Pasien tidak akan muncul di daftar aktif, tetapi riwayat kunjungannya tetap tersimpan.
                </p>
                {formError && <p style={{ color: 'var(--red)', fontSize: 13 }}>{formError}</p>}
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setConfirmDeactivate(false)}>Batal</button>
                  <button className="btn-primary" onClick={handleDeactivate} disabled={saving} style={{ background: 'var(--red)' }}>
                    {saving ? 'Memproses...' : 'Ya, Nonaktifkan'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
                  <Field label="Kode Pasien" value={<span style={{ fontFamily: 'monospace' }}>{selected.patient_code}</span>} />
                  <Field label="Nama Lengkap" value={selected.full_name} />
                  <Field label="Status" value={
                    <span className={`badge ${selected.is_active === false ? 'badge-cancelled' : 'badge-confirmed'}`}>
                      {selected.is_active === false ? 'Nonaktif' : 'Aktif'}
                    </span>
                  } />
                  <Field label="Identitas" value={`${ID_TYPE_LABEL[selected.id_type] || selected.id_type} — ${selected.id_number}`} />
                  <Field label="Tanggal Lahir" value={`${fmtDate(selected.date_of_birth)} (${ageFromDob(selected.date_of_birth)})`} />
                  <Field label="Jenis Kelamin" value={selected.gender ? (GENDER_LABEL[selected.gender] || selected.gender) : '-'} />
                  <Field label="Alamat" value={selected.address || '-'} />
                  <Field label="Telepon / WA" value={selected.phone} />
                  <Field label="Email" value={selected.email || '-'} />
                  <Field label="Pekerjaan" value={selected.occupation || '-'} />
                  <Field label="Kontak Darurat" value={
                    selected.emergency_contact_name || selected.emergency_contact_phone
                      ? `${selected.emergency_contact_name || '-'} (${selected.emergency_contact_phone || '-'})`
                      : '-'
                  } />
                  <Field label="Catatan" value={selected.notes || '-'} />
                  <Field label="Terdaftar" value={fmtDate(selected.created_at)} />
                </div>

                <PatientPackagesSection patientId={selected.id} />

                <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
                  <button className="btn-secondary" onClick={() => navigate(`/clinic/visits?patient_id=${selected.id}`)}>
                    Lihat Riwayat Kunjungan
                  </button>
                  <button className="btn-secondary" onClick={closeDetail}>Tutup</button>
                  <button className="btn-primary" onClick={() => { setFormError(''); setEditing(true) }}>Edit Pasien</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </>
  )
}

// ─── Paket Aktif ───────────────────────────────────────────────────────────────
function PatientPackagesSection({ patientId }: { patientId: string }) {
  const [pkgs, setPkgs] = useState<ClinicPatientPackage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    listPatientPackages(patientId, { includeInactive: true })
      .then(r => { if (active) setPkgs(r) })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [patientId])

  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Paket</h4>
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Memuat paket...</p>
      ) : pkgs.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Belum ada paket.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pkgs.map(pp => <PackageCard key={pp.id} pp={pp} />)}
        </div>
      )}
    </div>
  )
}

function PackageCard({ pp }: { pp: ClinicPatientPackage }) {
  const total = pp.total_sessions || 0
  const used = pp.used_sessions || 0
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const active = pp.is_active
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{pp.package?.name ?? 'Paket'}</span>
        <span className="badge" style={active ? { background: '#DCFCE7', color: '#166534' } : { background: '#F3F4F6', color: '#6B7280' }}>
          {active ? 'Aktif' : 'Habis'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
        {used} / {total} sesi terpakai · Sisa {pp.remaining_sessions} sesi
      </div>
      <div style={{ height: 8, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: active ? '#10B981' : '#9CA3AF' }} />
      </div>
    </div>
  )
}
