import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

const units = ['clinic', 'arena', 'gym']

// Resolve each app's built dist/ folder. Works in two layouts:
//   - local pnpm workspace: artifacts/admin-gateway -> ../<unit>-admin/dist
//   - docker image:        /app/server.js          -> ./<unit>-admin/dist
function resolveDist(unit) {
  const candidates = [
    path.join(__dirname, `../${unit}-admin/dist`),
    path.join(__dirname, `${unit}-admin/dist`),
  ]
  return candidates.find(p => fs.existsSync(path.join(p, 'index.html'))) || candidates[0]
}

units.forEach(unit => {
  const distPath = resolveDist(unit)
  // Serve built static assets (JS/CSS/favicon) under /<unit>/...
  app.use(`/${unit}`, express.static(distPath))
  // Bare /<unit> (no trailing slash) -> the app's index.html
  app.get(`/${unit}`, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
  // SPA fallback: any /<unit>/* that isn't a real file -> the app's index.html
  app.get(`/${unit}/*`, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
})

// ---- Cross-app admin SSO from admin.20fit.id (the super-admin BFF) ----
// admin.20fit.id mints a short-lived HMAC token { email, app:'booking', iat, exp }
// (sig = base64url(HMAC-SHA256(data, SSO_SHARED_SECRET))). We verify it, resolve the
// admin_users row by email via service-role, seat localStorage.admin_user (exactly what
// validate_admin_login stores), and redirect to the unit dashboard (or unit-picker for
// super_admin whose unit is null). Booking auth is purely localStorage-profile based.
const SSO_SECRET = process.env.SSO_SHARED_SECRET

function verifySso(token) {
  if (!token || !token.includes('.')) return null
  const [data, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SSO_SECRET).update(data).digest('base64url')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (!p.exp || Math.floor(Date.now() / 1000) > p.exp) return null
    return p
  } catch { return null }
}

function ssoFail(res, reason) {
  res.status(reason === 'not-configured' ? 503 : 401).type('html')
    .send(`<!doctype html><meta charset="utf-8"><script>location.replace('/?sso=${reason}')</script>Mengarahkan…`)
}

app.get('/sso', async (req, res) => {
  res.set('cache-control', 'no-store')
  if (!SSO_SECRET) return ssoFail(res, 'not-configured')
  const p = verifySso(String(req.query.token || ''))
  if (!p || p.app !== 'booking' || !p.email) return ssoFail(res, 'invalid')
  const email = String(p.email).toLowerCase().trim()
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return ssoFail(res, 'not-configured')
  try {
    const r = await fetch(
      `${base}/rest/v1/admin_users?select=id,email,full_name,role,unit,permissions,is_active&email=ilike.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } },
    )
    const rows = await r.json()
    const u = Array.isArray(rows) ? rows[0] : null
    if (!u || !u.is_active) return ssoFail(res, 'not-admin')
    const profile = { id: u.id, email: u.email, full_name: u.full_name, role: u.role, unit: u.unit, permissions: u.permissions || {} }
    const target = u.unit ? `/${u.unit}` : '/'
    res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Masuk…</title><script>try{localStorage.setItem('admin_user', ${JSON.stringify(JSON.stringify(profile))})}catch(e){}location.replace(${JSON.stringify(target)})</script>Sedang masuk…`,
    )
  } catch {
    return ssoFail(res, 'error')
  }
})

// Unit-picker landing at "/"
app.use(express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gateway running on port ${PORT}`)
  units.forEach(u => console.log(`  /${u}  ->  ${resolveDist(u)}`))
})
