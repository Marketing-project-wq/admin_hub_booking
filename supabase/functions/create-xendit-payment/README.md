# create-xendit-payment — JANGAN deploy dari repo ini

Edge Function **`create-xendit-payment`** (Supabase project `cpvzwqptzcxnwzfzgrmt`, `verify_jwt=true`)
**authoritative-nya ada di repo `ARENA-BOOKING`**:

```
ARENA-BOOKING/supabase/functions/create-xendit-payment/index.ts
```

Ini adalah **satu live function tunggal** yang bikin Xendit Invoice untuk SEMUA tipe
pembayaran (arena, class, gym day pass, gym membership, coach, PT/coach package, clinic).
Dulu di-mirror di repo ini juga, dan **salinan itu sudah diverge** dari live — salinan di sini
tertinggal: **tidak punya** anti-tamper harga gym (`MBR-`/`GDP-` baca harga otoritatif dari
DB), **tidak punya** override `invoice_duration` (Open Arena 30 menit), dan **tidak punya**
mapping order code coach/day-pass (`GDP-`, `COACH-`, `CPKG-`). Mirror ganda = sumber masalah,
jadi salinan `index.ts` di sini **dihapus** supaya hanya ada satu sumber (ARENA).

**Men-deploy versi dari repo ini berisiko memutus pembayaran** (regres fix gym anti-tamper /
invoice_duration / coach) kalau salinannya tertinggal dari live.

## Kalau perlu ubah / deploy create-xendit-payment

Lakukan dari `ARENA-BOOKING` (pertahankan `verify_jwt=TRUE` — **jangan** `--no-verify-jwt`):

```bash
# di ARENA-BOOKING
supabase functions deploy create-xendit-payment --project-ref cpvzwqptzcxnwzfzgrmt
```

Jangan menyalin ulang file `index.ts` ke sini — biarkan ARENA sebagai satu-satunya sumber.
Guard CI `.github/workflows/no-create-xendit-payment.yml` akan gagal kalau `index.ts` muncul
lagi di sini.
