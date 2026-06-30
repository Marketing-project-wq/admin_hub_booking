import React from 'react'
import { exportToCSV } from '@workspace/admin-shared'

interface Props {
  data: Record<string, unknown>[]
  filename: string
  disabled?: boolean
}

export default function ExportButton({ data, filename, disabled }: Props) {
  return (
    <button
      className="btn-secondary"
      disabled={disabled || data.length === 0}
      onClick={() => exportToCSV(data, filename)}
    >
      Export CSV
    </button>
  )
}
