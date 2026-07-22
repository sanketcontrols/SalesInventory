import { Plus, Trash2, Pencil, Search, Package, Layers, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, getStoredUser } from '../services/api'
import { canDelete } from '../utils/roleAccess'
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
}

interface ProductCode {
  id: number
  code: string
  name: string
  description: string
  items: CodeItem[]
  qty_available?: number | null
  booked?: number
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

export default function Products() {
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
    return { total: products.length, withBom, lowStock }
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

  const getInvName = (inventoryId: number) => {
    return inventory.find((i) => i.id === inventoryId)?.name || `Inventory #${inventoryId}`
  }

  const getInvAvailable = (inventoryId: number) => {
    return inventory.find((i) => i.id === inventoryId)?.available ?? 0
  }

  const minAvailable = (product: ProductCode) => {
    if (product.qty_available != null) return product.qty_available
    if (!product.items.length) return null
    return Math.min(
      ...product.items.map((i) => {
        const per = Number(i.qty_per_unit) || 1
        return Math.floor((i.available ?? 0) / per)
      })
    )
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
          <Select
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          >
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
                  <p className={`text-xs ${avail <= 0 ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
                    {avail} qty available
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
        subtitle="Click a product row to edit it in place. Sales books all linked inventory by product qty."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total products" value={stats.total} accent="blue" />
        <StatTile label="With inventory BOM" value={stats.withBom} accent="emerald" />
        <StatTile label="Low / zero stock parts" value={stats.lowStock} accent="amber" hint="Any linked part ≤ 0" />
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
          <table className="w-full min-w-[720px] text-left">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Code</th>
                <th className={thClass}>Product</th>
                <th className={thClass}>Parts</th>
                <th className={thClass}>Qty Available</th>
                <th className={thClass}>Booked</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const isEditing = editingId === product.id
                const minQty = minAvailable(product)
                const short = minQty != null && minQty <= 0
                return (
                  <Fragment key={product.id}>
                    <tr
                      className={`${trClass} cursor-pointer ${isEditing ? 'bg-blue-50/70 hover:bg-blue-50/70' : ''}`}
                      onClick={() => {
                        if (isEditing) return
                        openEdit(product)
                      }}
                    >
                      <td className={tdClass}>
                        <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                          {product.code}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <p className="font-medium text-slate-900">{product.name}</p>
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
                        {minQty == null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={`font-semibold tabular-nums ${short ? 'text-rose-600' : 'text-slate-900'}`}>
                            {minQty}
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <span className="font-medium tabular-nums text-amber-700">{product.booked ?? 0}</span>
                      </td>
                      <td className={`${tdClass} text-right`}>
                        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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
                    {isEditing && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={6} className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Edit product</p>
                                <p className="text-xs text-slate-500">
                                  Qty Available = how many you can still make · Booked = pending order qty
                                </p>
                              </div>
                              <Button variant="ghost" size="sm" onClick={closeForm} aria-label="Close">
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            {product.items.length > 0 && (
                              <div className="mb-4 overflow-hidden rounded-xl border border-slate-200">
                                <table className="w-full text-left text-sm">
                                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                      <th className="px-3 py-2 font-semibold">Inventory part</th>
                                      <th className="px-3 py-2 font-semibold">Qty / unit</th>
                                      <th className="px-3 py-2 font-semibold">Qty Available</th>
                                      <th className="px-3 py-2 font-semibold">Booked</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {product.items.map((item) => {
                                      const avail = item.available ?? 0
                                      return (
                                        <tr key={`${product.id}-${item.inventory_id}`} className="border-b border-slate-50 last:border-0">
                                          <td className="px-3 py-2 font-medium text-slate-800">{item.name}</td>
                                          <td className="px-3 py-2 tabular-nums text-slate-600">×{item.qty_per_unit}</td>
                                          <td className={`px-3 py-2 font-semibold tabular-nums ${avail <= 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                                            {avail}
                                          </td>
                                          <td className="px-3 py-2 font-medium tabular-nums text-amber-700">{item.booked ?? 0}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
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
