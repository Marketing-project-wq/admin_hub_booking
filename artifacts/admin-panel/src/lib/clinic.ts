import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Clinic data layer
//
// Assumed Supabase schema (mirrors Arena conventions). If the real tables differ,
// only this file needs to change — the pages consume these helpers, not supabase
// directly.
//
//   clinic_services  ( id, name, price, duration_min, is_active )
//   clinic_slots     ( id, slot_date date, start_time time, end_time time,
//                      quota int, booked_count int, is_active bool, created_at )
//   clinic_bookings  ( id, booking_code, service_id fk, slot_id fk,
//                      slot_date date, slot_time time,           -- snapshot for filtering/sort
//                      full_name, email, phone,
//                      status text ('confirmed'|'pending_payment'|'cancelled'),
//                      price numeric, payment_method, payment_ref,
//                      paid_at, created_at, updated_at )
// ─────────────────────────────────────────────────────────────────────────────

export interface ClinicService {
  id: string
  name: string
  price: number
  duration_minutes: number | null
  is_active: boolean
  requires_doctor: boolean
}

export interface ClinicSlot {
  id: string
  slot_date: string
  start_time: string
  end_time: string
  quota: number
  booked_count: number
  is_active: boolean
  created_at?: string
}

export interface ClinicBooking {
  id: string
  booking_code: string
  service_id: string | null
  slot_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  notes?: string | null
  status: string
  price: number
  payment_method: string | null
  payment_ref?: string | null
  paid_at: string | null
  created_at: string
  updated_at?: string | null
  // Derived (attached by enrichBookings from clinic_slots / clinic_services) —
  // not columns on clinic_bookings.
  slot_date: string | null
  slot_time: string | null
  service?: { name: string } | { name: string }[] | null
}

const SLOT_SELECT = 'id, slot_date, start_time, end_time, quota, booked_count, is_active, created_at'

// Explicit field list — NO embedded relations. Service name and slot date/time are
// attached afterwards (enrichBookings) via separate queries, so a missing/undeclared
// FK relationship can never fail the whole bookings query.
const BOOKING_FIELDS =
  'id, booking_code, service_id, slot_id, full_name, email, phone, notes, ' +
  'price, status, payment_method, paid_at, created_at'

/**
 * Attach service name (clinic_services) and slot date/time (clinic_slots) to a set
 * of bookings via two separate lookups. Fault-tolerant: if either lookup fails, the
 * bookings are still returned (without the missing piece) rather than throwing.
 */
