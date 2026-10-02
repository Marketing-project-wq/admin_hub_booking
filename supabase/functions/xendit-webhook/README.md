# xendit-webhook — JANGAN deploy dari repo ini

Edge Function **`xendit-webhook`** (Supabase project `cpvzwqptzcxnwzfzgrmt`, `verify_jwt=false`)
**authoritative-nya ada di repo `ARENA-BOOKING`**:

```
ARENA-BOOKING/supabase/functions/xendit-webhook/index.ts
```

Ini adalah **satu live function tunggal** untuk SEMUA tipe booking Xendit (arena, class,
gym, package, clinic, membership, coach, day pass, PT package). Dulu di-mirror di repo ini
juga, dan **mirror ganda itu sudah dua kali diverge** lalu disinkronkan manual ke live
(terakhir: sync ke live v7). Mirror ganda = sumber masalah, jadi salinan `index.ts` di sini
**dihapus** supaya hanya ada satu sumber (ARENA).

**Men-deploy versi dari repo ini berisiko memutus pembayaran** (add-on / day pass / coach /
voucher / PT package) kalau salinannya tertinggal dari live.

## Kalau perlu ubah / deploy xendit-webhook

Lakukan dari `ARENA-BOOKING`:

```bash
# di ARENA-BOOKING
supabase functions deploy xendit-webhook --project-ref cpvzwqptzcxnwzfzgrmt --no-verify-jwt
```

Jangan menyalin ulang file ini ke sini — biarkan ARENA sebagai satu-satunya sumber.
