import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Check, X } from 'lucide-react'
import { apiFetch, getStoredUser } from '../services/api'

interface InventoryItem {
  id: number
  name: string
  available: number
  monthly_avg: number
  pending: number
  booked?: number
  required_qty?: number
  qty_used?: number
  used?: number
  status: string
}

const statusStyles: Record<string, string> = {
  'Stock Available': 'bg-emerald-50 text-emerald-700',
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

  const load = () => {
    apiFetch<InventoryItem[]>('/api/inventory')
      .then((data) => setItems(data.slice(0, 6)))
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Inventory Summary</h2>
          <p className="text-xs text-slate-500">Required · Available · This month used · Status</p>
        </div>
        <Link to="/inventory" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          View all
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 font-semibold">Name</th>
              <th className="px-2 py-2 font-semibold">Qty Required</th>
              <th className="px-2 py-2 font-semibold">Available Qty</th>
              <th className="px-2 py-2 font-semibold">This Month</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isEditing = editingId === item.id
              const required = item.required_qty ?? item.booked ?? item.pending ?? 0
              return (
                <tr key={item.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-2.5 font-medium text-slate-900">{item.name}</td>
                  <td className="px-2 py-2.5 tabular-nums text-amber-700">{required}</td>
                  <td className="px-2 py-2.5">
                    {isEditing ? (
                      <input
                        type="number"
                        autoFocus
                        value={draft.available}
                        onChange={(e) => setDraft({ available: e.target.value })}
                        className="w-20 rounded-lg border border-blue-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                    ) : (
                      <span
                        className={`font-semibold tabular-nums ${
                          item.available <= 0 ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        {item.available}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-slate-700">
                    {Number(item.monthly_avg || 0).toFixed(1)}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        statusStyles[item.status] || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    {canEdit &&
                      (isEditing ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => saveEdit(item)}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            <Check className="h-3 w-3" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ))}
                  </td>
                </tr>
              )
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-sm text-slate-500">
                  No inventory items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
