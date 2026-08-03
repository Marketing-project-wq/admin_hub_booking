import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { fmtRp, fmtDateTime } from '../../lib/format'
import type { ClinicTransaction } from '../../lib/clinicBilling'

// Kwitansi A4 — layout meniru format kwitansi lama klinik (kop + judul "Kuitansi"
// di kanan, Info Pasien, tabel Info Tagihan, Catatan + breakdown, footer
// disclaimer). Data apa adanya dari clinic_transactions: 1 layanan per transaksi
// (Qty selalu 1), 1 metode pembayaran, admin_fee; kategori tanpa infrastruktur
// data (Obat & BHP, Vaksin) sengaja tidak ditampilkan.
// Pola print = MedicalResumeModal (portal + body class + #root display:none):
// pola lama visibility+absolute rusak oleh backdrop-filter overlay, dan class
// no-print di overlay (ancestor print-area) membuat display:none menelan
// seluruh isi cetakan.

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit', kredit: 'Kredit' }

// Angka di tabel tanpa prefix "Rp" — kolomnya sudah berlabel (Rp), meniru referensi.
const num = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('id-ID')

const RED = '#C0392B'
const INK = '#111827'
const MUTED = '#4B5563'

const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 8, padding: '2.5px 0', fontSize: 12.5 }}>
    <span style={{ color: MUTED, width: 120, flexShrink: 0, fontWeight: 600 }}>{label}</span>
    <span style={{ flex: 1 }}>: {value ?? '-'}</span>
  </div>
)

const SumRow = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0',
    fontSize: strong ? 14 : 12.5, fontWeight: strong ? 800 : 600,
    borderTop: strong ? `1.5px solid ${INK}` : 'none', marginTop: strong ? 4 : 0, paddingTop: strong ? 6 : 3,
  }}>
    <span style={{ color: strong ? INK : MUTED }}>{label}</span>
    <span>{value}</span>
  </div>
)

