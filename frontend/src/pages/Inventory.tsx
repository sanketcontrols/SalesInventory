import { Plus, Download, Filter, AlertTriangle, Package, Trash2, Pencil } from 'lucide-react'
import { useState, useEffect } from 'react'
import { apiFetch, getStoredUser } from '../services/api'
import { downloadCsv } from '../utils/exportCsv'
import ImportCsvButton from '../components/ImportCsvButton'
import EditWindowBadge from '../components/EditWindowBadge'
import { getEditWindowInfo } from '../utils/editWindow'
import { canDelete, canExport } from '../utils/roleAccess'

interface InventoryItem {
  id: number
  name: string
  sku: string
  available: number
  pending: number
  reserved: number
  status: string
  created_at?: string
  created_by?: number
}

interface CodeItem {
  id?: number
  inventory_id: number
  qty_per_unit: number
  name?: string
  sku?: string
  available?: number
}

interface ProductCode {
  id: number
  code: string
  name: string
  description: string
  items: CodeItem[]
}

export default function Inventory() {
  const user = getStoredUser()
  const role = user?.role
  const canExportCsv = canExport(role)
  const canRemove = canDelete(role)

  const [tab, setTab] = useState<'codes' | 'stock'>('codes')
  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [productCodes, setProductCodes] = useState<ProductCode[]>([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({ id: '', name: '', sku: '', available: '', pending: '', reserved: '', status: 'Normal' })
  const [isNewItem, setIsNewItem] = useState(false)

  const [codeForm, setCodeForm] = useState({
    id: '',
    code: '',
    name: '',
    description: '',
    items: [] as { inventory_id: number; qty_per_unit: number }[],
  })
  const [showCodeForm, setShowCodeForm] = useState(false)
  const [isNewCode, setIsNewCode] = useState(false)

  useEffect(() => {
    fetchAll()
  }, [statusFilter])

  const fetchAll = async () => {
    try {
      const params = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
      const [invData, codesData] = await Promise.all([
        apiFetch<InventoryItem[]>(`/api/inventory${params}`),
        apiFetch<ProductCode[]>('/api/product-codes'),
      ])
      setItems(invData)
      setProductCodes(codesData)
    } catch (error) {
      console.error('Error fetching inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const openUpdateForm = (item: InventoryItem) => {
    setIsNewItem(false)
    setFormData({
      id: String(item.id),
      name: item.name,
      sku: item.sku,
      available: String(item.available),
      pending: String(item.pending),
      reserved: String(item.reserved),
      status: item.status,
    })
    setShowForm(true)
  }

  const openNewForm = () => {
    setIsNewItem(true)
    setFormData({ id: '', name: '', sku: '', available: '', pending: '', reserved: '', status: 'Normal' })
    setShowForm(true)
  }

  const openNewCodeForm = () => {
    setIsNewCode(true)
    setCodeForm({ id: '', code: '', name: '', description: '', items: [{ inventory_id: items[0]?.id || 0, qty_per_unit: 1 }] })
    setShowCodeForm(true)
  }

  const openEditCodeForm = (code: ProductCode) => {
    setIsNewCode(false)
    setCodeForm({
      id: String(code.id),
      code: code.code,
      name: code.name,
      description: code.description || '',
      items: code.items.map((i) => ({ inventory_id: i.inventory_id, qty_per_unit: i.qty_per_unit })),
    })
    setShowCodeForm(true)
  }

  const addCodeItem = () => {
    setCodeForm({
      ...codeForm,
      items: [...codeForm.items, { inventory_id: items[0]?.id || 0, qty_per_unit: 1 }],
    })
  }

  const removeCodeItem = (index: number) => {
    setCodeForm({ ...codeForm, items: codeForm.items.filter((_, i) => i !== index) })
  }

  const handleSaveCode = async () => {
    if (!codeForm.code || !codeForm.name || codeForm.items.length === 0) {
      alert('Code, name, and at least one product are required')
      return
    }

    try {
      if (isNewCode) {
        await apiFetch('/api/product-codes', {
          method: 'POST',
          body: JSON.stringify({
            code: codeForm.code,
            name: codeForm.name,
            description: codeForm.description,
            items: codeForm.items,
          }),
        })
      } else {
        await apiFetch(`/api/product-codes/${codeForm.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            code: codeForm.code,
            name: codeForm.name,
            description: codeForm.description,
            items: codeForm.items,
          }),
        })
      }
      setShowCodeForm(false)
      fetchAll()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save product code')
    }
  }

  const handleDeleteCode = async (id: number) => {
    if (!confirm('Delete this product code?')) return
    try {
      await apiFetch(`/api/product-codes/${id}`, { method: 'DELETE' })
      fetchAll()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete')
    }
  }

  const handleSave = async () => {
    if (isNewItem) {
      if (!formData.name || !formData.sku) {
        alert('Name and SKU are required')
        return
      }
      try {
        await apiFetch('/api/inventory', {
          method: 'POST',
          body: JSON.stringify({
            name: formData.name,
            sku: formData.sku,
            available: formData.available,
            pending: formData.pending,
            reserved: formData.reserved,
            status: formData.status,
          }),
        })
        setShowForm(false)
        fetchAll()
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to add inventory item')
      }
      return
    }

    if (!formData.id || !formData.available || !formData.pending || !formData.reserved) {
      alert('Please fill all fields')
      return
    }

    try {
      await apiFetch(`/api/inventory/${formData.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          available: parseInt(formData.available),
          pending: parseInt(formData.pending),
          reserved: parseInt(formData.reserved),
          status: formData.status,
        }),
      })
      setShowForm(false)
      fetchAll()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update inventory')
    }
  }

  const handleExport = () => {
    downloadCsv(
      'inventory.csv',
      ['Name', 'SKU', 'Available', 'Pending', 'Reserved', 'Status'],
      items.map((i) => [i.name, i.sku, i.available, i.pending, i.reserved, i.status])
    )
  }

  const handleImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; total: number; errors: string[] }>('/api/inventory/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
    alert(`Imported ${result.imported} of ${result.total} rows${result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : ''}`)
    fetchAll()
  }

  const statusStyles: Record<string, string> = {
    Normal: 'bg-emerald-50 text-emerald-700',
    'Low Stock': 'bg-amber-50 text-amber-700',
    Critical: 'bg-rose-50 text-rose-700',
  }

  const getStockStatus = (code: ProductCode) => {
    for (const item of code.items) {
      if ((item.available ?? 0) === 0) return 'Out of Stock'
      if ((item.available ?? 0) < item.qty_per_unit) return 'Low Stock'
    }
    return 'In Stock'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Manage product codes with bundled items. Inventory users can edit stock within 48 hours of adding.</p>
        </div>
        <div className="flex gap-3">
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
          <ImportCsvButton onImport={handleImport} />
          <button onClick={tab === 'codes' ? openNewCodeForm : openNewForm} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            {tab === 'codes' ? 'Add Product Code' : 'Add Stock Item'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('codes')} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tab === 'codes' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
          Product Codes
        </button>
        <button onClick={() => setTab('stock')} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tab === 'stock' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
          Stock Items
        </button>
      </div>

      {showFilter && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Filter by Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
            <option value="">All Statuses</option>
            <option value="Normal">Normal</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
      )}

      {showCodeForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">{isNewCode ? 'Add Product Code' : 'Edit Product Code'}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <input type="text" placeholder="Product Code (e.g. BRK-001)" value={codeForm.code} onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Name (e.g. Barrier Kit)" value={codeForm.name} onChange={(e) => setCodeForm({ ...codeForm, name: e.target.value })} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Description" value={codeForm.description} onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })} className="md:col-span-2 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Products inside this code</label>
              <button onClick={addCodeItem} className="text-sm font-medium text-blue-600 hover:text-blue-700">+ Add Product</button>
            </div>
            <div className="space-y-2">
              {codeForm.items.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select value={item.inventory_id} onChange={(e) => {
                    const next = [...codeForm.items]
                    next[index] = { ...next[index], inventory_id: Number(e.target.value) }
                    setCodeForm({ ...codeForm, items: next })
                  }} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                    {items.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.name} ({inv.sku}) — {inv.available} avail</option>
                    ))}
                  </select>
                  <span className="text-slate-500">×</span>
                  <input type="number" min={1} value={item.qty_per_unit} onChange={(e) => {
                    const next = [...codeForm.items]
                    next[index] = { ...next[index], qty_per_unit: Number(e.target.value) || 1 }
                    setCodeForm({ ...codeForm, items: next })
                  }} className="w-20 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                  {codeForm.items.length > 1 && (
                    <button onClick={() => removeCodeItem(index)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={handleSaveCode} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">{isNewCode ? 'Create' : 'Save'}</button>
            <button onClick={() => setShowCodeForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">{isNewItem ? 'Add Stock Item' : 'Update Stock'}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {isNewItem ? (
              <>
                <input type="text" placeholder="Product Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="text" placeholder="SKU" value={formData.sku} onChange={(e) => setFormData({...formData, sku: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
              </>
            ) : (
              <div className="md:col-span-2 text-sm text-slate-600">
                Editing: <strong>{formData.name}</strong> ({formData.sku})
                {formData.id && items.find((i) => String(i.id) === formData.id) && (
                  <EditWindowBadge
                    role={role}
                    createdAt={items.find((i) => String(i.id) === formData.id)?.created_at}
                    createdBy={items.find((i) => String(i.id) === formData.id)?.created_by}
                    userId={user?.id}
                  />
                )}
              </div>
            )}
            <input type="number" placeholder="Available" value={formData.available} onChange={(e) => setFormData({...formData, available: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="number" placeholder="Pending" value={formData.pending} onChange={(e) => setFormData({...formData, pending: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="number" placeholder="Reserved" value={formData.reserved} onChange={(e) => setFormData({...formData, reserved: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
              <option value="Normal">Normal</option>
              <option value="Low Stock">Low Stock</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleSave} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">{isNewItem ? 'Add' : 'Update'}</button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500">Loading inventory...</div>
      ) : tab === 'codes' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {productCodes.map((code) => {
            const stockStatus = getStockStatus(code)
            const stockStyle = stockStatus === 'Out of Stock' ? 'bg-rose-50 text-rose-700' : stockStatus === 'Low Stock' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
            return (
              <div key={code.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Package className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{code.name}</h3>
                      <p className="text-sm font-mono text-blue-600">{code.code}</p>
                      {code.description && <p className="mt-1 text-xs text-slate-500">{code.description}</p>}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stockStyle}`}>{stockStatus}</span>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Contains (per unit)</p>
                  <div className="space-y-1">
                    {code.items.map((item) => (
                      <div key={item.inventory_id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">{item.name} × {item.qty_per_unit}</span>
                        <span className={`text-xs ${(item.available ?? 0) < item.qty_per_unit ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
                          {item.available ?? 0} avail
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {stockStatus !== 'In Stock' && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {stockStatus === 'Out of Stock' ? 'Some items are out of stock' : 'Insufficient stock for full kit'}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <button onClick={() => openEditCodeForm(code)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  {canRemove && (
                    <button onClick={() => handleDeleteCode(code.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {productCodes.length === 0 && (
            <div className="col-span-2 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
              No product codes yet. Add stock items first, then create a product code.
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {items.map((item) => {
            const editInfo = getEditWindowInfo(role, item.created_at, item.created_by, user?.id)
            return (
            <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{item.name}</h3>
                  <p className="text-sm text-slate-500">{item.sku}</p>
                  {item.created_at && (
                    <p className="mt-1 text-xs text-slate-400">Added: {new Date(item.created_at).toLocaleString('en-IN')}</p>
                  )}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>{item.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-emerald-50 p-3 text-center">
                  <p className="text-xs text-slate-500">Available</p>
                  <p className="mt-1 text-xl font-semibold text-emerald-600">{item.available}</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 text-center">
                  <p className="text-xs text-slate-500">Pending</p>
                  <p className="mt-1 text-xl font-semibold text-amber-600">{item.pending}</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-3 text-center">
                  <p className="text-xs text-slate-500">Reserved</p>
                  <p className="mt-1 text-xl font-semibold text-blue-600">{item.reserved}</p>
                </div>
              </div>
              {item.status === 'Low Stock' && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Reorder soon to maintain stock levels
                </div>
              )}
              <EditWindowBadge role={role} createdAt={item.created_at} createdBy={item.created_by} userId={user?.id} />
              <button
                onClick={() => editInfo.canEdit ? openUpdateForm(item) : alert('48-hour edit window expired. Contact admin.')}
                disabled={!editInfo.canEdit && role !== 'admin'}
                className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editInfo.canEdit ? 'Update Stock' : 'Edit locked (48h expired)'}
              </button>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}
