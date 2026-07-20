import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Customers from './pages/Customers'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Login from './pages/Login'
import Orders from './pages/Orders'
import Products from './pages/Products'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import CompanyProfile from './pages/CompanyProfile'
import AdminUsers from './pages/AdminUsers'
import { getStoredUser } from './services/api'
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
  const user = getStoredUser()
  const role = user?.role

  if (!role || role === 'pending') {
    return path === ROUTES.settings ? <>{children}</> : <Navigate to={ROUTES.settings} replace />
  }

  const home = getHomePath(role)
  if (!canAccessRoute(role, path)) {
    return <Navigate to={home} replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.dashboard}>
                <Layout><Dashboard /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.orders}>
                <Layout><Orders /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.customers}>
                <Layout><Customers /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.products}>
                <Layout><Products /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.inventory}>
                <Layout><Inventory /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.reports}>
                <Layout><Reports /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.settings}>
                <Layout><Settings /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/company-profile"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.companyProfile}>
                <Layout><CompanyProfile /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute>
              <RoleGate path={ROUTES.adminUsers}>
                <Layout><AdminUsers /></Layout>
              </RoleGate>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
