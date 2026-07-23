import { useEffect, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { apiFetch } from '../services/api'

export type MonthlyStatRow = {
  year_month: string
  label: string
  qty: number
  is_current?: boolean
}

type Props = {
  /** API path that returns { months, current_label, monthly_avg } */
  endpoint: string
  title: string
  /** e.g. Sold qty / Used qty */
  metricLabel: string
  /** Current month value already shown in the table (optional refresh from API) */
  currentValue?: number
  tone?: 'slate' | 'rose'
}

export default function MonthlyAvgHistory({
  endpoint,
  title,
  metricLabel,
  currentValue,
  tone = 'slate',
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [months, setMonths] = useState<MonthlyStatRow[]>([])
  const [currentLabel, setCurrentLabel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch<{ months: MonthlyStatRow[]; current_label?: string }>(endpoint)
      .then((data) => {
        if (cancelled) return
        setMonths(data.months || [])
        setCurrentLabel(data.current_label || '')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load monthly avg')
        setMonths([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, endpoint])

  const valueClass = tone === 'rose' ? 'text-rose-600' : 'text-slate-800'

  return (
    <div className="relative inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`inline-flex items-center gap-1 font-medium tabular-nums hover:underline ${valueClass}`}
        title="View monthly average history"
      >
        <span>{currentValue ?? 0}</span>
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-[11px] text-slate-500">
                {metricLabel} · resets each month
                {currentLabel ? ` · now ${currentLabel}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-200/60"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <p className="px-3 py-4 text-sm text-slate-500">Loading months…</p>
          ) : error ? (
            <p className="px-3 py-4 text-sm text-rose-600">{error}</p>
          ) : months.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No monthly data stored yet.</p>
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-100 bg-white text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Month</th>
                    <th className="px-3 py-2 font-semibold text-right">{metricLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr
                      key={m.year_month}
                      className={`border-b border-slate-50 last:border-0 ${
                        m.is_current ? 'bg-blue-50/60' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {m.label}
                        {m.is_current ? (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase text-blue-600">
                            current
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${valueClass}`}>
                        {Number(m.qty) || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
