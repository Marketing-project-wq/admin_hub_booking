import React, { useState, useEffect, useCallback } from 'react'
import { fmtDateTime } from '@workspace/admin-shared'
import { useAuth } from '@workspace/admin-shared'
import {
  listClinicUsers, createClinicUser, updateClinicUserPermissions,
  toggleClinicUserActive, resetClinicUserPassword,
  type ClinicUser,
} from '../../lib/clinic'

const PERMISSION_KEYS: { key: string; label: string }[] = [
  { key: 'can_checkin', label: 'Check-in pasien' },
  { key: 'can_screening', label: 'Isi screening' },
  { key: 'can_consent', label: 'Isi consent' },
  { key: 'can_assessment', label: 'Isi assessment' },
  { key: 'can_payment', label: 'Input payment' },
  { key: 'can_manage_slots', label: 'Kelola slot' },
  { key: 'can_manage_patients', label: 'Kelola data pasien' },
  { key: 'can_view_reports', label: 'Lihat laporan' },
  { key: 'can_manage_users', label: 'Kelola users' },
]

const ROLE_OPTIONS = ['dokter', 'therapist', 'registrasi', 'admin']

const allPerms = (val: boolean): Record<string, boolean> =>
  Object.fromEntries(PERMISSION_KEYS.map(p => [p.key, val]))

function presetFor(role: string): Record<string, boolean> {
  if (role === 'dokter') return allPerms(true)
  if (role === 'therapist') return { ...allPerms(false), can_checkin: true, can_screening: true, can_consent: true, can_assessment: true }
  if (role === 'registrasi') return { ...allPerms(false), can_checkin: true, can_screening: true, can_consent: true, can_payment: true, can_manage_patients: true }
  if (role === 'admin') return Object.fromEntries(PERMISSION_KEYS.map(p => [p.key, p.key !== 'can_manage_users']))
  return allPerms(false)
}

function roleBadgeStyle(role: string): React.CSSProperties {
  switch (role) {
    case 'super_admin': return { background: '#111827', color: '#fff' }
    case 'dokter': return { background: '#DBEAFE', color: '#1D4ED8' }
    case 'therapist': return { background: '#D1FAE5', color: '#065F46' }
    case 'registrasi': return { background: '#F3F4F6', color: '#6B7280' }
    default: return { background: '#F3F4F6', color: '#374151' }
  }
}

export default function ClinicUserManagement() {
  const { user, hasPermission } = useAuth()
  const [data, setData] = useState<ClinicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState<ClinicUser | null>(null)
  const [resetUser, setResetUser] = useState<ClinicUser | null>(null)

  const allowed = user?.role === 'super_admin' || hasPermission('can_manage_users')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listClinicUsers())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data user')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) fetchData() }, [allowed, fetchData])

  if (!allowed) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        🔒 Anda tidak memiliki akses untuk mengelola users.
      </div>
    )
  }

  const handleToggle = async (u: ClinicUser) => {
    try { await toggleClinicUserActive(u.id, !u.is_active); fetchData() }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal mengubah status') }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Kelola Users Clinic</h2>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Tambah User</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Login Terakhir</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={6}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">Belum ada user clinic</td></tr>
            ) : data.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                <td>{u.email}</td>
                <td><span className="badge" style={roleBadgeStyle(u.role)}>{u.role}</span></td>
                <td>
                  <span className={`badge ${u.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {u.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => setEditUser(u)}>Edit</button>
                  <button className="action-btn" onClick={() => setResetUser(u)}>Reset Password</button>
                  <button className={`action-btn ${u.is_active ? 'cancel' : 'confirm'}`} onClick={() => handleToggle(u)}>
                    {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchData() }} />}
      {editUser && <EditPermissionsModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); fetchData() }} />}
      {resetUser && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onSaved={() => setResetUser(null)} />}
    </div>
  )
}

// ─── Permission checkbox grid ─────────────────────────────────────────────────
function PermissionGrid({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
      {PERMISSION_KEYS.map(p => (
        <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value[p.key] === true} onChange={e => onChange({ ...value, [p.key]: e.target.checked })} style={{ width: 'auto' }} />
          {p.label}
        </label>
      ))}
    </div>
  )
}

function ModalShell({ title, onClose, children, maxWidth = 560 }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Add user ─────────────────────────────────────────────────────────────────
function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('registrasi')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [permissions, setPermissions] = useState<Record<string, boolean>>(presetFor('registrasi'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onRoleChange = (r: string) => { setRole(r); setPermissions(presetFor(r)) }

  const handleSave = async () => {
    setError('')
    if (!fullName.trim()) { setError('Nama wajib diisi'); return }
    if (!email.trim()) { setError('Email wajib diisi'); return }
    if (password.length < 8) { setError('Password minimal 8 karakter'); return }
    setSaving(true)
    try {
      await createClinicUser({ email: email.trim(), full_name: fullName.trim(), role, password, permissions })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Tambah User" onClose={onClose}>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="form-row">
        <div className="form-group"><label>Nama Lengkap *</label><input type="text" value={fullName} onChange={e => setFullName(e.target.value)} /></div>
        <div className="form-group"><label>Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Role *</label>
          <select value={role} onChange={e => onRoleChange(e.target.value)}>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Password * (min. 8)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} style={{ flex: 1 }} />
            <button type="button" className="btn-secondary" onClick={() => setShowPwd(s => !s)}>{showPwd ? 'Sembunyikan' : 'Lihat'}</button>
          </div>
        </div>
      </div>
      <div className="form-group">
        <label>Permissions</label>
        <PermissionGrid value={permissions} onChange={setPermissions} />
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan User'}</button>
      </div>
    </ModalShell>
  )
}

// ─── Edit permissions ─────────────────────────────────────────────────────────
function EditPermissionsModal({ user, onClose, onSaved }: { user: ClinicUser; onClose: () => void; onSaved: () => void }) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({ ...allPerms(false), ...(user.permissions ?? {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    try { await updateClinicUserPermissions(user.id, permissions); onSaved() }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal menyimpan permissions') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title={`Edit Permissions — ${user.full_name}`} onClose={onClose}>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="form-group">
        <label>Role: <strong>{user.role}</strong></label>
        <PermissionGrid value={permissions} onChange={setPermissions} />
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
      </div>
    </ModalShell>
  )
}

// ─── Reset password ───────────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose, onSaved }: { user: ClinicUser; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSave = async () => {
    setError('')
    if (password.length < 8) { setError('Password minimal 8 karakter'); return }
    setSaving(true)
    try { await resetClinicUserPassword(user.id, password); setDone(true); window.setTimeout(onSaved, 900) }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal reset password') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title={`Reset Password — ${user.full_name}`} onClose={onClose} maxWidth={420}>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {done ? (
        <p style={{ color: '#065F46', fontWeight: 600 }}>✓ Password berhasil direset.</p>
      ) : (
        <>
          <div className="form-group">
            <label>Password Baru (min. 8)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn-secondary" onClick={() => setShowPwd(s => !s)}>{showPwd ? 'Sembunyikan' : 'Lihat'}</button>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>Batal</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Memproses...' : 'Reset Password'}</button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
