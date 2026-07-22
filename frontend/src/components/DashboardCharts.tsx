import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from 'recharts'
import { formatRupee } from '../utils/formatRupee'

export type MonthlyPoint = {
  month: string
  monthNum: number
  revenue: number
  orders: number
  units: number
}

export type InventoryPoint = {
  id: number
  name: string
  fullName: string
  available: number
  booked: number
  status: string
}

type Props = {
  monthly: MonthlyPoint[]
  inventory: InventoryPoint[]
  year: string
}

export default function DashboardCharts({ monthly, inventory, year }: Props) {
  const [salesPoint, setSalesPoint] = useState<MonthlyPoint | null>(null)
  const [invPoint, setInvPoint] = useState<InventoryPoint | null>(null)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Sales trend · {year}</h2>
            <p className="text-xs text-slate-500">Click a point for values</p>
          </div>
          {salesPoint && (
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-right text-[11px] leading-4 text-slate-600">
              <p className="font-semibold text-slate-900">{salesPoint.month}</p>
              <p>{formatRupee(salesPoint.revenue)}</p>
              <p>{salesPoint.orders} orders · {salesPoint.units} units</p>
            </div>
          )}
        </div>

        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={monthly}
              margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
              onClick={(state) => {
                const anyState = state as { activePayload?: Array<{ payload: MonthlyPoint }> }
                const payload = anyState?.activePayload?.[0]?.payload
                if (payload) setSalesPoint(payload)
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} width={40} />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 10, borderColor: '#e2e8f0' }}
                formatter={(value, name) => {
                  const n = Number(value) || 0
                  if (name === 'revenue') return [formatRupee(n), 'Revenue']
                  if (name === 'orders') return [n, 'Orders']
                  return [n, 'Units']
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Line yAxisId="left" type="monotone" dataKey="revenue" name="revenue" stroke="#059669" strokeWidth={2} dot={{ r: 2.5, cursor: 'pointer' }} activeDot={{ r: 5 }} />
              <Line yAxisId="right" type="monotone" dataKey="orders" name="orders" stroke="#2563eb" strokeWidth={2} dot={{ r: 2.5, cursor: 'pointer' }} activeDot={{ r: 5 }} />
              <Line yAxisId="right" type="monotone" dataKey="units" name="units" stroke="#d97706" strokeWidth={1.5} strokeDasharray="3 3" dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Inventory levels</h2>
            <p className="text-xs text-slate-500">Click a bar for values</p>
          </div>
          {invPoint && (
            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-right text-[11px] leading-4 text-slate-600">
              <p className="font-semibold text-slate-900">{invPoint.fullName}</p>
              <p>Available {invPoint.available}</p>
              <p>Booked {invPoint.booked}</p>
            </div>
          )}
        </div>

        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={inventory.slice(0, 6)}
              margin={{ top: 4, right: 4, left: -18, bottom: 8 }}
              onClick={(state) => {
                const anyState = state as { activePayload?: Array<{ payload: InventoryPoint }> }
                const payload = anyState?.activePayload?.[0]?.payload
                if (payload) setInvPoint(payload)
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="#94a3b8" axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 10, borderColor: '#e2e8f0' }}
                formatter={(value, name) => [
                  Number(value) || 0,
                  name === 'available' ? 'Qty Available' : 'Booked',
                ]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Bar dataKey="available" name="available" fill="#2563eb" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={18} />
              <Bar dataKey="booked" name="booked" fill="#f59e0b" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
