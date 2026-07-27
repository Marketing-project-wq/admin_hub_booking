# Gambar Diagram Tubuh (EMR — Objective / Diagram Tubuh)

Folder ini menampung gambar siluet tubuh yang dipakai di form **Assessment EMR → Diagram Tubuh**
(`src/pages/clinic/ClinicDokter.tsx`).

## File yang diharapkan

Taruh **4 file** dengan nama persis seperti ini (huruf kecil semua):

| File | Dipakai saat |
|---|---|
| `front-male.png` | Toggle **Depan** + pasien `gender = 'male'` |
| `back-male.png` | Toggle **Belakang** + pasien `gender = 'male'` |
| `front-female.png` | Toggle **Depan** + pasien `gender = 'female'` |
| `back-female.png` | Toggle **Belakang** + pasien `gender = 'female'` |

Gender diambil otomatis dari `clinic_patients.gender` (via visit → patient).
Kalau nilainya kosong atau bukan `'male'`/`'female'`, aplikasi **default ke `male`**.
Tidak ada toggle gender manual di UI.

Path yang dibangun aplikasi: `/images/body-diagram/${view}-${gender}.${ext}`

### Ekstensi yang didukung

Aplikasi mencoba ekstensi **berurutan** sampai ada yang berhasil dimuat:

1. `.png`
2. `.jpg`
3. `.jpeg`

Kalau ketiganya gagal (file memang belum ada), otomatis jatuh ke **siluet SVG** bawaan.
Jadi yang wajib persis adalah **nama dasar**-nya (`front-male`, `back-male`, `front-female`,
`back-female`); ekstensinya boleh salah satu dari tiga di atas. Pencarian dilacak per nama
dasar, jadi tiap kombinasi tampak/gender bisa memakai ekstensi yang berbeda-beda.

## ⚠️ Ukuran & rasio — WAJIB diikuti

- **Rasio harus 2:5 (potret)** — mis. **400 × 1000 px** (disarankan), 480 × 1200, atau 600 × 1500.
- **Minimal 400 × 1000 px** biar tetap tajam di layar high-DPI.
- Background **transparan** (disarankan) atau **putih polos**.
- Format **PNG**, **JPG**, atau **JPEG** (lihat urutan pencarian di atas).

Kenapa rasionya wajib 2:5: titik pemeriksaan (`body_points`) disimpan sebagai **persentase
(x/y: 0–100)** relatif terhadap kotak diagram, dan kotak itu dikunci ke rasio `200 : 500`
(sama dengan `viewBox` siluet SVG). Gambar di-render `object-fit: fill` supaya selalu mengisi
kotak itu **persis**, sehingga titik yang sudah tersimpan tidak bergeser sedikit pun saat
tampilan berpindah dari siluet SVG ke gambar asli. Kalau rasio gambar bukan 2:5, gambar akan
tampak sedikit gepeng/melar (titik tetap presisi, tapi visualnya kurang enak) — jadi
ikuti rasio 2:5.

Idealnya keempat gambar memakai **framing yang sama** (posisi kepala, bahu, dan kaki di
koordinat relatif yang sama) supaya sebuah titik di "lutut kiri" tetap jatuh di lutut kiri
ketika berganti tampak depan/belakang atau berganti gender.

## 📋 Status file saat ini (per 2026-07-24) — sudah diketahui, BUKAN bug

Keempat file sudah ada (format `.jpeg`), tapi **rasionya belum 2:5 (0.4)**:

| File | Dimensi | Rasio | Status |
|---|---|---|---|
| `front-male.jpeg` | 503 × 1000 | 0.503 | belum 2:5 |
| `back-male.jpeg` | 450 × 1000 | 0.450 | belum 2:5 |
| `front-female.jpeg` | 494 × 959 | 0.515 | belum 2:5 |
| `back-female.jpeg` | 489 × 960 | 0.509 | belum 2:5 |

Akibatnya, karena `object-fit: fill`, gambar tampak **gepeng secara horizontal ±20–25%**.

Ini **keputusan sadar yang diterima sementara**: `fill` dipertahankan supaya titik pemeriksaan
(`body_points`) tetap **presisi** — prioritasnya akurasi posisi klik, bukan estetika gambar.
Jadi ini **bukan bug** dan **bukan blocker**.

**TODO (prioritas rendah):** minta desainer meng-crop/pad ulang keempat gambar ke rasio **2:5**
(mis. 400 × 1000) dengan framing yang konsisten antar-file, saat ada waktu senggang.
Begitu diganti, gambar langsung tampil normal tanpa perlu ubah kode.

## Perilaku fallback (aman kalau file belum ada)

Aplikasi memakai `<img onError>`:

- **File belum ada / gagal dimuat** → otomatis menggambar **siluet SVG bawaan**
  (`BodySilhouette`, tetap ada di kode sebagai cadangan). Tidak ada ikon "broken image".
- **File sudah ditaruh** → otomatis dipakai, **tanpa perlu ubah kode apa pun**.

Kegagalan dilacak per-file, jadi kalau mis. hanya `front-male.png` yang tersedia,
tampak Depan memakai gambar sementara tampak Belakang tetap memakai siluet SVG.

## Catatan

Keempat file gambar (`front`/`back` × `male`/`female`, format `.jpeg`) adalah
**versi awal dari desainer** dan **SUDAH di-commit ke repo** — di-`git add -f`,
karena pola `*.jpeg`/`*.png` di `.gitignore` sebenarnya mengecualikannya. Jadi
environment baru langsung mendapat gambarnya tanpa perlu ditaruh manual.

**Status versi awal ini: belum sesuai rasio 2:5** — masih **agak gepeng** karena
di-render `object-fit: fill` (lihat tabel dimensi di atas). Ini diterima sementara,
bukan blocker. **TODO crop/pad ulang ke rasio 2:5 TETAP BERLAKU**: begitu desainer
mengirim versi final, cukup timpa keempat file (nama dasar sama) lalu commit ulang —
tidak perlu ubah kode.
