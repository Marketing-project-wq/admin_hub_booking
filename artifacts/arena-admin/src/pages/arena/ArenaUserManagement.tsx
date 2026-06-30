import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtDateTime } from '@workspace/admin-shared'

interface AdminUser {
  id: string; email: string; full_name: string; role: string; unit: string | null;
  permissions: Record<string, boolean>; is_active: boolean;
  last_login_at: string | null; created_at: string;
}

const PERMISSION_KEYS = [
  { key: 'dashboard.view',  label: 'Lihat Dashboard' },
  { key: 'bookings.view',   label: 'Lihat Bookings' },
  { key: 'bookings.edit',   label: 'Edit / Confirm / Cancel Booking' },
  { key: 'bookings.create', label: 'Buat Manual Booking' },
  { key: 'venue.view',      label: 'Lihat Venue Booking' },
  { key: 'venue.edit',      label: 'Edit Venue Booking' },
  { key: 'vouchers.view',   label: 'Lihat Vouchers' },
  { key: 'vouchers.edit',   label: 'Buat / Edit Voucher' },
  { key: 'packages.view',   label: 'Lihat Package Orders' },
  { key: 'schedules.view',  label: 'Lihat Schedules' },
  { key: 'schedules.edit',  label: 'Tambah / Edit / Cancel Schedule' },
  { key: 'master.view',     label: 'Lihat Master Data' },
  { key: 'master.edit',     label: 'Edit Master Data (Units, Class Types, Coaches, Addons)' },
]

const emptyAddForm = () => ({ fullName: '', email: '', role: 'staff', password: '', confirmPassword: '' })

