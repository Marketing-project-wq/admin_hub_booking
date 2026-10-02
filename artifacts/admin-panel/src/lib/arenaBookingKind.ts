// Pemisahan arena_bookings jadi dua jenis untuk menu & report admin:
//   * Venue      — sewa arena per jam/eksklusif: rent_type NULL (booking slot lama),
//                  'venue_only', 'with_coach' (termasuk Rent Arena dari web).
//   * Open Arena — pass Open Arena/Open Gym dari web: harian, 1 bulan, with coach,
//                  with head coach, dan bundle (5x/10x Arena + Recovery, 1 Month Open Gym).
// Dibedakan dari kolom rent_type (sudah diisi booking web phase-2), bukan dari prefix
// kode — keduanya tetap BK- karena webhook pembayaran merutekan BK- ke arena_bookings.
// Venue = semua yang BUKAN Open Arena (termasuk NULL), supaya tidak ada booking yang
// hilang dari kedua menu bila nanti muncul rent_type baru.

export type ArenaBookingKind = 'venue' | 'open_arena'

export const OPEN_ARENA_RENT_TYPES = [
  'open_arena', 'open_arena_month', 'open_arena_coach', 'open_arena_head_coach', 'bundle',
] as const

export const RENT_TYPE_LABEL: Record<string, string> = {
  venue_only: 'Venue Saja',
  with_coach: 'Dengan Coach',
  open_arena: 'Harian',
  open_arena_month: '1 Bulan',
  open_arena_coach: 'With Coach',
  open_arena_head_coach: 'With Head Coach',
  bundle: 'Bundle',
}

export const KIND_TITLE: Record<ArenaBookingKind, string> = {
  venue: 'Booking Venue',
  open_arena: 'Open Arena',
}

export function arenaBookingKind(rentType: unknown): ArenaBookingKind {
  return (OPEN_ARENA_RENT_TYPES as readonly string[]).includes(String(rentType ?? '')) ? 'open_arena' : 'venue'
}

export function rentTypeLabel(rentType: unknown): string {
  const k = String(rentType ?? '')
  return RENT_TYPE_LABEL[k] || (k ? k : 'Slot')
}

// Filter PostgREST per jenis. Venue memakai or(); or() lain (mis. pencarian) di query yang
// sama digabung AND oleh PostgREST.
export function applyKindFilter<Q>(query: Q, kind: ArenaBookingKind): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any
  if (kind === 'open_arena') return q.in('rent_type', OPEN_ARENA_RENT_TYPES as readonly string[]) as Q
  return q.or(`rent_type.is.null,rent_type.not.in.(${OPEN_ARENA_RENT_TYPES.join(',')})`) as Q
}
