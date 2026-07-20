import { Plus, Download, Filter } from 'lucide-react'
import { useState, useEffect } from 'react'
import { apiFetch } from '../services/api'
import { downloadCsv } from '../utils/exportCsv'
import ImportCsvButton from '../components/ImportCsvButton'

interface Product {
  id: number
  product_id: string
  name: string
  category: string
  sku: string
  price: string
  stock: number
  status: string
}

export default function Products() {
  const [showForm, setShowForm] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({ name: '', sku: '', category: '', price: '', stock: '0' })

  useEffect(() => {
    fetchProducts()
  }, [search, categoryFilter])

  const fetchProducts = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (categoryFilter) params.set('category', categoryFilter)
      const query = params.toString() ? `?${params.toString()}` : ''
      const data = await apiFetch<Product[]>(`/api/products${query}`)
      setProducts(data)
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddProduct = async () => {
    if (!formData.name || !formData.sku || !formData.category || !formData.price) {
      alert('Please fill all fields')
      return
    }

    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify(formData),
      })
      setFormData({ name: '', sku: '', category: '', price: '', stock: '0' })
      setShowForm(false)
      fetchProducts()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add product')
    }
  }

  const handleExport = () => {
    downloadCsv(
      'products.csv',
      ['Product ID', 'Name', 'Category', 'SKU', 'Price', 'Stock', 'Status'],
      products.map((p) => [p.product_id, p.name, p.category, p.sku, p.price, p.stock, p.status])
    )
  }

  const handleImport = async (rows: Record<string, string>[]) => {
    const result = await apiFetch<{ imported: number; total: number; errors: string[] }>('/api/products/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
    alert(`Imported ${result.imported} of ${result.total} products${result.errors.length ? `\nErrors: ${result.errors.slice(0, 3).join(', ')}` : ''}`)
    fetchProducts()
  }

  const categories = [...new Set(products.map((p) => p.category))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-500">Manage product catalog, SKUs, and pricing information.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowFilter(!showFilter)} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <button onClick={handleExport} className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
            <Download className="h-4 w-4" />
            Export
          </button>
          <ImportCsvButton onImport={handleImport} />
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700">
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Search</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or SKU..." className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500">
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Add New Product</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <input type="text" placeholder="Product Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="SKU" value={formData.sku} onChange={(e) => setFormData({...formData, sku: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Category" value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="text" placeholder="Price" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
            <input type="number" placeholder="Stock" value={formData.stock} onChange={(e) => setFormData({...formData, stock: e.target.value})} className="rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleAddProduct} className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Add</button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500">Loading products...</div>
      ) : (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Product ID</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Name</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Category</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">SKU</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Price</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Stock</th>
              <th className="px-6 py-3 text-left font-medium text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                <td className="px-6 py-3 font-medium text-slate-900">{product.product_id}</td>
                <td className="px-6 py-3">{product.name}</td>
                <td className="px-6 py-3">{product.category}</td>
                <td className="px-6 py-3">{product.sku}</td>
                <td className="px-6 py-3">{product.price}</td>
                <td className="px-6 py-3">{product.stock}</td>
                <td className="px-6 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.status === 'In Stock' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {product.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
