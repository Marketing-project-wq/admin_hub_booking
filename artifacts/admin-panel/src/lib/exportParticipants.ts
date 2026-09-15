import writeXlsxFile, { type Row, type CellObject } from 'write-excel-file/browser'
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Export "Rekap Peserta" (class participants) to a real .xlsx file.
//
// Rekap per orang (dikelompokkan by email): berapa kali booking / repeat,
// no HP, email, dan jenis kelas yang diikuti. Booking lama/walk-in yang
// memakai email placeholder `noemail@20fit.id` dipisah ke sheet sendiri
// karena tidak bisa dipastikan sebagai orang unik.
// ---------------------------------------------------------------------------

const NOEMAIL = 'noemail@20fit.id'
const HEADER_BG = '#B91C1C' // 20FIT red
const HEADER_TX = '#FFFFFF'

type BookingRow = Record<string, unknown>

interface Agg {
  nama: string
  email: string
  noHp: string
  total: number
  confirmed: number
  cancelled: number
  jenisKelas: string
  nJenis: number
  totalBayar: number
  pertamaTs: number | null
  terakhirTs: number | null
}

const wibFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const ts = (v: unknown): number => {
  if (!v) return NaN
  return new Date(v as string).getTime()
}

const fmtWib = (t: number | null): string =>
  t == null || Number.isNaN(t) ? '' : wibFmt.format(new Date(t))

const str = (v: unknown): string => (v == null ? '' : String(v))

/** schedule may come back as object (to-one) or array — normalise to object. */
function firstOf(v: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(v)) return v[0] as Record<string, unknown> | undefined
  if (v && typeof v === 'object') return v as Record<string, unknown>
  return undefined
}

function classLabel(r: BookingRow): string {
  if (r.schedule_id) {
    const sch = firstOf(r.schedule)
    const ct = firstOf(sch?.class_type)
    const name = str(ct?.name).trim()
    return name || '(kelas tidak diketahui)'
  }
  const note = str(r.notes).trim()
  return note || '(tanpa jadwal / walk-in)'
}

function normEmail(r: BookingRow): string {
  return str(r.email).trim().toLowerCase()
}

/** Value of `field` from the record with the most recent created_at (non-empty). */
function mostRecent(recs: BookingRow[], field: string): string {
  let best = ''
  let bestTs = -Infinity
  for (const r of recs) {
    const v = r[field]
    if (v == null || String(v).trim() === '') continue
    const t = ts(r.created_at)
    const tt = Number.isNaN(t) ? -Infinity : t
    if (tt >= bestTs) {
      bestTs = tt
      best = String(v)
    }
  }
  return best
}

function aggregate(records: BookingRow[], keyFn: (r: BookingRow) => string): Agg[] {
  const groups = new Map<string, BookingRow[]>()
  for (const r of records) {
    const k = keyFn(r)
    const arr = groups.get(k)
    if (arr) arr.push(r)
    else groups.set(k, [r])
  }

  const out: Agg[] = []
  for (const recs of groups.values()) {
    const sorted = [...recs].sort((a, b) => (ts(a.created_at) || 0) - (ts(b.created_at) || 0))
    const classes: string[] = []
    const seen = new Set<string>()
    for (const r of sorted) {
      const c = classLabel(r)
      if (!seen.has(c)) {
        seen.add(c)
        classes.push(c)
      }
    }
    const confirmed = recs.filter((r) => r.status === 'confirmed')
    const cancelled = recs.filter((r) => r.status === 'cancelled')
    const dates = recs.map((r) => ts(r.created_at)).filter((n) => !Number.isNaN(n))
    out.push({
      nama: mostRecent(recs, 'full_name') || '-',
      email: mostRecent(recs, 'email') || str(recs[0]?.email) || '-',
      noHp: mostRecent(recs, 'phone'),
      total: recs.length,
      confirmed: confirmed.length,
      cancelled: cancelled.length,
      jenisKelas: classes.join(', '),
      nJenis: classes.length,
      totalBayar: confirmed.reduce((s, r) => s + (Number(r.price) || 0), 0),
      pertamaTs: dates.length ? Math.min(...dates) : null,
      terakhirTs: dates.length ? Math.max(...dates) : null,
    })
  }
  return out
}

