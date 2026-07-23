import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/auth/AuthLayout'
import { Button, Field, Input } from '../components/ui'
import { saveAuthAndSetUser, useAuth } from '../context/AuthContext'
import { clearAuth, login } from '../services/api'
import { getHomePath } from '../utils/roleAccess'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setUser, refreshUser } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setLoading(true)

    try {
      clearAuth()
      const data = await login(email.trim().toLowerCase(), password)
      saveAuthAndSetUser(data.token, data.user, setUser)
      await refreshUser()
      navigate(getHomePath(data.user.role))
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Login failed'
      if (/server error|database|unavailable|rejected/i.test(raw)) {
        setMessage(`${raw} Try http://YOUR-NAS:5080/api/fix-admin then login as harsh@gmail.com / 123456.`)
      } else {
        setMessage(raw)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Purn Sanket Electrols dashboard.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Email">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            required
          />
        </Field>
        <Field label="Password">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="••••••••"
            required
          />
        </Field>

        {message ? <p className="text-sm text-rose-600">{message}</p> : null}

        <Button type="submit" disabled={loading} className="w-full py-3">
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Need an account? Contact your admin to create one.
      </p>
    </AuthLayout>
  )
}
