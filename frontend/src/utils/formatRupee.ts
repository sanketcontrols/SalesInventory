export function parseAmount(value: string | number): number {
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  return Number(cleaned) || 0
}

export function formatRupee(value: string | number): string {
  const num = typeof value === 'number' ? value : parseAmount(value)
  return `₹ ${Math.round(num).toLocaleString('en-IN')}`
}

export function ensureRupee(value: string): string {
  if (!value) return '₹ 0'
  if (value.includes('₹')) return value
  return formatRupee(value)
}
