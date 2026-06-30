import React, { useState } from 'react'
import type { PatientPayload } from '../../lib/clinic'

export type PatientFormValues = PatientPayload

const empty = (initial?: Partial<PatientFormValues>): PatientFormValues => ({
  id_type: initial?.id_type ?? 'nik',
  id_number: initial?.id_number ?? '',
  full_name: initial?.full_name ?? '',
  date_of_birth: initial?.date_of_birth ?? '',
  gender: initial?.gender ?? '',
  address: initial?.address ?? '',
  phone: initial?.phone ?? '',
  email: initial?.email ?? '',
  occupation: initial?.occupation ?? '',
  emergency_contact_name: initial?.emergency_contact_name ?? '',
  emergency_contact_phone: initial?.emergency_contact_phone ?? '',
  notes: initial?.notes ?? '',
})

/** Age in whole years from a YYYY-MM-DD date of birth. */
function ageFromDob(dob: string | null): string {
  if (!dob) return '-'
  const b = new Date(dob + 'T00:00:00')
  if (isNaN(b.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age >= 0 ? `${age} tahun` : '-'
}

interface Props {
  initial?: Partial<PatientFormValues>
  onSubmit: (values: PatientFormValues) => void | Promise<void>
  onCancel?: () => void
  saving?: boolean
  submitLabel?: string
  error?: string
}

export default function ClinicPatientForm({ initial, onSubmit, onCancel, saving, submitLabel = 'Simpan', error }: Props) {
  const [v, setV] = useState<PatientFormValues>(() => empty(initial))
  const [localError, setLocalError] = useState('')

  const set = <K extends keyof PatientFormValues>(key: K, val: PatientFormValues[K]) =>
    setV(prev => ({ ...prev, [key]: val }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    if (!v.id_number.trim()) return setLocalError('Nomor identitas wajib diisi')
    if (!v.full_name.trim()) return setLocalError('Nama lengkap wajib diisi')
    if (!v.date_of_birth) return setLocalError('Tanggal lahir wajib diisi')
    if (!v.gender) return setLocalError('Jenis kelamin wajib dipilih')
    if (!v.phone.trim()) return setLocalError('Nomor telepon wajib diisi')
    onSubmit({
      ...v,
      // normalise empty strings to null for optional columns
      email: v.email?.trim() || null,
      address: v.address?.trim() || null,
      occupation: v.occupation?.trim() || null,
      emergency_contact_name: v.emergency_contact_name?.trim() || null,
      emergency_contact_phone: v.emergency_contact_phone?.trim() || null,
      notes: v.notes?.trim() || null,
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      {(error || localError) && (
        <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error || localError}</p>
      )}

      <div className="form-row">
        <div className="form-group">
          <label>Jenis Identitas *</label>
          <select value={v.id_type} onChange={e => set('id_type', e.target.value)}>
            <option value="nik">NIK</option>
            <option value="passport">Passport</option>
          </select>
        </div>
        <div className="form-group">
          <label>Nomor Identitas *</label>
          <input type="text" value={v.id_number} onChange={e => set('id_number', e.target.value)} required />
        </div>
      </div>

      <div className="form-group">
        <label>Nama Lengkap *</label>
        <input type="text" value={v.full_name} onChange={e => set('full_name', e.target.value)} required />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Tanggal Lahir *</label>
          <input type="date" value={v.date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Usia</label>
          <input type="text" value={ageFromDob(v.date_of_birth)} readOnly disabled style={{ background: '#f3f4f6' }} />
        </div>
      </div>

      <div className="form-group">
        <label>Jenis Kelamin *</label>
        <div style={{ display: 'flex', gap: 20, paddingTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, cursor: 'pointer' }}>
            <input type="radio" name="gender" checked={v.gender === 'male'} onChange={() => set('gender', 'male')} />
            Laki-laki
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, cursor: 'pointer' }}>
            <input type="radio" name="gender" checked={v.gender === 'female'} onChange={() => set('gender', 'female')} />
            Perempuan
          </label>
        </div>
      </div>

      <div className="form-group">
        <label>Alamat Domisili</label>
        <textarea value={v.address ?? ''} onChange={e => set('address', e.target.value)} rows={2} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Nomor Telepon / WhatsApp *</label>
          <input type="text" value={v.phone} onChange={e => set('phone', e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={v.email ?? ''} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Pekerjaan / Profesi</label>
        <input type="text" value={v.occupation ?? ''} onChange={e => set('occupation', e.target.value)} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Kontak Darurat - Nama</label>
          <input type="text" value={v.emergency_contact_name ?? ''} onChange={e => set('emergency_contact_name', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Kontak Darurat - No. HP</label>
          <input type="text" value={v.emergency_contact_phone ?? ''} onChange={e => set('emergency_contact_phone', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Catatan</label>
        <textarea value={v.notes ?? ''} onChange={e => set('notes', e.target.value)} rows={2} />
      </div>

      <div className="modal-footer">
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Batal</button>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Menyimpan...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
