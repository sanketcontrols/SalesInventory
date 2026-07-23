import {
  Save,
  Building2,
  Calendar,
  MapPin,
  Hash,
  Mail,
  Phone,
  Search,
  Plus,
  Minus,
  Package,
  Warehouse,
} from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { ensureRupee, formatRupee } from '../utils/formatRupee'

interface CustomerCompany {
  id: number
  name: string
  email: string
  phone: string
  city: string
  state: string
  gst_no: string
  address: string
  orders_count: number
  total_amount: string
}

interface OrderStats {
  totalOrders: number
  pendingOrders: number
  completedOrders: number
  ordersThisMonth: number
  monthly_avg_revenue?: string
  fy_label?: string
  fy_revenue?: string
  totalRevenue?: string
  filteredRevenue?: string
  filteredOrders?: number
  months_active?: number
}

interface ProductSummary {
  product_code_id: number | null
  product_code: string
  product_name: string
  pending_qty: number
  sold_qty: number
  orders_count: number
  monthly_avg_revenue: number
  monthly_avg_revenue_label: string
  fy_revenue: number
  fy_revenue_label: string
  lifetime_revenue: number
  lifetime_revenue_label: string
}

interface InventorySummary {
  inventory_id: number
  name: string
  sku: string
  pending_qty: number
  used_qty: number
  this_month_qty: number
  fy_qty: number
  lifetime_qty: number
  monthly_avg_qty: number
}

interface OrderItem {
  product_code?: string
  product_name?: string
  qty: number
  unit_price?: string
  amount?: string
}

interface OrderRow {
  id: number
  order_no: string
  company: string
  date: string
  qty: number
  amount: string
  status: string
  product_code?: string
  product_name?: string
  no_of_days?: number
  closing_date?: string | null
  ok_to_mfg?: boolean
  items?: OrderItem[]
}

