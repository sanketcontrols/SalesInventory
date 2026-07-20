import { BarChart3, Boxes, Building2, LayoutGrid, Package, Settings, ShoppingCart, Users, Warehouse } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { getStoredUser } from '../../services/api'
import { getSidebarPaths, ROUTES } from '../../utils/roleAccess'

const menuItems = [
  { name: 'Dashboard', path: ROUTES.dashboard, icon: LayoutGrid },
  { name: 'Sales Orders', path: ROUTES.orders, icon: ShoppingCart },
  { name: 'Customers', path: ROUTES.customers, icon: Users },
  { name: 'Products', path: ROUTES.products, icon: Boxes },
  { name: 'Inventory', path: ROUTES.inventory, icon: Warehouse },
  { name: 'Reports', path: ROUTES.reports, icon: BarChart3 },
  { name: 'Company Profiles', path: ROUTES.companyProfile, icon: Building2 },
  { name: 'Settings', path: ROUTES.settings, icon: Settings },
  { name: 'User Access', path: ROUTES.adminUsers, icon: Users },
]

export default function Sidebar() {
  const role = getStoredUser()?.role
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
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white px-5 py-6">
      <div className="mb-8 flex items-center gap-3">
        <div className="rounded-2xl bg-blue-600 p-2.5 text-white">
          <Package className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-900">HD E-MATE</p>
          <p className="text-sm text-slate-500">Operations Suite</p>
        </div>
      </div>

      <nav className="space-y-1">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.name}
              to={item.path}
              end={item.path === ROUTES.dashboard}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.name}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Your access</p>
        <p className="mt-1 text-sm capitalize text-slate-500">{role ?? 'pending'}</p>
        <p className="mt-2 text-sm text-slate-500">{focusMessage}</p>
      </div>
    </aside>
  )
}
