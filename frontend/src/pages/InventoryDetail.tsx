import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  History,
  Layers,
  Package,
  Warehouse,
} from 'lucide-react'
import { apiFetch } from '../services/api'
import { ROUTES } from '../utils/roleAccess'

interface InventorySummaryData {
  inventory: {
    id: number
    name: string
    sku?: string
    available: number
    required_qty: number
    status: string
  }
  stats: {
    available: number
    required_qty: number
    pending_qty: number
    used_qty: number
    customers_count: number
    orders_count: number
    this_month_qty: number
    monthly_avg_qty: number
    fy_label: string
    fy_qty: number
    lifetime_qty: number
    inward_qty: number
    months_active: number
  }
  companies: {
    company: string
    orders_count: number
    products_count: number
    pending_qty: number
    used_qty: number
    monthly_avg_qty: number
    fy_qty: number
    lifetime_qty: number
    this_month_qty: number
  }[]
  products: {
    id: number
    code: string
    name: string
    qty_per_unit: number
  }[]
  months: { year_month: string; label: string; qty: number; is_current?: boolean }[]
  history: {
    kind: string
    company: string
    order_no: string
    product_code: string
    qty: number
    date: string
    status: string
  }[]
}

function Pill({
  label,
  value,
  hint,
  tone = 'slate',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue'
}) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50',
    emerald: 'border-emerald-100 bg-emerald-50/60',
    amber: 'border-amber-100 bg-amber-50/60',
    rose: 'border-rose-100 bg-rose-50/50',
    blue: 'border-blue-100 bg-blue-50/60',
  }
  const valueTone =
    tone === 'rose'
      ? 'text-rose-600'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'emerald'
          ? 'text-emerald-700'
          : 'text-slate-900'
  return (
    <div className={`min-w-[120px] flex-1 rounded-2xl border px-3.5 py-3 ${tones[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default function InventoryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<InventorySummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    apiFetch<InventorySummaryData>(`/api/inventory/${id}/summary`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load inventory'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <p className="p-8 text-center text-sm text-slate-500">Loading inventory summary…</p>
  }

  if (error || !data) {
    return (
      <div className="space-y-4 p-6">
        <button
          type="button"
          onClick={() => navigate(ROUTES.inventory)}
          className="inline-flex items-center gap-2 text-sm text-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to inventory
        </button>
        <p className="text-rose-600">{error || 'Item not found'}</p>
      </div>
    )
  }

  const { inventory, stats, companies, products, months, history } = data

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-5 shadow-sm">
        <button
          type="button"
          onClick={() => navigate(ROUTES.inventory)}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Inventory
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {inventory.sku ? (
              <p className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-700">
                {inventory.sku}
              </p>
            ) : null}
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{inventory.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{inventory.status}</p>
          </div>
          <Link
            to={ROUTES.reports}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open reports
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Inventory summary</h2>
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          <Pill label="Available" value={String(stats.available)} tone="emerald" />
          <Pill label="Required" value={String(stats.required_qty)} tone="amber" />
          <Pill label="Used" value={String(stats.used_qty)} tone="rose" />
          <Pill label="Customers" value={String(stats.customers_count)} tone="blue" hint={`${stats.orders_count} orders`} />
          <Pill label="Monthly avg" value={String(stats.monthly_avg_qty)} hint={`${stats.months_active} mo`} />
          <Pill label={stats.fy_label} value={String(stats.fy_qty)} tone="blue" />
          <Pill label="Inward total" value={String(stats.inward_qty)} tone="emerald" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Per-company usage</h2>
            <p className="text-xs text-slate-500">Who uses this part · monthly avg · FY · lifetime</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Company</th>
                <th className="px-3 py-2.5 font-semibold">Orders</th>
                <th className="px-3 py-2.5 font-semibold">Products</th>
                <th className="px-3 py-2.5 font-semibold">Pending</th>
                <th className="px-3 py-2.5 font-semibold">Used</th>
                <th className="px-3 py-2.5 font-semibold">Monthly avg</th>
                <th className="px-3 py-2.5 font-semibold">FY qty</th>
                <th className="px-3 py-2.5 font-semibold">Lifetime</th>
                <th className="px-3 py-2.5 font-semibold">This month</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    No company usage yet.
                  </td>
                </tr>
              ) : (
                companies.map((c) => (
                  <tr key={c.company} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2.5 font-medium text-slate-900">{c.company}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.orders_count}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.products_count}</td>
                    <td className="px-3 py-2.5 tabular-nums text-amber-700">{c.pending_qty}</td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums text-rose-600">{c.used_qty}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.monthly_avg_qty}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.fy_qty}</td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{c.lifetime_qty}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.this_month_qty}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-900">Monthly used qty</h2>
          </div>
          <div className="max-h-72 overflow-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Month</th>
                  <th className="px-3 py-2 text-right font-semibold">Used qty</th>
                </tr>
              </thead>
              <tbody>
                {months.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-slate-500">
                      No monthly data yet.
                    </td>
                  </tr>
                ) : (
                  months.map((m) => (
                    <tr key={m.year_month} className={`border-b border-slate-50 ${m.is_current ? 'bg-emerald-50/50' : ''}`}>
                      <td className="px-3 py-2 font-medium">
                        {m.label}
                        {m.is_current ? <span className="ml-1 text-[10px] uppercase text-emerald-700">current</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">{m.qty}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-900">Linked products</h2>
          </div>
          <div className="overflow-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Code</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Qty / unit</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                      No products linked.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      onClick={() => navigate(`/products/${p.id}`)}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700">{p.code}</td>
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 tabular-nums">×{p.qty_per_unit}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-slate-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">History</h2>
            <p className="text-xs text-slate-500">Inward (green) · Pending (orange) · Used (red)</p>
          </div>
        </div>
        <div className="max-h-96 overflow-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Detail</th>
                <th className="px-3 py-2 font-semibold">Order / Ref</th>
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    No history yet.
                  </td>
                </tr>
              ) : (
                history.map((h, idx) => {
                  const used = h.kind === 'order' && h.status === 'Completed'
                  const pending = h.kind === 'order' && h.status === 'Pending'
                  const inward = h.kind === 'inward' || (h.kind !== 'order' && h.qty > 0 && h.status === 'Added')
                  return (
                    <tr key={`${h.order_no}-${idx}`} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {inward ? 'Inward' : used ? 'Used' : pending ? 'Pending' : 'Move'}
                      </td>
                      <td className="px-3 py-2">{h.company}</td>
                      <td className="px-3 py-2 font-mono text-xs">{h.order_no}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{h.product_code || '—'}</td>
                      <td
                        className={`px-3 py-2 font-semibold tabular-nums ${
                          inward ? 'text-emerald-700' : used ? 'text-rose-600' : 'text-amber-700'
                        }`}
                      >
                        {inward ? `+${Math.abs(h.qty)}` : Math.abs(h.qty)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{h.date}</td>
                      <td className="px-3 py-2 text-slate-600">{h.status}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Warehouse className="h-3.5 w-3.5" />
        Inventory detail summary · customers {stats.customers_count} · this month used {stats.this_month_qty}
        <Package className="ml-2 h-3.5 w-3.5" />
        {products.length} linked product{products.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}
