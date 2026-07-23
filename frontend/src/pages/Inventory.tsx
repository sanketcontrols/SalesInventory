import { Plus, Minus, Download, Filter, Pencil } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { downloadExcel } from '../utils/exportExcel'
import ImportCsvButton from '../components/ImportCsvButton'
import EditWindowBadge from '../components/EditWindowBadge'
import MonthlyAvgHistory from '../components/MonthlyAvgHistory'
import { getEditWindowInfo } from '../utils/editWindow'
import { canExport } from '../utils/roleAccess'

interface InventoryItem {
  id: number
  name: string
  available: number
  qty?: number
  remaining?: number
  monthly_avg: number
  pending: number
  booked?: number
  required_qty?: number
  qty_used?: number
  used?: number
  reserved: number
  status: string
  created_at?: string
  created_by?: number
}

interface BookingRow {
  order_no: string
  product_code: string
  qty: number
  date: string
  status?: string
  source?: string
}

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Inventory() {
  const navigate = useNavigate()
  const user = getStoredUser()
  const role = user?.role
  const canExportCsv = canExport(role)
  const canAdjust = role === 'admin' || role === 'inventory'

  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adjustingId, setAdjustingId] = useState<number | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [bookingsById, setBookingsById] = useState<Record<number, BookingRow[]>>({})
  const [loadingBookings, setLoadingBookings] = useState<number | null>(null)
  const [addQtyId, setAddQtyId] = useState<number | null>(null)
  const [addQtyForm, setAddQtyForm] = useState({
    inward: 'Inward',
    qty: '',
    date: todayLabel(),
  })
  const [isNewItem, setIsNewItem] = useState(false)
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    available: '',
  })

  useEffect(() => {
    fetchItems()
  }, [statusFilter])

  const fetchItems = async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const qs = params.toString() ? `?${params}` : ''
      const data = await apiFetch<InventoryItem[]>(`/api/inventory${qs}`)
      setItems(data)
    } catch (error) {
      console.error('Error fetching inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadBookings = async (inventoryId: number) => {
    setLoadingBookings(inventoryId)
    try {
      const data = await apiFetch<{ bookings: BookingRow[] }>(`/api/inventory/${inventoryId}/bookings`)
      setBookingsById((prev) => ({ ...prev, [inventoryId]: data.bookings || [] }))
    } catch (error) {
      console.error(error)
      setBookingsById((prev) => ({ ...prev, [inventoryId]: [] }))
    } finally {
      setLoadingBookings(null)
    }
  }

  const toggleExpand = async (item: InventoryItem) => {
    const willOpen = !expandedIds.has(item.id)
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    if (willOpen && !bookingsById[item.id]) {
      await loadBookings(item.id)
    }
  }

  const openAddQty = (item: InventoryItem) => {
    setAddQtyId(item.id)
    setAddQtyForm({
      inward: 'Inward',
      qty: '',
      date: todayLabel(),
    })
    setExpandedIds((prev) => new Set(prev).add(item.id))
    if (!bookingsById[item.id]) loadBookings(item.id)
  }

  const submitAddQty = async (item: InventoryItem) => {
    const qty = Number(addQtyForm.qty)
    if (!Number.isFinite(qty) || qty === 0) {
      alert('Enter qty to add (e.g. 10)')
      return
    }
    setAdjustingId(item.id)
    try {
      const updated = await apiFetch<InventoryItem>(`/api/inventory/${item.id}/add-qty`, {
        method: 'POST',
        body: JSON.stringify({
          qty,
          inward: addQtyForm.inward || 'Inward',
          date: addQtyForm.date || todayLabel(),
        }),
      })
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)))
      setAddQtyId(null)
      setAddQtyForm({ inward: 'Inward', qty: '', date: todayLabel() })
      await loadBookings(item.id)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add qty')
    } finally {
      setAdjustingId(null)
    }
  }

  const openNewForm = () => {
    setIsNewItem(true)
    setFormData({ id: '', name: '', available: '' })
    setShowForm(true)
  }

  const openEditForm = (item: InventoryItem) => {
    setIsNewItem(false)
    setFormData({
      id: String(item.id),
      name: item.name,
      available: String(item.available),
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Inventory name is required')
      return
    }

    try {
      if (isNewItem) {
        await apiFetch('/api/inventory', {
          method: 'POST',
          body: JSON.stringify({
            name: formData.name,
            available: Number(formData.available) || 0,
            pending: 0,
            reserved: 0,
          }),
        })
      } else {
        const item = items.find((i) => String(i.id) === formData.id)
        const editInfo = getEditWindowInfo(role, item?.created_at, item?.created_by, user?.id)
        if (!editInfo.canEdit && role !== 'admin') {
          alert('48-hour edit window expired. Contact admin.')
          return
        }
        await apiFetch(`/api/inventory/${formData.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formData.name,
            available: Number(formData.available) || 0,
          }),
        })
      }
      setShowForm(false)
      fetchItems()
      alert(isNewItem ? 'Inventory saved.' : 'Inventory updated.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save inventory')
    }
  }

  const handleExport = () => {
    downloadExcel(
      'inventory.xlsx',
      'Inventory',
      [
        { header: 'Name' },
        { header: 'Required Qty', type: 'number' },
        { header: 'Available Qty', type: 'number' },
        { header: 'Monthly Avg', type: 'number' },
        { header: 'Status' },
      ],
      items.map((i) => [
        i.name,
        i.required_qty ?? i.booked ?? i.pending ?? 0,
        i.available,
        i.monthly_avg ?? 0,
        i.status,
      ])
    )
  }

  const handleImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; total: number; skipped?: number; errors: string[] }>(
      '/api/inventory/import',
      {
        method: 'POST',
        body: JSON.stringify({ rows, namesOnly: true }),
      }
    )
    alert(
      `Imported ${result.imported} of ${result.total} (Particulars only)` +
        (result.skipped ? `\nSkipped: ${result.skipped}` : '') +
        (result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : '')
    )
    fetchItems()
  }

  const filtered = items.filter((item) => {
    if (!search.trim()) return true
    return item.name.toLowerCase().includes(search.toLowerCase())
  })

  const statusStyles: Record<string, string> = {
    'Stock Available': 'bg-emerald-50 text-emerald-700',
    Normal: 'bg-emerald-50 text-emerald-700',
    'Low Stock': 'bg-amber-50 text-amber-700',
    Defect: 'bg-rose-50 text-rose-700',
    Critical: 'bg-rose-50 text-rose-700',
  }

  const bookedOf = (item: InventoryItem) => item.required_qty ?? item.booked ?? item.pending ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">
            Required = pending (orange) · Available = green · Sold / used = red · This Month = used qty (click calendar for all months)
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setShowFilter(!showFilter)} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          {canExportCsv && (
            <button onClick={handleExport} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
          <ImportCsvButton onImport={handleImport} label="Import CSV" />
          <button onClick={openNewForm} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Add Inventory
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inventory name..."
          className="min-w-[240px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
      </div>

      {showFilter && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Filter by Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
            <option value="">All Statuses</option>
            <option value="Stock Available">Stock Available</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Defect">Defect</option>
          </select>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">{isNewItem ? 'Add Inventory' : 'Update Inventory'}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Inventory</label>
              <input
                type="text"
                placeholder="e.g. MCB 32A"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Qty Available</label>
              <input
                type="number"
                placeholder="Free stock qty"
                value={formData.available}
                onChange={(e) => setFormData({ ...formData, available: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {!isNewItem && (
            <div className="mt-3">
              <EditWindowBadge
                role={role}
                createdAt={items.find((i) => String(i.id) === formData.id)?.created_at}
                createdBy={items.find((i) => String(i.id) === formData.id)?.created_by}
                userId={user?.id}
              />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={handleSave} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">
              {isNewItem ? 'Create' : 'Save'}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="w-10 px-3 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Required Qty</th>
              <th className="px-4 py-3 font-medium">Available Qty</th>
              <th className="px-4 py-3 font-medium">This Month</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading inventory...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No inventory items yet. Click Add Inventory.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const low = item.available <= 0
                const required = bookedOf(item)
                const busy = adjustingId === item.id
                const expanded = expandedIds.has(item.id)
                const bookings = bookingsById[item.id] || []
                const showAdd = addQtyId === item.id
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/80"
                      onClick={() => navigate(`/inventory/${item.id}`)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(item)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                          title={expanded ? 'Hide bookings' : 'Show order bookings'}
                        >
                          {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 hover:text-blue-700">{item.name}</p>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-amber-700">{required}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-semibold tabular-nums ${
                            low ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {item.available}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <MonthlyAvgHistory
                          endpoint={`/api/inventory/${item.id}/monthly-stats`}
                          title={`${item.name} — monthly used`}
                          metricLabel="Used qty"
                          currentValue={Number(item.monthly_avg || 0)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status] || 'bg-slate-100 text-slate-600'}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1.5">
                          {canAdjust && (
                            <button
                              type="button"
                              onClick={() => openAddQty(item)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add Qty
                            </button>
                          )}
                          <button
                            onClick={() => openEditForm(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-3">
                            {showAdd && canAdjust && (
                              <div className="rounded-xl border border-emerald-200 bg-white p-4">
                                <p className="mb-3 text-sm font-semibold text-slate-900">Add Qty — {item.name}</p>
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-500">Inward</label>
                                    <input
                                      value={addQtyForm.inward}
                                      readOnly
                                      className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-500">Qty</label>
                                    <input
                                      type="number"
                                      value={addQtyForm.qty}
                                      onChange={(e) => setAddQtyForm({ ...addQtyForm, qty: e.target.value })}
                                      placeholder="Enter qty"
                                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-slate-500">Date</label>
                                    <input
                                      value={addQtyForm.date}
                                      onChange={(e) => setAddQtyForm({ ...addQtyForm, date: e.target.value })}
                                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    />
                                  </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => submitAddQty(item)}
                                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    Save Qty
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAddQtyId(null)}
                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                History — {item.name}
                              </p>
                              <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
                                Add / Inward (green) · Required / Pending (orange) · Sold / used (red)
                              </p>
                              {loadingBookings === item.id ? (
                                <p className="px-3 py-4 text-sm text-slate-500">Loading…</p>
                              ) : bookings.length === 0 ? (
                                <p className="px-3 py-4 text-sm text-slate-500">No orders or qty adds yet for this item.</p>
                              ) : (
                                <table className="w-full text-left text-sm">
                                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                      <th className="px-3 py-2 font-semibold">Ref</th>
                                      <th className="px-3 py-2 font-semibold">Product Code</th>
                                      <th className="px-3 py-2 font-semibold">Qty</th>
                                      <th className="px-3 py-2 font-semibold">Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {bookings.map((b, idx) => {
                                      const qty = Number(b.qty) || 0
                                      const isInward =
                                        (b.source === 'manual' ||
                                          /^inward$/i.test(String(b.order_no || '')) ||
                                          b.status === 'Added') &&
                                        qty > 0
                                      const isSold =
                                        b.status === 'Completed' || qty < 0
                                      const qtyTone = isInward
                                        ? 'text-emerald-700'
                                        : isSold
                                          ? 'text-rose-600'
                                          : 'text-amber-700'
                                      const qtyLabel = isInward
                                        ? `+${qty}`
                                        : isSold
                                          ? String(Math.abs(qty))
                                          : String(qty)
                                      return (
                                        <tr
                                          key={`${item.id}-${b.order_no}-${b.product_code}-${idx}`}
                                          className="border-b border-slate-50 last:border-0"
                                        >
                                          <td
                                            className={`px-3 py-2 font-medium ${
                                              isInward ? 'text-emerald-700' : 'text-slate-900'
                                            }`}
                                          >
                                            {b.order_no}
                                          </td>
                                          <td className="px-3 py-2 font-mono font-semibold text-blue-700">
                                            {b.product_code || '—'}
                                          </td>
                                          <td className={`px-3 py-2 font-semibold tabular-nums ${qtyTone}`}>
                                            {qtyLabel}
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">{b.date}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
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
  )
}
