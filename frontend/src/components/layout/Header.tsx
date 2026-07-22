import { Bell, ChevronDown, LogOut, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { apiFetch, clearAuth } from '../../services/api'
import { canUseGlobalSearch } from '../../utils/roleAccess'
import type { NotificationItem } from '../Notifications'

interface SearchResults {
  orders: { id: number; order_no: string; company: string }[]
  customers: { id: number; name: string; email: string }[]
  products: { id: number; product_id: string; name: string }[]
}

const toneStyles: Record<string, string> = {
  blue: 'text-blue-700',
  amber: 'text-amber-700',
  green: 'text-emerald-700',
  red: 'text-rose-700',
}

export default function Header() {
  const navigate = useNavigate()
  const bellRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [showBell, setShowBell] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const { user, role } = useAuth()
  const displayUser = user || { name: 'User', email: '' }
  const showSearch = canUseGlobalSearch(role)

  useEffect(() => {
    apiFetch<NotificationItem[]>('/api/notifications')
      .then(setNotifications)
      .catch(() => setNotifications([]))
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const handleSearch = async (value: string) => {
    setSearch(value)
    if (!showSearch || value.trim().length < 2) {
      setResults(null)
      return
    }
    if (role === 'inventory') {
      setResults(null)
      return
    }
    try {
      const data = await apiFetch<SearchResults>(`/api/search?q=${encodeURIComponent(value)}`)
      setResults(data)
    } catch {
      setResults(null)
    }
  }

  const hasResults = results && (results.orders.length > 0 || results.customers.length > 0 || results.products.length > 0)
  const alertCount = notifications.filter((n) => n.tone === 'red' || n.tone === 'amber').length

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-6 py-3.5 backdrop-blur-md lg:px-8">
      <div className="relative flex min-w-0 flex-1 items-center gap-3">
        {showSearch && (
          <div className="flex max-w-md flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/15">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              className="w-full min-w-0 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Search orders, customers, products…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              onBlur={() => setTimeout(() => setResults(null), 200)}
            />
          </div>
        )}
        {showSearch && hasResults && (
          <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/50">
            {results.orders.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Orders</p>
                {results.orders.map((o) => (
                  <button key={o.id} onClick={() => navigate('/orders')} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    {o.order_no} — {o.company}
                  </button>
                ))}
              </div>
            )}
            {results.customers.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Customers</p>
                {results.customers.map((c) => (
                  <button key={c.id} onClick={() => navigate('/customers')} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    {c.name} — {c.email}
                  </button>
                ))}
              </div>
            )}
            {results.products.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Products</p>
                {results.products.map((p) => (
                  <button key={p.id} onClick={() => navigate('/products')} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    {p.product_id} — {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 sm:block">
          {today}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => { setShowBell(!showBell); setShowProfile(false) }}
            className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50"
          >
            <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            {alertCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                {alertCount}
              </span>
            )}
          </button>
          {showBell && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/50">
              <p className="mb-2 text-sm font-semibold text-slate-900">Notifications</p>
              {notifications.length === 0 ? (
                <p className="text-sm text-slate-500">No alerts</p>
              ) : notifications.map((n) => (
                <div key={n.title} className="border-b border-slate-100 py-2 last:border-0">
                  <p className={`text-sm font-medium ${toneStyles[n.tone]}`}>{n.title}</p>
                  <p className="text-xs text-slate-500">{n.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { setShowProfile(!showProfile); setShowBell(false) }}
            className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 transition hover:bg-slate-50"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {displayUser.name ? displayUser.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="hidden text-left md:block">
              <p className="text-sm font-semibold text-slate-900">{displayUser.name || 'User'}</p>
              <p className="text-[11px] capitalize text-slate-500">{role ?? 'pending'}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
          {showProfile && (
            <div className="absolute right-0 top-full z-30 mt-2 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-200/50">
              <button onClick={() => { navigate('/settings'); setShowProfile(false) }} className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                Settings
              </button>
              <button onClick={handleLogout} className="block w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50">
                Logout
              </button>
            </div>
          )}
        </div>

        <button onClick={handleLogout} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600" title="Logout">
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  )
}
