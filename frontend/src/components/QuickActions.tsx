import { BatteryCharging, Box, CirclePlus, PackagePlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getStoredUser } from '../services/api'

const actions = [
  { title: 'New Order', icon: PackagePlus, color: 'bg-blue-600 text-white', path: '/orders' },
  { title: 'Add Customer', icon: CirclePlus, color: 'bg-slate-900 text-white', path: '/customers' },
  { title: 'Add Product', icon: Box, color: 'bg-emerald-600 text-white', path: '/products' },
  { title: 'Update Inventory', icon: BatteryCharging, color: 'bg-violet-600 text-white', path: '/inventory' },
]

export default function QuickActions() {
  const navigate = useNavigate()
  const role = getStoredUser()?.role

  const visibleActions =
    role === 'admin'
      ? actions
      : role === 'sales'
        ? actions.filter((a) => a.path === '/orders' || a.path === '/customers')
        : role === 'inventory'
          ? actions.filter((a) => a.path === '/inventory')
          : []

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
        <p className="text-sm text-slate-500">Common tasks for daily production operations.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleActions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.title}
              onClick={() => navigate(action.path)}
              className={`flex items-center justify-start gap-3 rounded-2xl px-4 py-4 text-left font-medium shadow-sm transition hover:-translate-y-0.5 ${action.color}`}
            >
              <Icon className="h-5 w-5" />
              <span>{action.title}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
