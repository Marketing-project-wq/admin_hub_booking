# 20FIT Admin Panel

Multi-unit admin panel for 20FIT business units (Arena, Gym, Clinic). Supabase-backed with unit-specific login and role-based access.

## Run & Operate

- `pnpm --filter @workspace/admin-panel run dev` — start the admin panel (Vite, auto PORT)
- `pnpm --filter @workspace/admin-panel run typecheck` — typecheck admin panel
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite 7, React Router v6
- Auth: Supabase JS v2 (`validate_admin_login` RPC)
- Styling: plain CSS (`src/styles/global.css`) — Times New Roman, CSS variables, NO Tailwind/UI lib
- No Drizzle / no Express — purely a Supabase-connected frontend

## Where things live

```
artifacts/admin-panel/src/
├── App.tsx                        # All routes
├── context/AuthContext.tsx        # Auth state, login(), logout(), canAccessUnit()
├── components/
│   ├── Layout.tsx                 # Shell with Sidebar + <Outlet>
│   ├── Sidebar.tsx                # Unit menus (UNIT_MENUS), dividers, super_admin switcher
│   ├── ProtectedRoute.tsx         # Redirects unauthenticated/wrong-unit users
│   └── arena/
│       ├── BookingDetailModal.tsx # Shared detail modal (slot + class)
│       ├── ManualBookingModal.tsx # Walk-in booking create (slot + class)
│       ├── ConfirmModal.tsx       # Generic confirm dialog
│       └── ExportButton.tsx      # CSV export button
├── lib/
│   ├── supabase.ts                # Supabase client
│   └── format.ts                 # fmtRp, fmtDate, fmtDateTime, fmtTime, STATUS_LABEL, exportToCSV, getPeriodRange
├── pages/
│   ├── LandingPage.tsx            # Public "/" — 3 unit cards
│   ├── LoginPage.tsx              # "/login/:unit" — unit-specific login
│   └── arena/
│       ├── ArenaDashboard.tsx     # KPIs (4), bar chart 6mo, recent bookings, status summary
│       ├── ArenaCalendar.tsx      # Month grid: kelas + venue booking dalam satu view, detail modal per event
│       ├── ArenaVenueBooking.tsx  # BK- venue bookings dari komunitas/event, full CRUD + export
│       ├── ArenaSlotBookings.tsx  # BK- bookings CRUD, manual booking, export
│       ├── ArenaClassBookings.tsx # CL- bookings CRUD, manual booking, export
│       ├── ArenaPackageOrders.tsx # PKG- orders + package voucher detail
│       ├── ArenaVouchers.tsx      # Voucher CRUD (add/edit/toggle)
│       └── master/
│           ├── ArenaUnits.tsx        # arena_booking_units CRUD
│           ├── ArenaClassTypes.tsx   # arena_class_types CRUD
│           ├── ArenaSchedules.tsx    # arena_class_schedules + bulk create
│           ├── ArenaCoaches.tsx      # arena_coaches CRUD
│           ├── ArenaAddons.tsx       # arena_addons CRUD
│           └── ArenaBlockedSlots.tsx # arena_blocked_slots CRUD
└── styles/global.css              # ALL styles (single file)
```

## Architecture decisions

- Session persisted in `localStorage` key `admin_user`; `AuthProvider` hydrates on mount
- `validate_admin_login(p_email, p_password, p_unit)` RPC returns user row; wrong unit → empty array → rejected
- `super_admin` role can access all units; sidebar shows "Switch Unit" links
- All Rupiah formatted with `fmtRp()` → `Rp X.XXX` using `id-ID` locale
- Supabase queries use `{ count: 'exact' }` for pagination; PAGE_SIZE = 20
- Debounced search (300ms) on all booking list pages

## Product (implemented)

- **Batch 1 v2:** Public landing → unit-specific login → protected dashboards
- **Batch 2 (Arena Full):**
  - Dashboard with period-filtered KPIs, 6-month revenue bar chart, recent bookings
  - Kalender: month grid semua aktivitas arena (kelas + venue booking) dalam satu view, navigasi bulan, klik event → detail modal (peserta kelas / detail venue)
  - Venue Booking: create booking dari admin (komunitas/event eksternal), detail modal, tandai lunas, cancel, filter (search/status/date range), CSV export
  - Slot Bookings (BK-): list, filter, detail modal, manual walk-in, confirm/cancel, CSV export
  - Class Bookings (CL-): same + quota validation on manual booking
  - Package Orders (PKG-): list, detail with package voucher info, CSV export
  - Vouchers: full CRUD with form modal, toggle active, per-schedule scoping (assign a voucher to specific class schedules)
  - Master Data: Units, Class Types, Schedules (+ bulk repeat), Coaches, Add-ons, Blocked Slots

## User preferences

- Plain CSS only — no Tailwind, no UI component libraries
- Font: Times New Roman (headers/titles), system sans-serif for body
- File names: `.tsx` (not `.jsx`)
- All status values: `pending_payment`, `confirmed`, `cancelled`
- Indonesian language throughout the UI

## Gotchas

- CSS variables defined at top of `global.css` (`--bg-page`, `--red`, `--border`, etc.)
- `src/index.css` is an empty stub — do not add styles there
- RPC `generate_booking_code()` → BK- prefix; `generate_class_booking_code()` → CL- prefix
- `arena_class_schedules.instructor` stores the coach name as a string (not a FK)
- Supabase anon key stored as secret `VITE_SUPABASE_ANON_KEY`; URL in `.env` as `VITE_SUPABASE_URL`
- `arena_voucher_schedules` (voucher_id, schedule_id) scopes a voucher to specific schedules. **Backward compatible: no rows for a voucher → berlaku semua jadwal.** The customer app (separate `ARENA-BOOKING` repo) must enforce this at checkout. Voucher code column is `code` (not `voucher_code`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