export default function ArenaUserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [permUser, setPermUser] = useState<AdminUser | null>(null)

  // Form states
  const [addForm, setAddForm] = useState(emptyAddForm())
  const [editForm, setEditForm] = useState({ fullName: '', role: 'staff', isActive: true })
  const [resetForm, setResetForm] = useState({ password: '', confirmPassword: '' })
  const [perms, setPerms] = useState<Record<string, boolean>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Auto-dismiss success banner
  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(t)
  }, [success])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('get_admin_users', { p_unit: 'arena' })
    if (err) setError(err.message)
    else setUsers((data || []) as AdminUser[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = users.filter(u => {
    if (search) {
      const q = search.toLowerCase()
      if (!u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
    }
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (statusFilter === 'active' && !u.is_active) return false
    if (statusFilter === 'inactive' && u.is_active) return false
    return true
  })

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (addForm.password !== addForm.confirmPassword) return setFormError('Password tidak cocok')
    if (addForm.password.length < 8) return setFormError('Password minimal 8 karakter')
    setSubmitting(true)
    const { error: err } = await supabase.rpc('create_admin_user', {
      p_email: addForm.email.toLowerCase().trim(),
      p_full_name: addForm.fullName.trim(),
      p_role: addForm.role,
      p_unit: 'arena',
      p_password: addForm.password,
      p_permissions: {},
    })
    setSubmitting(false)
    if (err) {
      setFormError(err.message.includes('duplicate') ? 'Email sudah terdaftar' : err.message)
      return
    }
    setShowAddModal(false)
    setAddForm(emptyAddForm())
    setSuccess(`User ${addForm.email} berhasil dibuat`)
    fetchUsers()
  }

  const openEdit = (u: AdminUser) => {
    setEditForm({ fullName: u.full_name, role: u.role, isActive: u.is_active })
    setFormError('')
    setEditUser(u)
  }

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    const { error: err } = await supabase.rpc('update_admin_user', {
      p_user_id: editUser!.id,
      p_full_name: editForm.fullName.trim(),
      p_role: editForm.role,
      p_is_active: editForm.isActive,
    })
    setSubmitting(false)
    if (err) { setFormError(err.message); return }
    setEditUser(null)
    setSuccess('User berhasil diupdate')
    fetchUsers()
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (resetForm.password !== resetForm.confirmPassword) return setFormError('Password tidak cocok')
    if (resetForm.password.length < 8) return setFormError('Password minimal 8 karakter')
    setSubmitting(true)
    const { error: err } = await supabase.rpc('set_admin_password', {
      p_user_id: resetUser!.id,
      p_new_password: resetForm.password,
    })
    setSubmitting(false)
    if (err) { setFormError(err.message); return }
    setResetUser(null)
    setResetForm({ password: '', confirmPassword: '' })
    setSuccess(`Password ${resetUser!.full_name} berhasil direset`)
  }

  const openPerms = (u: AdminUser) => {
    setPerms(u.permissions || {})
    setFormError('')
    setPermUser(u)
  }

  const togglePerm = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }))
  const selectAll = () => { const all: Record<string, boolean> = {}; PERMISSION_KEYS.forEach(p => { all[p.key] = true }); setPerms(all) }
  const clearAll = () => setPerms({})

  const handleSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    const { error: err } = await supabase.rpc('update_admin_permissions', {
      p_user_id: permUser!.id,
      p_permissions: perms,
    })
    setSubmitting(false)
    if (err) { setFormError(err.message); return }
    setPermUser(null)
    setSuccess(`Permissions ${permUser!.full_name} berhasil disimpan`)
    fetchUsers()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">User Management</h2>
        <button className="btn-primary" onClick={() => { setAddForm(emptyAddForm()); setFormError(''); setShowAddModal(true) }}>
          + Tambah User
        </button>
      </div>

      {success && (
        <div style={{ background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 6, padding: '10px 16px', marginBottom: 16, color: '#065F46', fontSize: 13 }}>
          ✓ {success}
        </div>
      )}
      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 6, padding: '10px 16px', marginBottom: 16, color: '#991B1B', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama / email..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">Semua Role</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="staff">Staff</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
          <option value="all">Semua Status</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={6}>Memuat data...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">Tidak ada user ditemukan</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.full_name}</div>
                  {u.role === 'super_admin' && (
                    <div style={{ fontSize: 11, color: 'var(--red)' }}>SUPER ADMIN</div>
                  )}
                </td>
                <td style={{ fontSize: 13 }}>{u.email}</td>
                <td>
                  <span className={`badge ${u.role === 'super_admin' ? 'badge-cancelled' : u.role === 'admin' ? 'badge-confirmed' : 'badge-pending'}`}>
                    {u.role.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td>
                  <span className={`badge ${u.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {u.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {u.role !== 'super_admin' && (
                    <>
                      <button className="action-btn detail" onClick={() => openEdit(u)}>Edit</button>
                      <button className="action-btn" style={{ borderColor: '#2563EB', color: '#2563EB' }} onClick={() => { setResetForm({ password: '', confirmPassword: '' }); setFormError(''); setResetUser(u) }}>
                        Reset PW
                      </button>
                      {u.role === 'staff' && (
                        <button className="action-btn" style={{ borderColor: '#7C3AED', color: '#7C3AED' }} onClick={() => openPerms(u)}>
                          Permissions
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Tambah User */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Tambah User</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label>Nama Lengkap *</label>
                <input value={addForm.fullName} onChange={e => setAddForm(p => ({ ...p, fullName: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input type="email" value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
                  {['admin', 'staff'].map(r => (
                    <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="add-role" value={r} checked={addForm.role === r} onChange={() => setAddForm(p => ({ ...p, role: r }))} />
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Password *</label>
                  <input type="password" value={addForm.password} onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} required minLength={8} />
                </div>
                <div className="form-group">
                  <label>Konfirmasi Password *</label>
                  <input type="password" value={addForm.confirmPassword} onChange={e => setAddForm(p => ({ ...p, confirmPassword: e.target.value }))} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Buat User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit User */}
      {editUser && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Edit User</h3>
              <button onClick={() => setEditUser(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12, marginBottom: 16 }}>{editUser.email}</p>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleEditUser}>
              <div className="form-group">
                <label>Nama Lengkap *</label>
                <input value={editForm.fullName} onChange={e => setEditForm(p => ({ ...p, fullName: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
                  {['admin', 'staff'].map(r => (
                    <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="edit-role" value={r} checked={editForm.role === r} onChange={() => setEditForm(p => ({ ...p, role: r }))} />
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 20 }}>
                <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(p => ({ ...p, isActive: e.target.checked }))} />
                Aktif
              </label>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Password */}
      {resetUser && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Reset Password</h3>
              <button onClick={() => setResetUser(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -12, marginBottom: 16 }}>
              Reset password untuk <strong>{resetUser.full_name}</strong>
            </p>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label>Password Baru *</label>
                <input type="password" value={resetForm.password} onChange={e => setResetForm(p => ({ ...p, password: e.target.value }))} required minLength={8} placeholder="Min. 8 karakter" />
              </div>
              <div className="form-group">
                <label>Konfirmasi Password Baru *</label>
                <input type="password" value={resetForm.confirmPassword} onChange={e => setResetForm(p => ({ ...p, confirmPassword: e.target.value }))} required />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setResetUser(null)}>Batal</button>
                <button type="submit" className="btn-danger" disabled={submitting}>{submitting ? 'Memproses...' : 'Reset Password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Permissions */}
      {permUser && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Set Permissions</h3>
              <button onClick={() => setPermUser(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {permUser.full_name} — <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{permUser.email}</span>
            </p>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSavePermissions}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={clearAll}>Clear All</button>
                <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={selectAll}>Select All</button>
              </div>
              <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '0 16px' }}>
                {PERMISSION_KEYS.map(p => (
                  <label key={p.key} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', fontSize: 14,
                  }}>
                    <input
                      type="checkbox"
                      checked={!!perms[p.key]}
                      onChange={() => togglePerm(p.key)}
                      style={{ accentColor: 'var(--red)', width: 16, height: 16, flexShrink: 0 }}
                    />
                    <span style={{ flex: 1 }}>{p.label}</span>
                    <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.key}</code>
                  </label>
                ))}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setPermUser(null)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan Permissions'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
