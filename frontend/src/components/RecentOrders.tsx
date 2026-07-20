import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { ensureRupee } from '../utils/formatRupee'
import { formatDateTime } from '../utils/editWindow'
import EditWindowBadge from './EditWindowBadge'

const statusStyles: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700',
  Completed: 'bg-emerald-50 text-emerald-700',
  Cancelled: 'bg-rose-50 text-rose-700',
}

interface Order {
  id: number
  order_no: string
  company: string
  state: string
  date: string
  qty: number
  amount: string
  status: string
  created_at?: string
  created_by?: number
}

interface RecentOrdersProps {
  month?: string
  year?: string
}

export default function RecentOrders({ month, year }: RecentOrdersProps) {
  const user = getStoredUser()
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    const params = new URLSearchParams()
    if (month) params.set('month', month)
    if (year) params.set('year', year)
    const qs = params.toString() ? `?${params}` : ''

    apiFetch<Order[]>(`/api/orders${qs}`)
      .then((data) => setOrders(data.slice(0, 5)))
      .catch(console.error)
  }, [month, year])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Recent Orders</h2>
          <p className="text-sm text-slate-500">With date & time. Sales/inventory edits allowed within 48 hours only.</p>
        </div>
        <Link to="/orders" className="text-sm font-medium text-blue-600 hover:text-blue-700">View all</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="py-3 pr-4 font-medium">Order No</th>
              <th className="py-3 pr-4 font-medium">Company</th>
              <th className="py-3 pr-4 font-medium">Date</th>
              <th className="py-3 pr-4 font-medium">Time</th>
              <th className="py-3 pr-4 font-medium">Qty</th>
              <th className="py-3 pr-4 font-medium">Amount</th>
              <th className="py-3 pr-4 font-medium">Status</th>
              <th className="py-3 pr-4 font-medium">Edit</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
                <tr key={order.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                  <td className="py-3 pr-4 font-medium text-slate-900">{order.order_no}</td>
                  <td className="py-3 pr-4">{order.company}</td>
                  <td className="py-3 pr-4">{order.date}</td>
                  <td className="py-3 pr-4 text-xs text-slate-500">{order.created_at ? formatDateTime(order.created_at) : '—'}</td>
                  <td className="py-3 pr-4">{order.qty}</td>
                  <td className="py-3 pr-4 font-medium">{ensureRupee(order.amount)}</td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[order.status]}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <EditWindowBadge role={user?.role} createdAt={order.created_at} createdBy={order.created_by} userId={user?.id} compact />
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
