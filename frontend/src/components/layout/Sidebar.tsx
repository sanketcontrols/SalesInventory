import { BarChart3, Boxes, Building2, LayoutGrid, Settings, ShoppingCart, Users, Warehouse } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getSidebarPaths, ROUTES } from '../../utils/roleAccess'

const menuItems = [
  { name: 'Dashboard', path: ROUTES.dashboard, icon: LayoutGrid },
  { name: 'Sales Orders', path: ROUTES.orders, icon: ShoppingCart },
  { name: 'Customers', path: ROUTES.customers, icon: Users },
  { name: 'Company Profiles', path: ROUTES.companyProfile, icon: Building2 },
  { name: 'Products', path: ROUTES.products, icon: Boxes },
  { name: 'Inventory', path: ROUTES.inventory, icon: Warehouse },
  { name: 'Reports', path: ROUTES.reports, icon: BarChart3 },
  { name: 'Settings', path: ROUTES.settings, icon: Settings },
  { name: 'User Access', path: ROUTES.adminUsers, icon: Users },
]

export default function Sidebar() {
  const { role } = useAuth()
  const allowedPaths = getSidebarPaths(role)
  const visibleMenuItems = menuItems.filter((item) => allowedPaths.includes(item.path))

  const focusMessage =
    role === 'admin'
      ? 'Review pending orders, stock alerts, and user access.'
      : role === 'sales'
        ? 'Create orders, update customers, and track buyer companies.'
        : role === 'inventory'
          ? 'Update stock levels and manage product codes.'
          : 'Waiting for admin to assign your role.'

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white/95 px-4 py-5 backdrop-blur">
      <div className="mb-7 overflow-hidden rounded-2xl bg-white px-2 py-2.5 ring-1 ring-slate-200">
        <img
          src="/logo.png"
          alt="Purn Sanket Electrols"
          className="h-12 w-full object-contain object-left"
        />
      </div>

      <nav className="space-y-1 overflow-y-auto px-1">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.name}
              to={item.path}
              end={item.path === ROUTES.dashboard}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your access</p>
        <p className="mt-1 text-sm font-semibold capitalize text-slate-900">{role ?? 'pending'}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{focusMessage}</p>
      </div>
    </aside>
  )
}
