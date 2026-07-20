import { Plus, Download, Filter, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { apiFetch, getStoredUser } from '../services/api'
import { downloadCsv } from '../utils/exportCsv'
import ImportCsvButton from '../components/ImportCsvButton'
import { ensureRupee, formatRupee } from '../utils/formatRupee'
import { formatDateTime, getEditWindowInfo } from '../utils/editWindow'
import EditWindowBadge from '../components/EditWindowBadge'

interface Order {
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
  created_at?: string
  created_by?: number
}

interface ProductCode {
  id: number
  code: string
  name: string
  items: { name: string; sku: string; qty_per_unit: number; available: number }[]
}

interface StockBreakdown {
  name: string
  display: string
  total_qty: number
  available: number
  in_stock: boolean
}

export default function Orders() {
  const user = getStoredUser()
  const role = user?.role
  const canExport = role === 'admin'

  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [productCodes, setProductCodes] = useState<ProductCode[]>([])
  const [customers, setCustomers] = useState<{ id: number; name: string; state: string; gst_no?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [formData, setFormData] = useState({ company: '', state: '', qty: '1', amount: '', product_code_id: '' })
  const [editData, setEditData] = useState({ status: 'Pending' })
  const [breakdown, setBreakdown] = useState<StockBreakdown[]>([])
  const [stockWarnings, setStockWarnings] = useState<string[]>([])
  const [stockOk, setStockOk] = useState(true)

  useEffect(() => {
    fetchOrders()
    apiFetch<ProductCode[]>('/api/product-codes').then(setProductCodes).catch(console.error)
    apiFetch<{ id: number; name: string; state: string; gst_no?: string }[]>('/api/customers').then(setCustomers).catch(console.error)
  }, [statusFilter, filterMonth, filterYear])

  const fetchOrders = async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (filterMonth) params.set('month', filterMonth)
      if (filterYear) params.set('year', filterYear)
      const qs = params.toString() ? `?${params}` : ''
      const data = await apiFetch<Order[]>(`/api/orders${qs}`)
      setOrders(data)
    } catch (error) {
      console.error('Error fetching orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const checkStock = async (codeId: string, qty: string) => {
    if (!codeId || !qty) {
      setBreakdown([])
      setStockWarnings([])
      setStockOk(true)
      return
    }
    try {
      const data = await apiFetch<{ breakdown: StockBreakdown[]; warnings: { message: string }[]; stockOk: boolean }>(
        `/api/product-codes/${codeId}/stock-check?qty=${qty}`
      )
      setBreakdown(data.breakdown)
      setStockWarnings(data.warnings.map((w) => w.message))
      setStockOk(data.stockOk)
    } catch {
      setBreakdown([])
      setStockWarnings([])
    }
  }

  const handleCodeChange = (codeId: string) => {
    setFormData({ ...formData, product_code_id: codeId })
    checkStock(codeId, formData.qty)
  }

  const handleQtyChange = (qty: string) => {
    setFormData({ ...formData, qty })
    if (formData.product_code_id) {
      checkStock(formData.product_code_id, qty)
    }
  }

  const handleAddOrder = async (force = false) => {
    if (!formData.company || !formData.state || !formData.qty) {
      alert('Please fill company, state, and quantity')
      return
    }
    if (!formData.product_code_id && !formData.amount) {
      alert('Select a product code or enter amount')
      return
    }
    if (!stockOk && !force) {
      alert('Insufficient stock! Cannot create order.')
      return
    }

    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          company: formData.company,
          state: formData.state,
          qty: formData.qty,
          amount: formData.amount || undefined,
          product_code_id: formData.product_code_id ? Number(formData.product_code_id) : undefined,
          force,
        }),
      })
      setFormData({ company: '', state: '', qty: '1', amount: '', product_code_id: '' })
      setBreakdown([])
      setStockWarnings([])
      setShowForm(false)
      fetchOrders()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create order'
      if (msg.includes('Insufficient stock')) {
        alert('⚠ Out of stock! Some items do not have enough quantity.')
      } else {
        alert(msg)
      }
    }
  }

  const handleUpdateOrder = async () => {
    if (!editingOrder) return
    try {
      await apiFetch(`/api/orders/${editingOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify(editData),
      })
      setEditingOrder(null)
      fetchOrders()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update order')
    }
  }

  const handleExport = () => {
    downloadCsv(
      'orders.csv',
      ['Order No', 'Product Code', 'Company', 'State', 'Date', 'Qty', 'Amount', 'Status'],
      orders.map((o) => [o.order_no, o.product_code || '-', o.company, o.state, o.date, o.qty, ensureRupee(o.amount), o.status])
    )
  }

  const handleImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; total: number; errors: string[] }>('/api/orders/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
    alert(`Imported ${result.imported} of ${result.total} orders${result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : ''}`)
    fetchOrders()
  }

  const statusStyles: Record<string, string> = {
    Pending: 'bg-amber-50 text-amber-700',
    Completed: 'bg-emerald-50 text-emerald-700',
    Cancelled: 'bg-rose-50 text-rose-700',
  }

  const selectedCode = productCodes.find((c) => String(c.id) === formData.product_code_id)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const filteredRevenue = orders.filter((o) => o.status !== 'Cancelled').reduce((sum, o) => {
    const n = parseFloat(String(o.amount).replace(/[^0-9.]/g, '')) || 0
    return sum + n
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sales Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Analyze orders by month. Sales users can edit own orders within 48 hours only.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowFilter(!showFilter)} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          {canExport && (
            <button onClick={handleExport} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
          <ImportCsvButton onImport={handleImport} />
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            New Order
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Month</label>
              <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="">All months</option>
                {months.map((m, i) => (
                  <option key={m} value={String(i + 1)}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Year</label>
              <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="">All years</option>
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-blue-50 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{orders.length}</p>
            <p className="text-xs text-slate-500">Orders in filter</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{formatRupee(filteredRevenue)}</p>
            <p className="text-xs text-slate-500">Revenue (excl. cancelled)</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{orders.filter((o) => o.status === 'Pending').length}</p>
            <p className="text-xs text-slate-500">Pending orders</p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Create New Order</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Buyer Company</label>
              <select
                value={formData.company}
                onChange={(e) => {
                  const selected = customers.find((c) => c.name === e.target.value)
                  setFormData({
                    ...formData,
                    company: e.target.value,
                    state: selected?.state || formData.state,
                  })
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              >
                <option value="">Select company...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}{c.gst_no ? ` (${c.gst_no})` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Add companies in Customers page first</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
              <input type="text" placeholder="State" value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Product Code</label>
              <select value={formData.product_code_id} onChange={(e) => handleCodeChange(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="">Select product code...</option>
                {productCodes.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Quantity (multiplier)</label>
              <input type="number" min={1} placeholder="e.g. 2 for Barrier × 2" value={formData.qty} onChange={(e) => handleQtyChange(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            </div>
            <input type="text" placeholder="Amount (auto-calculated if blank)" value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          </div>

          {selectedCode && breakdown.length > 0 && (
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                {selectedCode.name} × {formData.qty} — Items required:
              </p>
              <div className="space-y-1">
                {breakdown.map((item) => (
                  <div key={item.display} className={`flex items-center justify-between text-sm ${item.in_stock ? 'text-slate-700' : 'font-semibold text-rose-600'}`}>
                    <span>{item.display}</span>
                    <span>{item.in_stock ? `${item.available} avail ✓` : `Only ${item.available} avail ✗`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stockWarnings.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Out of stock warning!</p>
                {stockWarnings.map((w) => <p key={w}>{w}</p>)}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button onClick={() => handleAddOrder()} disabled={!stockOk} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Create Order</button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {editingOrder && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Edit Order {editingOrder.order_no}</h2>
          <EditWindowBadge role={role} createdAt={editingOrder.created_at} createdBy={editingOrder.created_by} userId={user?.id} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Status</label>
              <select value={editData.status} onChange={(e) => setEditData({ status: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleUpdateOrder} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Save</button>
            <button onClick={() => setEditingOrder(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500">Loading orders...</div>
      ) : (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Order No</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Product Code</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Company</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">State</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Date</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Time</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Qty</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Amount</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Status</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const editInfo = getEditWindowInfo(role, order.created_at, order.created_by, user?.id)
              return (
              <tr key={order.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                <td className="px-6 py-3 font-medium text-slate-900">{order.order_no}</td>
                <td className="px-6 py-3">
                  {order.product_code ? (
                    <span className="font-mono text-xs text-blue-600">{order.product_code}</span>
                  ) : '—'}
                </td>
                <td className="px-6 py-3">{order.company}</td>
                <td className="px-6 py-3">{order.state}</td>
                <td className="px-6 py-3">{order.date}</td>
                <td className="px-6 py-3 text-xs text-slate-500">{order.created_at ? formatDateTime(order.created_at) : '—'}</td>
                <td className="px-6 py-3">{order.qty}</td>
                <td className="px-6 py-3 font-medium">{ensureRupee(order.amount)}</td>
                <td className="px-6 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[order.status]}`}>{order.status}</span>
                </td>
                <td className="px-6 py-3">
                  {editInfo.canEdit ? (
                    <button onClick={() => { setEditingOrder(order); setEditData({ status: order.status }) }} className="rounded px-2 py-1 text-slate-600 transition hover:bg-slate-100" title="Edit status">✎</button>
                  ) : (
                    <span className="text-xs text-slate-400" title={editInfo.remainingLabel}>🔒</span>
                  )}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
