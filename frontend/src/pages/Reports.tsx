import { Download, BarChart3, TrendingUp, Calendar } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../services/api'
import { downloadCsv } from '../utils/exportCsv'

interface DashboardStats {
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  totalInventory: number
  totalQuantity: number
  lowStockItems: number
}

interface Order {
  id: number
  order_no: string
  company: string
  amount: string
  status: string
}

export default function Reports() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [generated, setGenerated] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch<DashboardStats>('/api/dashboard/stats'),
      apiFetch<Order[]>('/api/orders'),
    ]).then(([statsData, ordersData]) => {
      setStats(statsData)
      setOrders(ordersData)
    }).catch(console.error)
  }, [])

  const metrics = stats ? [
    { label: 'Total Orders', value: String(stats.totalOrders), change: `${stats.totalQuantity} units`, color: 'emerald' },
    { label: 'Total Customers', value: String(stats.totalCustomers), change: 'Registered', color: 'blue' },
    { label: 'Total Products', value: String(stats.totalProducts), change: 'In catalog', color: 'violet' },
    { label: 'Low Stock Items', value: String(stats.lowStockItems), change: `${stats.totalInventory} SKUs`, color: 'amber' },
  ] : []

  const handleDownloadOrders = () => {
    downloadCsv(
      'sales-report.csv',
      ['Order No', 'Company', 'Amount', 'Status'],
      orders.map((o) => [o.order_no, o.company, o.amount, o.status])
    )
  }

  const handleGenerate = () => {
    setGenerated(true)
  }

  const reports = [
    { title: 'Sales Report', description: 'Monthly revenue and order volume trends', icon: TrendingUp, color: 'bg-blue-50', onDownload: handleDownloadOrders },
    { title: 'Inventory Report', description: 'Stock levels and product movement analysis', icon: BarChart3, color: 'bg-emerald-50', onDownload: () => navigateToInventory() },
    { title: 'Customer Report', description: 'Customer acquisition and retention metrics', icon: BarChart3, color: 'bg-violet-50', onDownload: () => window.location.href = '/customers' },
  ]

  function navigateToInventory() {
    window.location.href = '/inventory'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">View business analytics, trends, and performance metrics.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900">Live Metrics</h2>
          <p className="text-sm text-slate-500">Data pulled from PostgreSQL database</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{metric.value}</p>
              <p className={`mt-2 text-sm font-medium text-${metric.color}-600`}>{metric.change}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <div key={report.title} className={`rounded-2xl border border-slate-200 ${report.color} p-6 shadow-sm`}>
              <Icon className="h-8 w-8 text-slate-900" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{report.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{report.description}</p>
              <button onClick={report.onDownload} className="mt-4 flex items-center gap-2 rounded-lg bg-white px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100">
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Custom Report</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          <button onClick={handleGenerate} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Generate</button>
        </div>
        {generated && (
          <p className="mt-4 text-sm text-emerald-600">
            Report generated for {startDate || 'all time'} to {endDate || 'today'} — {orders.length} orders found.
          </p>
        )}
      </div>
    </div>
  )
}
