import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtTime } from '../../lib/format'

const UNIT_ID = '6e8f44a7-23d4-4602-90d4-980c63b3acc2'

interface Props {
  type: 'slot' | 'class'
  onClose: () => void
  onRefresh: () => void
}

export default function ManualBookingModal({ type, onClose, onRefresh }: Props) {
  const [units, setUnits] = useState<Record<string, unknown>[]>([])
  const [classTypes, setClassTypes] = useState<Record<string, unknown>[]>([])
  const [schedules, setSchedules] = useState<Record<string, unknown>[]>([])
  const [coaches, setCoaches] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [unitId, setUnitId] = useState(UNIT_ID)
  const [classTypeId, setClassTypeId] = useState('')
  const [scheduleId, setScheduleId] = useState('')
  // Mode backdate (khusus class): dropdown Jadwal menampilkan jadwal LAMPAU
  // untuk input booking susulan. Slot booking tidak perlu — tanggalnya bebas.
  const [showPast, setShowPast] = useState(false)
  const [bookingDate, setBookingDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [bookerType, setBookerType] = useState('guest')          // tier harga + booker_type (member/guest)
  const [customerType, setCustomerType] = useState('individual')  // individual/corporation
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [voucherCode, setVoucherCode] = useState('')
  const [price, setPrice] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  // Slot (sewa venue): venue saja atau dengan coach (+ pilih coach). Harga tetap diatur manual.
  const [rentType, setRentType] = useState<'venue_only' | 'with_coach'>('venue_only')
  const [coachName, setCoachName] = useState('')

  const priceFinal = Math.max(0, price - discount)

  useEffect(() => {
    if (type === 'slot') {
      supabase.from('arena_booking_units').select('*').eq('is_active', true).then(({ data }) => {
        if (data) {
          setUnits(data)
          // If only one unit, auto-select it
          if (data.length === 1) setUnitId(data[0].id as string)
        }
      })
      // Daftar coach aktif utk pilihan "Dengan Coach".
      supabase.from('arena_coaches').select('id, name').eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false }).order('name')
        .then(({ data }) => { if (data) setCoaches(data) })
    } else {
      supabase.from('arena_class_types')
        .select('id, name, price_guest, price_member, duration_min, color')
        .eq('is_active', true)
        .order('name')
        .then(({ data }) => { if (data) setClassTypes(data) })
    }
  }, [type])

  useEffect(() => {
    if (type === 'slot' && unitId) {
      const unit = units.find(u => u.id === unitId)
      if (unit) {
        const priceVal = bookerType === 'member'
          ? Number(unit.price_member)
          : Number(unit.price_guest)
        setPrice(priceVal)
        if (startTime && unit.slot_duration) {
          const [h, m] = startTime.split(':').map(Number)
          const totalMin = h * 60 + m + Number(unit.slot_duration)
          const endH = String(Math.floor(totalMin / 60)).padStart(2, '0')
          const endM = String(totalMin % 60).padStart(2, '0')
          setEndTime(`${endH}:${endM}`)
        }
      }
    }
  }, [unitId, bookerType, startTime, units, type])

  useEffect(() => {
    if (type === 'class' && classTypeId) {
      const ct = classTypes.find(c => c.id === classTypeId)
      if (ct) {
        setPrice(bookerType === 'member' ? Number(ct.price_member) : Number(ct.price_guest))
      }
      const today = new Date().toISOString().slice(0, 10)
      const base = supabase.from('arena_class_schedules')
        .select('id, schedule_date, start_time, end_time, instructor, quota')
        .eq('class_type_id', classTypeId)
        .eq('is_cancelled', false)
      // Backdate: jadwal yang SUDAH LEWAT, terbaru dulu, dibatasi 100 supaya
      // dropdown tetap wajar. Mode normal: hari ini ke depan (perilaku semula).
      const query = showPast
        ? base.lt('schedule_date', today).order('schedule_date', { ascending: false }).order('start_time', { ascending: true }).limit(100)
        : base.gte('schedule_date', today).order('schedule_date', { ascending: true })
      query.then(({ data }) => { if (data) setSchedules(data) })
    } else {
      setSchedules([])
      setScheduleId('')
    }
  }, [classTypeId, classTypes, bookerType, type, showPast])

  useEffect(() => {
    if (type === 'class' && classTypeId && bookerType) {
      const ct = classTypes.find(c => c.id === classTypeId)
      if (ct) setPrice(bookerType === 'member' ? Number(ct.price_member) : Number(ct.price_guest))
    }
  }, [bookerType, classTypeId, classTypes, type])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (type === 'slot') {
        if (rentType === 'with_coach' && !coachName) throw new Error('Pilih coach untuk sewa "Dengan Coach"')
        const { data: codeData, error: codeErr } = await supabase.rpc('generate_booking_code')
        if (codeErr) throw codeErr
        const { error: insertErr } = await supabase.from('arena_bookings').insert({
          booking_code: codeData,
          unit_id: unitId,
          booking_date: bookingDate,
          start_time: startTime,
          end_time: endTime,
          booker_type: bookerType,
          customer_type: customerType,
          full_name: fullName,
          email,
          phone,
          notes: notes || null,
          voucher_code: voucherCode || null,
          price: priceFinal,
          discount,
          price_before_disc: price,
          status: 'confirmed',
          payment_method: paymentMethod,
          paid_at: new Date().toISOString(),
          rent_type: rentType,
          coach_name: rentType === 'with_coach' ? coachName : null,
        })
        if (insertErr) throw insertErr
      } else {
        // Check quota first
        const { count } = await supabase.from('arena_class_bookings')
          .select('*', { count: 'exact', head: true })
          .eq('schedule_id', scheduleId)
          .eq('status', 'confirmed')
        const schedule = schedules.find(s => s.id === scheduleId)
        if (schedule && count !== null && count >= Number(schedule.quota)) {
          throw new Error('Jadwal ini sudah penuh')
        }
        const { data: codeData, error: codeErr } = await supabase.rpc('generate_class_booking_code')
        if (codeErr) throw codeErr
        const { error: insertErr } = await supabase.from('arena_class_bookings').insert({
          booking_code: codeData,
          schedule_id: scheduleId,
          booker_type: bookerType,
          customer_type: customerType,
          full_name: fullName,
          email,
          phone,
          notes: notes || null,
          price: priceFinal,
          discount,
          price_before_disc: price,
          status: 'confirmed',
          payment_method: paymentMethod,
          paid_at: new Date().toISOString(),
        })
        if (insertErr) throw insertErr
      }
      onRefresh()
      onClose()
    } catch (err: unknown) {
      // Surface the real Supabase/Postgres error instead of a generic message.
      // A PostgrestError carries { message, code, details, hint } — the code
      // (e.g. 42501 = RLS, 23502 = not-null, 23503 = FK, PGRST204 = unknown
      // column) is what actually pinpoints the root cause, so include it.
      console.error('[ManualBookingModal] submit failed:', err)
      const e = err as { message?: string; code?: string; details?: string; hint?: string }
      const parts = [e?.message, e?.details, e?.hint].filter(Boolean)
      const base = parts.length > 0
        ? parts.join(' — ')
        : (err instanceof Error ? err.message : 'Terjadi kesalahan')
      setError(e?.code ? `${base} (code: ${e.code})` : base)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>
            {type === 'slot' ? 'Manual Slot Booking' : 'Manual Class Booking'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          {type === 'slot' ? (
            <>
              <div className="form-group">
                <label>Unit *</label>
                <select value={unitId} onChange={e => setUnitId(e.target.value)} required>
                  <option value="">Pilih unit...</option>
                  {units.map((u: Record<string, unknown>) => (
                    <option key={u.id as string} value={u.id as string}>{u.name as string}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Tanggal *</label>
                <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Booker Type *</label>
                  <select value={bookerType} onChange={e => setBookerType(e.target.value)}>
                    <option value="guest">Guest</option>
                    <option value="member">Member</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Tipe Customer *</label>
                  <select value={customerType} onChange={e => setCustomerType(e.target.value)}>
                    <option value="individual">Individual</option>
                    <option value="corporation">Corporation</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Jam Selesai *</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sewa *</label>
                  <select value={rentType}
                    onChange={e => { const v = e.target.value as 'venue_only' | 'with_coach'; setRentType(v); if (v === 'venue_only') setCoachName('') }}>
                    <option value="venue_only">Venue Saja</option>
                    <option value="with_coach">Dengan Coach</option>
                  </select>
                </div>
                {rentType === 'with_coach' && (
                  <div className="form-group">
                    <label>Coach *</label>
                    <select value={coachName} onChange={e => setCoachName(e.target.value)} required>
                      <option value="">Pilih coach...</option>
                      {coaches.map((c: Record<string, unknown>) => (
                        <option key={c.id as string} value={c.name as string}>{c.name as string}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Kelas *</label>
                <select value={classTypeId} onChange={e => { setClassTypeId(e.target.value); setScheduleId('') }} required>
                  <option value="">Pilih kelas...</option>
                  {classTypes.map((ct: Record<string, unknown>) => (
                    <option key={ct.id as string} value={ct.id as string}>{ct.name as string}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Jadwal *</label>
                <select value={scheduleId} onChange={e => setScheduleId(e.target.value)} required disabled={!classTypeId}>
                  <option value="">{showPast ? 'Pilih jadwal lampau...' : 'Pilih jadwal...'}</option>
                  {schedules.map((s: Record<string, unknown>) => (
                    <option key={s.id as string} value={s.id as string}>
                      {fmtDate(s.schedule_date as string)} {fmtTime(s.start_time as string)}–{fmtTime(s.end_time as string)} | {s.instructor as string} | Quota: {s.quota as number}
                    </option>
                  ))}
                </select>
                {/* Toggle backdate — pilihan jadwal di-reset saat ganti mode karena
                    jadwal terpilih belum tentu ada di daftar mode satunya. */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 400 }}>
                  <input type="checkbox" checked={showPast}
                    onChange={e => { setShowPast(e.target.checked); setScheduleId('') }}
                    style={{ width: 'auto', margin: 0 }} />
                  Backdate — tampilkan jadwal yang sudah lewat
                </label>
                {classTypeId && schedules.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    {showPast ? 'Tidak ada jadwal lampau untuk kelas ini.' : 'Tidak ada jadwal mendatang untuk kelas ini.'}
                  </p>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Booker Type *</label>
                  <select value={bookerType} onChange={e => setBookerType(e.target.value)}>
                    <option value="guest">Guest</option>
                    <option value="member">Member</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Tipe Customer *</label>
                  <select value={customerType} onChange={e => setCustomerType(e.target.value)}>
                    <option value="individual">Individual</option>
                    <option value="corporation">Corporation</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Nama Lengkap *</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Telp *</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} required />
            </div>
            {type === 'slot' && (
              <div className="form-group">
                <label>Voucher Code</label>
                <input type="text" value={voucherCode} onChange={e => setVoucherCode(e.target.value)} />
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="modal-section">
            <div className="form-row">
              <div className="form-group">
                <label>Harga (Rp)</label>
                <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} min={0} />
              </div>
              <div className="form-group">
                <label>Diskon (Rp)</label>
                <input type="number" value={discount} onChange={e => setDiscount(Number(e.target.value))} min={0} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Harga Final:</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{fmtRp(priceFinal)}</span>
            </div>
            <div className="form-group">
              <label>Payment Method *</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="transfer">Transfer</option>
                <option value="voucher">Voucher</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Menyimpan...' : 'Simpan Booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
