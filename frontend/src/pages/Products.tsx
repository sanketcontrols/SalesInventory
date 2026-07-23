import { Plus, Minus, Trash2, Pencil, Search, Package, Layers, X, ExternalLink } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { canDelete } from '../utils/roleAccess'
import ImportExcelButton from '../components/ImportExcelButton'
import MonthlyAvgHistory from '../components/MonthlyAvgHistory'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatTile,
  TableShell,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from '../components/ui'

const PRODUCT_CATEGORIES = [
  'Temperature sensor',
  'Level sensor',
  'Panel accessories',
  'Trading items',
] as const

interface InventoryItem {
  id: number
  name: string
  sku?: string
  available: number
}

interface CodeItem {
  inventory_id: number
  qty_per_unit: number
  name?: string
  sku?: string
  available?: number
  booked?: number
  required_qty?: number
}

interface ProductCode {
  id: number
  code: string
  name: string
  description: string
  items: CodeItem[]
  stock_qty?: number
  qty_available?: number | null
  /** Pending order demand (same as required_qty) */
  booked?: number
  required_qty?: number
  sold?: number
  monthly_avg?: number
}

function requiredOf(p: { booked?: number; required_qty?: number }) {
  return p.booked ?? p.required_qty ?? 0
}

function itemRequiredOf(item: { booked?: number; required_qty?: number }) {
  return item.booked ?? item.required_qty ?? 0
}

interface BookingRow {
  type?: string
  company: string
  order_no: string
  qty: number
  date: string
  status?: string
  created_at?: string
}

interface StockHistoryRow {
  type?: string
  label: string
  qty: number
  stock_after: number
  date: string
  note?: string
  created_at?: string
}

type HistoryRow = {
  key: string
  kind: 'stock' | 'order'
  detail: string
  order_no: string
  qty: number
  qtyLabel: string
  date: string
  status: string
  /** stock add → green; required/pending → amber; sold → red */
  qtyTone: 'green' | 'amber' | 'red'
  sortAt: number
}

function mergeProductHistory(
  productId: number,
  bookings: BookingRow[],
  stockHistory: StockHistoryRow[]
): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...stockHistory.map((h, idx) => ({
      key: `${productId}-s-${idx}`,
      kind: 'stock' as const,
      detail: h.label || 'Stock',
      order_no: '—',
      qty: h.qty,
      qtyLabel: `+${h.qty}`,
      date: h.date,
      status: 'Add in stock',
      qtyTone: 'green' as const,
      sortAt: h.created_at ? new Date(h.created_at).getTime() : 0,
    })),
    ...bookings.map((b, idx) => {
      const completed = b.status === 'Completed'
      return {
        key: `${productId}-o-${idx}`,
        kind: 'order' as const,
        detail: b.company || '—',
        order_no: b.order_no || '—',
        qty: b.qty,
        qtyLabel: String(b.qty),
        date: b.date,
        status: b.status || '—',
        qtyTone: (completed ? 'red' : 'amber') as 'red' | 'amber',
        sortAt: b.created_at ? new Date(b.created_at).getTime() : 0,
      }
    }),
  ]
  return rows.sort((a, b) => b.sortAt - a.sortAt)
}

type ProductFormState = {
  id: string
  code: string
  name: string
  description: string
  items: { inventory_id: number; qty_per_unit: number }[]
}

const emptyForm = (): ProductFormState => ({
  id: '',
  code: '',
  name: '',
  description: '',
  items: [],
})

