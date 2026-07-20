import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/auth/AuthLayout'
import { login, saveAuth, clearAuth } from '../services/api'
import { getHomePath } from '../utils/roleAccess'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      clearAuth()
      const data = await login(email, password)
      saveAuth(data.token, data.user)
      navigate(getHomePath(data.user.role))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your HD E-MATE dashboard.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" placeholder="you@example.com" required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" placeholder="********" required />
        </div>

        {message ? <p className="text-sm text-rose-600">{message}</p> : null}

        <button type="submit" disabled={loading} className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-60">
          {loading ? 'Signing in...' : 'Login'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        Need an account? Contact your admin to create one.
      </p>
    </AuthLayout>
  )
}
