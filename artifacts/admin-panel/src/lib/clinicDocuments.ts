import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Clinic Documents data layer
//
// Dokumen pasien (PDF / gambar / dokumen kantor) di bucket privat `clinic-documents`
// + tabel `clinic_documents`. Dipakai oleh DocumentsPanel (tab Document EMR dokter)
// dan halaman Dokumen (menu admin/kasir/registrasi). Pola storage mengikuti
// PostureScanPanel (bucket privat → signed URL untuk baca).
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'clinic-documents'
export const DOC_SIGNED_TTL = 3600
export const DOC_MAX_BYTES = 20 * 1024 * 1024 // 20 MB — samakan dgn limit bucket

export interface ClinicDocument {
  id: string
  patient_id: string
  visit_id: string | null
  category: string
  title: string | null
  file_path: string
  file_name: string
  file_type: string | null
  file_size: number | null
  uploaded_by: string | null
  created_at: string
}

export interface DocCategory { key: string; label: string }
export const DOC_CATEGORIES: DocCategory[] = [
  { key: 'umum', label: 'Umum / Lainnya' },
  { key: 'lab', label: 'Hasil Lab' },
  { key: 'radiologi', label: 'Radiologi / Rontgen' },
  { key: 'rujukan', label: 'Surat Rujukan' },
  { key: 'resep', label: 'Resep' },
  { key: 'identitas', label: 'Identitas / Asuransi' },
  { key: 'postur', label: 'Foto Postur' },
]
export const docCategoryLabel = (key: string): string =>
  DOC_CATEGORIES.find(c => c.key === key)?.label ?? key

// Ekstensi yang diizinkan → mime. Dipakai untuk (1) validasi sisi klien dan
// (2) menetapkan contentType eksplisit saat upload — file dgn File.type kosong
// (mis. sebagian .heic/.docx) tetap terunggah dgn mime yang diterima bucket.
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

// Atribut accept untuk <input type="file">. image/* memudahkan buka kamera di HP.
export const DOC_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,image/*,application/pdf'

export function fileExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}
export function isAllowedDocFile(name: string): boolean {
  return !!EXT_MIME[fileExt(name)]
}
export function resolveContentType(file: File): string {
  return EXT_MIME[fileExt(file.name)] || file.type || 'application/octet-stream'
}
export function isImageDoc(d: { file_type: string | null; file_name: string }): boolean {
  if (d.file_type && d.file_type.startsWith('image/')) return true
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(fileExt(d.file_name))
}
export function isPdfDoc(d: { file_type: string | null; file_name: string }): boolean {
  return d.file_type === 'application/pdf' || fileExt(d.file_name) === 'pdf'
}

/** Ikon sederhana per tipe file (emoji) untuk kartu non-gambar. */
export function docIcon(d: { file_type: string | null; file_name: string }): string {
  if (isImageDoc(d)) return '🖼️'
  if (isPdfDoc(d)) return '📄'
  const ext = fileExt(d.file_name)
  if (ext === 'doc' || ext === 'docx') return '📝'
  if (ext === 'xls' || ext === 'xlsx') return '📊'
  return '📎'
}

export function humanFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function listPatientDocuments(patientId: string): Promise<ClinicDocument[]> {
  const { data, error } = await supabase
    .from('clinic_documents')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ClinicDocument[]
}

export interface UploadDocInput {
  patientId: string
  visitId?: string | null
  category: string
  title?: string | null
  file: File
  uploadedBy?: string | null
}

export async function uploadDocument(input: UploadDocInput): Promise<ClinicDocument> {
  const { patientId, visitId = null, category, title = null, file, uploadedBy = null } = input
  if (!patientId) throw new Error('Pasien belum dipilih.')
  if (!isAllowedDocFile(file.name)) {
    throw new Error('Tipe file tidak didukung. Gunakan gambar, PDF, atau dokumen (doc/docx/xls/xlsx/txt).')
  }
  if (file.size > DOC_MAX_BYTES) {
    throw new Error('Ukuran file melebihi 20 MB.')
  }
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  const path = `${patientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
  const contentType = resolveContentType(file)

  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType, upsert: false })
  if (up.error) throw up.error

  const ins = await supabase.from('clinic_documents').insert({
    patient_id: patientId,
    visit_id: visitId,
    category,
    title,
    file_path: path,
    file_name: file.name,
    file_type: contentType,
    file_size: file.size,
    uploaded_by: uploadedBy,
  }).select('*').single()

  if (ins.error) {
    // Bersihkan objek yatim bila insert baris gagal (best-effort).
    try { await supabase.storage.from(BUCKET).remove([path]) } catch { /* abaikan */ }
    throw ins.error
  }
  return ins.data as ClinicDocument
}

/** Signed URL untuk membuka/preview objek (bucket privat). null bila gagal. */
export async function signedDocUrl(path: string, ttl = DOC_SIGNED_TTL): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttl)
  return data?.signedUrl ?? null
}

export async function deleteDocument(doc: { id: string; file_path: string }): Promise<void> {
  // Hapus objek storage dulu (best-effort) lalu baris tabel.
  try { await supabase.storage.from(BUCKET).remove([doc.file_path]) } catch { /* abaikan */ }
  const { error } = await supabase.from('clinic_documents').delete().eq('id', doc.id)
  if (error) throw error
}
