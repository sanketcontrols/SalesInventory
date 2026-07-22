type AuthLayoutProps = {
  title: string
  subtitle: string
  children: React.ReactNode
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(37,99,235,0.12),transparent),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-24 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-16 h-56 w-56 rounded-full bg-slate-300/25 blur-3xl" />

      <div className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/95 p-8 shadow-xl shadow-slate-300/40 backdrop-blur">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-5 overflow-hidden rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200 shadow-sm">
            <img
              src="/logo.png"
              alt="Purn Sanket Electrols"
              className="mx-auto h-16 w-full max-w-[280px] object-contain"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