export default function ClinicReceiptModal({ transaction: t, onClose }: {
  transaction: ClinicTransaction
  onClose: () => void
}) {
  const method = (t.payment_method || '').toLowerCase()
  const isCard = method === 'debit' || method === 'kredit'
  const methodLabel = METHOD_LABEL[method] ?? (t.payment_method || '-')

  useEffect(() => {
    document.body.classList.add('receipt-print-mode')
    return () => document.body.classList.remove('receipt-print-mode')
  }, [])

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11.5, fontWeight: 700, color: INK, background: '#F3F4F6' }
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, borderBottom: '1px solid #E5E7EB' }
  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: RED, borderBottom: '1.5px solid #E5E7EB', padding: '14px 0 4px', marginBottom: 8 }

  return createPortal(
    <div className="modal-overlay receipt-overlay" onClick={onClose}
      style={{ overflowY: 'auto', padding: '24px 12px' }}>
      <style>{`
        @media print {
          body.receipt-print-mode #root { display: none !important; }
          .receipt-no-print { display: none !important; }
          .receipt-overlay {
            position: static !important; inset: auto !important;
            display: block !important; height: auto !important; min-height: 0 !important;
            overflow: visible !important; padding: 0 !important; background: none !important;
            -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
          }
          .receipt-wrap { max-width: none !important; }
          .receipt-sheet {
            width: 100% !important; max-width: none !important; margin: 0 !important;
            padding: 0 !important; border-radius: 0 !important; box-shadow: none !important;
            /* Area konten A4 = 297mm - 2x14mm margin @page; tanpa override ini
               minHeight 297mm dari layar akan meluber dan mendorong footer ke hal. 2. */
            min-height: 269mm !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      <div className="receipt-wrap" style={{ width: '100%', maxWidth: 800, margin: '0 auto' }} onClick={e => e.stopPropagation()}>
        {/* Kontrol — tidak ikut tercetak */}
        <div className="receipt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => window.print()}>
            Print / Simpan PDF
          </button>
          <button className="btn-secondary" style={{ width: 'auto', padding: '8px 12px' }} onClick={onClose}>
            <X size={14} style={{ verticalAlign: -2 }} /> Tutup
          </button>
        </div>

        {/* Lembar kwitansi — HARDCODE putih/gelap: dokumen resmi tidak ikut tema.
            Flex kolom + minHeight setinggi A4: footer (marginTop:auto) selalu
            menempel di dasar halaman, di layar maupun print; konten panjang
            tetap mendorong footer ke bawah konten (tidak pernah overlap). */}
        <div className="receipt-sheet" style={{ background: '#fff', color: INK, width: '100%', padding: '28px 34px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.55, colorScheme: 'light', display: 'flex', flexDirection: 'column', minHeight: '297mm' }}>
          {/* Kop */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderBottom: `2.5px solid ${INK}`, paddingBottom: 12 }}>
            <div>
              <img src="/20fit-sports-clinic-black.png" alt="20FIT Sports Clinic" style={{ width: 190, height: 'auto', display: 'block' }} />
              <div style={{ fontSize: 11, color: MUTED, marginTop: 8, maxWidth: 320 }}>
                Jl. Sinabung No.9, RT.8/RW.5, Gunung, Kec. Kby. Baru, Jakarta Selatan
              </div>
              <div style={{ fontSize: 11, color: MUTED }}>+62 811 1185 9109</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: RED, letterSpacing: 0.5 }}>Kuitansi</div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, marginTop: 2 }}>{t.transaction_code}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Dibuat pada {fmtDateTime(t.created_at)}</div>
              <div style={{ fontSize: 11, color: MUTED }}>Diubah pada {fmtDateTime(t.updated_at)}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Kasir: {t.cashier_name || '-'}</div>
            </div>
          </div>

          {/* Info Pasien */}
          <div style={sectionTitle}>Info Pasien</div>
          <InfoRow label="Nama Pasien" value={t.patient?.full_name ?? '-'} />
          <InfoRow label="No. Telepon" value={t.patient?.phone ?? '-'} />
          <InfoRow label="Alamat" value={t.patient?.address || '-'} />
          <InfoRow label="No. RM" value={<span style={{ fontFamily: 'monospace' }}>{t.patient?.patient_code ?? '-'}</span>} />

          {/* Info Tagihan */}
          <div style={sectionTitle}>Info Tagihan</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Item</th>
                <th style={{ ...th, textAlign: 'center', width: 60 }}>Qty</th>
                <th style={{ ...th, textAlign: 'right', width: 130 }}>Harga (Rp)</th>
                <th style={{ ...th, textAlign: 'right', width: 130 }}>Total Harga (Rp)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ ...td, fontWeight: 700 }} colSpan={4}>Layanan</td></tr>
              <tr>
                <td style={td}>{t.service_name}</td>
                <td style={{ ...td, textAlign: 'center' }}>1</td>
                <td style={{ ...td, textAlign: 'right' }}>{num(t.service_price)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{num(t.service_price)}</td>
              </tr>
            </tbody>
          </table>

          {/* Catatan + breakdown */}
          <div style={{ display: 'flex', gap: 32, marginTop: 16, marginBottom: 28, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: RED, marginBottom: 4 }}>Catatan</div>
              <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'pre-wrap' }}>{t.notes || '-'}</div>
            </div>
            <div style={{ width: 300, flexShrink: 0 }}>
              <SumRow label="Subtotal Layanan" value={fmtRp(t.service_price)} />
              <SumRow label="Total Diskon" value={t.discount > 0 ? `-${fmtRp(t.discount)}` : fmtRp(0)} />
              <SumRow label="Biaya Administrasi" value={fmtRp(t.admin_fee ?? 0)} />
              <SumRow label="Total Tagihan" value={fmtRp(t.total_amount)} strong />
              <SumRow label={`Dibayar via ${methodLabel}`} value={fmtRp(t.total_amount)} />
              {isCard && (
                <div style={{ fontSize: 11, color: MUTED, textAlign: 'right' }}>
                  Kartu: {t.payment_detail?.bank_name || '-'} · **** {t.payment_detail?.card_last4 || '----'}
                </div>
              )}
              {method === 'transfer' && t.payment_detail?.transfer_ref && (
                <div style={{ fontSize: 11, color: MUTED, textAlign: 'right' }}>Ref: {t.payment_detail.transfer_ref}</div>
              )}
            </div>
          </div>

          {/* Footer — marginTop:auto mendorongnya ke dasar sheet (flex kolom) */}
          <div style={{ textAlign: 'center', fontSize: 10.5, color: MUTED, marginTop: 'auto', borderTop: '1px solid #E5E7EB', paddingTop: 10, lineHeight: 1.6 }}>
            Dokumen digital ini sah diterbitkan oleh 20FIT Sports Clinic dan diproses secara komputerisasi — sah tanpa tanda tangan basah.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