async function enrichBookings(rows: ClinicBooking[]): Promise<ClinicBooking[]> {
  const serviceIds = [...new Set(rows.map(r => r.service_id).filter(Boolean))] as string[]
  const slotIds = [...new Set(rows.map(r => r.slot_id).filter(Boolean))] as string[]

  const [svcRes, slotRes] = await Promise.all([
    serviceIds.length
      ? supabase.from('clinic_services').select('id, name').in('id', serviceIds)
      : Promise.resolve({ data: [], error: null }),
    slotIds.length
      ? supabase.from('clinic_slots').select('id, slot_date, start_time').in('id', slotIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const svcMap = new Map(((svcRes.data as { id: string; name: string }[]) || []).map(s => [s.id, s.name]))
  const slotMap = new Map(
    ((slotRes.data as { id: string; slot_date: string; start_time: string }[]) || []).map(s => [s.id, s]),
  )

  return rows.map(r => {
    const slot = r.slot_id ? slotMap.get(r.slot_id) : undefined
    return {
      ...r,
      service: r.service_id ? { name: svcMap.get(r.service_id) || '-' } : null,
      slot_date: slot?.slot_date ?? null,
      slot_time: slot?.start_time ?? null,
    }
  })
}

/** Slot IDs whose slot_date falls in [from, to] (inclusive). Empty = none. */
async function slotIdsInRange(from: string, to: string): Promise<string[]> {
  let q = supabase.from('clinic_slots').select('id, slot_date')
  if (from) q = q.gte('slot_date', from)
  if (to) q = q.lte('slot_date', to)
  const { data, error } = await q
  if (error || !data) return []
  return (data as { id: string }[]).map(s => s.id)
}

// ─── Date helpers ────────────────────────────────────────────────────────────
// Format a Date as local YYYY-MM-DD. Using toISOString() here would convert to UTC
// and render the wrong calendar day in UTC+7 (Indonesia).
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayISO = () => ymd(new Date())

export const daysAgoISO = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return ymd(d)
}

/** Shift a YYYY-MM-DD string by `delta` days (local). */
export const shiftDay = (iso: string, delta: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return ymd(d)
}

/** Monday-based start, Sunday end of the current week (local). */
export const thisWeekRange = () => {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  const start = new Date(d); start.setDate(d.getDate() - dow)
  const end = new Date(start); end.setDate(start.getDate() + 6)
  return { from: ymd(start), to: ymd(end) }
}

/** Resolve a Supabase embedded relation that may be returned as object or array. */
export const serviceName = (b: ClinicBooking): string => {
  const s = Array.isArray(b.service) ? b.service[0] : b.service
  return s?.name || '-'
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface ClinicStats {
  today: number
  week: number
  pending: number
  confirmed: number
}

export async function getDashboardStats(): Promise<ClinicStats> {
  const today = todayISO()
  const week = thisWeekRange()
  const head = { count: 'exact' as const, head: true }

  // Today/Week are by SLOT date, which lives on clinic_slots — resolve the slot IDs
  // first, then count non-cancelled bookings against them.
  const [todaySlots, weekSlots] = await Promise.all([
    slotIdsInRange(today, today),
    slotIdsInRange(week.from, week.to),
  ])

  const countBySlots = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0
    const { count } = await supabase.from('clinic_bookings').select('id', head)
      .neq('status', 'cancelled').in('slot_id', ids)
    return count || 0
  }

  const [todayCount, weekCount, pendingRes, confirmedRes] = await Promise.all([
    countBySlots(todaySlots),
    countBySlots(weekSlots),
    supabase.from('clinic_bookings').select('id', head).eq('status', 'pending_payment'),
    supabase.from('clinic_bookings').select('id', head).eq('status', 'confirmed'),
  ])

  return {
    today: todayCount,
    week: weekCount,
    pending: pendingRes.count || 0,
    confirmed: confirmedRes.count || 0,
  }
}

export async function getRecentBookings(limit = 10): Promise<ClinicBooking[]> {
  const { data, error } = await supabase
    .from('clinic_bookings')
    .select(BOOKING_FIELDS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return enrichBookings((data || []) as unknown as ClinicBooking[])
}

// ─── Slots ───────────────────────────────────────────────────────────────────
export async function getSlotsByDate(date: string): Promise<ClinicSlot[]> {
  const { data, error } = await supabase
    .from('clinic_slots')
    .select(SLOT_SELECT)
    .eq('slot_date', date)
    .order('start_time', { ascending: true })
  console.log('slots fetch:', data, error)
  if (error) throw error
  return (data || []) as ClinicSlot[]
}

export interface NewSlot {
  slot_date: string
  start_time: string
  end_time: string
  quota: number
}

export async function addSlot(slot: NewSlot): Promise<void> {
  const { error } = await supabase.from('clinic_slots').insert({
    ...slot,
    booked_count: 0,
    is_active: true,
    created_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function deleteSlot(id: string): Promise<void> {
  const { error } = await supabase.from('clinic_slots').delete().eq('id', id)
  if (error) throw error
}

export interface BulkSlotInput {
  startDate: string
  endDate: string
  daysOfWeek: number[] // 0 = Sunday .. 6 = Saturday (JS getDay)
  times: { start_time: string; end_time: string }[]
  quota: number
}

/** Expand a bulk request into individual slot rows and insert them. Returns count. */
export async function bulkAddSlots(input: BulkSlotInput): Promise<number> {
  const rows: NewSlot[] = []
  const start = new Date(input.startDate + 'T00:00:00')
  const end = new Date(input.endDate + 'T00:00:00')
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!input.daysOfWeek.includes(d.getDay())) continue
    const dateStr = d.toISOString().slice(0, 10)
    for (const t of input.times) {
      rows.push({ slot_date: dateStr, start_time: t.start_time, end_time: t.end_time, quota: input.quota })
    }
  }
  if (rows.length === 0) return 0
  const { error } = await supabase.from('clinic_slots').insert(
    rows.map(r => ({ ...r, booked_count: 0, is_active: true, created_at: new Date().toISOString() }))
  )
  if (error) throw error
  return rows.length
}

// ─── Bookings ────────────────────────────────────────────────────────────────
export interface BookingFilters {
  status: string // 'all' | 'confirmed' | 'pending_payment' | 'cancelled'
  dateFrom: string
  dateTo: string
  search: string
}

/**
 * Apply the shared booking filters to a query. The date range filters by
 * created_at (when the booking was made) — a real column on clinic_bookings — so
 * filtering and pagination happen server-side. slot_date/slot_time are display-only
 * (attached later by enrichBookings from clinic_slots).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBookingFilters(query: any, filters: BookingFilters): any {
  let q = query
  if (filters.status !== 'all') q = q.eq('status', filters.status)
  if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom + 'T00:00:00')
  if (filters.dateTo) q = q.lte('created_at', filters.dateTo + 'T23:59:59')
  if (filters.search) {
    const s = filters.search
    q = q.or(`full_name.ilike.%${s}%,booking_code.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
  }
  return q
}

export async function getBookings(
  filters: BookingFilters,
  page: number,
  pageSize: number,
): Promise<{ data: ClinicBooking[]; count: number }> {
  let q = supabase.from('clinic_bookings').select(BOOKING_FIELDS, { count: 'exact' })
  q = applyBookingFilters(q, filters)
  q = q.order('created_at', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1)

  const { data, count, error } = await q
  if (error) throw error
  const enriched = await enrichBookings((data || []) as unknown as ClinicBooking[])
  return { data: enriched, count: count || 0 }
}

export async function getAllBookings(filters: BookingFilters): Promise<ClinicBooking[]> {
  let q = supabase.from('clinic_bookings').select(BOOKING_FIELDS)
  q = applyBookingFilters(q, filters)
  q = q.order('created_at', { ascending: false })

  const { data, error } = await q
  if (error) throw error
  return enrichBookings((data || []) as unknown as ClinicBooking[])
}

export async function confirmBooking(id: string): Promise<void> {
  const { error } = await supabase.from('clinic_bookings').update({
    status: 'confirmed',
    payment_method: 'cash',
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

export async function cancelBooking(id: string): Promise<void> {
  const { error } = await supabase.from('clinic_bookings').update({
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

// ─── Services ────────────────────────────────────────────────────────────────
export async function listServices(): Promise<ClinicService[]> {
  const { data, error } = await supabase
    .from('clinic_services')
    .select('id, name, price, duration_minutes, is_active, requires_doctor, package_category')
    .order('name', { ascending: true })
  console.log('services fetch:', data, error)
  if (error) throw error
  return (data || []) as ClinicService[]
}

// ─── Patients ────────────────────────────────────────────────────────────────
// Assumed clinic_patients schema:
//   id, patient_code, id_type ('nik'|'passport'), id_number, full_name,
//   date_of_birth date, gender ('male'|'female'), address, phone, email,
//   occupation, emergency_contact_name, emergency_contact_phone, notes,
//   created_at, updated_at
export interface ClinicPatient {
  id: string
  patient_code: string
  id_type: string
  id_number: string
  full_name: string
  date_of_birth: string | null
  gender: string | null
  address: string | null
  phone: string
  email: string | null
  occupation: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  notes: string | null
  is_active?: boolean
  created_at: string
  updated_at?: string | null
}

export type PatientPayload = Omit<ClinicPatient, 'id' | 'patient_code' | 'is_active' | 'created_at' | 'updated_at'>

const PATIENT_FIELDS =
  'id, patient_code, id_type, id_number, full_name, date_of_birth, gender, address, ' +
  'phone, email, occupation, emergency_contact_name, emergency_contact_phone, notes, created_at'

export async function listPatients(search?: string): Promise<ClinicPatient[]> {
  let q = supabase.from('clinic_patients').select(PATIENT_FIELDS)
  if (search) {
    const s = search.trim()
    q = q.or(`full_name.ilike.%${s}%,id_number.ilike.%${s}%,phone.ilike.%${s}%`)
  }
  q = q.order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) throw error
  return (data || []) as unknown as ClinicPatient[]
}

export async function getPatient(id: string): Promise<ClinicPatient> {
  const { data, error } = await supabase.from('clinic_patients').select(PATIENT_FIELDS).eq('id', id).single()
  if (error) throw error
  return data as unknown as ClinicPatient
}

export async function searchPatientByIdNumber(idNumber: string): Promise<ClinicPatient | null> {
  const { data, error } = await supabase
    .from('clinic_patients').select(PATIENT_FIELDS).eq('id_number', idNumber.trim()).maybeSingle()
  if (error) throw error
  return (data as unknown as ClinicPatient) || null
}

export async function createPatient(payload: PatientPayload): Promise<ClinicPatient> {
  // Generate patient_code via RPC; if the RPC is missing, let the DB default fill it.
  const insert: Record<string, unknown> = { ...payload, created_at: new Date().toISOString() }
  const { data: code, error: codeErr } = await supabase.rpc('generate_patient_code')
  if (!codeErr && code) insert.patient_code = code as string

  const { data, error } = await supabase.from('clinic_patients').insert(insert).select(PATIENT_FIELDS).single()
  if (error) throw error
  return data as unknown as ClinicPatient
}

export async function updatePatient(id: string, payload: Partial<PatientPayload>): Promise<void> {
  const { error } = await supabase
    .from('clinic_patients')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ─── Manual booking ──────────────────────────────────────────────────────────
/** Slots on a date that can still take a booking (active + not full). */
export async function getAvailableSlots(date: string): Promise<ClinicSlot[]> {
  const slots = await getSlotsByDate(date)
  return slots.filter(s => s.is_active && s.booked_count < s.quota)
}

async function nextBookingCode(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_booking_code')
  if (!error && data) return data as string
  // Fallback if no RPC exists — timestamp-based, prefixed for clinic.
  return `CLN-${Date.now().toString(36).toUpperCase()}`
}

export interface ManualBookingInput {
  patient_id: string
  service_id: string
  full_name: string
  email: string | null
  phone: string | null
  notes: string | null
  price: number
  payment_method: string // 'cash' | 'transfer' | 'mayar' | 'free'
  slot_id?: string | null // existing slot, OR…
  manual_date?: string    // …a manual date + time (a slot is created for it)
  manual_time?: string
}

/** Create a confirmed manual booking. Returns the generated booking_code. */
export async function createManualBooking(input: ManualBookingInput): Promise<string> {
  let slotId = input.slot_id || null

  // No existing slot chosen → materialise one for the manual date/time so the
  // booking still carries a date/time (the app derives those from clinic_slots).
  if (!slotId && input.manual_date && input.manual_time) {
    const start = input.manual_time.length === 5 ? input.manual_time : `${input.manual_time}:00`
    const endH = String(parseInt(start.slice(0, 2)) + 1).padStart(2, '0')
    const { data: slot, error: slotErr } = await supabase.from('clinic_slots').insert({
      slot_date: input.manual_date, start_time: start, end_time: `${endH}:${start.slice(3)}`,
      quota: 1, booked_count: 1, is_active: true, created_at: new Date().toISOString(),
    }).select('id').single()
    if (slotErr) throw slotErr
    slotId = (slot as { id: string }).id
  } else if (slotId) {
    // Existing slot → increment its booked_count.
    const { data: slot } = await supabase.from('clinic_slots').select('booked_count').eq('id', slotId).single()
    const current = (slot as { booked_count: number } | null)?.booked_count ?? 0
    await supabase.from('clinic_slots').update({ booked_count: current + 1 }).eq('id', slotId)
  }

  const booking_code = await nextBookingCode()
  const isFree = input.payment_method === 'free'
  const { error } = await supabase.from('clinic_bookings').insert({
    booking_code,
    patient_id: input.patient_id,
    service_id: input.service_id,
    slot_id: slotId,
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    price: isFree ? 0 : input.price,
    status: 'confirmed',
    payment_method: input.payment_method,
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  })
  if (error) throw error
  return booking_code
}

// ─── Visits (Kunjungan) ──────────────────────────────────────────────────────
// Assumed clinic_visits schema:
//   id, visit_code, patient_id, booking_id (nullable), service_id,
//   visit_date date, visit_time time, status ('in_progress'|'completed'|'cancelled'),
//   chief_complaint, notes, handled_by, payment_method, payment_amount,
//   payment_status ('unpaid'|'paid'), handled_by, created_by, created_at, updated_at
// Also assumes clinic_bookings has: visit_id, check_in_at.
// Layanan dari clinic_visit_services (satu visit bisa banyak layanan).
export interface ClinicVisitService {
  id: string
  service_id: string
  service_name: string
  price: number
  notes: string | null
}

export interface ClinicVisit {
  id: string
  visit_code: string
  patient_id: string | null
  booking_id: string | null
  visit_date: string | null
  visit_time: string | null
  status: string
  chief_complaint: string | null
  notes: string | null
  handled_by: string | null
  payment_method: string | null
  payment_amount: number | null
  payment_status: string | null
  patient_package_id: string | null
  follow_up_date: string | null
  follow_up_notes: string | null
  created_at: string
  updated_at?: string | null
  // Derived by enrichVisits:
  patient?: { full_name: string; phone: string | null; patient_code: string } | null
  services: ClinicVisitService[]
}

const VISIT_FIELDS =
  'id, visit_code, patient_id, booking_id, visit_date, visit_time, status, ' +
  'chief_complaint, notes, handled_by, payment_method, payment_amount, payment_status, ' +
  'patient_package_id, follow_up_date, follow_up_notes, created_at, updated_at'

const VISIT_SELECT =
  VISIT_FIELDS + ', services:clinic_visit_services(id, service_id, service_name, price, notes, sort_order)'

/** Attach patient info to visits via a separate lookup. Services come from the embed in VISIT_SELECT. */
async function enrichVisits(rows: ClinicVisit[]): Promise<ClinicVisit[]> {
  const patientIds = [...new Set(rows.map(r => r.patient_id).filter(Boolean))] as string[]
  const patData = patientIds.length
    ? (await supabase.from('clinic_patients').select('id, full_name, phone, patient_code').in('id', patientIds)).data
    : []
  const patMap = new Map(
    ((patData as { id: string; full_name: string; phone: string | null; patient_code: string }[]) || [])
      .map(p => [p.id, p]),
  )

  return rows.map(r => ({
    ...r,
    patient: r.patient_id && patMap.has(r.patient_id)
      ? { full_name: patMap.get(r.patient_id)!.full_name, phone: patMap.get(r.patient_id)!.phone, patient_code: patMap.get(r.patient_id)!.patient_code }
      : null,
    services: (r.services ?? []) as ClinicVisitService[],
  }))
}

async function nextVisitCode(): Promise<string> {
  const { data, error } = await supabase.rpc('generate_visit_code')
  if (!error && data) return data as string
  return `VST-${Date.now().toString(36).toUpperCase()}`
}

export interface BookingWithDetails {
  id: string
  booking_code: string
  patient_id: string | null
  service_id: string | null
  slot_id: string | null
  full_name: string
  phone: string | null
  email: string | null
  price: number
  status: string
  payment_method: string | null
  paid_at: string | null
  visit_id: string | null
  patient?: ClinicPatient | null
  service?: { name: string } | null
  slot?: { slot_date: string; start_time: string } | null
}

/** Fetch a booking by its code, with patient / service / slot details attached. */
export async function getBookingByCode(code: string): Promise<BookingWithDetails | null> {
  const { data, error } = await supabase
    .from('clinic_bookings')
    .select('id, booking_code, patient_id, service_id, slot_id, full_name, phone, email, price, status, payment_method, paid_at, visit_id')
    .eq('booking_code', code.trim())
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const b = data as unknown as BookingWithDetails

  const [pat, svc, slot] = await Promise.all([
    b.patient_id ? getPatient(b.patient_id).catch(() => null) : Promise.resolve(null),
    b.service_id
      ? supabase.from('clinic_services').select('name').eq('id', b.service_id).maybeSingle().then(r => r.data as { name: string } | null)
      : Promise.resolve(null),
    b.slot_id
      ? supabase.from('clinic_slots').select('slot_date, start_time').eq('id', b.slot_id).maybeSingle().then(r => r.data as { slot_date: string; start_time: string } | null)
      : Promise.resolve(null),
  ])
  return { ...b, patient: pat, service: svc, slot }
}

export interface VisitFromBookingPayload {
  handled_by?: string | null
  chief_complaint?: string | null
  notes?: string | null
}

interface BookingForVisit {
  id: string
  patient_id: string | null
  service_id: string | null
  slot_id: string | null
  price: number
  payment_method: string | null
  full_name: string
  phone: string | null
  email: string | null
}

/**
 * Resolve a patient_id for a booking that has none (legacy/online bookings made
 * before patients existed). Matches by phone first; otherwise auto-creates a
 * minimal patient record from the booking data with placeholder identity fields.
 */
async function resolvePatientFromBooking(b: BookingForVisit): Promise<string> {
  if (b.phone) {
    const { data } = await supabase.from('clinic_patients').select('id').eq('phone', b.phone).limit(1)
    if (data && data.length > 0) return (data[0] as { id: string }).id
  }

  const insert: Record<string, unknown> = {
    full_name: b.full_name,
    phone: b.phone,
    email: b.email,
    id_type: 'nik',
    id_number: `TMP-${b.phone || Date.now().toString(36)}`, // temporary placeholder ID
    date_of_birth: '2000-01-01',                            // placeholder
    gender: 'male',                                          // placeholder
    created_at: new Date().toISOString(),
  }
  const { data: code, error: codeErr } = await supabase.rpc('generate_patient_code')
  if (!codeErr && code) insert.patient_code = code as string

  const { data, error } = await supabase.from('clinic_patients').insert(insert).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Create a visit from an existing booking and mark the booking checked-in. */
export async function createVisitFromBooking(bookingId: string, payload: VisitFromBookingPayload = {}): Promise<ClinicVisit> {
  const { data: bRow, error: bErr } = await supabase
    .from('clinic_bookings')
    .select('id, patient_id, service_id, slot_id, price, payment_method, full_name, phone, email')
    .eq('id', bookingId).single()
  if (bErr) throw bErr
  const b = bRow as BookingForVisit

  // Existing bookings may not have a patient yet — find or create one.
  const patientId = b.patient_id || await resolvePatientFromBooking(b)

  // Pull slot date/time if present.
  let visit_date: string | null = todayISO()
  let visit_time: string | null = null
  if (b.slot_id) {
    const { data: slot } = await supabase.from('clinic_slots').select('slot_date, start_time').eq('id', b.slot_id).maybeSingle()
    if (slot) { visit_date = (slot as { slot_date: string }).slot_date; visit_time = (slot as { start_time: string }).start_time }
  }

  // Online (mayar) bookings are already paid; others start unpaid.
  const paidOnline = b.payment_method === 'mayar'

  const visit_code = await nextVisitCode()
  const { data: vRow, error: vErr } = await supabase.from('clinic_visits').insert({
    visit_code,
    patient_id: patientId,
    booking_id: b.id,
    visit_date, visit_time,
    status: 'in_progress',
    chief_complaint: payload.chief_complaint ?? null,
    notes: payload.notes ?? null,
    handled_by: payload.handled_by ?? null,
    payment_method: paidOnline ? 'mayar' : null,
    payment_amount: paidOnline ? b.price : null,
    payment_status: paidOnline ? 'paid' : 'unpaid',
    created_at: new Date().toISOString(),
  }).select('id').single()
  if (vErr) throw vErr
  const visitId = (vRow as { id: string }).id

  // Carry the booking's service over as a clinic_visit_services row.
  if (b.service_id) {
    const { data: svc } = await supabase.from('clinic_services').select('name, price').eq('id', b.service_id).maybeSingle()
    const s = svc as { name: string; price: number } | null
    await supabase.from('clinic_visit_services').insert({
      visit_id: visitId,
      service_id: b.service_id,
      service_name: s?.name ?? '-',
      price: s?.price ?? b.price ?? 0,
      notes: null,
      sort_order: 0,
    })
  }

  await supabase.from('clinic_bookings')
    .update({
      check_in_at: new Date().toISOString(),
      visit_id: visitId,
      // Backfill patient_id on the booking if it was missing.
      ...(b.patient_id ? {} : { patient_id: patientId }),
    })
    .eq('id', b.id)

  return getVisit(visitId)
}

export interface WalkInVisitPayload {
  patient_id: string
  service_id: string
  visit_date: string
  visit_time: string | null
  chief_complaint?: string | null
  notes?: string | null
  handled_by?: string | null
  payment_method?: string | null
  payment_amount?: number | null
}

/** Create a visit not tied to any booking (walk-in). Returns the created visit. */
export async function createWalkInVisit(payload: WalkInVisitPayload): Promise<ClinicVisit> {
  const visit_code = await nextVisitCode()
  const { data, error } = await supabase.from('clinic_visits').insert({
    visit_code,
    patient_id: payload.patient_id,
    booking_id: null,
    visit_date: payload.visit_date,
    visit_time: payload.visit_time,
    status: 'in_progress',
    chief_complaint: payload.chief_complaint ?? null,
    notes: payload.notes ?? null,
    handled_by: payload.handled_by ?? null,
    payment_method: payload.payment_method ?? null,
    payment_amount: payload.payment_amount ?? null,
    payment_status: 'unpaid',
    created_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw error
  const visitId = (data as { id: string }).id

  if (payload.service_id) {
    const { data: svc } = await supabase.from('clinic_services').select('name, price').eq('id', payload.service_id).maybeSingle()
    const s = svc as { name: string; price: number } | null
    await supabase.from('clinic_visit_services').insert({
      visit_id: visitId,
      service_id: payload.service_id,
      service_name: s?.name ?? '-',
      price: s?.price ?? payload.payment_amount ?? 0,
      notes: null,
      sort_order: 0,
    })
  }

  return getVisit(visitId)
}

export async function listVisits(date: string): Promise<ClinicVisit[]> {
  const { data, error } = await supabase
    .from('clinic_visits')
    .select(VISIT_SELECT)
    .eq('visit_date', date)
    .order('visit_time', { ascending: true, nullsFirst: false })
  if (error) throw error
  return enrichVisits((data || []) as unknown as ClinicVisit[])
}

export async function getVisit(id: string): Promise<ClinicVisit> {
  const { data, error } = await supabase.from('clinic_visits').select(VISIT_SELECT).eq('id', id).single()
  if (error) throw error
  const [v] = await enrichVisits([data as unknown as ClinicVisit])
  return v
}

export interface CompleteVisitPayload {
  chief_complaint?: string | null
  notes?: string | null
  handled_by?: string | null
  payment_method?: string | null
  payment_amount?: number | null
}

export async function completeVisit(visitId: string, payload: CompleteVisitPayload): Promise<void> {
  const { error } = await supabase.from('clinic_visits').update({
    status: 'completed',
    payment_status: 'paid',
    chief_complaint: payload.chief_complaint ?? null,
    notes: payload.notes ?? null,
    handled_by: payload.handled_by ?? null,
    payment_method: payload.payment_method ?? null,
    payment_amount: payload.payment_amount ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', visitId)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════════════════
// Clinic Information System — patient master, staff/services master, visit log,
// reports. These coexist with the booking/check-in helpers above; the FK-backed
// PostgREST embeds used here are safe (all clinic_* FKs are declared in the DB).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Patients (paginated master) ───────────────────────────────────────────────
const PATIENT_FIELDS_FULL =
  'id, patient_code, id_type, id_number, full_name, date_of_birth, gender, address, ' +
  'phone, email, occupation, emergency_contact_name, emergency_contact_phone, notes, ' +
  'is_active, created_at, updated_at'

export async function listPatientsPaged(params: {
  search?: string; page?: number; pageSize?: number; activeOnly?: boolean
}): Promise<{ rows: ClinicPatient[]; count: number }> {
  const { search = '', page = 0, pageSize = 20, activeOnly = false } = params
  let q = supabase
    .from('clinic_patients')
    .select(PATIENT_FIELDS_FULL, { count: 'exact' })
    .order('full_name', { ascending: true })

  if (activeOnly) q = q.eq('is_active', true)
  if (search) {
    const s = search.trim()
    q = q.or(`full_name.ilike.%${s}%,patient_code.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`)
  }
  q = q.range(page * pageSize, (page + 1) * pageSize - 1)

  const { data, error, count } = await q
  if (error) throw error
  return { rows: (data ?? []) as unknown as ClinicPatient[], count: count ?? 0 }
}

export async function deactivatePatient(id: string): Promise<void> {
  const { error } = await supabase
    .from('clinic_patients')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ─── Staff master ───────────────────────────────────────────────────────────────
export interface ClinicStaff {
  id: string
  name: string
  role: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
}

export type StaffPayload = Omit<ClinicStaff, 'id' | 'created_at'>

export async function listStaff(activeOnly = false): Promise<ClinicStaff[]> {
  let q = supabase.from('clinic_staff').select('*').order('name', { ascending: true })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ClinicStaff[]
}

export async function createStaff(s: StaffPayload): Promise<void> {
  const { error } = await supabase.from('clinic_staff').insert({ ...s, created_at: new Date().toISOString() })
  if (error) throw error
}

export async function updateStaff(id: string, s: Partial<StaffPayload>): Promise<void> {
  const { error } = await supabase.from('clinic_staff').update(s).eq('id', id)
  if (error) throw error
}

export async function toggleStaffActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('clinic_staff').update({ is_active: active }).eq('id', id)
  if (error) throw error
}

// ─── Services master (full row) ──────────────────────────────────────────────────
// Note: the minimal `listServices()` / `ClinicService` above is kept for the
// manual-booking & walk-in modals. This richer shape backs the Services master page.
export interface ClinicServiceFull {
  id: string
  code: string
  name: string
  description: string | null
  price: number
  duration_minutes: number | null
  category: string | null
  service_group: string | null
  is_online_bookable: boolean
  is_active: boolean
  sort_order: number | null
  created_at: string
}

export type ServicePayload = Omit<ClinicServiceFull, 'id' | 'created_at'>

const SERVICE_FULL_FIELDS =
  'id, code, name, description, price, duration_minutes, category, service_group, ' +
  'is_online_bookable, is_active, sort_order, created_at'

export async function listServicesFull(activeOnly = false): Promise<ClinicServiceFull[]> {
  let q = supabase
    .from('clinic_services')
    .select(SERVICE_FULL_FIELDS)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as ClinicServiceFull[]
}

export async function createService(s: ServicePayload): Promise<void> {
  const { error } = await supabase.from('clinic_services').insert({ ...s, created_at: new Date().toISOString() })
  if (error) throw error
}

export async function updateService(id: string, s: Partial<ServicePayload>): Promise<void> {
  const { error } = await supabase.from('clinic_services').update(s).eq('id', id)
  if (error) throw error
}

export async function toggleServiceActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('clinic_services').update({ is_active: active }).eq('id', id)
  if (error) throw error
}

// ─── Visits (filterable log) ─────────────────────────────────────────────────────
export interface ClinicVisitRow {
  id: string
  visit_code: string
  patient_id: string
  booking_id: string | null
  visit_date: string
  visit_time: string | null
  status: string
  chief_complaint: string | null
  notes: string | null
  payment_method: string | null
  payment_amount: number | null
  payment_status: string | null
  handled_by: string | null
  created_by: string | null
  patient_package_id: string | null
  follow_up_date: string | null
  follow_up_notes: string | null
  created_at: string
  updated_at: string
  patient?: { full_name: string; phone: string | null; patient_code: string } | null
  services: ClinicVisitService[]
}

const VISIT_LOG_SELECT =
  '*, patient:clinic_patients(full_name,phone,patient_code), ' +
  'services:clinic_visit_services(id, service_id, service_name, price, notes, sort_order)'

export async function listVisitsLog(params: {
  patientId?: string; search?: string; dateFrom?: string; dateTo?: string
  status?: string; page?: number; pageSize?: number
}): Promise<{ rows: ClinicVisitRow[]; count: number }> {
  const { patientId, search = '', dateFrom, dateTo, status = 'all', page = 0, pageSize = 20 } = params
  let q = supabase
    .from('clinic_visits')
    .select(VISIT_LOG_SELECT, { count: 'exact' })
    .order('visit_date', { ascending: false })
    .order('visit_time', { ascending: false, nullsFirst: false })

  if (patientId) q = q.eq('patient_id', patientId)
  if (status !== 'all') q = q.eq('status', status)
  if (dateFrom) q = q.gte('visit_date', dateFrom)
  if (dateTo) q = q.lte('visit_date', dateTo)
  if (search.trim()) {
    // Cari lintas visit_code + pasien (nama/kode/HP) + nama layanan. Nama pasien dan
    // layanan ada di tabel join, jadi resolve dulu id-nya lalu gabungkan via .or().
    const like = `%${search.trim()}%`
    const [patRes, svcRes] = await Promise.all([
      supabase.from('clinic_patients').select('id')
        .or(`full_name.ilike."${like}",patient_code.ilike."${like}",phone.ilike."${like}"`),
      supabase.from('clinic_visit_services').select('visit_id').ilike('service_name', like),
    ])
    const patientIds = [...new Set(((patRes.data as { id: string }[] | null) ?? []).map(p => p.id))]
    const serviceVisitIds = [...new Set(((svcRes.data as { visit_id: string }[] | null) ?? []).map(r => r.visit_id))]

    const orParts = [`visit_code.ilike."${like}"`]
    if (patientIds.length) orParts.push(`patient_id.in.(${patientIds.join(',')})`)
    if (serviceVisitIds.length) orParts.push(`id.in.(${serviceVisitIds.join(',')})`)
    q = q.or(orParts.join(','))
  }
  q = q.range(page * pageSize, (page + 1) * pageSize - 1)

  const { data, error, count } = await q
  if (error) throw error
  return { rows: (data ?? []) as unknown as ClinicVisitRow[], count: count ?? 0 }
}

// Fetch satu visit (bentuk ClinicVisitRow) by id — dipakai untuk buka modal edit langsung.
export async function getVisitRow(id: string): Promise<ClinicVisitRow | null> {
  const { data, error } = await supabase
    .from('clinic_visits')
    .select(VISIT_LOG_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as unknown as ClinicVisitRow | null
}

export interface VisitServiceInput {
  service_id: string
  service_name: string
  price: number
  notes?: string
}

export interface VisitPayload {
  patient_id: string
  services: VisitServiceInput[]
  visit_date: string
  visit_time: string | null
  status: string
  chief_complaint: string | null
  notes: string | null
  handled_by: string | null
  payment_method: string | null
  payment_amount: number | null
  payment_status: string
  patient_package_id?: string | null
  created_by?: string | null
}

async function insertVisitServices(visitId: string, services: VisitServiceInput[]): Promise<void> {
  if (!services || services.length === 0) return
  const { error } = await supabase
    .from('clinic_visit_services')
    .insert(services.map((s, i) => ({
      visit_id: visitId,
      service_id: s.service_id,
      service_name: s.service_name,
      price: s.price,
      notes: s.notes ?? null,
      sort_order: i,
    })))
  if (error) throw error
}

export async function addVisit(v: VisitPayload): Promise<ClinicVisitRow> {
  const { services, ...rest } = v
  const visit_code = await nextVisitCode()
  const { data, error } = await supabase
    .from('clinic_visits')
    .insert({ ...rest, visit_code, booking_id: null, created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw error
  const visitId = (data as { id: string }).id

  await insertVisitServices(visitId, services)

  const { data: row, error: rowErr } = await supabase
    .from('clinic_visits')
    .select(VISIT_LOG_SELECT)
    .eq('id', visitId)
    .single()
  if (rowErr) throw rowErr
  return row as unknown as ClinicVisitRow
}

export async function updateVisit(id: string, v: Partial<VisitPayload>): Promise<void> {
  const { services, ...rest } = v
  const { error } = await supabase
    .from('clinic_visits')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error

  // If services provided, replace the visit's service rows.
  if (services) {
    const { error: delErr } = await supabase.from('clinic_visit_services').delete().eq('visit_id', id)
    if (delErr) throw delErr
    await insertVisitServices(id, services)
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────────
export interface ReportSummary {
  totalRevenue: number
  totalVisits: number
  totalPatients: number
  avgRevenuePerVisit: number
  byService: { name: string; count: number; revenue: number }[]
  byStaff: { name: string; count: number; revenue: number }[]
  byPaymentMethod: { method: string; count: number; revenue: number }[]
}

export async function getReportSummary(dateFrom: string, dateTo: string): Promise<ReportSummary> {
  const { data: visits, error } = await supabase
    .from('clinic_visits')
    .select('*, services:clinic_visit_services(service_name, price)')
    .gte('visit_date', dateFrom)
    .lte('visit_date', dateTo)
    .eq('payment_status', 'paid')
  if (error) throw error

  const rows = (visits ?? []) as (ClinicVisitRow & { services: { service_name: string; price: number }[] | null })[]

  const totalRevenue = rows.reduce((s, r) => s + (r.payment_amount ?? 0), 0)
  const totalVisits = rows.length

  const { count: totalPatients } = await supabase
    .from('clinic_patients')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)

  const group = (keyOf: (r: typeof rows[number]) => string) => {
    const map: Record<string, { count: number; revenue: number }> = {}
    rows.forEach(r => {
      const key = keyOf(r)
      if (!map[key]) map[key] = { count: 0, revenue: 0 }
      map[key].count++
      map[key].revenue += r.payment_amount ?? 0
    })
    return map
  }

  const svcMap = group(r => r.services?.[0]?.service_name ?? 'Unknown')
  const staffMap = group(r => r.handled_by ?? 'Unknown')
  const pmMap = group(r => r.payment_method ?? 'Unknown')

  return {
    totalRevenue,
    totalVisits,
    totalPatients: totalPatients ?? 0,
    avgRevenuePerVisit: totalVisits > 0 ? Math.round(totalRevenue / totalVisits) : 0,
    byService: Object.entries(svcMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
    byStaff: Object.entries(staffMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
    byPaymentMethod: Object.entries(pmMap).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.revenue - a.revenue),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — Screening, Consent, Assessment, Clinic User Management
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Screening ────────────────────────────────────────────────────────────────
export interface ClinicScreening {
  id: string
  visit_id: string
  patient_id: string
  selected_services: string[]
  chief_complaint: string | null
  vital_signs: ClinicVitalSigns
  par_q: Record<string, boolean>
  msk_location: string[]
  msk_character: string[]
  msk_timing: string[]
  msk_intensity: number | null
  msk_function: string[]
  msk_additional: string[]
  msk_history: string[]
  health_cardiovascular: string[]
  health_metabolic: string[]
  health_respiratory: string[]
  health_musculoskeletal: string[]
  health_special: string[]
  health_female: string[]
  health_medications: string | null
  health_allergies: string[]
  health_surgeries: string | null
  physical_activity_level: string | null
  physical_activity_type: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function getScreeningByVisit(visitId: string): Promise<ClinicScreening | null> {
  const { data } = await supabase
    .from('clinic_screenings')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle()
  return data as ClinicScreening | null
}

export async function upsertScreening(
  screening: Partial<ClinicScreening> & { visit_id: string; patient_id: string },
): Promise<void> {
  const { error } = await supabase
    .from('clinic_screenings')
    .upsert({ ...screening, updated_at: new Date().toISOString() }, { onConflict: 'visit_id' })
  if (error) throw error
}

// ─── Consent ──────────────────────────────────────────────────────────────────
export interface ClinicConsent {
  id: string
  visit_id: string
  patient_id: string
  consent_type: string
  is_agreed: boolean
  signature_data: string | null
  signed_at: string | null
  signed_by_name: string | null
  created_at: string
}

export async function getConsentsByVisit(visitId: string): Promise<ClinicConsent[]> {
  const { data, error } = await supabase
    .from('clinic_consents')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ClinicConsent[]
}

export async function upsertConsent(
  consent: Partial<ClinicConsent> & { visit_id: string; patient_id: string; consent_type: string },
): Promise<void> {
  const existing = await supabase
    .from('clinic_consents')
    .select('id')
    .eq('visit_id', consent.visit_id)
    .eq('consent_type', consent.consent_type)
    .maybeSingle()

  if (existing.data?.id) {
    const { error } = await supabase.from('clinic_consents').update(consent).eq('id', existing.data.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('clinic_consents').insert(consent)
    if (error) throw error
  }
}

// ─── Assessment (SOAP) ──────────────────────────────────────────────────────────
export interface ClinicVitalSigns {
  blood_pressure?: string
  heart_rate?: number
  temperature?: number
  spo2?: number
  respiratory_rate?: number
  weight?: number
  height?: number
}

export interface ClinicAssessment {
  id: string
  visit_id: string
  patient_id: string
  staff_id: string | null
  vital_signs: ClinicVitalSigns
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  diagnosis: string | null
  follow_up_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function getAssessmentByVisit(visitId: string): Promise<ClinicAssessment | null> {
  const { data } = await supabase
    .from('clinic_assessments')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle()
  return data as ClinicAssessment | null
}

export async function upsertAssessment(
  assessment: Partial<ClinicAssessment> & { visit_id: string; patient_id: string },
): Promise<void> {
  const { error } = await supabase
    .from('clinic_assessments')
    .upsert({ ...assessment, updated_at: new Date().toISOString() }, { onConflict: 'visit_id' })
  if (error) throw error
}

// ─── Clinic Users ─────────────────────────────────────────────────────────────
export interface ClinicUser {
  id: string
  email: string
  full_name: string
  role: string
  unit: string | null
  permissions: Record<string, boolean>
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

export async function listClinicUsers(): Promise<ClinicUser[]> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, email, full_name, role, unit, permissions, is_active, last_login_at, created_at')
    .eq('unit', 'clinic')
    .order('full_name')
  if (error) throw error
  return (data ?? []) as ClinicUser[]
}

export async function createClinicUser(u: {
  email: string; full_name: string; role: string
  password: string; permissions: Record<string, boolean>
}): Promise<void> {
  const { error } = await supabase.rpc('create_admin_user', {
    p_email: u.email,
    p_full_name: u.full_name,
    p_role: u.role,
    p_unit: 'clinic',
    p_password: u.password,
    p_permissions: u.permissions,
  })
  if (error) throw error
}

export async function updateClinicUserPermissions(id: string, permissions: Record<string, boolean>): Promise<void> {
  const { error } = await supabase.from('admin_users').update({ permissions }).eq('id', id)
  if (error) throw error
}

export async function toggleClinicUserActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('admin_users').update({ is_active: active }).eq('id', id)
  if (error) throw error
}

export async function resetClinicUserPassword(id: string, newPassword: string): Promise<void> {
  const { error } = await supabase.rpc('reset_admin_password', { p_id: id, p_password: newPassword })
  if (error) throw error
}

// ─── Lock / Unlock ────────────────────────────────────────────────────────────

export type LockableTable = 'clinic_screenings' | 'clinic_consents' | 'clinic_assessments' | 'clinic_transactions'

export interface AuditLog {
  id: string
  action: string
  record_type: string
  record_id: string
  performed_by: string
  performed_by_role: string | null
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// Auto-lock setelah save — panggil ini setelah upsert berhasil
export async function lockRecord(
  table: LockableTable,
  recordId: string,
  lockedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: lockedBy,
    })
    .eq('id', recordId)
  if (error) throw error
}

// Unlock oleh super admin — wajib ada reason
export async function unlockRecord(
  table: LockableTable,
  recordId: string,
  unlockedBy: string,
  unlockedByRole: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', recordId)
  if (error) throw error

  await supabase.from('clinic_audit_logs').insert({
    action: 'unlock',
    record_type: table,
    record_id: recordId,
    performed_by: unlockedBy,
    performed_by_role: unlockedByRole,
    reason,
    metadata: { table },
  })
}

// Re-lock setelah edit selesai
export async function relockRecord(
  table: LockableTable,
  recordId: string,
  lockedBy: string,
  lockedByRole: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: lockedBy,
    })
    .eq('id', recordId)
  if (error) throw error

  await supabase.from('clinic_audit_logs').insert({
    action: 'relock',
    record_type: table,
    record_id: recordId,
    performed_by: lockedBy,
    performed_by_role: lockedByRole,
    reason: 'Re-locked after edit',
    metadata: { table },
  })
}

export async function listAuditLogs(params: {
  recordType?: string
  recordId?: string
  page?: number
  pageSize?: number
}): Promise<{ rows: AuditLog[]; count: number }> {
  const { recordType, recordId, page = 0, pageSize = 20 } = params
  let q = supabase
    .from('clinic_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (recordType) q = q.eq('record_type', recordType)
  if (recordId) q = q.eq('record_id', recordId)
  q = q.range(page * pageSize, (page + 1) * pageSize - 1)

  const { data, error, count } = await q
  if (error) throw error
  return { rows: (data ?? []) as unknown as AuditLog[], count: count ?? 0 }
}

// ─── Paket (clinic_packages / clinic_patient_packages) ───────────────────────────
export interface ClinicPackage {
  id: string
  name: string
  category: string
  sessions: number
  price_per_session: number
  package_price: number
  retail_price: number
  discount_percent: number
  is_active: boolean
}

export interface ClinicPatientPackage {
  id: string
  patient_id: string
  package_id: string
  total_sessions: number
  used_sessions: number
  remaining_sessions: number
  purchased_at: string
  expires_at: string | null
  is_active: boolean
  notes: string | null
  package?: ClinicPackage
}

// Fetch semua paket aktif
export async function listPackages(): Promise<ClinicPackage[]> {
  const { data, error } = await supabase
    .from('clinic_packages')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('sessions')
  if (error) throw error
  return (data ?? []) as ClinicPackage[]
}

// Fetch paket milik pasien (default hanya yang aktif)
export async function listPatientPackages(
  patientId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ClinicPatientPackage[]> {
  let q = supabase
    .from('clinic_patient_packages')
    .select('*, package:clinic_packages(*)')
    .eq('patient_id', patientId)
  if (!opts.includeInactive) q = q.eq('is_active', true)
  q = q.order('purchased_at', { ascending: false })
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ClinicPatientPackage[]
}

// Fetch paket aktif pasien yang masih punya sisa sesi
export async function listPatientActivePackages(patientId: string): Promise<ClinicPatientPackage[]> {
  const { data, error } = await supabase
    .from('clinic_patient_packages')
    .select('*, package:clinic_packages(*)')
    .eq('patient_id', patientId)
    .eq('is_active', true)
    .gt('remaining_sessions', 0)
    .order('purchased_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ClinicPatientPackage[]
}

// Fetch satu patient package by id (untuk detail kunjungan)
export async function getPatientPackage(id: string): Promise<ClinicPatientPackage | null> {
  const { data, error } = await supabase
    .from('clinic_patient_packages')
    .select('*, package:clinic_packages(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as ClinicPatientPackage | null
}

// Beli paket baru untuk pasien
export async function purchasePatientPackage(input: {
  patient_id: string
  package_id: string
  total_sessions: number
  notes?: string
}): Promise<ClinicPatientPackage> {
  const { data, error } = await supabase
    .from('clinic_patient_packages')
    .insert({
      patient_id: input.patient_id,
      package_id: input.package_id,
      total_sessions: input.total_sessions,
      used_sessions: 0,
      is_active: true,
      notes: input.notes ?? null,
      purchased_at: new Date().toISOString(),
    })
    .select('*, package:clinic_packages(*)')
    .single()
  if (error) throw error
  return data as ClinicPatientPackage
}

// Pakai 1 sesi paket (dipanggil saat kasir close bill)
export async function usePackageSession(patientPackageId: string): Promise<void> {
  const { data: pkg, error: fetchErr } = await supabase
    .from('clinic_patient_packages')
    .select('used_sessions, total_sessions')
    .eq('id', patientPackageId)
    .single()
  if (fetchErr) throw fetchErr
  if (!pkg) return

  const newUsed = (pkg as { used_sessions: number; total_sessions: number }).used_sessions + 1
  const isExhausted = newUsed >= (pkg as { used_sessions: number; total_sessions: number }).total_sessions

  const { error } = await supabase
    .from('clinic_patient_packages')
    .update({
      used_sessions: newUsed,
      is_active: !isExhausted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', patientPackageId)
  if (error) throw error
}

// Schedule follow-up visit
export async function scheduleFollowUpVisit(input: {
  patient_id: string
  follow_up_date: string
  follow_up_notes: string | null
  patient_package_id: string | null
  services: { service_id: string; service_name: string; price: number }[]
}): Promise<{ id: string; visit_code: string }> {
  const { data: visit, error: visitErr } = await supabase
    .from('clinic_visits')
    .insert({
      patient_id: input.patient_id,
      visit_date: input.follow_up_date,
      status: 'scheduled',
      payment_status: input.patient_package_id ? 'package' : 'unpaid',
      patient_package_id: input.patient_package_id,
      follow_up_notes: input.follow_up_notes,
      created_by: 'dokter',
    })
    .select('id, visit_code')
    .single()
  if (visitErr) throw visitErr

  const created = visit as { id: string; visit_code: string }

  if (input.services.length > 0) {
    const { error: svcErr } = await supabase
      .from('clinic_visit_services')
      .insert(input.services.map((s, i) => ({
        visit_id: created.id,
        service_id: s.service_id,
        service_name: s.service_name,
        price: s.price,
        sort_order: i,
      })))
    if (svcErr) throw svcErr
  }

  return { id: created.id, visit_code: created.visit_code }
}

export async function createManualVisit(payload: {
  patient_id: string
  visit_date: string
  visit_time: string | null
  chief_complaint: string
  services: { service_id: string; service_name: string; price: number }[]
  patient_package_id?: string | null
  created_by: string
}): Promise<{ visit_id: string; visit_code: string }> {
  // 1. Insert clinic_visits
  const { data: visit, error: visitErr } = await supabase
    .from('clinic_visits')
    .insert({
      patient_id: payload.patient_id,
      visit_date: payload.visit_date,
      visit_time: payload.visit_time || null,
      status: 'scheduled',
      payment_status: payload.patient_package_id ? 'package' : 'unpaid',
      chief_complaint: payload.chief_complaint,
      patient_package_id: payload.patient_package_id ?? null,
      created_by: payload.created_by,
    })
    .select('id, visit_code')
    .single()

  if (visitErr) throw visitErr

  // 2. Insert clinic_visit_services
  if (payload.services.length > 0) {
    const { error: svcErr } = await supabase
      .from('clinic_visit_services')
      .insert(payload.services.map((s, i) => ({
        visit_id: visit.id,
        service_id: s.service_id,
        service_name: s.service_name,
        price: s.price,
        sort_order: i,
      })))
    if (svcErr) throw svcErr
  }

  return { visit_id: visit.id, visit_code: visit.visit_code }
}
