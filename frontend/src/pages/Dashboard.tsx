import { useEffect, useState } from 'react'
import DashboardCard from '../components/DashboardCard'
import InventorySummary from '../components/InventorySummary'
import Notifications, { type NotificationItem } from '../components/Notifications'
import QuickActions from '../components/QuickActions'
import RecentOrders from '../components/RecentOrders'
import { apiFetch, getStoredUser } from '../services/api'

interface DashboardStats {
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  totalInventory: number
  totalQuantity: number
  lowStockItems: number
  totalRevenue: string
  pendingOrders: number
  filterApplied?: boolean
}

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function Dashboard() {
  const role = getStoredUser()?.role
  const showInventorySummary = role === 'admin'
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterMonth) params.set('month', filterMonth)
    if (filterYear) params.set('year', filterYear)
    const qs = params.toString() ? `?${params}` : ''

    apiFetch<DashboardStats>(`/api/dashboard/stats${qs}`).then(setStats).catch(console.error)
    apiFetch<NotificationItem[]>('/api/notifications').then(setNotifications).catch(console.error)
  }, [filterMonth, filterYear])

  const periodLabel = filterMonth
    ? `${months[Number(filterMonth) - 1]} ${filterYear}`
    : filterYear
      ? `Year ${filterYear}`
      : 'All time'

  const cards = [
    {
      title: 'Total Revenue',
      value: stats?.totalRevenue ?? '...',
      growth: `${stats?.totalQuantity ?? 0} units · ${periodLabel}`,
      icon: 'BarChart3',
      accent: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Total Orders',
      value: stats ? String(stats.totalOrders) : '...',
      growth: `${stats?.pendingOrders ?? 0} pending · ${periodLabel}`,
      icon: 'Package',
      accent: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Customers',
      value: stats ? String(stats.totalCustomers) : '...',
      growth: 'Active buyer companies',
      icon: 'Users',
      accent: 'bg-violet-50 text-violet-600',
    },
    {
      title: 'Low Stock Items',
      value: stats ? String(stats.lowStockItems) : '...',
      growth: `${stats?.totalInventory ?? 0} total SKUs`,
      icon: 'Boxes',
      accent: 'bg-amber-50 text-amber-600',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Analyze sales by date or month. Showing: {periodLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">All months</option>
            {months.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </select>
          <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">All years</option>
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        {cards.map((card) => (
          <DashboardCard key={card.title} {...card} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_0.8fr]">
        <div className="space-y-6">
          <RecentOrders month={filterMonth} year={filterYear} />
          <QuickActions />
        </div>
        <div className="space-y-6">
          {showInventorySummary && <InventorySummary />}
          <Notifications items={notifications} />
        </div>
      </div>
    </div>
  )
}
