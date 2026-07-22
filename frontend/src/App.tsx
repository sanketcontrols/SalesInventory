import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { AuthProvider, useAuth } from './context/AuthContext'
import Customers from './pages/Customers'
import CompanyProfile from './pages/CompanyProfile'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Login from './pages/Login'
import Orders from './pages/Orders'
import Products from './pages/Products'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import AdminUsers from './pages/AdminUsers'
import { canAccessRoute, getHomePath, ROUTES } from './utils/roleAccess'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function RoleGate({
  path,
  children,
}: {
  path: string
  children: React.ReactNode
}) {
  const { role, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading your access...
      </div>
    )
  }

  if (!role || role === 'pending') {
    return path === ROUTES.settings ? <Layout>{children}</Layout> : <Navigate to={ROUTES.settings} replace />
  }

  const home = getHomePath(role)
  if (!canAccessRoute(role, path)) {
    return <Navigate to={home} replace />
  }

  return <Layout>{children}</Layout>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.dashboard}><Dashboard /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.orders}><Orders /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.customers}><Customers /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.products}><Products /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.inventory}><Inventory /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.reports}><Reports /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.settings}><Settings /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/company-profile"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.companyProfile}><CompanyProfile /></RoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <RoleGate path={ROUTES.adminUsers}><AdminUsers /></RoleGate>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
