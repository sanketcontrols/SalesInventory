import type { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'

type LayoutProps = {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen text-slate-800">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Header />
          <main className="page-enter flex-1 px-6 py-6 lg:px-8">{children}</main>
          <footer className="flex items-center justify-between border-t border-slate-200/80 bg-white/80 px-6 py-3.5 text-xs text-slate-500 backdrop-blur">
            <span>© 2026 Purn Sanket Electrols</span>
            <span>Purn Sanket Electrols · v1.0</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
