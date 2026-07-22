import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getStoredUser,
  refreshStoredUser,
  saveAuth,
  type User,
} from '../services/api'

type AuthContextValue = {
  user: User | null
  role: User['role']
  loading: boolean
  setUser: (user: User | null) => void
  refreshUser: () => Promise<User | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => getStoredUser())
  const [loading, setLoading] = useState(true)

  const setUser = useCallback((next: User | null) => {
    setUserState(next)
  }, [])

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      setUserState(null)
      return null
    }

    const updated = await refreshStoredUser()
    const resolved = updated ?? getStoredUser()
    setUserState(resolved)
    return resolved
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))

    const onFocus = () => {
      refreshUser()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshUser])

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role,
        loading,
        setUser,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export function saveAuthAndSetUser(token: string, user: User, setUser: (u: User | null) => void) {
  saveAuth(token, user)
  setUser(user)
}
