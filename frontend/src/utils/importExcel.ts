import * as XLSX from 'xlsx'

function cell(v: unknown): string {
  return String(v ?? '').trim()
}

function isSkipParticular(name: string): boolean {
  if (!name) return true
  if (/^grand total$/i.test(name)) return true
  if (/^particulars$/i.test(name)) return true
  if (/^closing balance$/i.test(name)) return true
  if (/^quantity$/i.test(name)) return true
  if (/^rate$/i.test(name)) return true
  if (/^value$/i.test(name)) return true
  if (/^stock summary$/i.test(name)) return true
  if (/^\d+$/.test(name)) return true // HSN-only rows
  return false
}

/** Read workbook from File (xlsx / xls) */
export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true })
}

/**
 * GSTN / company Excel columns:
 * Company name, Address, State, Country, GSTIN/UIN, ...
 */
export async function parseCompanyExcel(file: File): Promise<Record<string, string>[]> {
  const wb = await readWorkbook(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const out: Record<string, string>[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const name = cell(
      row['Company name'] ?? row['Company Name'] ?? row['company name'] ?? row.name ?? row.Name
    )
    if (!name || /^sl\s*no/i.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const address = cell(row.Address ?? row.address ?? row['ADD'] ?? row.Add)
    const state = cell(row.State ?? row.state)
    const gst = cell(row['GSTIN/UIN'] ?? row.GSTIN ?? row.gst_no ?? row.GST ?? row['GST No'])
    const country = cell(row.Country ?? row.country)

    // Best-effort city from address last comma segment
    let city = cell(row.City ?? row.city)
    if (!city && address) {
      const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
      const last = parts[parts.length - 1] || ''
      city = last.replace(/\d{5,6}/g, '').replace(/-/g, ' ').trim() || state || '—'
    }
    if (!city) city = state || '—'

    out.push({
      name,
      address,
      state: state || '—',
      city,
      country,
      gst_no: gst,
      email: cell(row.Email ?? row.email) || `${key.replace(/[^a-z0-9]+/g, '.').slice(0, 40)}@import.local`,
      phone: cell(row.Phone ?? row.phone ?? row.Mobile) || '—',
    })
  }

  return out
}

/**
 * StkSum.xlsx — Tally stock summary.
 * Particulars start after header rows; col0 = name, col1 = qty text like "-350 Pcs."
 */
export async function parseStkSumExcel(file: File): Promise<Record<string, string>[]> {
  const wb = await readWorkbook(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })

  let start = 0
  for (let i = 0; i < raw.length; i++) {
    const a = cell(raw[i]?.[0])
    const b = cell(raw[i]?.[1])
    if (/^particulars$/i.test(a) || (/^quantity$/i.test(b) && i > 5)) {
      start = i + 1
    }
    // Data usually begins after "Quantity / Rate / Value" header
    if (/^quantity$/i.test(b) && /^rate$/i.test(cell(raw[i]?.[2]))) {
      start = i + 1
      break
    }
  }
  // Fallback: skip first 12 rows (typical StkSum layout)
  if (start < 12) start = 12

  const out: Record<string, string>[] = []
  const seen = new Set<string>()

  for (let i = start; i < raw.length; i++) {
    const name = cell(raw[i]?.[0])
    if (isSkipParticular(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const qtyText = cell(raw[i]?.[1])
    const qtyMatch = qtyText.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    const qty = qtyMatch ? String(Math.abs(Math.round(Number(qtyMatch[0])))) : '0'

    out.push({
      Particulars: name,
      name,
      available: qty,
      Quantity: qtyText,
      Rate: cell(raw[i]?.[2]),
      Value: cell(raw[i]?.[3]),
    })
  }

  return out
}

/** Auto-detect: company sheet vs StkSum */
export async function parseExcelAuto(
  file: File,
  prefer: 'company' | 'stksum' | 'auto' = 'auto'
): Promise<{ kind: 'company' | 'stksum'; rows: Record<string, string>[] }> {
  if (prefer === 'company') return { kind: 'company', rows: await parseCompanyExcel(file) }
  if (prefer === 'stksum') return { kind: 'stksum', rows: await parseStkSumExcel(file) }

  const wb = await readWorkbook(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const sample = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }).slice(0, 3)
  const keys = sample[0] ? Object.keys(sample[0]).join(' ').toLowerCase() : ''
  if (keys.includes('company') || keys.includes('gstin') || keys.includes('gst')) {
    return { kind: 'company', rows: await parseCompanyExcel(file) }
  }
  return { kind: 'stksum', rows: await parseStkSumExcel(file) }
}
