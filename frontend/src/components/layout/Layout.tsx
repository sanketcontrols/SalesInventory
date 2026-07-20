import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { refreshStoredUser } from '../../services/api'
import Header from './Header'
import Sidebar from './Sidebar'

type LayoutProps = {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    refreshStoredUser().finally(() => setSessionReady(true))

    const refreshOnFocus = () => {
      refreshStoredUser().finally(() => setSessionReady(true))
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [])

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading your access...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Header />
          <main className="flex-1 p-6">{children}</main>
          <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4 text-sm text-slate-500">
            <span>© 2026 HD Engineering Solutions</span>
            <span>Version 1.0</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
