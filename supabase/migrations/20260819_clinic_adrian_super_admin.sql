-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Perubahan DATA ini di-apply langsung ke Supabase (project
-- cpvzwqptzcxnwzfzgrmt); file ini DOKUMENTASI kondisi live.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Naikkan akses dr. Adrian Purwadihardja, Sp.KO menjadi SUPER ADMIN.
--
-- Sebelumnya role-nya 'dokter', sehingga Sidebar hanya menampilkan satu menu
-- (EMR / Panel Dokter) — lihat filter role di
-- artifacts/admin-panel/src/components/Sidebar.tsx (`role === 'dokter'` hanya
-- boleh '/clinic/dokter'). Dengan role 'super_admin':
--   • semua menu clinic tampil (Dashboard, Kalender, Bookings, Visits, Triase,
--     EMR, Kasir, Patients, Users, Services, Package, Slots, Audit Log),
--   • akses lintas-unit (canAccessUnit → true untuk super_admin),
--   • bypass seluruh permission gate (Kasir finansial, Triase, unlock rekam, dst).
--
-- Constraint admin_users_role_unit_check mewajibkan super_admin ber-unit NULL
-- (super_admin bersifat global / lintas-unit), jadi unit di-set NULL sekalian.
--
-- Aman untuk login: validate_admin_login() mencocokkan
-- `role = 'super_admin' OR unit = p_unit`; cabang super_admin sudah true, jadi
-- login lewat /clinic/login tetap berfungsi meski unit NULL.
--
-- Dicocokkan lewat email (unik & stabil). Idempotent — aman dijalankan ulang.

UPDATE public.admin_users
   SET role = 'super_admin',
       unit = NULL
 WHERE lower(email) = lower('dr.adrian@20fit.id');
