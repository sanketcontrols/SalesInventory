import { type LucideIcon } from 'lucide-react'
import { BarChart3, Boxes, Package, Users } from 'lucide-react'

type DashboardCardProps = {
  title: string
  value: string
  growth: string
  icon: string
  accent: string
}

const iconMap: Record<string, LucideIcon> = {
  Package,
  Users,
  Boxes,
  BarChart3,
}

export default function DashboardCard({ title, value, growth, icon, accent }: DashboardCardProps) {
  const Icon = iconMap[icon] ?? Package

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl p-3 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-600">
        ↑ {growth}
      </div>
    </div>
  )
}
