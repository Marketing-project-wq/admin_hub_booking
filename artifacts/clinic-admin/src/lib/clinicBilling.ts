import { supabase } from '@workspace/admin-shared'
import { ClinicVisit, ClinicPatient } from './clinic'

export interface ClinicTransaction {
  id: string
  transaction_code: string
  visit_id: string | null
  patient_id: string
  service_id: string | null
  service_name: string
  service_price: number
  discount: number
  total_amount: number
  payment_method: string // cash | transfer | qris | debit | kredit
  payment_detail: {
    card_last4?: string
    bank_name?: string
    transfer_ref?: string
  }
  payment_status: string // paid | pending | cancelled
  notes: string | null
  cashier_name: string | null
  created_at: string
  updated_at: string
  // joined
  patient?: Pick<ClinicPatient, 'full_name' | 'phone' | 'patient_code'> | null
  visit?: (Pick<ClinicVisit, 'visit_code' | 'visit_date' | 'visit_time' | 'patient_package_id'> & {
    services: { service_name: string; price: number }[]
  }) | null
}

export interface CreateTransactionPayload {
  visit_id?: string
  patient_id: string
  service_id?: string
  service_name: string
  service_price: number
  discount: number
  total_amount: number
  payment_method: string
  payment_detail: Record<string, string>
  notes?: string
  cashier_name?: string
}

// List transaksi dengan filter
export async function listTransactions(params: {
  dateFrom?: string
  dateTo?: string
  search?: string
  paymentMethod?: string
  page?: number
  pageSize?: number
}): Promise<{ rows: ClinicTransaction[]; count: number }> {
  const { dateFrom, dateTo, search = '', paymentMethod = 'all', page = 0, pageSize = 20 } = params
  let q = supabase
    .from('clinic_transactions')
    .select(`
      *,
      patient:clinic_patients(full_name, phone, patient_code),
      visit:clinic_visits(visit_code, visit_date, visit_time, patient_package_id, services:clinic_visit_services(service_name, price))
    `, { count: 'exact' })
    .order('created_at', { ascending: false })

  if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00')
  if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
  if (paymentMethod !== 'all') q = q.eq('payment_method', paymentMethod)
  if (search) q = q.or(`transaction_code.ilike.%${search}%,service_name.ilike.%${search}%`)
  q = q.range(page * pageSize, (page + 1) * pageSize - 1)

  const { data, error, count } = await q
  if (error) throw error
  return { rows: (data ?? []) as unknown as ClinicTransaction[], count: count ?? 0 }
}

// Get transaksi by visit
export async function getTransactionByVisit(visitId: string): Promise<ClinicTransaction | null> {
  const { data } = await supabase
    .from('clinic_transactions')
    .select(`*, patient:clinic_patients(full_name, phone, patient_code), visit:clinic_visits(visit_code, visit_date, visit_time, patient_package_id, services:clinic_visit_services(service_name, price))`)
    .eq('visit_id', visitId)
    .maybeSingle()
  return data as unknown as ClinicTransaction | null
}

// Buat transaksi baru (transaction_code di-generate oleh trigger DB)
export async function createTransaction(payload: CreateTransactionPayload): Promise<ClinicTransaction> {
  const { data, error } = await supabase
    .from('clinic_transactions')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as unknown as ClinicTransaction
}

// Update status visit setelah bayar
export async function completeVisitPayment(visitId: string, method: string, amount: number): Promise<void> {
  const { error } = await supabase
    .from('clinic_visits')
    .update({
      payment_method: method,
      payment_amount: amount,
      payment_status: 'paid',
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId)
  if (error) throw error
}

// Summary kasir hari ini
export async function getTodaySummary(): Promise<{
  totalTransactions: number
  totalRevenue: number
  byCash: number
  byTransfer: number
  byQris: number
  byCard: number
}> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('clinic_transactions')
    .select('total_amount, payment_method')
    .gte('created_at', todayStart.toISOString())
    .eq('payment_status', 'paid')

  if (error) throw error
  const rows = (data ?? []) as { total_amount: number; payment_method: string }[]

  return {
    totalTransactions: rows.length,
    totalRevenue: rows.reduce((s, r) => s + r.total_amount, 0),
    byCash: rows.filter(r => r.payment_method === 'cash').reduce((s, r) => s + r.total_amount, 0),
    byTransfer: rows.filter(r => r.payment_method === 'transfer').reduce((s, r) => s + r.total_amount, 0),
    byQris: rows.filter(r => r.payment_method === 'qris').reduce((s, r) => s + r.total_amount, 0),
    byCard: rows.filter(r => ['debit', 'kredit'].includes(r.payment_method)).reduce((s, r) => s + r.total_amount, 0),
  }
}
