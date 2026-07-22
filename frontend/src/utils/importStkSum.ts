import * as XLSX from 'xlsx'

function isSkipParticular(name: string) {
  if (!name) return true
  if (/^grand total$/i.test(name)) return true
  if (/^stock$/i.test(name)) return true
  if (/^particulars$/i.test(name)) return true
  if (/^closing balance$/i.test(name)) return true
  if (/^quantity$/i.test(name)) return true
  if (/^rate$/i.test(name)) return true
  if (/^value$/i.test(name)) return true
  if (/^\d+$/.test(name)) return true
  return false
}

/**
 * Parse StkSum.xlsx (Tally Stock Summary style):
 * uses Particulars column only — ignores Quantity / Rate / Value.
 */
export async function parseStkSumExcel(file: File): Promise<Record<string, string>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })

  const items: Record<string, string>[] = []
  const seen = new Set<string>()

  for (let i = 12; i < rows.length; i++) {
    const name = String(rows[i]?.[0] ?? '').trim()
    if (isSkipParticular(name)) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    items.push({ Particulars: name, name })
  }

  return items
}