const todayLabel = () =>
  new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function Products() {
  const navigate = useNavigate()
  const user = getStoredUser()
  const canRemove = canDelete(user?.role)
  const formRef = useRef<HTMLDivElement>(null)

  const [products, setProducts] = useState<ProductCode[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [form, setForm] = useState<ProductFormState>(emptyForm())
  const [invSearch, setInvSearch] = useState('')
  const [showInvSuggest, setShowInvSuggest] = useState(false)

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [bookingsById, setBookingsById] = useState<Record<number, BookingRow[]>>({})
  const [stockHistoryById, setStockHistoryById] = useState<Record<number, StockHistoryRow[]>>({})
  const [addQtyId, setAddQtyId] = useState<number | null>(null)
  const [addQtyForm, setAddQtyForm] = useState({ stock: 'Stock', qty: '', date: todayLabel() })
  const [savingQtyId, setSavingQtyId] = useState<number | null>(null)

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    if ((editingId != null || showNewForm) && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [editingId, showNewForm])

  const fetchAll = async () => {
    try {
      const [codes, inv] = await Promise.all([
        apiFetch<ProductCode[]>('/api/product-codes'),
        apiFetch<InventoryItem[]>('/api/inventory'),
      ])
      setProducts(codes)
      setInventory(inv)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const loadBookings = async (productId: number) => {
    try {
      const data = await apiFetch<{ bookings: BookingRow[]; stock_history?: StockHistoryRow[] }>(
        `/api/product-codes/${productId}/bookings`
      )
      setBookingsById((prev) => ({ ...prev, [productId]: data.bookings || [] }))
      setStockHistoryById((prev) => ({ ...prev, [productId]: data.stock_history || [] }))
    } catch (error) {
      console.error(error)
      setBookingsById((prev) => ({ ...prev, [productId]: [] }))
      setStockHistoryById((prev) => ({ ...prev, [productId]: [] }))
    }
  }

  const toggleExpand = async (productId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const willOpen = !expandedIds.has(productId)
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
    if (willOpen && (!bookingsById[productId] || !stockHistoryById[productId])) {
      await loadBookings(productId)
    }
  }

  const openAddQty = (product: ProductCode, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!product.items.length) {
      alert('Link inventory parts first before adding product stock.')
      return
    }
    setAddQtyId(product.id)
    setAddQtyForm({ stock: 'Stock', qty: '', date: todayLabel() })
    setExpandedIds((prev) => new Set(prev).add(product.id))
    if (!bookingsById[product.id]) loadBookings(product.id)
  }

  const submitAddQty = async (product: ProductCode) => {
    const qty = Number(addQtyForm.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('Enter product qty greater than 0')
      return
    }
    setSavingQtyId(product.id)
    try {
      const updated = await apiFetch<
        ProductCode & {
          product_qty_added?: number
          stock_before?: number
          deductions?: { name: string; deducted: number; available?: number }[]
        }
      >(`/api/product-codes/${product.id}/add-qty`, {
        method: 'POST',
        body: JSON.stringify({
          qty,
          stock: addQtyForm.stock || 'Stock',
          date: addQtyForm.date || todayLabel(),
        }),
      })
      setProducts((prev) => prev.map((row) => (row.id === product.id ? { ...row, ...updated } : row)))
      setAddQtyId(null)
      setAddQtyForm({ stock: 'Stock', qty: '', date: todayLabel() })
      await fetchAll()
      await loadBookings(product.id)
      const before = updated.stock_before ?? 0
      const after = Math.max(0, updated.qty_available ?? updated.stock_qty ?? before + qty)
      const parts = (updated.deductions || [])
        .map((d) => `${d.name}: −${d.deducted}`)
        .join('\n')
      alert(
        `Product ${product.code}: +${qty} ( Available Qty: ${before} → ${after})\n` +
          `Linked inventory deducted:\n${parts || '(none)'}`
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add product qty')
    } finally {
      setSavingQtyId(null)
    }
  }

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.items.some((i) => (i.name || '').toLowerCase().includes(q))
    )
  }, [products, search])

  const stats = useMemo(() => {
    const withBom = products.filter((p) => p.items.length > 0).length
    const lowStock = products.filter((p) => {
      if (!p.items.length) return false
      return p.items.some((i) => (i.available ?? 0) <= 0)
    }).length
    const requiredTotal = products.reduce((sum, p) => sum + requiredOf(p), 0)
    const soldTotal = products.reduce((sum, p) => sum + (p.sold ?? 0), 0)
    return { total: products.length, withBom, lowStock, requiredTotal, soldTotal }
  }, [products])

  const invSuggestions = useMemo(() => {
    const q = invSearch.trim().toLowerCase()
    if (!q) return inventory.slice(0, 8)
    return inventory.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [inventory, invSearch])

  const closeForm = () => {
    setShowNewForm(false)
    setEditingId(null)
    setIsNew(false)
    setForm(emptyForm())
    setInvSearch('')
  }

  const openNew = () => {
    setIsNew(true)
    setEditingId(null)
    setForm(emptyForm())
    setInvSearch('')
    setShowNewForm(true)
  }

  const openEdit = (product: ProductCode) => {
    setIsNew(false)
    setShowNewForm(false)
    setForm({
      id: String(product.id),
      code: product.code,
      name: product.name,
      description: product.description || '',
      items: product.items.map((i) => ({ inventory_id: i.inventory_id, qty_per_unit: i.qty_per_unit })),
    })
    setInvSearch('')
    setEditingId(product.id)
  }

  const addInventory = (item: InventoryItem) => {
    if (form.items.some((i) => i.inventory_id === item.id)) {
      alert('This inventory is already added to the product')
      return
    }
    setForm({
      ...form,
      items: [...form.items, { inventory_id: item.id, qty_per_unit: 1 }],
    })
    setInvSearch('')
    setShowInvSuggest(false)
  }

  const updateItemQty = (index: number, qty: number) => {
    const next = [...form.items]
    next[index] = { ...next[index], qty_per_unit: Math.max(1, qty) }
    setForm({ ...form, items: next })
  }

  const removeItem = (index: number) => {
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) })
  }

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      alert('Product code and name are required')
      return
    }
    if (form.items.length === 0) {
      alert('Add at least one inventory item to this product')
      return
    }

    try {
      if (isNew) {
        await apiFetch('/api/product-codes', {
          method: 'POST',
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            description: form.description,
            items: form.items,
          }),
        })
      } else {
        await apiFetch(`/api/product-codes/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            description: form.description,
            items: form.items,
          }),
        })
      }
      closeForm()
      fetchAll()
      alert(isNew ? 'Product saved.' : 'Product updated.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save product')
    }
  }

  const handleDelete = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!confirm('Delete this product?')) return
    try {
      await apiFetch(`/api/product-codes/${id}`, { method: 'DELETE' })
      if (editingId === id) closeForm()
      fetchAll()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete')
    }
  }

  const handleStkSumImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; skipped?: number; total: number; errors: string[] }>(
      '/api/product-codes/import',
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }
    )
    alert(
      `Products — added: ${result.imported}, skipped: ${result.skipped ?? 0}, total rows: ${result.total}` +
        (result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : '')
    )
    fetchAll()
  }

  const getInvName = (inventoryId: number) => {
    return inventory.find((i) => i.id === inventoryId)?.name || `Inventory #${inventoryId}`
  }

  const getInvAvailable = (inventoryId: number) => {
    return inventory.find((i) => i.id === inventoryId)?.available ?? 0
  }

  const minAvailable = (product: ProductCode) => {
    const stock = product.qty_available ?? product.stock_qty
    if (stock == null) return 0
    return Math.max(0, Number(stock) || 0)
  }

  const renderFormFields = () => (
    <div ref={formRef} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Product Code">
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="e.g. BRK-001"
            autoFocus
          />
        </Field>
        <Field label="Product Name">
          <Select value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}>
            <option value="">Select category…</option>
            {PRODUCT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
            {form.name && !(PRODUCT_CATEGORIES as readonly string[]).includes(form.name) && (
              <option value={form.name}>{form.name}</option>
            )}
          </Select>
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional notes"
          />
        </Field>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Add inventory to this product</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={invSearch}
            onChange={(e) => {
              setInvSearch(e.target.value)
              setShowInvSuggest(true)
            }}
            onFocus={() => setShowInvSuggest(true)}
            onBlur={() => setTimeout(() => setShowInvSuggest(false), 150)}
            placeholder="Type inventory name to suggest…"
            className="pl-10"
          />
          {showInvSuggest && invSuggestions.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {invSuggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={() => addInventory(item)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{item.name}</span>
                  <span className={`text-xs font-semibold ${item.available <= 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {item.available} avail
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {form.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500">
            No inventory selected yet — search and add parts above
          </div>
        ) : (
          form.items.map((item, index) => {
            const avail = getInvAvailable(item.inventory_id)
            return (
              <div
                key={`${item.inventory_id}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <Package className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-[160px] flex-1">
                  <p className="text-sm font-medium text-slate-900">{getInvName(item.inventory_id)}</p>
                  <p className={`text-xs ${avail <= 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-700'}`}>
                    {avail} Available Qty
                  </p>
                </div>
                <label className="text-xs text-slate-500">Qty / unit</label>
                <input
                  type="number"
                  min={1}
                  value={item.qty_per_unit}
                  onChange={(e) => updateItemQty(index, Number(e.target.value) || 1)}
                  className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                  aria-label="Remove part"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave}>{isNew ? 'Create Product' : 'Save Product'}</Button>
        <Button variant="secondary" onClick={closeForm}>
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Products"
        subtitle="Click a product for full summary. + expands quick history. Available green · Required orange · Sold red."
        actions={
          <div className="flex flex-wrap gap-2">
            <ImportExcelButton kind="stksum" onImport={handleStkSumImport} />
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Add Product
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total products" value={stats.total} accent="blue" />
        <StatTile label="With inventory BOM" value={stats.withBom} accent="emerald" />
        <StatTile label="Low / zero stock parts" value={stats.lowStock} accent="amber" hint="Any linked part ≤ 0" />
        <StatTile label="Required Qty (pending)" value={stats.requiredTotal} accent="violet" hint="Open orders" />
        <StatTile
          label="Sold (completed)"
          value={<span className="text-rose-600">{stats.soldTotal}</span>}
          accent="rose"
          hint="Closed delivery qty"
        />
      </div>

      <div className="relative max-w-lg">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, name, description, or inventory…"
          className="pl-10"
        />
      </div>

      {showNewForm && (
        <Card className="border-blue-100 ring-1 ring-blue-100/80">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Add Product</h2>
              <p className="text-sm text-slate-500">Link inventory parts and qty used per product unit.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={closeForm} aria-label="Close form">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {renderFormFields()}
        </Card>
      )}

      {loading ? (
        <EmptyState message="Loading products…" />
      ) : filteredProducts.length === 0 ? (
        <EmptyState message={search ? 'No products match your search.' : 'No products yet. Click Add Product.'} />
      ) : (
        <TableShell>
          <table className="w-full min-w-[900px] text-left">
            <thead className={theadClass}>
              <tr>
                <th className={`${thClass} w-10`} />
                <th className={thClass}>Code</th>
                <th className={thClass}>Product</th>
                <th className={thClass}>Parts</th>
                <th className={thClass}>Available Qty</th>
                <th className={thClass}>Required Qty</th>
                <th className={thClass}>Sold</th>
                <th className={thClass}>This Month</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const isEditing = editingId === product.id
                const expanded = expandedIds.has(product.id)
                const bookings = bookingsById[product.id] || []
                const stockHistory = stockHistoryById[product.id] || []
                const history = mergeProductHistory(product.id, bookings, stockHistory)
                const minQty = minAvailable(product)
                const short = minQty != null && minQty <= 0
                const colSpan = 9
                return (
                  <Fragment key={product.id}>
                    <tr
                      className={`${trClass} cursor-pointer ${isEditing ? 'bg-blue-50/70 hover:bg-blue-50/70' : ''}`}
                      onClick={() => {
                        if (isEditing) return
                        navigate(`/products/${product.id}`)
                      }}
                    >
                      <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => toggleExpand(product.id, e)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                          title={expanded ? 'Hide history' : 'Show history'}
                        >
                          {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className={tdClass}>
                        <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                          {product.code}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <p className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                          {product.name}
                          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                        </p>
                        {product.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{product.description}</p>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {product.items.length === 0 ? (
                          <Badge tone="amber">No parts linked</Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                            <Layers className="h-3.5 w-3.5 text-slate-400" />
                            {product.items.length} part{product.items.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <span
                          className={`font-semibold tabular-nums ${
                            short ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {minQty}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <span className="font-medium tabular-nums text-amber-700">{requiredOf(product)}</span>
                      </td>
                      <td className={tdClass}>
                        <span className="font-semibold tabular-nums text-rose-600">
                          {product.sold ?? 0}
                        </span>
                      </td>
                      <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                        <MonthlyAvgHistory
                          endpoint={`/api/product-codes/${product.id}/monthly-stats`}
                          title={`${product.code} — monthly sold`}
                          metricLabel="Sold qty"
                          currentValue={product.monthly_avg ?? 0}
                          tone="rose"
                        />
                      </td>
                      <td className={`${tdClass} text-right`}>
                        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button variant="secondary" size="sm" onClick={(e) => openAddQty(product, e)}>
                            <Plus className="h-3.5 w-3.5" />
                            Add Qty
                          </Button>
                          <Button
                            variant={isEditing ? 'soft' : 'secondary'}
                            size="sm"
                            onClick={() => (isEditing ? closeForm() : openEdit(product))}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {isEditing ? 'Close' : 'Edit'}
                          </Button>
                          {canRemove && (
                            <Button variant="danger" size="sm" onClick={(e) => handleDelete(product.id, e)} aria-label="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={colSpan} className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            {addQtyId === product.id && (
                              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                                <p className="mb-1 text-sm font-semibold text-slate-900">Add Stock — {product.code}</p>
                                <p className="mb-3 text-xs text-slate-500">
                                  Adds <span className="font-semibold text-slate-700">+</span> to product Available Qty
                                  and deducts <span className="font-semibold text-slate-700">−</span> every linked
                                  inventory part (qty per unit × stock qty).
                                </p>
                                <div className="mb-3 grid gap-2 sm:grid-cols-3 text-xs">
                                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-slate-500">Available Qty</p>
                                    <p
                                      className={`text-base font-semibold ${
                                        short ? 'text-rose-600' : 'text-emerald-700'
                                      }`}
                                    >
                                      {minQty ?? 0}
                                    </p>
                                    {Number(addQtyForm.qty) > 0 && (
                                      <p className="mt-0.5 text-[10px] text-emerald-600">
                                        After save: +{(minQty ?? 0) + Number(addQtyForm.qty)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-slate-500">Required Qty (pending)</p>
                                    <p className="text-base font-semibold text-amber-700">{requiredOf(product)}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-slate-500">Sold (completed)</p>
                                    <p className="text-base font-semibold text-rose-600">{product.sold ?? 0}</p>
                                  </div>
                                </div>
                                {product.items.length > 0 && (
                                  <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                                    <p className="mb-1.5 font-medium text-slate-700">
                                      Linked inventory ({product.items.length}) — each will be minused
                                    </p>
                                    <ul className="space-y-1">
                                      {product.items.map((item) => {
                                        const avail = Math.max(0, item.available ?? 0)
                                        const per = Number(item.qty_per_unit) || 1
                                        const stockQty = Number(addQtyForm.qty) || 0
                                        const willCut = stockQty > 0 ? per * stockQty : null
                                        return (
                                          <li
                                            key={`add-${product.id}-${item.inventory_id}`}
                                            className="flex flex-wrap items-center justify-between gap-2"
                                          >
                                            <span className="font-medium text-slate-800">
                                              {item.name || getInvName(item.inventory_id)}{' '}
                                              <span className="font-normal text-slate-500">×{per}</span>
                                            </span>
                                            <span className="tabular-nums text-slate-600">
                                              avail <span className="font-semibold">{avail}</span>
                                              {willCut != null && (
                                                <span className="ml-2 text-rose-600">→ −{willCut}</span>
                                              )}
                                            </span>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  </div>
                                )}
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <Field label="Stock">
                                    <Input value={addQtyForm.stock} readOnly className="bg-slate-50 text-slate-600" />
                                  </Field>
                                  <Field label="Stock Qty">
                                    <Input
                                      type="number"
                                      min={1}
                                      value={addQtyForm.qty}
                                      onChange={(e) => setAddQtyForm({ ...addQtyForm, qty: e.target.value })}
                                      placeholder="e.g. 2"
                                    />
                                  </Field>
                                  <Field label="Date">
                                    <Input
                                      value={addQtyForm.date}
                                      onChange={(e) => setAddQtyForm({ ...addQtyForm, date: e.target.value })}
                                    />
                                  </Field>
                                </div>
                                {Number(addQtyForm.qty) > 0 && (
                                  <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-slate-700">
                                    Save: product <span className="font-semibold text-emerald-700">+{Number(addQtyForm.qty)}</span>
                                    {' · '}
                                    inventory{' '}
                                    {product.items
                                      .map(
                                        (i) =>
                                          `${i.name || getInvName(i.inventory_id)} −${
                                            (Number(i.qty_per_unit) || 1) * Number(addQtyForm.qty)
                                          }`
                                      )
                                      .join(' · ')}
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => submitAddQty(product)}
                                    disabled={savingQtyId === product.id}
                                  >
                                    {savingQtyId === product.id ? 'Saving…' : 'Save Qty'}
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => setAddQtyId(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}

                            <div>
                              <p className="mb-2 text-sm font-semibold text-slate-900">History</p>
                              <p className="mb-2 text-xs text-slate-500">
                                Stock adds (green) · Required / Pending (orange) · Sold / Completed (red)
                              </p>
                              {history.length === 0 ? (
                                <p className="text-sm text-slate-500">No history for this product yet.</p>
                              ) : (
                                <div className="overflow-hidden rounded-xl border border-slate-200">
                                  <table className="w-full text-left text-sm">
                                    <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                      <tr>
                                        <th className="px-3 py-2 font-semibold">Type</th>
                                        <th className="px-3 py-2 font-semibold">Detail</th>
                                        <th className="px-3 py-2 font-semibold">Order No</th>
                                        <th className="px-3 py-2 font-semibold">Qty</th>
                                        <th className="px-3 py-2 font-semibold">Date</th>
                                        <th className="px-3 py-2 font-semibold">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {history.map((h) => (
                                        <tr key={h.key} className="border-b border-slate-50 last:border-0">
                                          <td className="px-3 py-2 font-medium text-slate-800">
                                            {h.kind === 'stock'
                                              ? 'Stock'
                                              : h.status === 'Completed'
                                                ? 'Sold'
                                                : 'Required'}
                                          </td>
                                          <td className="px-3 py-2 font-medium text-slate-800">{h.detail}</td>
                                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{h.order_no}</td>
                                          <td
                                            className={`px-3 py-2 font-semibold tabular-nums ${
                                              h.qtyTone === 'green'
                                                ? 'text-emerald-700'
                                                : h.qtyTone === 'red'
                                                  ? 'text-rose-600'
                                                  : 'text-amber-700'
                                            }`}
                                          >
                                            {h.qtyLabel}
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">{h.date}</td>
                                          <td className="px-3 py-2 text-slate-600">{h.status}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {product.items.length > 0 && (
                              <div>
                                <p className="mb-2 text-sm font-semibold text-slate-900">Linked inventory (available qty)</p>
                                <div className="overflow-hidden rounded-xl border border-slate-200">
                                  <table className="w-full text-left text-sm">
                                    <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                      <tr>
                                        <th className="px-3 py-2 font-semibold">Inventory part</th>
                                        <th className="px-3 py-2 font-semibold">Qty / unit</th>
                                        <th className="px-3 py-2 font-semibold">Available Qty</th>
                                        <th className="px-3 py-2 font-semibold">Required Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {product.items.map((item) => {
                                        const raw = item.available ?? 0
                                        const avail = Math.max(0, raw)
                                        return (
                                          <tr
                                            key={`${product.id}-${item.inventory_id}`}
                                            className="border-b border-slate-50 last:border-0"
                                          >
                                            <td className="px-3 py-2 font-medium text-slate-800">{item.name}</td>
                                            <td className="px-3 py-2 tabular-nums text-slate-600">×{item.qty_per_unit}</td>
                                            <td
                                              className={`px-3 py-2 font-semibold tabular-nums ${
                                                avail <= 0 ? 'text-rose-600' : 'text-emerald-700'
                                              }`}
                                            >
                                              {avail}
                                            </td>
                                            <td className="px-3 py-2 font-medium tabular-nums text-amber-700">
                                              {itemRequiredOf(item)}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}

                    {isEditing && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={colSpan} className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Edit product</p>
                                <p className="text-xs text-slate-500">
                                  Available Qty = product stock you add · Required Qty = pending order qty
                                </p>
                              </div>
                              <Button variant="ghost" size="sm" onClick={closeForm} aria-label="Close">
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            {renderFormFields()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}
