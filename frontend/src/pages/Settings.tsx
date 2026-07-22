import { Building2, KeyRound, LogOut, RefreshCw, Save, Shield, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiFetch, clearAuth, saveAuth } from '../services/api'
import { ROUTES } from '../utils/roleAccess'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
} from '../components/ui'

type CompanySettings = {
  company_name: string
  address: string
  gst_no: string
  updated_at?: string
}

export default function Settings() {
  const navigate = useNavigate()
  const { user, role, setUser, refreshUser } = useAuth()
  const isAdmin = role === 'admin'
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null

  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [passwordMsg, setPasswordMsg] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)

  const [company, setCompany] = useState<CompanySettings>({
    company_name: 'Purn Sanket Electrols',
    address: '',
    gst_no: '',
  })
  const [companyMsg, setCompanyMsg] = useState('')
  const [companySaving, setCompanySaving] = useState(false)
  const [companyLoading, setCompanyLoading] = useState(false)

  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setProfileName(user?.name || '')
  }, [user?.name])

  useEffect(() => {
    if (!isAdmin) return
    setCompanyLoading(true)
    apiFetch<CompanySettings>('/api/company/settings')
      .then((data) => {
        setCompany({
          company_name: data.company_name || 'Purn Sanket Electrols',
          address: data.address || '',
          gst_no: data.gst_no || '',
          updated_at: data.updated_at,
        })
      })
      .catch(console.error)
      .finally(() => setCompanyLoading(false))
  }, [isAdmin])

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  const handleSaveProfile = async () => {
    setProfileMsg('')
    const name = profileName.trim()
    if (!name) {
      setProfileMsg('Name is required')
      return
    }
    setProfileSaving(true)
    try {
      const updated = await apiFetch<{ id: number; name: string; email: string; role: string }>(
        '/api/auth/profile',
        { method: 'PUT', body: JSON.stringify({ name }) }
      )
      const nextUser = {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: (updated.role as typeof role) || role,
      }
      if (token) saveAuth(token, nextUser)
      setUser(nextUser)
      setProfileMsg('Profile saved')
    } catch (error) {
      setProfileMsg(error instanceof Error ? error.message : 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordMsg('')
    if (passwords.next !== passwords.confirm) {
      setPasswordMsg('New passwords do not match')
      return
    }
    if (passwords.next.length < 6) {
      setPasswordMsg('Password must be at least 6 characters')
      return
    }
    setPasswordSaving(true)
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.next,
        }),
      })
      setPasswordMsg('Password updated successfully')
      setPasswords({ current: '', next: '', confirm: '' })
      setShowPasswordForm(false)
    } catch (error) {
      setPasswordMsg(error instanceof Error ? error.message : 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleSaveCompany = async () => {
    setCompanyMsg('')
    if (!company.company_name.trim()) {
      setCompanyMsg('Company name is required')
      return
    }
    setCompanySaving(true)
    try {
      const saved = await apiFetch<CompanySettings>('/api/company/settings', {
        method: 'PUT',
        body: JSON.stringify({
          company_name: company.company_name.trim(),
          address: company.address.trim(),
          gst_no: company.gst_no.trim(),
        }),
      })
      setCompany({
        company_name: saved.company_name,
        address: saved.address || '',
        gst_no: saved.gst_no || '',
        updated_at: saved.updated_at,
      })
      setCompanyMsg('Company details saved')
    } catch (error) {
      setCompanyMsg(error instanceof Error ? error.message : 'Failed to save company details')
    } finally {
      setCompanySaving(false)
    }
  }

  const handleRefreshAccess = async () => {
    setRefreshing(true)
    try {
      await refreshUser()
    } finally {
      setRefreshing(false)
    }
  }

  const handleLogout = () => {
    clearAuth()
    setUser(null)
    navigate('/login')
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Manage your account, security, and company details."
      />

      {role === 'pending' && (
        <Card className="border-amber-200 bg-amber-50/80">
          <p className="text-sm font-medium text-amber-900">Account pending approval</p>
          <p className="mt-1 text-sm text-amber-800">
            An admin must assign your role before you can use other pages. After they update your
            access, refresh below.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={handleRefreshAccess}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Checking…' : 'Refresh access'}
          </Button>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <SectionTitle title="Your profile" subtitle="Display name shown across the app." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <Input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Field label="Email">
                <Input value={user?.email || ''} disabled className="bg-slate-50 text-slate-500" />
              </Field>
            </div>
            {profileMsg && (
              <p
                className={`mt-3 text-sm ${
                  profileMsg.toLowerCase().includes('saved') ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {profileMsg}
              </p>
            )}
            <Button className="mt-4" onClick={handleSaveProfile} disabled={profileSaving}>
              <Save className="h-4 w-4" />
              {profileSaving ? 'Saving…' : 'Save profile'}
            </Button>
          </Card>

          <Card>
            <SectionTitle title="Security" subtitle="Keep your login secure." />
            <button
              type="button"
              onClick={() => setShowPasswordForm((v) => !v)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-slate-900">Change password</p>
                <p className="text-sm text-slate-500">Update your password regularly</p>
              </div>
            </button>

            {showPasswordForm && (
              <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <Field label="Current password">
                  <Input
                    type="password"
                    value={passwords.current}
                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                    autoComplete="current-password"
                  />
                </Field>
                <Field label="New password">
                  <Input
                    type="password"
                    value={passwords.next}
                    onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm new password">
                  <Input
                    type="password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                    autoComplete="new-password"
                  />
                </Field>
                {passwordMsg && (
                  <p
                    className={`text-sm ${
                      passwordMsg.toLowerCase().includes('success')
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {passwordMsg}
                  </p>
                )}
                <Button onClick={handleChangePassword} disabled={passwordSaving}>
                  {passwordSaving ? 'Updating…' : 'Update password'}
                </Button>
              </div>
            )}
          </Card>

          {isAdmin && (
            <Card>
              <SectionTitle
                title="Seller company"
                subtitle="Your business details for invoices and records."
                action={
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Building2 className="h-4 w-4" />
                  </div>
                }
              />
              {companyLoading ? (
                <p className="text-sm text-slate-500">Loading company details…</p>
              ) : (
                <>
                  <div className="grid gap-4">
                    <Field label="Company name">
                      <Input
                        value={company.company_name}
                        onChange={(e) => setCompany({ ...company, company_name: e.target.value })}
                        placeholder="Purn Sanket Electrols"
                      />
                    </Field>
                    <Field label="Address">
                      <Input
                        value={company.address}
                        onChange={(e) => setCompany({ ...company, address: e.target.value })}
                        placeholder="Registered address"
                      />
                    </Field>
                    <Field label="GST number">
                      <Input
                        value={company.gst_no}
                        onChange={(e) => setCompany({ ...company, gst_no: e.target.value })}
                        placeholder="e.g. 27AAAAA0000A1Z5"
                      />
                    </Field>
                  </div>
                  {companyMsg && (
                    <p
                      className={`mt-3 text-sm ${
                        companyMsg.toLowerCase().includes('saved')
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {companyMsg}
                    </p>
                  )}
                  <Button className="mt-4" onClick={handleSaveCompany} disabled={companySaving}>
                    <Save className="h-4 w-4" />
                    {companySaving ? 'Saving…' : 'Save company details'}
                  </Button>
                </>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {initials}
            </div>
            <h3 className="font-semibold text-slate-900">{user?.name || 'User'}</h3>
            <p className="text-sm text-slate-500">{user?.email || ''}</p>
            <div className="mt-3">
              <Badge tone={role === 'pending' ? 'amber' : role === 'admin' ? 'blue' : 'slate'}>
                {role || 'pending'}
              </Badge>
            </div>
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={handleRefreshAccess}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh session
            </Button>
          </Card>

          {(isAdmin || role === 'sales') && (
            <Card padding="sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Quick links
              </p>
              <div className="space-y-1">
                {isAdmin && (
                  <Link
                    to={ROUTES.adminUsers}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <Shield className="h-4 w-4 text-slate-500" />
                    User access
                  </Link>
                )}
                <Link
                  to={ROUTES.customers}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <Users className="h-4 w-4 text-slate-500" />
                  Customers
                </Link>
                <Link
                  to={ROUTES.companyProfile}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <Building2 className="h-4 w-4 text-slate-500" />
                  Buyer company profiles
                </Link>
              </div>
            </Card>
          )}

          <Button variant="danger" className="w-full" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </div>
  )
}
