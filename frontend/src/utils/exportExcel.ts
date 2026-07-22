import * as XLSX from 'xlsx'
import { parseAmount } from './formatRupee'

export type ExcelColumn = {
  header: string
  /** If 'inr', value is written as a number with Indian Rupee Excel format */
  type?: 'text' | 'number' | 'inr'
}

/**
 * Download a proper .xlsx workbook that Excel opens cleanly.
 * Amount columns use numeric cells + INR format (avoids â‚¹ corruption).
 */
export function downloadExcel(
  filename: string,
  sheetName: string,
  columns: ExcelColumn[],
  rows: (string | number | null | undefined)[][]
) {
  const aoa: (string | number)[][] = [columns.map((c) => c.header)]

  for (const row of rows) {
    aoa.push(
      row.map((cell, index) => {
        const col = columns[index]
        if (col?.type === 'inr' || col?.type === 'number') {
          return parseAmount(cell ?? 0)
        }
        return cell == null ? '' : String(cell)
      })
    )
  }

  const worksheet = XLSX.utils.aoa_to_sheet(aoa)

  // Apply INR / number formats to data cells
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c]
      if (col.type !== 'inr' && col.type !== 'number') continue
      const addr = XLSX.utils.encode_cell({ r: r + 1, c })
      const cell = worksheet[addr]
      if (!cell) continue
      cell.t = 'n'
      cell.v = parseAmount(rows[r][c] ?? 0)
      cell.z = col.type === 'inr' ? '"Rs."#,##0.00' : '#,##0'
    }
  }

  // Reasonable column widths
  worksheet['!cols'] = columns.map((col, index) => {
    const headerLen = col.header.length
    const maxData = rows.reduce((max, row) => {
      const val = String(row[index] ?? '')
      return Math.max(max, val.length)
    }, 0)
    return { wch: Math.min(40, Math.max(12, headerLen, maxData) + 2) }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31))
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/** CSV with UTF-8 BOM so Excel shows ₹ correctly when CSV is still used */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const csv = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Format amount for Excel text cells as Rs. (ASCII-safe) */
export function excelRupeeText(value: string | number): string {
  const num = parseAmount(value)
  return `Rs. ${Math.round(num).toLocaleString('en-IN')}`
}
