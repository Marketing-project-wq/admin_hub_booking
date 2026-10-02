// Kolom "Payment" booking Arena. Booking Rp 0 (voucher 100%) disimpan dengan
// payment_method 'voucher' (+ payment_ref = kode voucher bila dikonfirmasi server lewat
// confirm_free_voucher_booking) → tampil badge "Voucher" + kodenya. Booking berbayar
// yang memakai voucher diskon sebagian tetap tampil metodenya, kode voucher di bawahnya.
type Props = {
  method: unknown
  voucherCode?: unknown
  paymentRef?: unknown
  showCode?: boolean
}

export function bookingVoucherCode(method: unknown, voucherCode: unknown, paymentRef: unknown): string | null {
  const code = String(voucherCode || '') || (method === 'voucher' ? String(paymentRef || '') : '')
  return code || null
}

export default function PaymentMethodCell({ method, voucherCode, paymentRef, showCode = true }: Props) {
  const code = bookingVoucherCode(method, voucherCode, paymentRef)
  const codeLine = showCode && code ? (
    <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }} title={`Kode voucher: ${code}`}>
      {code}
    </div>
  ) : null

  if (method === 'voucher') {
    return (
      <div style={{ whiteSpace: 'nowrap' }}>
        <span className="badge badge-info" title="Lunas dengan voucher (Rp 0)">Voucher</span>
        {codeLine}
      </div>
    )
  }
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      {String(method || '') || '-'}
      {codeLine}
    </div>
  )
}
