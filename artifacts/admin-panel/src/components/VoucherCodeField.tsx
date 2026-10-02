import React, { useState } from 'react'
import { Sparkles, Copy, Check } from 'lucide-react'
import { generateUniqueVoucherCode, sanitizeVoucherCode, getSavedVoucherPrefix, saveVoucherPrefix } from '../lib/voucherCode'

// Field "Kode voucher" + tombol Generate Kode (kode unik otomatis, tidak perlu diketik)
// + tombol salin + prefix opsional (diingat per unit di localStorage).
// Dipakai di halaman voucher Arena & Clinic.

interface Props {
  value: string
  onChange: (code: string) => void
  storageKey: string            // mis. 'arena' / 'clinic' → prefix diingat terpisah
  defaultPrefix?: string
  disabled?: boolean
  disabledHint?: string
  onError?: (msg: string) => void
  onGeneratingChange?: (busy: boolean) => void
}

export default function VoucherCodeField({
  value, onChange, storageKey, defaultPrefix = '', disabled, disabledHint, onError, onGeneratingChange,
}: Props) {
  const [prefix, setPrefix] = useState(() => getSavedVoucherPrefix(storageKey, defaultPrefix))
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const updatePrefix = (raw: string) => {
    const p = sanitizeVoucherCode(raw).replace(/-/g, '').slice(0, 12)
    setPrefix(p)
    saveVoucherPrefix(storageKey, p)
  }

  const generate = async () => {
    setGenerating(true); onGeneratingChange?.(true)
    try {
      onChange(await generateUniqueVoucherCode(prefix))
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Gagal membuat kode')
    } finally {
      setGenerating(false); onGeneratingChange?.(false)
    }
  }

  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="form-group">
      <label>Kode Voucher *</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text" value={value} disabled={disabled}
          onChange={e => onChange(sanitizeVoucherCode(e.target.value))}
          placeholder="Klik Generate Kode →"
          style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: 1 }}
        />
        <button
          type="button" className="btn-primary" onClick={generate} disabled={generating || disabled}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <Sparkles size={14} /> {generating ? 'Membuat...' : 'Generate Kode'}
        </button>
        {value && (
          <button type="button" className="btn-secondary" onClick={copy} title="Salin kode"
            style={{ display: 'inline-flex', alignItems: 'center', padding: '0 12px' }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
      {disabled && disabledHint ? (
        <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{disabledHint}</small>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Prefix (opsional):</small>
          <input
            type="text" value={prefix} onChange={e => updatePrefix(e.target.value)}
            placeholder="mis. PROMO" aria-label="Prefix kode voucher"
            style={{ width: 120, padding: '4px 8px', fontSize: 12, fontFamily: 'var(--font-mono)' }}
          />
          <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            Klik Generate → kode unik otomatis, contoh <b style={{ fontFamily: 'var(--font-mono)' }}>{prefix ? `${prefix}7KQ2MX` : '7KQ2MXP4'}</b>. Boleh juga diketik manual.
          </small>
        </div>
      )}
    </div>
  )
}
