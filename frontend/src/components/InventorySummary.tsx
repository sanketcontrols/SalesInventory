import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Check, X, Plus, Minus } from 'lucide-react'
import { apiFetch, getStoredUser } from '../services/api'

interface InventoryItem {
  id: number
  name: string
  available: number
  monthly_avg: number
  pending: number
  booked?: number
  status: string
}

const statusStyles: Record<string, string> = {
  Normal: 'bg-emerald-50 text-emerald-700',
  'Low Stock': 'bg-amber-50 text-amber-700',
  Critical: 'bg-rose-50 text-rose-700',
  Defect: 'bg-rose-50 text-rose-700',
}

type Props = {
  onUpdated?: () => void
}

export default function InventorySummary({ onUpdated }: Props) {
  const role = getStoredUser()?.role
  const canEdit = role === 'admin' || role === 'inventory'
  const [items, setItems] = useState<InventoryItem[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState({ available: '' })
  const [saving, setSaving] = useState(false)
  const [adjustingId, setAdjustingId] = useState<number | null>(null)

  const load = () => {
    apiFetch<InventoryItem[]>('/api/inventory')
      .then((data) => setItems(data.slice(0, 4)))
      .catch(console.error)
  }

  useEffect(() => {
    load()
  }, [])

  const startEdit = (item: InventoryItem) => {
    if (!canEdit) return
    setEditingId(item.id)
    setDraft({ available: String(item.available) })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft({ available: '' })
  }

  const saveEdit = async (item: InventoryItem) => {
    setSaving(true)
    try {
      const updated = await apiFetch<InventoryItem>(`/api/inventory/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          available: Number(draft.available) || 0,
        }),
      })
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)))
      setEditingId(null)
      onUpdated?.()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update inventory')
    } finally {
      setSaving(false)
    }
  }

  const adjustQty = async (item: InventoryItem, delta: number) => {
    if (!canEdit) return
    setAdjustingId(item.id)
    try {
      const updated = await apiFetch<InventoryItem>(`/api/inventory/${item.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta }),
      })
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...updated } : row)))
      onUpdated?.()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to adjust qty')
    } finally {
      setAdjustingId(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Inventory Summary</h2>
          <p className="text-xs text-slate-500">
            Qty Available = free · Booked = pending orders · +/− to adjust
          </p>
        </div>
        <Link to="/inventory" className="text-sm font-medium text-blue-600 hover:text-blue-700">View all</Link>
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const isEditing = editingId === item.id
          const booked = item.booked ?? item.pending ?? 0
          const busy = adjustingId === item.id
          return (
            <div key={item.id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{item.name}</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status] || 'bg-slate-100 text-slate-600'}`}>
                  {item.status}
                </span>
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Qty Available</label>
                    <input
                      type="number"
                      autoFocus
                      value={draft.available}
                      onChange={(e) => setDraft({ available: e.target.value })}
                      className="w-full rounded-lg border border-blue-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={saving}
                      onClick={() => saveEdit(item)}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Check className="h-3.5 w-3.5" /> Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 py-1.5">
                    <div className="inline-flex items-center justify-center gap-1">
                      {canEdit && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => adjustQty(item, -1)}
                          className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-50"
                          title="Subtract 1"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className={`font-semibold tabular-nums ${item.available <= 0 ? 'text-rose-600' : 'text-slate-900'} ${canEdit ? 'hover:underline' : ''}`}
                        title={canEdit ? 'Click to set qty' : undefined}
                      >
                        {item.available}
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => adjustQty(item, 1)}
                          className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-50"
                          title="Add 1"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                      {canEdit && <Pencil className="h-3 w-3 text-slate-400" />}
                    </div>
                    <p className="text-slate-500">Qty Available</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-1.5">
                    <p className="font-semibold tabular-nums text-amber-700">{booked}</p>
                    <p className="text-slate-500">Booked</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-1.5">
                    <p className="font-semibold text-slate-900">{Number(item.monthly_avg || 0).toFixed(1)}</p>
                    <p className="text-slate-500">Monthly avg</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {items.length === 0 && <p className="text-sm text-slate-500">No inventory items yet.</p>}
      </div>
    </section>
  )
}
