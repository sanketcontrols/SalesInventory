import { Save, Building2, Calendar, MapPin, Hash, Mail, Phone, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { ensureRupee } from '../utils/formatRupee'

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
}

export default function CompanyProfile() {
  const role = getStoredUser()?.role
  const isAdmin = role === 'admin'
  const canAccess = role === 'admin' || role === 'sales'

  const [companies, setCompanies] = useState<CustomerCompany[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [company, setCompany] = useState<CustomerCompany | null>(null)
  const [editName, setEditName] = useState('')
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', city: '', state: '', gst_no: '', address: '' })
  const [stats, setStats] = useState<OrderStats | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [search, setSearch] = useState('')
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
        if (data.length > 0 && !selectedId) {
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

    apiFetch<{ orders: OrderRow[]; stats: OrderStats }>(`/api/customers/${selectedId}/orders?${params}`)
      .then((data) => {
        setOrders(data.orders)
        setStats(data.stats)
      })
      .catch(console.error)

    apiFetch<CustomerCompany>(`/api/customers/${selectedId}`)
      .then((c) => {
        setCompany(c)
        setEditName(c.name)
        setEditForm({
          name: c.name,
          email: c.email,
          phone: c.phone,
          city: c.city,
          state: c.state,
          gst_no: c.gst_no || '',
          address: c.address || '',
        })
      })
      .catch(console.error)
  }, [selectedId, filterMonth, filterYear, canAccess])

  const handleSave = async () => {
    if (!selectedId) return
    try {
      const payload = isAdmin
        ? editForm
        : { name: editName }

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

  const filtered = companies.filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.gst_no || '').toLowerCase().includes(search.toLowerCase())
  )

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Building2 className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Company Profiles</h1>
        <p className="mt-2 text-sm text-slate-500">Buyer company profiles are available to admin and sales users.</p>
        <p className="mt-1 text-sm text-slate-500">Add companies from the Customers page to track who you sell to.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Company Profiles</h1>
        <p className="mt-1 text-sm text-slate-500">
          Buyer companies you sell to — address, GST, order frequency, and order history.
          {isAdmin ? ' Admin can edit all fields.' : ' You can edit company name only.'}
        </p>
        <p className="mt-1 text-sm text-blue-600">
          Add new companies from{' '}
          <Link to="/customers" className="font-medium underline hover:text-blue-700">Customers</Link>
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
            ) : filtered.map((c) => (
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
            ))}
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
                      <input value={editForm.gst_no} onChange={(e) => setEditForm({ ...editForm, gst_no: e.target.value })} placeholder="e.g. 27AABCU9603R1ZM" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
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
                  <h2 className="mb-4 text-lg font-semibold text-slate-900">Order Frequency — {company.name}</h2>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
                      {months.map((m, i) => (
                        <option key={m} value={String(i + 1)}>{m}</option>
                      ))}
                    </select>
                    <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                      {[2024, 2025, 2026, 2027].map((y) => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Order No</th>
                        <th className="py-2 pr-4 font-medium">Product</th>
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Qty</th>
                        <th className="py-2 pr-4 font-medium">Amount</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr><td colSpan={6} className="py-6 text-center text-slate-500">No orders for this company in selected period</td></tr>
                      ) : orders.map((o) => (
                        <tr key={o.id} className="border-b border-slate-100">
                          <td className="py-2 pr-4 font-medium">{o.order_no}</td>
                          <td className="py-2 pr-4 font-mono text-xs text-blue-600">{o.product_code || o.product_name || '—'}</td>
                          <td className="py-2 pr-4">{o.date}</td>
                          <td className="py-2 pr-4">{o.qty}</td>
                          <td className="py-2 pr-4">{ensureRupee(o.amount)}</td>
                          <td className="py-2 pr-4">{o.status}</td>
                        </tr>
                      ))}
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
