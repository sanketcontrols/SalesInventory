import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, getStoredUser } from '../services/api'

type Role = 'admin' | 'inventory' | 'sales' | 'pending'

interface UserRow {
  id: number
  name: string
  email: string
  role: Role
  created_at: string
}

export default function AdminUsers() {
  const currentUser = getStoredUser()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'pending' as Role, password: '' })

  const [create, setCreate] = useState({
    name: '',
    email: '',
    password: '',
    role: 'pending' as Role,
  })

  const roles: Role[] = useMemo(() => ['admin', 'inventory', 'sales', 'pending'], [])

  const fetchUsers = async () => {
    try {
      setError('')
      const data = await apiFetch<UserRow[]>('/api/admin/users')
      setUsers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleUpdateRole = async (id: number, nextRole: Role) => {
    try {
      await apiFetch<UserRow>(`/api/admin/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      })
      fetchUsers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  const openEdit = (user: UserRow) => {
    setEditingUser(user)
    setEditForm({ name: user.name, email: user.email, role: user.role, password: '' })
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    if (!editForm.name || !editForm.email) {
      alert('Name and email are required')
      return
    }

    try {
      await apiFetch<UserRow>(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name,
          email: editForm.email,
          role: editForm.role,
          ...(editForm.password ? { password: editForm.password } : {}),
        }),
      })
      setEditingUser(null)
      setEditForm({ name: '', email: '', role: 'pending', password: '' })
      fetchUsers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update user')
    }
  }

  const handleDeleteUser = async (user: UserRow) => {
    if (user.id === currentUser?.id) {
      alert('You cannot delete your own account')
      return
    }

    if (!confirm(`Delete user "${user.name}" (${user.email})? This cannot be undone.`)) {
      return
    }

    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      fetchUsers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete user')
    }
  }

  const handleCreateUser = async () => {
    if (!create.name || !create.email || !create.password) {
      alert('Please fill name, email, and password')
      return
    }

    try {
      await apiFetch<UserRow>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(create),
      })
      setCreate({ name: '', email: '', password: '', role: 'pending' })
      fetchUsers()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create user')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">User Access</h1>
        <p className="mt-1 text-sm text-slate-500">Create, edit, delete users and assign page access roles.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Add New User</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            value={create.name}
            onChange={(e) => setCreate({ ...create, name: e.target.value })}
            placeholder="Full name"
            className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
          <input
            value={create.email}
            onChange={(e) => setCreate({ ...create, email: e.target.value })}
            placeholder="email@example.com"
            className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={create.password}
            onChange={(e) => setCreate({ ...create, password: e.target.value })}
            placeholder="Password"
            className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
          <select
            value={create.role}
            onChange={(e) => setCreate({ ...create, role: e.target.value as Role })}
            className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={handleCreateUser} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">
            Create User
          </button>
          <button onClick={() => setCreate({ name: '', email: '', password: '', role: 'pending' })} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">
            Clear
          </button>
        </div>
      </div>

      {editingUser && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Edit User — {editingUser.name}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="Full name"
              className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
            <input
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              placeholder="email@example.com"
              className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
            <select
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
              className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              placeholder="New password (leave blank to keep)"
              className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleSaveEdit} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">
              Save Changes
            </button>
            <button onClick={() => setEditingUser(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">All Users</h2>
        </div>

        {loading ? (
          <div className="text-center text-slate-500">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">User</th>
                  <th className="py-3 pr-4 font-medium">Email</th>
                  <th className="py-3 pr-4 font-medium">Role / Access</th>
                  <th className="py-3 pr-4 font-medium">Created</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">{u.name}</div>
                      <div className="text-xs text-slate-500">ID: {u.id}</div>
                    </td>
                    <td className="py-3 pr-4">{u.email}</td>
                    <td className="py-3 pr-4">
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdateRole(u.id, e.target.value as Role)}
                        className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{new Date(u.created_at).toLocaleString()}</td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          title="Edit user"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.id === currentUser?.id}
                          className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          title={u.id === currentUser?.id ? 'Cannot delete yourself' : 'Delete user'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
