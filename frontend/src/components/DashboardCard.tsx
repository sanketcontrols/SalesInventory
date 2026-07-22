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
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 truncate text-[11px] text-slate-500">{growth}</p>
        </div>
        <div className={`shrink-0 rounded-lg p-2 ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}
