export const fmtRp = (n: number | null | undefined) =>
  'Rp ' + (Number(n) || 0).toLocaleString('id-ID')

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export const fmtTime = (timeStr: string | null | undefined) => {
  if (!timeStr) return '-'
  return timeStr.substring(0, 5)
}

export const STATUS_LABEL: Record<string, { label: string; css: string }> = {
  confirmed:       { label: 'Confirmed', css: 'badge-confirmed' },
  pending_payment: { label: 'Pending',   css: 'badge-pending' },
  cancelled:       { label: 'Cancelled', css: 'badge-cancelled' },
}

export const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h] ?? ''
      return `"${String(val).replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export const getPeriodRange = (period: string) => {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  if (period === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (period === 'week') {
    const day = now.getDay()
    start.setDate(now.getDate() - day)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'last_month') {
    start.setMonth(start.getMonth() - 1, 1)
    start.setHours(0, 0, 0, 0)
    end.setDate(0)
    end.setHours(23, 59, 59, 999)
  }
  return { start: start.toISOString(), end: end.toISOString() }
}
