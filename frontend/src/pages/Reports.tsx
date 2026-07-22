import { Download, BarChart3, TrendingUp, Package, Users, Warehouse } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../services/api'
import { downloadExcel } from '../utils/exportExcel'
import { parseAmount } from '../utils/formatRupee'

interface DashboardStats {
  totalOrders: number
  totalCustomers: number
  totalProducts: number
  totalInventory: number
  totalQuantity: number
  lowStockItems: number
  totalRevenue?: string
  pendingOrders?: number
}

interface Order {
  id: number
  order_no: string
  company: string
  state?: string
  date?: string
  qty?: number
  amount: string
  status: string
  product_code?: string
  product_name?: string
}

interface InventoryItem {
  id: number
  name: string
  sku: string
  available: number
  required_qty: number
  monthly_avg: number
  pending: number
  status: string
}

interface ProductCode {
  id: number
  code: string
  name: string
  description: string
  items: { name: string; sku: string; qty_per_unit: number; available: number }[]
}

interface Customer {
  id: number
  name: string
  email: string
  phone: string
  city: string
  state: string
  gst_no?: string
  orders_count: number
  total_amount: string
}

export default function Reports() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [products, setProducts] = useState<ProductCode[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([
      apiFetch<DashboardStats>('/api/dashboard/stats'),
      apiFetch<Order[]>('/api/orders'),
      apiFetch<InventoryItem[]>('/api/inventory'),
      apiFetch<ProductCode[]>('/api/product-codes'),
      apiFetch<Customer[]>('/api/customers'),
    ])
      .then(([statsData, ordersData, invData, productData, customerData]) => {
        setStats(statsData)
        setOrders(ordersData)
        setInventory(invData)
        setProducts(productData)
        setCustomers(customerData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const showMsg = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 2500)
  }

  const downloadSalesReport = () => {
    downloadExcel(
      `Sales_Report_${today()}.xlsx`,
      'Sales Orders',
      [
        { header: 'Order No' },
        { header: 'Product Code' },
        { header: 'Product Name' },
        { header: 'Company' },
        { header: 'State' },
        { header: 'Date' },
        { header: 'Qty', type: 'number' },
        { header: 'Amount (INR)', type: 'inr' },
        { header: 'Status' },
      ],
      orders.map((o) => [
        o.order_no,
        o.product_code || '-',
        o.product_name || '-',
        o.company,
        o.state || '-',
        o.date || '-',
        o.qty ?? 0,
        o.amount,
        o.status,
      ])
    )
    showMsg('Sales report downloaded (.xlsx)')
  }

  const downloadInventoryReport = () => {
    downloadExcel(
      `Inventory_Report_${today()}.xlsx`,
      'Inventory',
      [
        { header: 'Inventory' },
        { header: 'SKU' },
        { header: 'Qty Available', type: 'number' },
        { header: 'Required Qty', type: 'number' },
        { header: 'Booked', type: 'number' },
        { header: 'Monthly Avg', type: 'number' },
        { header: 'Status' },
      ],
      inventory.map((i) => [
        i.name,
        i.sku,
        i.available,
        i.required_qty ?? 0,
        i.pending ?? 0,
        Number(i.monthly_avg || 0),
        i.status,
      ])
    )
    showMsg('Inventory report downloaded (.xlsx)')
  }

  const downloadProductReport = () => {
    const rows: (string | number)[][] = []
    for (const product of products) {
      if (!product.items?.length) {
        rows.push([product.code, product.name, product.description || '-', '-', '-', 0, 0, 'No inventory linked'])
        continue
      }
      for (const item of product.items) {
        rows.push([
          product.code,
          product.name,
          product.description || '-',
          item.name,
          item.sku,
          item.qty_per_unit,
          item.available ?? 0,
          (item.available ?? 0) >= item.qty_per_unit ? 'OK' : 'Low',
        ])
      }
    }

    downloadExcel(
      `Product_Report_${today()}.xlsx`,
      'Products',
      [
        { header: 'Product Code' },
        { header: 'Product Name' },
        { header: 'Description' },
        { header: 'Inventory Item' },
        { header: 'Inventory SKU' },
        { header: 'Qty Per Product', type: 'number' },
        { header: 'Available Stock', type: 'number' },
        { header: 'Stock Status' },
      ],
      rows
    )
    showMsg('Product report downloaded (.xlsx)')
  }

  const downloadCustomerReport = () => {
    downloadExcel(
      `Customer_Report_${today()}.xlsx`,
      'Customers',
      [
        { header: 'Company' },
        { header: 'Email' },
        { header: 'Phone' },
        { header: 'City' },
        { header: 'State' },
        { header: 'GST No' },
        { header: 'Orders', type: 'number' },
        { header: 'Total Amount (INR)', type: 'inr' },
      ],
      customers.map((c) => [
        c.name,
        c.email,
        c.phone,
        c.city,
        c.state,
        c.gst_no || '-',
        c.orders_count,
        c.total_amount,
      ])
    )
    showMsg('Customer report downloaded (.xlsx)')
  }

  const metrics = stats
    ? [
        { label: 'Total Orders', value: String(stats.totalOrders), hint: `${stats.totalQuantity} units` },
        { label: 'Revenue', value: stats.totalRevenue || '—', hint: `${stats.pendingOrders ?? 0} pending` },
        { label: 'Products', value: String(products.length), hint: 'Product codes' },
        { label: 'Inventory SKUs', value: String(stats.totalInventory), hint: `${stats.lowStockItems} low stock` },
      ]
    : []

  const reports = [
    {
      title: 'Sales Report',
      description: 'Orders with product, company, qty and amount in Rs.',
      icon: TrendingUp,
      color: 'bg-blue-50',
      count: orders.length,
      onDownload: downloadSalesReport,
    },
    {
      title: 'Product Report',
      description: 'Product codes with linked inventory items and stock.',
      icon: Package,
      color: 'bg-indigo-50',
      count: products.length,
      onDownload: downloadProductReport,
    },
    {
      title: 'Inventory Report',
      description: 'Qty, required qty, booked and monthly average.',
      icon: Warehouse,
      color: 'bg-emerald-50',
      count: inventory.length,
      onDownload: downloadInventoryReport,
    },
    {
      title: 'Customer Report',
      description: 'Buyer companies, GST, orders and total amount.',
      icon: Users,
      color: 'bg-violet-50',
      count: customers.length,
      onDownload: downloadCustomerReport,
    },
  ]

  const totalSales = orders
    .filter((o) => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + parseAmount(o.amount), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download clean Excel (.xlsx) files. Amounts use Rs. format so Excel shows currency correctly.
          </p>
        </div>
        {message && <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">{message}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{metric.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{loading ? '...' : metric.value}</p>
            <p className="mt-1 text-[11px] text-slate-500">{metric.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {reports.map((report) => {
          const Icon = report.icon
          return (
            <div key={report.title} className={`rounded-2xl border border-slate-200 ${report.color} p-5 shadow-sm`}>
              <div className="flex items-start justify-between">
                <Icon className="h-7 w-7 text-slate-800" />
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {report.count} rows
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">{report.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{report.description}</p>
              <button
                onClick={report.onDownload}
                disabled={loading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Download Excel
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-slate-600" />
          <h2 className="text-base font-semibold text-slate-900">Report preview</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Active sales total</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">Rs. {Math.round(totalSales).toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Product codes</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{products.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Inventory items</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{inventory.length}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tip: Open the downloaded .xlsx in Excel. Amount column shows as <strong>Rs. 1,000.00</strong> — not broken symbols.
        </p>
      </div>
    </div>
  )
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
