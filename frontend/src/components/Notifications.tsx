const toneStyles: Record<string, string> = {
  blue: 'border-blue-100 bg-blue-50 text-blue-700',
  amber: 'border-amber-100 bg-amber-50 text-amber-700',
  green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  red: 'border-rose-100 bg-rose-50 text-rose-700',
}

interface NotificationItem {
  title: string
  description: string
  tone: 'blue' | 'amber' | 'green' | 'red'
}

interface NotificationsProps {
  items?: NotificationItem[]
}

export default function Notifications({ items = [] }: NotificationsProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
        <p className="text-sm text-slate-500">Stock alerts and pending orders.</p>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-700">
            <p className="font-semibold">All clear</p>
            <p className="mt-1 text-sm opacity-80">No alerts at the moment.</p>
          </div>
        ) : items.map((item) => (
          <div key={item.title} className={`rounded-xl border p-3 ${toneStyles[item.tone]}`}>
            <p className="font-semibold">{item.title}</p>
            <p className="mt-1 text-sm opacity-80">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export type { NotificationItem }
