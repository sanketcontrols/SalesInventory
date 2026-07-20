import { Save, Lock, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiFetch, clearAuth, getStoredUser } from '../services/api'
import { ROUTES } from '../utils/roleAccess'

export default function Settings() {
  const navigate = useNavigate()
  const user = getStoredUser()
  const role = user?.role
  const [saved, setSaved] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' })
  const [settings, setSettings] = useState({
    timezone: 'IST',
    language: 'English',
    notifications: true,
    twoFactor: false,
  })

  const handleSave = () => {
    localStorage.setItem('settings', JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleChangePassword = async () => {
    setPasswordMessage('')
    if (passwords.new !== passwords.confirm) {
      setPasswordMessage('New passwords do not match')
      return
    }
    if (passwords.new.length < 6) {
      setPasswordMessage('Password must be at least 6 characters')
      return
    }
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.new }),
      })
      setPasswordMessage('Password updated successfully')
      setPasswords({ current: '', new: '', confirm: '' })
      setShowPasswordForm(false)
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : 'Failed to update password')
    }
  }

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Account preferences and security.</p>
        {(role === 'admin' || role === 'sales') && (
          <p className="mt-2 text-sm text-blue-600">
            Buyer companies you sell to →{' '}
            <Link to={ROUTES.companyProfile} className="font-medium underline hover:text-blue-700">Company Profiles</Link>
          </p>
        )}
        {role === 'pending' && (
          <p className="mt-3 text-sm text-amber-700">
            Your account is pending admin approval. When admin assigns a role, refresh the page or switch back to this tab to see your pages.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-lg font-semibold text-slate-900">Preferences</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Timezone</label>
                <select value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                  <option>IST</option><option>UTC</option><option>EST</option><option>PST</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Language</label>
                <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
                  <option>English</option><option>Hindi</option>
                </select>
              </div>
            </div>
            <button onClick={handleSave} className="mt-6 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
              <Save className="h-4 w-4" />
              {saved ? 'Saved!' : 'Save Preferences'}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Security</h2>
            <button onClick={() => setShowPasswordForm(!showPasswordForm)} className="flex w-full items-center gap-3 rounded-lg border border-slate-300 p-3 text-left transition hover:bg-slate-50">
              <Lock className="h-5 w-5 text-slate-600" />
              <div>
                <p className="font-medium text-slate-900">Change Password</p>
                <p className="text-sm text-slate-500">Update your password regularly for security</p>
              </div>
            </button>
            {showPasswordForm && (
              <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
                <input type="password" placeholder="Current password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="password" placeholder="New password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="password" placeholder="Confirm new password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                {passwordMessage && <p className={`text-sm ${passwordMessage.includes('success') ? 'text-emerald-600' : 'text-rose-600'}`}>{passwordMessage}</p>}
                <button onClick={handleChangePassword} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Update Password</button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white font-semibold">
              {initials}
            </div>
            <h3 className="font-semibold text-slate-900">{user?.name || 'User'}</h3>
            <p className="text-sm text-slate-500">{user?.email || ''}</p>
            <p className="mt-1 text-xs capitalize text-slate-400">{role} account</p>
          </div>

          <button onClick={handleLogout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 font-medium text-rose-600 transition hover:bg-rose-100">
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
