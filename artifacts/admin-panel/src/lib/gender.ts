// Buyer gender, as stored on every Arena + Gym purchase table.
//
// The DB stores the raw vocabulary ("male" | "female") and the column is nullable: rows created
// before the field shipped, and rows created by paths that do not collect it, have no gender.
// That null is meaningful — it is "not recorded", NOT "unknown gender" — so it renders as a
// dash rather than being folded into either bucket. Reporting can then separate "we know" from
// "we never asked" instead of silently skewing the split.

export type Gender = "male" | "female";

/** Compact label for dense table cells. "L" = Laki-laki, "P" = Perempuan. */
export function genderShort(g: unknown): string {
  return g === "male" ? "L" : g === "female" ? "P" : "-";
}

/** Full Indonesian label for detail views and exports. */
export function genderLabel(g: unknown): string {
  return g === "male" ? "Laki-laki" : g === "female" ? "Perempuan" : "-";
}
