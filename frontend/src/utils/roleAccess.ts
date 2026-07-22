export type AppRole = 'admin' | 'inventory' | 'sales' | 'pending'

export const ROUTES = {
  dashboard: '/',
  orders: '/orders',
  customers: '/customers',
  companyProfile: '/company-profile',
  products: '/products',
  inventory: '/inventory',
  reports: '/reports',
  settings: '/settings',
  adminUsers: '/admin/users',
} as const

const ROLE_PATHS: Record<'admin' | 'sales' | 'inventory', string[]> = {
  admin: [
    ROUTES.dashboard,
    ROUTES.orders,
    ROUTES.customers,
    ROUTES.companyProfile,
    ROUTES.products,
    ROUTES.inventory,
    ROUTES.reports,
    ROUTES.settings,
    ROUTES.adminUsers,
  ],
  sales: [
    ROUTES.dashboard,
    ROUTES.orders,
    ROUTES.customers,
    ROUTES.companyProfile,
    ROUTES.settings,
  ],
  inventory: [ROUTES.inventory, ROUTES.products, ROUTES.settings],
}

export function getHomePath(role?: AppRole): string {
  if (role === 'inventory') return ROUTES.inventory
  if (!role || role === 'pending') return ROUTES.settings
  return ROUTES.dashboard
}

export function canAccessRoute(role: AppRole | undefined, path: string): boolean {
  if (!role || role === 'pending') return path === ROUTES.settings
  return ROLE_PATHS[role].includes(path)
}

export function getSidebarPaths(role?: AppRole): string[] {
  if (!role || role === 'pending') return [ROUTES.settings]
  return ROLE_PATHS[role]
}

export function canDelete(role?: AppRole): boolean {
  return role === 'admin'
}

export function canExport(role?: AppRole): boolean {
  return role === 'admin'
}

export function canUseGlobalSearch(role?: AppRole): boolean {
  return role === 'admin' || role === 'sales'
}

export function canSeeSalesDashboard(role?: AppRole): boolean {
  return role === 'admin' || role === 'sales'
}
