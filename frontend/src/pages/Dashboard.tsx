import { useEffect, useState } from 'react'
import DashboardCard from '../components/DashboardCard'
import DashboardCharts, { type InventoryPoint, type MonthlyPoint } from '../components/DashboardCharts'
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

interface ChartPayload {
  year: number
  monthly: MonthlyPoint[]
  inventory: InventoryPoint[]
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Dashboard() {
  const role = getStoredUser()?.role
  const showInventorySummary = role === 'admin' || role === 'inventory'
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [charts, setCharts] = useState<ChartPayload | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [chartKey, setChartKey] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterMonth) params.set('month', filterMonth)
    if (filterYear) params.set('year', filterYear)
    const qs = params.toString() ? `?${params}` : ''

    apiFetch<DashboardStats>(`/api/dashboard/stats${qs}`).then(setStats).catch(console.error)
    apiFetch<NotificationItem[]>('/api/notifications').then(setNotifications).catch(console.error)
    apiFetch<ChartPayload>(`/api/dashboard/charts?year=${filterYear || new Date().getFullYear()}`)
      .then(setCharts)
      .catch(console.error)
  }, [filterMonth, filterYear, chartKey])

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
      growth: `${stats?.pendingOrders ?? 0} pending`,
      icon: 'Package',
      accent: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Customers',
      value: stats ? String(stats.totalCustomers) : '...',
      growth: 'Buyer companies',
      icon: 'Users',
      accent: 'bg-violet-50 text-violet-600',
    },
    {
      title: 'Low Stock',
      value: stats ? String(stats.lowStockItems) : '...',
      growth: `${stats?.totalInventory ?? 0} items total`,
      icon: 'Boxes',
      accent: 'bg-amber-50 text-amber-600',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-500">{periodLabel}</p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          >
            <option value="">All months</option>
            {months.map((m, i) => (
              <option key={m} value={String(i + 1)}>{m}</option>
            ))}
          </select>
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          >
            <option value="">All years</option>
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <DashboardCard key={card.title} {...card} />
        ))}
      </div>

      {charts && (
        <DashboardCharts
          monthly={charts.monthly}
          inventory={charts.inventory}
          year={String(charts.year)}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.55fr_0.95fr]">
        <div className="space-y-4">
          <RecentOrders month={filterMonth} year={filterYear} />
          <QuickActions />
        </div>
        <div className="space-y-4">
          {showInventorySummary && (
            <InventorySummary onUpdated={() => setChartKey((k) => k + 1)} />
          )}
          <Notifications items={notifications} />
        </div>
      </div>
    </div>
  )
}
