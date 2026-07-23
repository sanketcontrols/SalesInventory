import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15'

export const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15'

export const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20',
  secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100',
  ghost: 'text-slate-600 hover:bg-slate-100',
  soft: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  className = '',
  padding = 'md',
}: {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
}) {
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : padding === 'lg' ? 'p-6' : 'p-5'
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 ${pad} ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <div className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    violet: 'bg-violet-50 text-violet-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export const statusTone: Record<string, 'amber' | 'emerald' | 'rose' | 'slate'> = {
  Pending: 'amber',
  Completed: 'emerald',
  Cancelled: 'rose',
  Normal: 'emerald',
  'Stock Available': 'emerald',
  'Low Stock': 'amber',
  Critical: 'rose',
  Defect: 'rose',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] || 'slate'}>{status}</Badge>
}

export function StatTile({
  label,
  value,
  hint,
  accent = 'blue',
}: {
  label: string
  value: ReactNode
  hint?: string
  accent?: 'blue' | 'emerald' | 'amber' | 'violet' | 'slate' | 'rose'
}) {
  const accents = {
    blue: 'from-blue-50 to-white text-blue-700',
    emerald: 'from-emerald-50 to-white text-emerald-700',
    amber: 'from-amber-50 to-white text-amber-700',
    violet: 'from-violet-50 to-white text-violet-700',
    slate: 'from-slate-50 to-white text-slate-700',
    rose: 'from-rose-50 to-white text-rose-700',
  }
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-b ${accents[accent]} px-4 py-3.5 shadow-sm shadow-slate-200/30`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 truncate text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
      {message}
    </div>
  )
}

export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${inputClass} ${className}`} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select className={`${selectClass} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

export const thClass = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500'
export const tdClass = 'px-4 py-3 text-sm text-slate-700'
export const trClass = 'border-b border-slate-100 last:border-0 transition hover:bg-slate-50/80'
export const theadClass = 'border-b border-slate-200 bg-slate-50/90'