function StatPill({
  label,
  value,
  hint,
  accent = 'slate',
}: {
  label: string
  value: string
  hint?: string
  accent?: 'blue' | 'amber' | 'emerald' | 'violet' | 'slate' | 'sky'
}) {
  const tones = {
    blue: 'from-blue-50 to-white border-blue-100',
    amber: 'from-amber-50 to-white border-amber-100',
    emerald: 'from-emerald-50 to-white border-emerald-100',
    violet: 'from-violet-50 to-white border-violet-100',
    sky: 'from-sky-50 to-white border-sky-100',
    slate: 'from-slate-50 to-white border-slate-200',
  }
  return (
    <div className={`min-w-[128px] flex-1 rounded-2xl border bg-gradient-to-b ${tones[accent]} px-3.5 py-3 shadow-sm`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default function CompanyProfile() {
  const role = getStoredUser()?.role
  const isAdmin = role === 'admin'
  const canAccess = role === 'admin' || role === 'sales'
  const [searchParams, setSearchParams] = useSearchParams()

  const [companies, setCompanies] = useState<CustomerCompany[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [company, setCompany] = useState<CustomerCompany | null>(null)
  const [editName, setEditName] = useState('')
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    gst_no: '',
    address: '',
  })
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [products, setProducts] = useState<ProductSummary[]>([])
  const [inventory, setInventory] = useState<InventorySummary[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    apiFetch<CustomerCompany[]>('/api/customers')
      .then((data) => {
        setCompanies(data)
        const idParam = searchParams.get('id')
        const searchParam = searchParams.get('search')
        if (idParam) setSelectedId(Number(idParam))
        else if (searchParam) {
          const match = data.find((c) => c.name.toLowerCase().includes(searchParam.toLowerCase()))
          setSelectedId(match?.id ?? data[0]?.id ?? null)
          setSearch(searchParam)
        } else if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [canAccess])

  useEffect(() => {
    if (!selectedId || !canAccess) return
    const params = new URLSearchParams()
    if (filterMonth) params.set('month', filterMonth)
    if (filterYear) params.set('year', filterYear)

    apiFetch<{
      orders: OrderRow[]
      stats: OrderStats
      customer: CustomerCompany
      products?: ProductSummary[]
      inventory?: InventorySummary[]
    }>(`/api/customers/${selectedId}/orders?${params}`)
      .then((data) => {
        setOrders(data.orders)
        setStats(data.stats)
        setProducts(data.products || [])
        setInventory(data.inventory || [])
        if (data.customer) {
          setCompany(data.customer)
          setEditName(data.customer.name)
          setEditForm({
            name: data.customer.name,
            email: data.customer.email,
            phone: data.customer.phone,
            city: data.customer.city,
            state: data.customer.state,
            gst_no: data.customer.gst_no || '',
            address: data.customer.address || '',
          })
        }
      })
      .catch(console.error)

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('id', String(selectedId))
      return next
    }, { replace: true })
  }, [selectedId, filterMonth, filterYear, canAccess])

  const handleSave = async () => {
    if (!selectedId) return
    try {
      const payload = isAdmin ? editForm : { name: editName }
      const updated = await apiFetch<CustomerCompany>(`/api/customers/${selectedId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setCompany(updated)
      setEditName(updated.name)
      setEditForm({
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        city: updated.city,
        state: updated.state,
        gst_no: updated.gst_no || '',
        address: updated.address || '',
      })
      setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save')
    }
  }

  const filtered = companies.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.gst_no || '').toLowerCase().includes(search.toLowerCase())
  )

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const statusStyles: Record<string, string> = {
    Pending: 'bg-amber-50 text-amber-700',
    Completed: 'bg-emerald-50 text-emerald-700',
    Cancelled: 'bg-rose-50 text-rose-700',
  }

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Building2 className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Company Profiles</h1>
        <p className="mt-2 text-sm text-slate-500">Available to admin and sales users.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-5 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Company Profiles</h1>
        <p className="mt-1 text-sm text-slate-500">
          Company report · per-product · inventory usage · order history
        </p>
        <p className="mt-2 text-sm text-blue-700">
          Add companies in{' '}
          <Link to="/customers" className="font-medium underline">
            Customers
          </Link>
          {' · '}
          <Link to="/orders" className="font-medium underline">
            Sales Orders
          </Link>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company / GST"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {loading ? (
              <p className="p-3 text-sm text-slate-500">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No companies yet.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    selectedId === c.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className={`truncate text-xs ${selectedId === c.id ? 'text-slate-300' : 'text-slate-500'}`}>
                    {c.gst_no || `${c.city}, ${c.state}`}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="space-y-5">
          {!company ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              Select a company to view its report
            </div>
          ) : (
            <>
              {/* Details */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <div className="rounded-xl bg-blue-50 p-2">
                    <Building2 className="h-4 w-4 text-blue-700" />
                  </div>
                  <h2 className="text-base font-semibold text-slate-900">Company details</h2>
                </div>

                {isAdmin ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Company Name</label>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">GST No.</label>
                      <input
                        value={editForm.gst_no}
                        onChange={(e) => setEditForm({ ...editForm, gst_no: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-500">Address</label>
                      <textarea
                        value={editForm.address}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                        rows={2}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Email</label>
                      <input
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Phone</label>
                      <input
                        value={editForm.phone}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">City</label>
                      <input
                        value={editForm.city}
                        onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">State</label>
                      <input
                        value={editForm.state}
                        onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Company Name</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-2">
                      <p className="flex items-start gap-2">
                        <Hash className="mt-0.5 h-4 w-4 text-slate-400" />
                        <span>GST: {company.gst_no || '—'}</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 text-slate-400" />
                        <span>{company.address || `${company.city}, ${company.state}`}</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Mail className="mt-0.5 h-4 w-4 text-slate-400" />
                        <span>{company.email}</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Phone className="mt-0.5 h-4 w-4 text-slate-400" />
                        <span>{company.phone}</span>
                      </p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSave}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Save className="h-4 w-4" />
                  {saved ? 'Saved!' : isAdmin ? 'Save details' : 'Save name'}
                </button>
              </section>

              {/* Company report — only requested metrics */}
              {stats && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-slate-900">Company report — {company.name}</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {stats.fy_label || 'FY'}
                    </span>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    <StatPill label="Total orders" value={String(stats.totalOrders)} accent="blue" />
                    <StatPill label="Pending" value={String(stats.pendingOrders)} accent="amber" />
                    <StatPill label="Completed" value={String(stats.completedOrders)} accent="emerald" />
                    <StatPill label="Orders in month" value={String(stats.ordersThisMonth)} accent="violet" />
                    <StatPill
                      label="Monthly avg"
                      value={ensureRupee(stats.monthly_avg_revenue || '₹ 0')}
                      hint={`${stats.months_active ?? 1} mo active`}
                      accent="sky"
                    />
                    <StatPill
                      label={`${stats.fy_label || 'FY'} revenue`}
                      value={ensureRupee(stats.fy_revenue || '₹ 0')}
                      accent="blue"
                    />
                    <StatPill
                      label="Lifetime revenue"
                      value={ensureRupee(stats.totalRevenue || company.total_amount)}
                      accent="slate"
                    />
                  </div>
                </section>
              )}

              {/* Per-product */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4 text-slate-600" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Per-product summary</h2>
                    <p className="text-xs text-slate-500">Monthly avg · FY revenue · Lifetime for each product</p>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Code</th>
                        <th className="px-3 py-2.5 font-semibold">Product</th>
                        <th className="px-3 py-2.5 font-semibold">Pending</th>
                        <th className="px-3 py-2.5 font-semibold">Sold</th>
                        <th className="px-3 py-2.5 font-semibold">Monthly avg</th>
                        <th className="px-3 py-2.5 font-semibold">FY revenue</th>
                        <th className="px-3 py-2.5 font-semibold">Lifetime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                            No products for this company yet.
                          </td>
                        </tr>
                      ) : (
                        products.map((p) => (
                          <tr key={`${p.product_code}-${p.product_code_id}`} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-2.5 font-mono text-xs font-semibold text-blue-700">{p.product_code}</td>
                            <td className="px-3 py-2.5 font-medium text-slate-900">{p.product_name}</td>
                            <td className="px-3 py-2.5 tabular-nums text-amber-700">{p.pending_qty}</td>
                            <td className="px-3 py-2.5 font-semibold tabular-nums text-rose-600">{p.sold_qty}</td>
                            <td className="px-3 py-2.5 font-medium tabular-nums text-slate-800">
                              {ensureRupee(p.monthly_avg_revenue_label)}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-800">{ensureRupee(p.fy_revenue_label)}</td>
                            <td className="px-3 py-2.5 font-semibold tabular-nums text-slate-900">
                              {ensureRupee(p.lifetime_revenue_label)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Per-inventory */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-slate-600" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Per-inventory summary</h2>
                    <p className="text-xs text-slate-500">
                      Parts used by this company · Monthly avg · FY used · Lifetime used
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Inventory</th>
                        <th className="px-3 py-2.5 font-semibold">Pending</th>
                        <th className="px-3 py-2.5 font-semibold">Used</th>
                        <th className="px-3 py-2.5 font-semibold">Monthly avg</th>
                        <th className="px-3 py-2.5 font-semibold">FY used</th>
                        <th className="px-3 py-2.5 font-semibold">Lifetime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                            No linked inventory usage for this company yet.
                          </td>
                        </tr>
                      ) : (
                        inventory.map((i) => (
                          <tr key={i.inventory_id} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-slate-900">{i.name}</p>
                              {i.sku ? <p className="text-[11px] text-slate-500">{i.sku}</p> : null}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-amber-700">{i.pending_qty}</td>
                            <td className="px-3 py-2.5 font-semibold tabular-nums text-rose-600">{i.used_qty}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-800">{i.monthly_avg_qty}</td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-800">{i.fy_qty}</td>
                            <td className="px-3 py-2.5 font-semibold tabular-nums text-slate-900">{i.lifetime_qty}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Order history */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-600" />
                    <h2 className="text-base font-semibold text-slate-900">Order history</h2>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={filterMonth}
                      onChange={(e) => setFilterMonth(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">All months</option>
                      {months.map((m, i) => (
                        <option key={m} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filterYear}
                      onChange={(e) => setFilterYear(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">All years</option>
                      {[2024, 2025, 2026, 2027].map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {stats?.filteredRevenue ? (
                  <p className="mb-3 text-xs text-slate-500">
                    Period: <strong>{stats.filteredOrders ?? orders.length}</strong> orders ·{' '}
                    <strong>{ensureRupee(stats.filteredRevenue)}</strong>
                  </p>
                ) : null}
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-8 px-2 py-2.5" />
                        <th className="px-3 py-2.5 font-semibold">Order date</th>
                        <th className="px-3 py-2.5 font-semibold">Closing</th>
                        <th className="px-3 py-2.5 font-semibold">Order no</th>
                        <th className="px-3 py-2.5 font-semibold">Products</th>
                        <th className="px-3 py-2.5 font-semibold">Qty</th>
                        <th className="px-3 py-2.5 font-semibold">Amount</th>
                        <th className="px-3 py-2.5 font-semibold">Days</th>
                        <th className="px-3 py-2.5 font-semibold">MFG</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                            No orders in selected period
                          </td>
                        </tr>
                      ) : (
                        orders.map((o) => {
                          const isClosed = o.status === 'Completed' || o.status === 'Cancelled'
                          const lines = o.items?.length
                            ? o.items
                            : [
                                {
                                  product_code: o.product_code || '—',
                                  product_name: o.product_name,
                                  qty: o.qty,
                                  unit_price: o.amount,
                                  amount: o.amount,
                                },
                              ]
                          const expanded = expandedIds.has(o.id)
                          return (
                            <Fragment key={o.id}>
                              <tr className="border-b border-slate-50">
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedIds((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(o.id)) next.delete(o.id)
                                        else next.add(o.id)
                                        return next
                                      })
                                    }
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  >
                                    {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                  </button>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">{o.date}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                                  {isClosed ? o.closing_date || '—' : <span className="text-slate-400">Open</span>}
                                </td>
                                <td className="px-3 py-2 font-medium">{o.order_no}</td>
                                <td className="px-3 py-2 text-slate-700">
                                  {lines.length} product{lines.length === 1 ? '' : 's'}
                                </td>
                                <td className="px-3 py-2 tabular-nums">{o.qty}</td>
                                <td className="px-3 py-2 tabular-nums">{ensureRupee(o.amount)}</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">{o.no_of_days ?? 0}</td>
                                <td className="px-3 py-2">{o.ok_to_mfg ? 'Yes' : 'No'}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      statusStyles[o.status] || 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {o.status}
                                  </span>
                                </td>
                              </tr>
                              {expanded && (
                                <tr className="bg-slate-50/70">
                                  <td colSpan={10} className="px-4 py-3">
                                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Line items — {o.order_no}
                                      </p>
                                      <table className="w-full text-left text-sm">
                                        <thead className="border-b border-slate-100 text-xs uppercase text-slate-500">
                                          <tr>
                                            <th className="px-3 py-2 font-semibold">Sr</th>
                                            <th className="px-3 py-2 font-semibold">Code</th>
                                            <th className="px-3 py-2 font-semibold">Name</th>
                                            <th className="px-3 py-2 font-semibold">Qty</th>
                                            <th className="px-3 py-2 font-semibold">Unit</th>
                                            <th className="px-3 py-2 font-semibold">Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((item, idx) => {
                                            const qty = Number(item.qty) || 0
                                            const amt =
                                              Number(String(item.amount || '').replace(/[^\d.-]/g, '')) || 0
                                            const unitRaw =
                                              Number(String(item.unit_price || '').replace(/[^\d.-]/g, '')) || 0
                                            const unit = unitRaw || (qty ? amt / qty : 0)
                                            return (
                                              <tr key={`${o.id}-${idx}`} className="border-b border-slate-50 last:border-0">
                                                <td className="px-3 py-2 tabular-nums">{idx + 1}</td>
                                                <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                                                  {item.product_code || '—'}
                                                </td>
                                                <td className="px-3 py-2">{item.product_name || '—'}</td>
                                                <td
                                                  className={`px-3 py-2 font-semibold tabular-nums ${
                                                    o.status === 'Completed'
                                                      ? 'text-rose-600'
                                                      : o.status === 'Pending'
                                                        ? 'text-amber-700'
                                                        : 'text-slate-800'
                                                  }`}
                                                >
                                                  {qty}
                                                </td>
                                                <td className="px-3 py-2 tabular-nums">{formatRupee(unit)}</td>
                                                <td className="px-3 py-2 font-medium tabular-nums">
                                                  {formatRupee(amt || unit * qty)}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