async function fetchAllBookings(): Promise<BookingRow[]> {
  const pageSize = 1000
  const all: BookingRow[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('arena_class_bookings')
      .select(
        `id, booking_code, full_name, email, phone, customer_type, status, price, notes,
         created_at, paid_at, schedule_id,
         schedule:arena_class_schedules(
           schedule_date, start_time, instructor,
           class_type:arena_class_types(name)
         )`,
      )
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = (data as BookingRow[] | null) ?? []
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

// ---- cell helpers ----------------------------------------------------------
const H = (text: string): CellObject => ({
  value: text,
  fontWeight: 'bold',
  backgroundColor: HEADER_BG,
  textColor: HEADER_TX,
  align: 'center',
})
const B = (text: string): CellObject => ({ value: text, fontWeight: 'bold' })
const num = (n: number, format = '#,##0'): CellObject => ({ value: n, type: Number, format })

function pad(row: Row, width: number): Row {
  const r = row.slice()
  while (r.length < width) r.push(null)
  return r
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Fetch, aggregate, and download the participants recap workbook. */
export async function exportClassParticipants(): Promise<void> {
  const rows = await fetchAllBookings()

  const real: BookingRow[] = []
  const legacy: BookingRow[] = []
  for (const r of rows) {
    const e = normEmail(r)
    if (e === NOEMAIL || !e.includes('@')) legacy.push(r)
    else real.push(r)
  }

  const recap = aggregate(real, normEmail)
  recap.sort(
    (a, b) => b.confirmed - a.confirmed || b.total - a.total || a.nama.localeCompare(b.nama),
  )
  const legacyAgg = aggregate(legacy, (r) => str(r.full_name).trim().toLowerCase() || '(tanpa nama)')
  legacyAgg.sort((a, b) => b.confirmed - a.confirmed || b.total - a.total)

  const allTs = rows.map((r) => ts(r.created_at)).filter((n) => !Number.isNaN(n))
  const confirmedCount = rows.filter((r) => r.status === 'confirmed').length
  const cancelledCount = rows.filter((r) => r.status === 'cancelled').length

  // per class type
  const byClass = new Map<string, { total: number; confirmed: number }>()
  for (const r of rows) {
    const c = classLabel(r)
    const cur = byClass.get(c) ?? { total: 0, confirmed: 0 }
    cur.total += 1
    if (r.status === 'confirmed') cur.confirmed += 1
    byClass.set(c, cur)
  }
  const classRows = [...byClass.entries()].sort((a, b) => b[1].confirmed - a[1].confirmed)

  // ---- Sheet 1: Ringkasan ----
  const W1 = 6
  const s1: Row[] = []
  s1.push(pad([{ value: '20FIT Arena — Rekap Peserta Booking Kelas', fontWeight: 'bold', fontSize: 14 }], W1))
  s1.push(pad([{ value: `Dibuat: ${today()} (WIB) · Sumber: arena_class_bookings`, fontStyle: 'italic' }], W1))
  s1.push(pad([], W1))
  s1.push(pad([B('Statistik')], W1))
  const period = allTs.length ? `${fmtWib(Math.min(...allTs))} – ${fmtWib(Math.max(...allTs))}` : '-'
  const stat = (label: string, value: string | number): void => {
    s1.push(pad([{ value: label }, typeof value === 'number' ? num(value) : { value }], W1))
  }
  stat('Periode data booking', period)
  stat('Total booking (semua status)', rows.length)
  stat('  • Confirmed', confirmedCount)
  stat('  • Cancelled', cancelledCount)
  stat('Peserta unik teridentifikasi (punya email)', recap.length)
  stat('Booking tanpa email / walk-in (noemail@20fit.id)', legacy.length)
  stat('  • nama unik pada kelompok ini', legacyAgg.length)
  s1.push(pad([], W1))
  s1.push(pad([B('Jumlah Booking per Jenis Kelas')], W1))
  s1.push(pad([H('Jenis Kelas'), H('Total Booking'), H('Confirmed')], W1))
  for (const [name, v] of classRows) s1.push(pad([{ value: name }, num(v.total), num(v.confirmed)], W1))
  s1.push(pad([], W1))
  s1.push(pad([B('Top 15 Peserta Paling Sering (by Confirmed)')], W1))
  s1.push(pad([H('#'), H('Nama'), H('Email'), H('No HP'), H('Confirmed'), H('Total')], W1))
  recap.slice(0, 15).forEach((p, i) => {
    s1.push(pad([num(i + 1), { value: p.nama }, { value: p.email }, { value: p.noHp }, num(p.confirmed), num(p.total)], W1))
  })

  // ---- Sheet 2: Rekap Peserta ----
  const head2 = [
    'No', 'Nama', 'Email', 'No HP', 'Total Booking', 'Confirmed', 'Cancelled',
    'Jml Jenis Kelas', 'Jenis Kelas yang Diikuti', 'Total Dibayar (Rp)',
    'Booking Pertama', 'Booking Terakhir',
  ]
  const s2: Row[] = [head2.map(H)]
  recap.forEach((p, i) => {
    s2.push([
      num(i + 1), { value: p.nama }, { value: p.email }, { value: p.noHp },
      num(p.total), num(p.confirmed), num(p.cancelled), num(p.nJenis),
      { value: p.jenisKelas }, num(p.totalBayar),
      { value: fmtWib(p.pertamaTs) }, { value: fmtWib(p.terakhirTs) },
    ])
  })

  // ---- Sheet 3: Booking Tanpa Email ----
  const head3 = [
    'No', 'Nama', 'No HP', 'Total Booking', 'Confirmed', 'Cancelled',
    'Jenis Kelas (dari catatan)', 'Booking Pertama', 'Booking Terakhir',
  ]
  const s3: Row[] = [
    pad([{ value: 'Booking legacy / walk-in dengan email placeholder noemail@20fit.id — dikelompokkan per NAMA (tidak bisa dipastikan orang unik).', fontStyle: 'italic' }], head3.length),
    head3.map(H),
  ]
  legacyAgg.forEach((p, i) => {
    s3.push([
      num(i + 1), { value: p.nama }, { value: p.noHp }, num(p.total),
      num(p.confirmed), num(p.cancelled), { value: p.jenisKelas },
      { value: fmtWib(p.pertamaTs) }, { value: fmtWib(p.terakhirTs) },
    ])
  })

  // ---- Sheet 4: Semua Booking (Detail) ----
  const head4 = [
    'Booking Code', 'Tgl Daftar', 'Nama', 'Email', 'No HP', 'Jenis Kelas',
    'Tgl Kelas', 'Jam', 'Instruktur', 'Status', 'Harga (Rp)', 'Tipe Customer',
  ]
  const s4: Row[] = [head4.map(H)]
  const detailSorted = [...rows].sort((a, b) => (ts(b.created_at) || 0) - (ts(a.created_at) || 0))
  for (const r of detailSorted) {
    const sch = firstOf(r.schedule)
    s4.push([
      { value: str(r.booking_code) }, { value: fmtWib(ts(r.created_at)) },
      { value: str(r.full_name) }, { value: str(r.email) }, { value: str(r.phone) },
      { value: classLabel(r) }, { value: str(sch?.schedule_date) },
      { value: str(sch?.start_time).slice(0, 5) }, { value: str(sch?.instructor) },
      { value: str(r.status) }, num(Number(r.price) || 0), { value: str(r.customer_type) },
    ])
  }

  await writeXlsxFile([
    { sheet: 'Ringkasan', columns: [{ width: 42 }, { width: 22 }, { width: 26 }, { width: 16 }, { width: 12 }, { width: 10 }], stickyRowsCount: 0, data: s1 },
    { sheet: 'Rekap Peserta', stickyRowsCount: 1, columns: [{ width: 5 }, { width: 24 }, { width: 32 }, { width: 16 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 46 }, { width: 16 }, { width: 15 }, { width: 15 }], data: s2 },
    { sheet: 'Booking Tanpa Email', stickyRowsCount: 2, columns: [{ width: 5 }, { width: 26 }, { width: 16 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 40 }, { width: 15 }, { width: 15 }], data: s3 },
    { sheet: 'Semua Booking (Detail)', stickyRowsCount: 1, columns: [{ width: 20 }, { width: 12 }, { width: 22 }, { width: 30 }, { width: 16 }, { width: 30 }, { width: 12 }, { width: 8 }, { width: 16 }, { width: 11 }, { width: 12 }, { width: 13 }], data: s4 },
  ]).toFile(`Rekap_Peserta_Kelas_20FIT_${today()}.xlsx`)
}
