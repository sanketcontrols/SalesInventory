import { Plus, Minus, Download, Filter, AlertTriangle, Trash2, Search, Building2 } from 'lucide-react'
import { Fragment, useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { downloadExcel } from '../utils/exportExcel'
import ImportCsvButton from '../components/ImportCsvButton'
import { ensureRupee, formatRupee } from '../utils/formatRupee'
import { getEditWindowInfo } from '../utils/editWindow'
import EditWindowBadge from '../components/EditWindowBadge'

interface OrderItem {
  id?: number
  product_code_id: number
  product_code?: string
  product_name?: string
  description?: string
  qty: number
  unit_price?: string
  amount?: string
}

interface Order {
  id: number
  date: string
  order_no: string
  company: string
  state: string
  qty: number
  amount: string
  status: string
  product_code?: string
  product_name?: string
  no_of_days?: number
  ok_to_mfg?: boolean
  mfg_ok?: boolean
  days_open?: number
  days_closed?: boolean
  closing_date?: string | null
  closed_at?: string | null
  items?: OrderItem[]
  created_at?: string
  created_by?: number
}

interface ProductCode {
  id: number
  code: string
  name: string
  description?: string
  items: { name: string; sku: string; qty_per_unit: number; available: number }[]
}

interface StockBreakdown {
  product?: string
  name: string
  display: string
  available: number
  booked: number
  remaining: number
  in_stock: boolean
}

type LineDraft = {
  key: string
  product_code_id: string
  label: string
  description: string
  qty: string
  price: string
}

function parseMoney(value: string | number | undefined) {
  if (value == null || value === '') return 0
  return Number(String(value).replace(/[^0-9.]/g, '')) || 0
}

function lineUnitPrice(item: { qty: number; unit_price?: string; amount?: string }) {
  const unit = parseMoney(item.unit_price)
  if (unit > 0) return unit
  const qty = Number(item.qty) || 0
  if (qty <= 0) return 0
  return parseMoney(item.amount) / qty
}

export default function Orders() {
  const navigate = useNavigate()
  const user = getStoredUser()
  const role = user?.role
  const canExport = role === 'admin'

  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [companySummary, setCompanySummary] = useState<{
    name: string
    orders: number
    pending: number
    revenue: number
  } | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [productCodes, setProductCodes] = useState<ProductCode[]>([])
  const [customers, setCustomers] = useState<{ id: number; name: string; state: string; gst_no?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState('')
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [company, setCompany] = useState('')
  const [state, setState] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([
    { key: '1', product_code_id: '', label: '', description: '', qty: '1', price: '' },
  ])
  const [activeSuggestKey, setActiveSuggestKey] = useState<string | null>(null)
  const [editData, setEditData] = useState({ status: 'Pending' })
  const [breakdown, setBreakdown] = useState<StockBreakdown[]>([])
  const [stockWarnings, setStockWarnings] = useState<string[]>([])
  const [stockOk, setStockOk] = useState(true)

  useEffect(() => {
    fetchOrders()
    apiFetch<ProductCode[]>('/api/product-codes').then(setProductCodes).catch(console.error)
    apiFetch<{ id: number; name: string; state: string; gst_no?: string }[]>('/api/customers').then(setCustomers).catch(console.error)
  }, [statusFilter, filterMonth, filterYear])

  useEffect(() => {
    if (showForm) checkStockForLines(lines)
  }, [lines, showForm])

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

  const checkStockForLines = async (currentLines: LineDraft[]) => {
    const items = currentLines
      .filter((l) => l.product_code_id && Number(l.qty) > 0)
      .map((l) => ({ product_code_id: Number(l.product_code_id), qty: Number(l.qty) }))

    if (items.length === 0) {
      setBreakdown([])
      setStockWarnings([])
      setStockOk(true)
      return
    }

    try {
      const data = await apiFetch<{ breakdown: StockBreakdown[]; warnings: { message: string }[]; stockOk: boolean }>(
        '/api/orders/stock-check',
        { method: 'POST', body: JSON.stringify({ items }) }
      )
      setBreakdown(data.breakdown)
      setStockWarnings(data.warnings.map((w) => w.message))
      setStockOk(data.stockOk)
    } catch {
      setBreakdown([])
      setStockWarnings([])
    }
  }

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { key: String(Date.now()), product_code_id: '', label: '', description: '', qty: '1', price: '' },
    ])
  }

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)))
  }

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const suggestionsFor = (query: string) => {
    const q = query.trim().toLowerCase()
    return productCodes
      .filter((c) => {
        if (!q) return true
        return (
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          c.items.some((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
        )
      })
      .slice(0, 8)
  }

  const lineTotal = (line: LineDraft) => parseMoney(line.price) * (Number(line.qty) || 0)

  const orderSummary = useMemo(() => {
    const valid = lines.filter((l) => l.product_code_id && Number(l.qty) > 0)
    const totalQty = valid.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
    const totalAmount = valid.reduce((sum, l) => sum + lineTotal(l), 0)
    return { lines: valid.length, totalQty, totalAmount }
  }, [lines])

  const handleAddOrder = async () => {
    if (!company || !state) {
      alert('Please select company and state')
      return
    }
    const items = lines
      .filter((l) => l.product_code_id && Number(l.qty) > 0)
      .map((l) => ({
        product_code_id: Number(l.product_code_id),
        qty: Number(l.qty),
        price: parseMoney(l.price),
        description: l.description,
        amount: lineTotal(l),
      }))

    if (items.length === 0) {
      alert('Add at least one product')
      return
    }
    if (items.some((i) => !i.price)) {
      alert('Enter price for each product')
      return
    }

    if (!stockOk) {
      const proceed = window.confirm(
        'Warning: stock is not available for this order.\n\nAvailable to MFG will show Not Available.\n\nCreate order anyway?'
      )
      if (!proceed) return
    }

    try {
      const created = await apiFetch<{ stockOk?: boolean; warnings?: { message: string }[]; order_no?: string }>(
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            company,
            state,
            items,
            force: true,
          }),
        }
      )
      if (created.stockOk === false || (created.warnings && created.warnings.length > 0)) {
        alert('Order created with stock warning. Available to MFG: Not Available.')
      }
      setCompany('')
      setState('')
      setLines([{ key: '1', product_code_id: '', label: '', description: '', qty: '1', price: '' }])
      setBreakdown([])
      setStockWarnings([])
      setShowForm(false)
      fetchOrders()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create order')
    }
  }

  const handleUpdateOrder = async () => {
    if (!editingOrder) return
    try {
      await apiFetch(`/api/orders/${editingOrder.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: editData.status,
        }),
      })
      setEditingOrder(null)
      fetchOrders()
      alert('Order updated in database.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update order')
    }
  }

  const openCompanySummary = (companyName: string) => {
    const companyOrders = orders.filter((o) => o.company === companyName)
    const revenue = companyOrders
      .filter((o) => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + parseMoney(o.amount), 0)
    setCompanySummary({
      name: companyName,
      orders: companyOrders.length,
      pending: companyOrders.filter((o) => o.status === 'Pending').length,
      revenue,
    })
  }

  const openCompanyProfile = (companyName: string) => {
    const match = customers.find((c) => c.name === companyName)
    if (match) {
      navigate(`/company-profile?id=${match.id}`)
    } else {
      navigate(`/company-profile?search=${encodeURIComponent(companyName)}`)
    }
  }

  const handleExport = () => {
    const rows: (string | number)[][] = []
    for (const o of orders) {
      const lines = o.items?.length
        ? o.items
        : [{ product_code: o.product_code || '-', qty: o.qty, unit_price: o.amount, amount: o.amount }]
      lines.forEach((item, idx) => {
        const unit = lineUnitPrice(item as OrderItem)
        const lineAmt = parseMoney((item as OrderItem).amount) || unit * Number(item.qty)
        rows.push([
          o.date,
          o.closing_date || (o.status === 'Completed' || o.status === 'Cancelled' ? '—' : 'Open'),
          o.order_no,
          idx + 1,
          o.company,
          o.state,
          item.product_code || '-',
          Number(item.qty) || 0,
          unit,
          lineAmt,
          o.status,
          o.no_of_days ?? 0,
          o.status === 'Completed' || o.status === 'Cancelled' || (o.mfg_ok ?? o.ok_to_mfg) ? 'OK' : 'Short',
        ])
      })
    }
    downloadExcel(
      'orders.xlsx',
      'Orders',
      [
        { header: 'Order Date' },
        { header: 'Closing Date' },
        { header: 'Order No' },
        { header: 'Sr', type: 'number' },
        { header: 'Company' },
        { header: 'State' },
        { header: 'Product Code' },
        { header: 'Qty', type: 'number' },
        { header: 'Price', type: 'inr' },
        { header: 'Total', type: 'inr' },
        { header: 'Status' },
        { header: 'No of Days', type: 'number' },
        { header: 'Available to MFG' },
      ],
      rows
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

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const filteredRevenue = orders
    .filter((o) => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + parseMoney(o.amount), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sales Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track date, product, price, MFG release, and company history. Click a company for summary.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/company-profile"
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Building2 className="h-4 w-4" />
            Company Profiles
          </Link>
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
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Create Order</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Buyer Company</label>
              <select
                value={company}
                onChange={(e) => {
                  const selected = customers.find((c) => c.name === e.target.value)
                  setCompany(e.target.value)
                  setState(selected?.state || state)
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
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">State</label>
              <input type="text" value={state} onChange={(e) => setState(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            No of days starts from today and freezes when the order is Completed/Cancelled.
            Available to MFG shows <span className="font-medium text-emerald-600">Available</span> or{' '}
            <span className="font-medium text-rose-600">Not Available</span> from live inventory stock.
          </p>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Products — code, description, qty, price</label>
              <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Plus className="h-4 w-4" /> Add product
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="relative grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1.4fr_1.4fr_90px_110px_110px_40px]">
                  <div className="relative">
                    <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <Search className="h-4 w-4" />
                    </div>
                    <input
                      value={line.label}
                      onChange={(e) => {
                        updateLine(line.key, { label: e.target.value, product_code_id: '' })
                        setActiveSuggestKey(line.key)
                      }}
                      onFocus={() => setActiveSuggestKey(line.key)}
                      onBlur={() => setTimeout(() => setActiveSuggestKey(null), 150)}
                      placeholder="Product code"
                      className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                    />
                    {activeSuggestKey === line.key && suggestionsFor(line.label).length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                        {suggestionsFor(line.label).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={() => {
                              updateLine(line.key, {
                                product_code_id: String(c.id),
                                label: c.code,
                                description: c.description || c.name,
                              })
                              setActiveSuggestKey(null)
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          >
                            <span className="font-medium">{c.code}</span> — {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Description"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    placeholder="Qty"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.price}
                    onChange={(e) => updateLine(line.key, { price: e.target.value })}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    placeholder="Price"
                  />
                  <div className="flex items-center rounded-xl bg-slate-50 px-3 text-sm font-medium text-slate-800">
                    {formatRupee(lineTotal(line))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 1}
                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Products</p>
              <p className="text-lg font-semibold text-slate-900">{orderSummary.lines}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Qty</p>
              <p className="text-lg font-semibold text-slate-900">{orderSummary.totalQty}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Overall Amount</p>
              <p className="text-lg font-semibold text-blue-700">{formatRupee(orderSummary.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Inventory Status</p>
              <p className={`text-sm font-semibold ${stockOk ? 'text-emerald-600' : 'text-rose-600'}`}>
                {stockOk ? 'Available' : 'Not Available'}
              </p>
            </div>
          </div>

          {breakdown.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                <p className="text-sm font-semibold text-slate-800">Stock for all products</p>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Product / Inventory</th>
                    <th className="px-3 py-2 text-left font-medium">Available</th>
                    <th className="px-3 py-2 text-left font-medium">Booked</th>
                    <th className="px-3 py-2 text-left font-medium">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((item) => (
                    <tr key={item.display} className={item.in_stock ? '' : 'bg-rose-50'}>
                      <td className="px-3 py-2">
                        {item.product ? <span className="text-xs text-blue-600">{item.product} · </span> : null}
                        {item.name}
                      </td>
                      <td className="px-3 py-2">{item.available}</td>
                      <td className="px-3 py-2 font-medium text-amber-700">{item.booked}</td>
                      <td className={`px-3 py-2 font-semibold ${item.in_stock ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {item.remaining}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stockWarnings.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold">Warning — stock will go minus</p>
                <p className="mt-0.5 text-xs">You can still create this order. Available to MFG will show Red.</p>
                {stockWarnings.slice(0, 3).map((w) => <p key={w} className="mt-1">{w}</p>)}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleAddOrder}
              disabled={!company || lines.every((l) => !l.product_code_id)}
              className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create Order
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {editingOrder && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Edit Order {editingOrder.order_no}</h2>
          <EditWindowBadge role={role} createdAt={editingOrder.created_at} createdBy={editingOrder.created_by} userId={user?.id} />
          {editingOrder.items && editingOrder.items.length > 0 && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              {editingOrder.items.map((item) => (
                <p key={`${item.product_code_id}-${item.qty}`}>
                  {item.product_code} — {item.description || item.product_name} × {item.qty} @ {ensureRupee(item.unit_price || '0')} = {ensureRupee(item.amount || '0')}
                </p>
              ))}
              <p className="mt-2 font-semibold text-slate-900">Total: {ensureRupee(editingOrder.amount)}</p>
            </div>
          )}
          <div className="mt-4 grid max-w-xl gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Status</label>
              <select value={editData.status} onChange={(e) => setEditData({ status: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">No of days</p>
              <p className="font-semibold text-slate-900">{editingOrder.no_of_days ?? 0}</p>
              <p className="text-[11px] text-slate-400">
                {(editingOrder.status === 'Completed' || editingOrder.status === 'Cancelled')
                  ? `Closed${editingOrder.closing_date ? ` · ${editingOrder.closing_date}` : ''} (order date → close)`
                  : 'Running (order date → today)'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Inventory Status</p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  editingOrder.status === 'Completed' ||
                  editingOrder.status === 'Cancelled' ||
                  (editingOrder.mfg_ok ?? editingOrder.ok_to_mfg)
                    ? 'text-emerald-600'
                    : 'text-rose-600'
                }`}
              >
                {editingOrder.status === 'Completed' ||
                editingOrder.status === 'Cancelled' ||
                (editingOrder.mfg_ok ?? editingOrder.ok_to_mfg)
                  ? 'Available'
                  : 'Not Available'}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Mark Completed to freeze days. Cancelled restores stock.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={handleUpdateOrder} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Save</button>
            <button onClick={() => setEditingOrder(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {companySummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-slate-900">{companySummary.name}</h2>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xl font-bold text-blue-600">{companySummary.orders}</p>
                <p className="text-xs text-slate-500">Orders</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-xl font-bold text-amber-600">{companySummary.pending}</p>
                <p className="text-xs text-slate-500">Pending</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-xl font-bold text-emerald-600">{formatRupee(companySummary.revenue)}</p>
                <p className="text-xs text-slate-500">Revenue</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  openCompanyProfile(companySummary.name)
                  setCompanySummary(null)
                }}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
              >
                Open Full Profile
              </button>
              <button onClick={() => setCompanySummary(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500">Loading orders...</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-slate-700 w-10" />
                <th className="px-3 py-3 text-left font-medium text-slate-700">Date</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Closing Date</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Order No</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Company</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">State</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Products</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Qty</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Total</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Status</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">No of Days</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Inventory Status</th>
                <th className="px-3 py-3 text-left font-medium text-slate-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-500">No orders found</td>
                </tr>
              ) : (
                orders.map((order) => {
                  const editInfo = getEditWindowInfo(role, order.created_at, order.created_by, user?.id)
                  const isClosed = order.status === 'Completed' || order.status === 'Cancelled'
                  const mfgOk = isClosed
                    ? true
                    : typeof order.mfg_ok === 'boolean'
                      ? order.mfg_ok
                      : Boolean(order.ok_to_mfg)
                  const daysShown = Number(order.no_of_days ?? order.days_open ?? 0)
                  const lines =
                    order.items?.length
                      ? order.items
                      : [
                          {
                            product_code: order.product_code || '—',
                            qty: order.qty,
                            unit_price: order.amount,
                            amount: order.amount,
                          } as OrderItem,
                        ]
                  const productCount = lines.length
                  const expanded = expandedIds.has(order.id)
                  const toggle = () => {
                    setExpandedIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(order.id)) next.delete(order.id)
                      else next.add(order.id)
                      return next
                    })
                  }

                  return (
                    <Fragment key={order.id}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={toggle}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                            title={expanded ? 'Hide products' : 'Show products / booking'}
                            aria-label={expanded ? 'Collapse' : 'Expand'}
                          >
                            {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-900">{order.date}</p>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                          {isClosed ? order.closing_date || '—' : <span className="text-slate-400">Open</span>}
                        </td>
                        <td className="px-3 py-3 font-medium text-slate-900">{order.order_no}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => openCompanySummary(order.company)}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {order.company}
                          </button>
                        </td>
                        <td className="px-3 py-3">{order.state}</td>
                        <td className="px-3 py-3 text-slate-700">
                          {productCount} product{productCount === 1 ? '' : 's'}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{order.qty}</td>
                        <td className="px-3 py-3 font-semibold text-slate-900">{ensureRupee(order.amount)}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[order.status]}`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-medium text-slate-900">{daysShown}</span>
                          <p className={`text-[11px] ${isClosed ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {isClosed ? 'Closed' : 'Running'}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              mfgOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {mfgOk ? 'Available' : 'Not Available'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {editInfo.canEdit ? (
                            <button
                              onClick={() => {
                                setEditingOrder(order)
                                setEditData({ status: order.status })
                              }}
                              className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
                            >
                              ✎
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">🔒</span>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={13} className="px-4 py-3">
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Booking — {order.order_no} · {order.company}
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
                                    const unit = lineUnitPrice(item)
                                    const lineAmt = parseMoney(item.amount) || unit * Number(item.qty)
                                    return (
                                      <tr
                                        key={`${order.id}-${item.id ?? item.product_code}-${lineIndex}`}
                                        className="border-b border-slate-50 last:border-0"
                                      >
                                        <td className="px-3 py-2 font-semibold tabular-nums text-slate-700">{lineIndex + 1}</td>
                                        <td className="px-3 py-2 font-mono font-semibold text-blue-700">{item.product_code || '—'}</td>
                                        <td className="px-3 py-2 tabular-nums text-slate-800">{item.qty}</td>
                                        <td className="px-3 py-2 tabular-nums text-slate-800">{formatRupee(unit)}</td>
                                        <td className="px-3 py-2 font-semibold tabular-nums text-slate-900">{formatRupee(lineAmt)}</td>
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
      )}
    </div>
  )
}
