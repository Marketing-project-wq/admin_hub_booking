// MediaPipe PoseLandmarker — logic init dipindah dari POC Stage 1 (sudah terbukti jalan:
// 33 landmark terdeteksi di headless Chromium). Model .task + wasm self-host di public/.
//
// Semua import runtime dilakukan via dynamic import() supaya bundle MediaPipe (~besar)
// jadi CHUNK TERPISAH — TIDAK ikut initial load. Tipe di-import via `import type`
// (di-erase saat build, tanpa dampak bundle).
import type { PoseLandmarker as PoseLandmarkerT } from '@mediapipe/tasks-vision'

const WASM_PATH = '/mediapipe-wasm'
const MODEL_PATH = '/models/pose_landmarker_lite.task'

// Indeks landmark MediaPipe Pose (33 titik).
const LM = { L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24, L_ANKLE: 27, R_ANKLE: 28 } as const

export interface PoseLandmark { x: number; y: number; z: number; visibility?: number }
export interface PoseAngles {
  shoulder_tilt_deg: number
  hip_tilt_deg: number
  lateral_deviation_deg: number
  // Rata-rata skor `visibility` 6 landmark kunci (0..1) — kualitas deteksi, BUKAN sudut.
  // Ditambahkan Stage 2b; disimpan di angles jsonb agar riwayat kualitasnya ikut tercatat.
  detection_confidence?: number
}

let landmarkerPromise: Promise<PoseLandmarkerT> | null = null

// Singleton lazy: model+wasm hanya di-load sekali, saat pertama kali deteksi dipakai.
async function getLandmarker(): Promise<PoseLandmarkerT> {
  if (landmarkerPromise) return landmarkerPromise
  landmarkerPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
        // Ambang deteksi diturunkan dari default 0.5 → lebih toleran pada foto klinik
        // (jarak, pencahayaan, pakaian, warna latar bervariasi). Klinik SELALU memotret
        // orang, jadi risiko false-positive minim; yang dihindari = false-negative
        // "Tubuh tidak terdeteksi" pada foto yang sebenarnya sudah bagus.
        minPoseDetectionConfidence: 0.25,
        minPosePresenceConfidence: 0.25,
        minTrackingConfidence: 0.25,
      })
    // GPU dulu (WebGL), fallback CPU (wasm) kalau WebGL bermasalah.
    try {
      return await create('GPU')
    } catch {
      return await create('CPU')
    }
  })()
  return landmarkerPromise
}

/** Deteksi 1 pose pada gambar; kembalikan 33 landmark ternormalisasi (kosong kalau tak terdeteksi).
 *  Menerima <canvas>/ImageBitmap selain <img> — pemanggil menormalkan orientasi EXIF & ukuran ke
 *  kanvas dulu (MediaPipe/WebGL TIDAK menerapkan orientasi EXIF pada HTMLImageElement mentah). */
export async function detectPose(src: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Promise<PoseLandmark[]> {
  const lm = await getLandmarker()
  const res = lm.detect(src)
  const first = res.landmarks?.[0] ?? []
  return first.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
}

/**
 * Rata-rata skor `visibility` (skala MediaPipe 0..1; makin tinggi makin yakin terlihat)
 * untuk 6 landmark yang dipakai kalkulasi sudut (bahu, pinggul, pergelangan kaki kiri-kanan).
 * Dipakai sebagai indikator kualitas deteksi — TIDAK mengubah kalkulasi sudut.
 */
export function keyVisibility(landmarks: PoseLandmark[]): number {
  const keys = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE]
  const vals = keys.map(i => landmarks[i]?.visibility ?? 0)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// ── Perhitungan sudut ────────────────────────────────────────────────────────
// PENTING: landmark ternormalisasi (x per lebar, y per tinggi). Untuk sudut geometris
// yang benar pada gambar non-persegi, konversi ke piksel (×w, ×h) DULU sebelum atan2.

/** Deviasi garis (dua titik) dari HORIZONTAL, dalam derajat bertanda, dinormalisasi ke [-90,90]. */
function tiltFromHorizontal(a: { x: number; y: number }, b: { x: number; y: number }): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  if (deg > 90) deg -= 180
  if (deg < -90) deg += 180
  return deg
}

/** Deviasi garis (atas→bawah) dari VERTIKAL sempurna, dalam derajat bertanda. 0 = tegak lurus. */
function deviationFromVertical(top: { x: number; y: number }, bottom: { x: number; y: number }): number {
  return (Math.atan2(bottom.x - top.x, bottom.y - top.y) * 180) / Math.PI
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Hitung 3 sudut postur dari landmark + dimensi gambar asli (piksel). */
export function computeAngles(landmarks: PoseLandmark[], w: number, h: number): PoseAngles {
  const P = (i: number) => ({ x: landmarks[i].x * w, y: landmarks[i].y * h })
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const lsh = P(LM.L_SHOULDER), rsh = P(LM.R_SHOULDER)
  const lhip = P(LM.L_HIP), rhip = P(LM.R_HIP)
  const lank = P(LM.L_ANKLE), rank = P(LM.R_ANKLE)
  return {
    shoulder_tilt_deg: round1(tiltFromHorizontal(lsh, rsh)),
    hip_tilt_deg: round1(tiltFromHorizontal(lhip, rhip)),
    lateral_deviation_deg: round1(deviationFromVertical(mid(lsh, rsh), mid(lank, rank))),
  }
}
