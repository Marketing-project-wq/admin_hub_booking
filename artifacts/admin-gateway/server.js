import express from 'express'
import fs from 'fs'
import path from 'path'
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

// Unit-picker landing at "/"
app.use(express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gateway running on port ${PORT}`)
  units.forEach(u => console.log(`  /${u}  ->  ${resolveDist(u)}`))
})
