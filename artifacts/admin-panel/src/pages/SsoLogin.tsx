import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Cross-app admin SSO from admin.20fit.id. This SPA is static (anon supabase-js) and
// auth is purely localStorage.admin_user, so /sso is a client route: verify the HMAC
// token via the SECURITY DEFINER RPC bk_sso_resolve (forging needs the shared secret),
// seat the same localStorage the normal login uses, then hard-redirect so AuthProvider
// re-reads it (super_admin → unit picker at '/', unit admin → that unit's dashboard).
export default function SsoLogin() {
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      const token = new URLSearchParams(window.location.search).get('token')
      if (!token) { setErr('Token SSO tidak ada.'); return }
      const { data, error } = await supabase.rpc('bk_sso_resolve', { p_token: token })
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) { setErr('Auto-login gagal (token tidak valid / bukan admin).'); return }
      localStorage.setItem('admin_user', JSON.stringify({
        id: row.id, email: row.email, full_name: row.full_name,
        role: row.role, unit: row.unit, permissions: row.permissions || {},
      }))
      window.location.replace(row.unit ? `/${row.unit}` : '/')
    })()
  }, [])

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui' }}>
      <p style={{ color: '#666', fontSize: 14 }}>{err || 'Sedang masuk…'}</p>
    </div>
  )
}
