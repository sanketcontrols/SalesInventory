import { Save, Building2, Calendar, MapPin, Hash, Mail, Phone, Search, Plus, Minus } from 'lucide-react'
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
  totalRevenue?: string
  filteredRevenue?: string
  filteredOrders?: number
}

interface OrderItem {
  product_code?: string
  product_name?: string
  description?: string
  qty: number
  unit_price?: string
  amount?: string
}

interface OrderRow {
  id: number
  order_no: string
  company: string
  state: string
  date: string
  qty: number
  amount: string
  status: string
  product_code?: string
  product_name?: string
  no_of_days?: number
  closing_date?: string | null
  closed_at?: string | null
  ok_to_mfg?: boolean
  items?: OrderItem[]
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
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', city: '', state: '', gst_no: '', address: '' })
  const [stats, setStats] = useState<OrderStats | null>(null)
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
        if (idParam) {
          setSelectedId(Number(idParam))
        } else if (searchParam) {
          const match = data.find((c) => c.name.toLowerCase().includes(searchParam.toLowerCase()))
          setSelectedId(match?.id ?? data[0]?.id ?? null)
          setSearch(searchParam)
        } else if (data.length > 0 && !selectedId) {
          setSelectedId(data[0].id)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [canAccess])

  useEffect(() => {
    if (!selectedId || !canAccess) return
    const params = new URLSearchParams()
    if (filterMonth) params.set('month', filterMonth)
    if (filterYear) params.set('year', filterYear)

    apiFetch<{ orders: OrderRow[]; stats: OrderStats; customer: CustomerCompany }>(
      `/api/customers/${selectedId}/orders?${params}`
    )
      .then((data) => {
        setOrders(data.orders)
        setStats(data.stats)
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
        <p className="mt-2 text-sm text-slate-500">Buyer company profiles are available to admin and sales users.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Company Profiles</h1>
        <p className="mt-1 text-sm text-slate-500">
          Company details, order summary, and full history.
          {isAdmin ? ' Admin can edit all fields.' : ' You can edit company name only.'}
        </p>
        <p className="mt-1 text-sm text-blue-600">
          Add companies from{' '}
          <Link to="/customers" className="font-medium underline hover:text-blue-700">Customers</Link>
          {' · '}
          <Link to="/orders" className="font-medium underline hover:text-blue-700">Sales Orders</Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company / GST"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-[480px] space-y-1 overflow-y-auto">
            {loading ? (
              <p className="p-3 text-sm text-slate-500">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No companies yet. Add them in Customers.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    selectedId === c.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className={`truncate text-xs ${selectedId === c.id ? 'text-blue-100' : 'text-slate-500'}`}>
                    {c.gst_no || `${c.city}, ${c.state}`}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          {!company ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              Select a company to view its profile
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-6 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-slate-900">Company Details</h2>
                </div>

                {isAdmin ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Company Name</label>
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">GST No.</label>
                      <input value={editForm.gst_no} onChange={(e) => setEditForm({ ...editForm, gst_no: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">Address</label>
                      <textarea value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                      <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                      <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
                      <input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
                      <input value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Company Name (editable)</label>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                    </div>
                    <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-2">
                      <p className="flex items-start gap-2"><Hash className="mt-0.5 h-4 w-4 text-slate-400" /><span><strong>GST:</strong> {company.gst_no || '—'}</span></p>
                      <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-slate-400" /><span><strong>Address:</strong> {company.address || `${company.city}, ${company.state}`}</span></p>
                      <p className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 text-slate-400" /><span>{company.email}</span></p>
                      <p className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 text-slate-400" /><span>{company.phone}</span></p>
                    </div>
                  </div>
                )}

                <button onClick={handleSave} className="mt-4 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
                  <Save className="h-4 w-4" />
                  {saved ? 'Saved!' : isAdmin ? 'Save All Details' : 'Save Name'}
                </button>
              </div>

              {stats && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold text-slate-900">Summary — {company.name}</h2>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded-xl bg-blue-50 p-4 text-center">
                      <p className="text-2xl font-bold text-blue-600">{stats.totalOrders}</p>
                      <p className="text-xs text-slate-500">Total Orders</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-4 text-center">
                      <p className="text-2xl font-bold text-amber-600">{stats.pendingOrders}</p>
                      <p className="text-xs text-slate-500">Pending</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-4 text-center">
                      <p className="text-2xl font-bold text-emerald-600">{stats.completedOrders}</p>
                      <p className="text-xs text-slate-500">Completed</p>
                    </div>
                    <div className="rounded-xl bg-violet-50 p-4 text-center">
                      <p className="text-2xl font-bold text-violet-600">{stats.ordersThisMonth}</p>
                      <p className="text-xs text-slate-500">This Month</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4 text-center md:col-span-2">
                      <p className="text-xl font-bold text-slate-900">{ensureRupee(stats.totalRevenue || company.total_amount)}</p>
                      <p className="text-xs text-slate-500">Lifetime revenue</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-blue-600" />
                    <h2 className="text-lg font-semibold text-slate-900">Order History</h2>
                  </div>
                  <div className="flex gap-2">
                    <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                      <option value="">All months</option>
                      {months.map((m, i) => (
                        <option key={m} value={String(i + 1)}>{m}</option>
                      ))}
                    </select>
                    <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                      <option value="">All years</option>
                      {[2024, 2025, 2026, 2027].map((y) => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {stats?.filteredRevenue ? (
                  <p className="mb-3 text-sm text-slate-500">
                    Period: <strong>{stats.filteredOrders ?? orders.length}</strong> orders ·{' '}
                    <strong>{ensureRupee(stats.filteredRevenue)}</strong> revenue
                  </p>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium w-8" />
                        <th className="py-2 pr-4 font-medium">Order Date</th>
                        <th className="py-2 pr-4 font-medium">Closing Date</th>
                        <th className="py-2 pr-4 font-medium">Order No</th>
                        <th className="py-2 pr-4 font-medium">Products</th>
                        <th className="py-2 pr-4 font-medium">Qty</th>
                        <th className="py-2 pr-4 font-medium">Amount</th>
                        <th className="py-2 pr-4 font-medium">No of Days</th>
                        <th className="py-2 pr-4 font-medium">MFG</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-6 text-center text-slate-500">No orders for this company in selected period</td>
                        </tr>
                      ) : (
                        orders.map((o) => {
                          const isClosed = o.status === 'Completed' || o.status === 'Cancelled'
                          const lines = o.items?.length
                            ? o.items
                            : [{ product_code: o.product_code || '—', qty: o.qty, unit_price: o.amount, amount: o.amount }]
                          const expanded = expandedIds.has(o.id)
                          const toggle = () => {
                            setExpandedIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(o.id)) next.delete(o.id)
                              else next.add(o.id)
                              return next
                            })
                          }
                          return (
                            <Fragment key={o.id}>
                              <tr className="border-b border-slate-100">
                                <td className="py-2 pr-2">
                                  <button
                                    type="button"
                                    onClick={toggle}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                                    title={expanded ? 'Hide booking' : 'Show booking'}
                                  >
                                    {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                  </button>
                                </td>
                                <td className="py-2 pr-4 whitespace-nowrap">{o.date}</td>
                                <td className="py-2 pr-4 whitespace-nowrap text-slate-600">
                                  {isClosed ? o.closing_date || '—' : <span className="text-slate-400">Open</span>}
                                </td>
                                <td className="py-2 pr-4 font-medium">{o.order_no}</td>
                                <td className="py-2 pr-4 text-slate-700">
                                  {lines.length} product{lines.length === 1 ? '' : 's'}
                                </td>
                                <td className="py-2 pr-4">{o.qty}</td>
                                <td className="py-2 pr-4">{ensureRupee(o.amount)}</td>
                                <td className="py-2 pr-4">
                                  <span className="font-semibold text-slate-900">{o.no_of_days ?? 0}</span>
                                  <p className={`text-[11px] ${isClosed ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    {isClosed ? 'Closed' : 'Running'}
                                  </p>
                                </td>
                                <td className="py-2 pr-4">{o.ok_to_mfg ? 'Yes' : 'No'}</td>
                                <td className="py-2 pr-4">
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[o.status] || 'bg-slate-100 text-slate-600'}`}>
                                    {o.status}
                                  </span>
                                </td>
                              </tr>
                              {expanded && (
                                <tr className="bg-slate-50/80">
                                  <td colSpan={10} className="px-4 py-3">
                                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        Booking — {o.order_no}
                                      </p>
                                      <table className="w-full text-left text-sm">
                                        <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                                          <tr>
                                            <th className="px-3 py-2 font-semibold">Sr</th>
                                            <th className="px-3 py-2 font-semibold">Product Code</th>
                                            <th className="px-3 py-2 font-semibold">Qty</th>
                                            <th className="px-3 py-2 font-semibold">Price</th>
                                            <th className="px-3 py-2 font-semibold">Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((item, lineIndex) => {
                                            const qty = Number(item.qty) || 0
                                            const amt = Number(String(item.amount || '').replace(/[^\d.-]/g, '')) || 0
                                            const unitRaw = Number(String(item.unit_price || '').replace(/[^\d.-]/g, '')) || 0
                                            const unit = unitRaw || (qty ? amt / qty : 0)
                                            return (
                                              <tr key={`${o.id}-${item.product_code}-${lineIndex}`} className="border-b border-slate-50 last:border-0">
                                                <td className="px-3 py-2 font-semibold tabular-nums">{lineIndex + 1}</td>
                                                <td className="px-3 py-2 font-mono font-semibold text-blue-700">{item.product_code}</td>
                                                <td className="px-3 py-2 tabular-nums">{qty}</td>
                                                <td className="px-3 py-2 tabular-nums">{formatRupee(unit)}</td>
                                                <td className="px-3 py-2 font-medium tabular-nums">{formatRupee(amt || unit * qty)}</td>
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
