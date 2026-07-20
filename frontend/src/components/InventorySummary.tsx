import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../services/api'

const statusStyles: Record<string, string> = {
  Normal: 'bg-emerald-50 text-emerald-700',
  'Low Stock': 'bg-amber-50 text-amber-700',
  Critical: 'bg-rose-50 text-rose-700',
}

interface InventoryItem {
  id: number
  name: string
  sku: string
  available: number
  pending: number
  reserved: number
  status: string
}

export default function InventorySummary() {
  const [items, setItems] = useState<InventoryItem[]>([])

  useEffect(() => {
    apiFetch<InventoryItem[]>('/api/inventory')
      .then((data) => setItems(data.slice(0, 3)))
      .catch(console.error)
  }, [])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Inventory Summary</h2>
          <p className="text-sm text-slate-500">Critical stock visibility for the current month.</p>
        </div>
        <Link to="/inventory" className="text-sm font-medium text-blue-600 hover:text-blue-700">View all</Link>
      </div>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500">{item.available} Available</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>
                {item.status}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{item.pending} Pending</span>
              <span className="font-medium text-slate-700">{item.available} on hand</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
