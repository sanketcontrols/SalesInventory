import { Plus, Download, Filter, Mail, Phone, Hash, MapPin } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, getStoredUser } from '../services/api'
import { downloadExcel } from '../utils/exportExcel'
import ImportCsvButton from '../components/ImportCsvButton'
import { ensureRupee } from '../utils/formatRupee'
import EditWindowBadge from '../components/EditWindowBadge'
import { getEditWindowInfo } from '../utils/editWindow'

interface Customer {
  id: number
  name: string
  email: string
  phone: string
  city: string
  state: string
  gst_no?: string
  address?: string
  orders_count: number
  total_amount: string
  created_at?: string
  created_by?: number
}

const emptyForm = { name: '', email: '', phone: '', city: '', state: '', gst_no: '', address: '' }

export default function Customers() {
  const user = getStoredUser()
  const role = user?.role
  const isAdmin = role === 'admin'
  const canExport = role === 'admin'

  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [search, setSearch] = useState('')
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState(emptyForm)

  useEffect(() => {
    fetchCustomers()
  }, [search])

  const fetchCustomers = async () => {
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : ''
      const data = await apiFetch<Customer[]>(`/api/customers${params}`)
      setCustomers(data)
    } catch (error) {
      console.error('Error fetching customers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddCustomer = async () => {
    if (!formData.name || !formData.email || !formData.phone || !formData.city || !formData.state) {
      alert('Please fill company name, email, phone, city, and state')
      return
    }

    try {
      await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify(formData),
      })
      setFormData(emptyForm)
      setShowForm(false)
      fetchCustomers()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add customer')
    }
  }

  const handleUpdateCustomer = async () => {
    if (!editingCustomer) return

    try {
      const payload = isAdmin
        ? editingCustomer
        : { name: editingCustomer.name }

      await apiFetch(`/api/customers/${editingCustomer.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setEditingCustomer(null)
      fetchCustomers()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update customer')
    }
  }

  const handleExport = () => {
    downloadExcel(
      'customers.xlsx',
      'Customers',
      [
        { header: 'Name' },
        { header: 'Email' },
        { header: 'Phone' },
        { header: 'City' },
        { header: 'State' },
        { header: 'GST No' },
        { header: 'Address' },
        { header: 'Orders', type: 'number' },
        { header: 'Total Amount (INR)', type: 'inr' },
      ],
      customers.map((c) => [
        c.name,
        c.email,
        c.phone,
        c.city,
        c.state,
        c.gst_no || '',
        c.address || '',
        c.orders_count,
        c.total_amount,
      ])
    )
  }

  const handleImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; total: number; errors: string[] }>('/api/customers/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
    alert(`Imported ${result.imported} of ${result.total} companies${result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : ''}`)
    fetchCustomers()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Companies you sell to — add GST, address, and contact details. View full profile & order history in{' '}
            <Link to="/company-profile" className="font-medium text-blue-600 underline hover:text-blue-700">Company Profiles</Link>.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowFilter(!showFilter)} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          {canExport && (
            <button onClick={handleExport} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
          <ImportCsvButton onImport={handleImport} />
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Add Company
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Search companies</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, GST, email, city..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Add Buyer Company</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <input type="text" placeholder="Company Name *" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="GST No." value={formData.gst_no} onChange={(e) => setFormData({...formData, gst_no: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Address" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} className="md:col-span-2 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="email" placeholder="Email *" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Phone *" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="City *" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="State *" value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleAddCustomer} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Add</button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {editingCustomer && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Edit Company {isAdmin ? '' : '(name only)'}
          </h2>
          <EditWindowBadge role={role} createdAt={editingCustomer.created_at} createdBy={editingCustomer.created_by} userId={user?.id} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <input type="text" value={editingCustomer.name} onChange={(e) => setEditingCustomer({...editingCustomer, name: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" placeholder="Company Name" />
            {isAdmin ? (
              <>
                <input type="text" value={editingCustomer.gst_no || ''} onChange={(e) => setEditingCustomer({...editingCustomer, gst_no: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" placeholder="GST No." />
                <input type="text" value={editingCustomer.address || ''} onChange={(e) => setEditingCustomer({...editingCustomer, address: e.target.value})} className="md:col-span-2 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" placeholder="Address" />
                <input type="email" value={editingCustomer.email} onChange={(e) => setEditingCustomer({...editingCustomer, email: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="text" value={editingCustomer.phone} onChange={(e) => setEditingCustomer({...editingCustomer, phone: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="text" value={editingCustomer.city} onChange={(e) => setEditingCustomer({...editingCustomer, city: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
                <input type="text" value={editingCustomer.state} onChange={(e) => setEditingCustomer({...editingCustomer, state: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
              </>
            ) : (
              <div className="md:col-span-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                Other details (GST, address, contact) are read-only. Only admin can edit them.
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleUpdateCustomer} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Save</button>
            <button onClick={() => setEditingCustomer(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {viewCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{viewCustomer.name}</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p><strong>GST No:</strong> {viewCustomer.gst_no || '—'}</p>
              <p><strong>Address:</strong> {viewCustomer.address || `${viewCustomer.city}, ${viewCustomer.state}`}</p>
              <p><strong>Email:</strong> {viewCustomer.email}</p>
              <p><strong>Phone:</strong> {viewCustomer.phone}</p>
              <p><strong>Location:</strong> {viewCustomer.city}, {viewCustomer.state}</p>
              <p><strong>Total Orders:</strong> {viewCustomer.orders_count}</p>
              <p><strong>Total Amount:</strong> {ensureRupee(viewCustomer.total_amount)}</p>
            </div>
            <div className="mt-6 flex gap-2">
              <Link to={`/company-profile?id=${viewCustomer.id}`} className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-center font-medium text-white transition hover:bg-blue-700">
                Open Profile
              </Link>
              <button onClick={() => setViewCustomer(null)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500">Loading companies...</div>
      ) : (
        <div className="grid gap-6">
          {customers.map((customer) => {
            const editInfo = getEditWindowInfo(role, customer.created_at, customer.created_by, user?.id)
            return (
            <div key={customer.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900">{customer.name}</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Hash className="h-4 w-4" />
                      GST: {customer.gst_no || '—'}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <MapPin className="h-4 w-4" />
                      {customer.address || `${customer.city}, ${customer.state}`}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Mail className="h-4 w-4" />
                      {customer.email}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Phone className="h-4 w-4" />
                      {customer.phone}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500">Total Orders</p>
                  <p className="text-2xl font-semibold text-slate-900">{customer.orders_count}</p>
                  <p className="mt-2 text-sm font-medium text-emerald-600">{ensureRupee(customer.total_amount)}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                <button onClick={() => setViewCustomer(customer)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-blue-100">View Details</button>
                <button
                  onClick={() => editInfo.canEdit ? setEditingCustomer({ ...customer }) : alert('48-hour edit window expired. Contact admin.')}
                  disabled={!editInfo.canEdit && role !== 'admin'}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAdmin ? 'Edit' : editInfo.canEdit ? 'Edit Name' : 'Edit locked'}
                </button>
                {customer.created_at && (
                  <span className="ml-auto self-center text-xs text-slate-400">
                    Added {new Date(customer.created_at).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}
