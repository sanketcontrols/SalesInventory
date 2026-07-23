import {
  Download,
  BarChart3,
  TrendingUp,
  Package,
  Users,
  Warehouse,
  CalendarDays,
  History,
  LayoutDashboard,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../services/api'
import { downloadExcel, type ExcelColumn } from '../utils/exportExcel'
import { parseAmount } from '../utils/formatRupee'

type ReportKind =
  | 'summary'
  | 'history'
  | 'monthly'
  | 'sales'
  | 'inventory'
  | 'products'
  | 'product-detail'
  | 'inventory-detail'
  | 'customers'
type HistoryScope = 'orders' | 'products' | 'inventory'
type MonthlyScope = 'products' | 'inventory' | 'both'

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
  sold?: number
  booked?: number
  required_qty?: number
  monthly_avg?: number
  stock_qty?: number
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

interface ReportSummary {
  current_month: string
  current_label: string
  orders: { total: number; qty: number; pending: number; completed: number; cancelled: number }
  sold_this_month: number
  revenue_this_month: number
  revenue_all_time: number
  products: number
  inventory: number
  low_stock: number
  customers: number
}

interface MonthlyRow {
  kind: string
  code: string
  name: string
  year_month: string
  month_label: string
  qty: number
  metric: string
  is_current?: boolean
}

interface ProductDetailRow {
  code: string
  name: string
  available: number
  customers_count: number
  pending_qty: number
  sold_qty: number
  monthly_avg_qty: number
  fy_qty: number
  lifetime_qty: number
  monthly_avg_revenue: number
  monthly_avg_revenue_label: string
  fy_revenue: number
  fy_revenue_label: string
  lifetime_revenue: number
  lifetime_revenue_label: string
  fy_label: string
}

interface InventoryDetailRow {
  name: string
  sku: string
  available: number
  customers_count: number
  pending_qty: number
  used_qty: number
  monthly_avg_qty: number
  fy_qty: number
  lifetime_qty: number
  this_month_qty: number
  fy_label: string
  status: string
}

const REPORT_OPTIONS: {
  id: ReportKind
  title: string
  description: string
  icon: typeof BarChart3
}[] = [
  {
    id: 'summary',
    title: 'Summary',
    description: 'Overview totals — orders, sold, revenue, stock.',
    icon: LayoutDashboard,
  },
  {
    id: 'history',
    title: 'History',
    description: 'Order, product stock, or inventory move history.',
    icon: History,
  },
  {
    id: 'monthly',
    title: 'Monthly Avg',
    description: 'Stored sold / used qty by month (resets each month).',
    icon: CalendarDays,
  },
  {
    id: 'product-detail',
    title: 'Every Product',
    description: 'Customers, sold qty & revenue — monthly / FY / lifetime.',
    icon: Package,
  },
  {
    id: 'inventory-detail',
    title: 'Every Inventory',
    description: 'Customers, used qty — monthly / FY / lifetime.',
    icon: Warehouse,
  },
  {
    id: 'sales',
    title: 'Sales Detail',
    description: 'Full order list with company, qty and amount.',
    icon: TrendingUp,
  },
  {
    id: 'products',
    title: 'Products stock',
    description: 'Product codes, available, required, sold.',
    icon: Package,
  },
  {
    id: 'inventory',
    title: 'Inventory',
    description: 'Available, required, this month used, status.',
    icon: Warehouse,
  },
  {
    id: 'customers',
    title: 'Customers',
    description: 'Buyer companies, GST, orders and totals.',
    icon: Users,
  },
]

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatInr(n: number) {
  return `Rs. ${Math.round(n).toLocaleString('en-IN')}`
}

export default function Reports() {
  const [kind, setKind] = useState<ReportKind>('summary')
  const [historyScope, setHistoryScope] = useState<HistoryScope>('orders')
  const [monthlyScope, setMonthlyScope] = useState<MonthlyScope>('both')
  const [month, setMonth] = useState('') // '' = all months

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [products, setProducts] = useState<ProductCode[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [historyRows, setHistoryRows] = useState<Record<string, unknown>[]>([])
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([])
  const [productDetailRows, setProductDetailRows] = useState<ProductDetailRow[]>([])
  const [inventoryDetailRows, setInventoryDetailRows] = useState<InventoryDetailRow[]>([])
  const [monthOptions, setMonthOptions] = useState<{ year_month: string; label: string }[]>([])

  const [loading, setLoading] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([
      apiFetch<DashboardStats>('/api/dashboard/stats').catch(() => null),
      apiFetch<Order[]>('/api/orders').catch(() => []),
      apiFetch<InventoryItem[]>('/api/inventory').catch(() => []),
      apiFetch<ProductCode[]>('/api/product-codes').catch(() => []),
      apiFetch<Customer[]>('/api/customers').catch(() => []),
    ])
      .then(([statsData, ordersData, invData, productData, customerData]) => {
        setStats(statsData)
        setOrders(ordersData || [])
        setInventory(invData || [])
        setProducts(productData || [])
        setCustomers(customerData || [])
      })
      .finally(() => setLoading(false))
  }, [])

  const loadSelectedReport = useCallback(async () => {
    setLoadingReport(true)
    try {
      if (kind === 'summary') {
        const data = await apiFetch<ReportSummary>('/api/reports/summary')
        setSummary(data)
      } else if (kind === 'history') {
        const q = new URLSearchParams({ scope: historyScope, limit: '300' })
        if (month) q.set('month', month)
        const data = await apiFetch<{ rows: Record<string, unknown>[] }>(`/api/reports/history?${q}`)
        setHistoryRows(data.rows || [])
      } else if (kind === 'monthly') {
        const q = new URLSearchParams({ scope: monthlyScope })
        if (month) q.set('month', month)
        const data = await apiFetch<{
          rows: MonthlyRow[]
          months: { year_month: string; label: string }[]
        }>(`/api/reports/monthly-avg?${q}`)
        setMonthlyRows(data.rows || [])
        setMonthOptions(data.months || [])
      } else if (kind === 'product-detail') {
        const data = await apiFetch<{ rows: ProductDetailRow[] }>('/api/reports/products-detail')
        setProductDetailRows(data.rows || [])
      } else if (kind === 'inventory-detail') {
        const data = await apiFetch<{ rows: InventoryDetailRow[] }>('/api/reports/inventory-detail')
        setInventoryDetailRows(data.rows || [])
      }
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : 'Failed to load report')
      setTimeout(() => setMessage(''), 3000)
    } finally {
      setLoadingReport(false)
    }
  }, [kind, historyScope, monthlyScope, month])

  useEffect(() => {
    if (
      kind === 'summary' ||
      kind === 'history' ||
      kind === 'monthly' ||
      kind === 'product-detail' ||
      kind === 'inventory-detail'
    ) {
      loadSelectedReport()
    }
  }, [kind, historyScope, monthlyScope, month, loadSelectedReport])

  const showMsg = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 2500)
  }

  const preview = useMemo(() => {
    if (kind === 'summary' && summary) {
      const columns: ExcelColumn[] = [
        { header: 'Metric' },
        { header: 'Value' },
      ]
      const rows: (string | number)[][] = [
        ['Month', summary.current_label],
        ['Orders (active)', summary.orders.total],
        ['Orders pending', summary.orders.pending],
        ['Orders completed', summary.orders.completed],
        ['Sold this month (qty)', summary.sold_this_month],
        ['Revenue this month', formatInr(summary.revenue_this_month)],
        ['Revenue all time', formatInr(summary.revenue_all_time)],
        ['Products', summary.products],
        ['Inventory items', summary.inventory],
        ['Low stock', summary.low_stock],
        ['Customers', summary.customers],
      ]
      return { columns, rows, sheet: 'Summary', file: `Summary_Report_${today()}.xlsx` }
    }

    if (kind === 'history') {
      if (historyScope === 'orders') {
        const columns: ExcelColumn[] = [
          { header: 'Month' },
          { header: 'Order No' },
          { header: 'Company' },
          { header: 'Product Code' },
          { header: 'Product Name' },
          { header: 'Qty', type: 'number' },
          { header: 'Amount (INR)', type: 'inr' },
          { header: 'Status' },
          { header: 'Date' },
        ]
        const rows = historyRows.map((r) => [
          String(r.month_label || ''),
          String(r.order_no || ''),
          String(r.company || ''),
          String(r.product_code || ''),
          String(r.product_name || ''),
          Number(r.qty) || 0,
          String(r.amount || '0'),
          String(r.status || ''),
          String(r.date || ''),
        ])
        return { columns, rows, sheet: 'Order History', file: `History_Orders_${today()}.xlsx` }
      }
      if (historyScope === 'products') {
        const columns: ExcelColumn[] = [
          { header: 'Month' },
          { header: 'Product Code' },
          { header: 'Product Name' },
          { header: 'Type' },
          { header: 'Qty Added', type: 'number' },
          { header: 'Qty After', type: 'number' },
          { header: 'Date' },
        ]
        const rows = historyRows.map((r) => [
          String(r.month_label || ''),
          String(r.product_code || ''),
          String(r.product_name || ''),
          String(r.label || 'Stock'),
          Number(r.qty) || 0,
          Number(r.stock_after) || 0,
          String(r.date || ''),
        ])
        return { columns, rows, sheet: 'Product History', file: `History_Products_${today()}.xlsx` }
      }
      const columns: ExcelColumn[] = [
        { header: 'Month' },
        { header: 'Inventory' },
        { header: 'Ref' },
        { header: 'Product Code' },
        { header: 'Type' },
        { header: 'Qty', type: 'number' },
        { header: 'Date' },
      ]
      const rows = historyRows.map((r) => [
        String(r.month_label || ''),
        String(r.inventory_name || ''),
        String(r.ref || ''),
        String(r.product_code || ''),
        String(r.type || ''),
        Number(r.qty) || 0,
        String(r.date || ''),
      ])
      return { columns, rows, sheet: 'Inventory History', file: `History_Inventory_${today()}.xlsx` }
    }

    if (kind === 'monthly') {
      const columns: ExcelColumn[] = [
        { header: 'Month' },
        { header: 'Type' },
        { header: 'Code / SKU' },
        { header: 'Name' },
        { header: 'Metric' },
        { header: 'Qty', type: 'number' },
        { header: 'Current Month' },
      ]
      const rows = monthlyRows.map((r) => [
        r.month_label,
        r.kind === 'product' ? 'Product' : 'Inventory',
        r.code,
        r.name,
        r.metric,
        r.qty,
        r.is_current ? 'Yes' : 'No',
      ])
      return { columns, rows, sheet: 'Monthly Avg', file: `Monthly_Avg_${today()}.xlsx` }
    }

    if (kind === 'sales') {
      const columns: ExcelColumn[] = [
        { header: 'Order No' },
        { header: 'Product Code' },
        { header: 'Product Name' },
        { header: 'Company' },
        { header: 'State' },
        { header: 'Date' },
        { header: 'Qty', type: 'number' },
        { header: 'Amount (INR)', type: 'inr' },
        { header: 'Status' },
      ]
      const rows = orders.map((o) => [
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
      return { columns, rows, sheet: 'Sales', file: `Sales_Report_${today()}.xlsx` }
    }

    if (kind === 'product-detail') {
      const columns: ExcelColumn[] = [
        { header: 'Code' },
        { header: 'Product' },
        { header: 'Customers', type: 'number' },
        { header: 'Pending qty', type: 'number' },
        { header: 'Sold qty', type: 'number' },
        { header: 'Monthly avg qty', type: 'number' },
        { header: 'FY qty', type: 'number' },
        { header: 'Lifetime qty', type: 'number' },
        { header: 'Monthly avg revenue (INR)', type: 'inr' },
        { header: 'FY revenue (INR)', type: 'inr' },
        { header: 'Lifetime revenue (INR)', type: 'inr' },
        { header: 'Available', type: 'number' },
      ]
      const rows = productDetailRows.map((p) => [
        p.code,
        p.name,
        p.customers_count,
        p.pending_qty,
        p.sold_qty,
        p.monthly_avg_qty,
        p.fy_qty,
        p.lifetime_qty,
        p.monthly_avg_revenue,
        p.fy_revenue,
        p.lifetime_revenue,
        p.available,
      ])
      return { columns, rows, sheet: 'Every Product', file: `Every_Product_Report_${today()}.xlsx` }
    }

    if (kind === 'inventory-detail') {
      const columns: ExcelColumn[] = [
        { header: 'Inventory' },
        { header: 'SKU' },
        { header: 'Customers', type: 'number' },
        { header: 'Pending qty', type: 'number' },
        { header: 'Used qty', type: 'number' },
        { header: 'Monthly avg qty', type: 'number' },
        { header: 'FY qty', type: 'number' },
        { header: 'Lifetime qty', type: 'number' },
        { header: 'This month used', type: 'number' },
        { header: 'Available', type: 'number' },
        { header: 'Status' },
      ]
      const rows = inventoryDetailRows.map((r) => [
        r.name,
        r.sku || '-',
        r.customers_count,
        r.pending_qty,
        r.used_qty,
        r.monthly_avg_qty,
        r.fy_qty,
        r.lifetime_qty,
        r.this_month_qty,
        r.available,
        r.status,
      ])
      return { columns, rows, sheet: 'Every Inventory', file: `Every_Inventory_Report_${today()}.xlsx` }
    }

    if (kind === 'products') {
      const columns: ExcelColumn[] = [
        { header: 'Product Code' },
        { header: 'Product Name' },
        { header: 'Available Qty', type: 'number' },
        { header: 'Required Qty', type: 'number' },
        { header: 'Sold', type: 'number' },
        { header: 'This Month Sold', type: 'number' },
        { header: 'Parts', type: 'number' },
      ]
      const rows = products.map((p) => [
        p.code,
        p.name,
        Math.max(0, Number(p.stock_qty) || 0),
        p.required_qty ?? p.booked ?? 0,
        p.sold ?? 0,
        p.monthly_avg ?? 0,
        p.items?.length || 0,
      ])
      return { columns, rows, sheet: 'Products', file: `Product_Report_${today()}.xlsx` }
    }

    if (kind === 'inventory') {
      const columns: ExcelColumn[] = [
        { header: 'Inventory' },
        { header: 'SKU' },
        { header: 'Available Qty', type: 'number' },
        { header: 'Required Qty', type: 'number' },
        { header: 'This Month Used', type: 'number' },
        { header: 'Status' },
      ]
      const rows = inventory.map((i) => [
        i.name,
        i.sku,
        i.available,
        i.required_qty ?? 0,
        Number(i.monthly_avg || 0),
        i.status,
      ])
      return { columns, rows, sheet: 'Inventory', file: `Inventory_Report_${today()}.xlsx` }
    }

    const columns: ExcelColumn[] = [
      { header: 'Company' },
      { header: 'Email' },
      { header: 'Phone' },
      { header: 'City' },
      { header: 'State' },
      { header: 'GST No' },
      { header: 'Orders', type: 'number' },
      { header: 'Total Amount (INR)', type: 'inr' },
    ]
    const rows = customers.map((c) => [
      c.name,
      c.email,
      c.phone,
      c.city,
      c.state,
      c.gst_no || '-',
      c.orders_count,
      c.total_amount,
    ])
    return { columns, rows, sheet: 'Customers', file: `Customer_Report_${today()}.xlsx` }
  }, [
    kind,
    summary,
    historyScope,
    historyRows,
    monthlyRows,
    productDetailRows,
    inventoryDetailRows,
    orders,
    products,
    inventory,
    customers,
  ])

  const handleDownload = () => {
    downloadExcel(preview.file, preview.sheet, preview.columns, preview.rows)
    showMsg(`${preview.sheet} downloaded (.xlsx)`)
  }

  const selectedMeta = REPORT_OPTIONS.find((o) => o.id === kind)
  const busy = loading || loadingReport

  const monthSelectOptions = useMemo(() => {
    if (monthOptions.length) return monthOptions
    // fallback: last 12 months
    const list: { year_month: string; label: string }[] = []
    const d = new Date()
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const ym = `${y}-${m}`
      const label = d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })
      list.push({ year_month: ym, label })
      d.setMonth(d.getMonth() - 1)
    }
    return list
  }, [monthOptions])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose what you want — Summary, History, Monthly Avg, or detail reports — then preview or download Excel.
          </p>
        </div>
        {message ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">{message}</p>
        ) : null}
      </div>

      {/* Selection */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Select report</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {REPORT_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = kind === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKind(opt.id)}
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  active
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <Icon className={`mb-1.5 h-4 w-4 ${active ? 'text-blue-700' : 'text-slate-500'}`} />
                <p className={`text-sm font-semibold ${active ? 'text-blue-900' : 'text-slate-900'}`}>{opt.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{opt.description}</p>
              </button>
            )
          })}
        </div>

        {(kind === 'history' || kind === 'monthly') && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            {kind === 'history' && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">History for</span>
                <select
                  value={historyScope}
                  onChange={(e) => setHistoryScope(e.target.value as HistoryScope)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="orders">Orders</option>
                  <option value="products">Product stock adds</option>
                  <option value="inventory">Inventory moves</option>
                </select>
              </label>
            )}
            {kind === 'monthly' && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Monthly avg for</span>
                <select
                  value={monthlyScope}
                  onChange={(e) => setMonthlyScope(e.target.value as MonthlyScope)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="both">Products sold + Inventory used</option>
                  <option value="products">Products sold only</option>
                  <option value="inventory">Inventory used only</option>
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="">All months</option>
                {!monthOptions.some((m) => m.year_month === currentYearMonth()) && (
                  <option value={currentYearMonth()}>This month</option>
                )}
                {monthSelectOptions.map((m) => (
                  <option key={m.year_month} value={m.year_month}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={loadSelectedReport}
              disabled={busy}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Summary cards when summary selected */}
      {kind === 'summary' && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Sold this month',
              value: summary ? String(summary.sold_this_month) : '…',
              hint: summary?.current_label || '',
            },
            {
              label: 'Revenue this month',
              value: summary ? formatInr(summary.revenue_this_month) : '…',
              hint: `${summary?.orders.completed ?? 0} completed orders`,
            },
            {
              label: 'Pending orders',
              value: summary ? String(summary.orders.pending) : '…',
              hint: `${summary?.orders.total ?? 0} active orders`,
            },
            {
              label: 'Low stock items',
              value: summary ? String(summary.low_stock) : '…',
              hint: `${summary?.inventory ?? 0} inventory SKUs`,
            },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{busy ? '…' : card.value}</p>
              <p className="mt-1 text-[11px] text-slate-500">{card.hint}</p>
            </div>
          ))}
        </div>
      )}

      {/* Preview + download */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-slate-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">{selectedMeta?.title} preview</h2>
              <p className="text-xs text-slate-500">{selectedMeta?.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy || preview.rows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download Excel ({preview.rows.length} rows)
          </button>
        </div>

        {busy ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading report…</p>
        ) : preview.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No rows for this selection.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {preview.columns.map((col) => (
                    <th key={col.header} className="px-3 py-2 font-semibold">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row, idx) => (
                  <tr key={idx} className="border-b border-slate-50 last:border-0">
                    {row.map((cell, cIdx) => {
                      const col = preview.columns[cIdx]
                      let display: string | number = cell ?? ''
                      if (col?.type === 'inr') display = formatInr(parseAmount(cell))
                      return (
                        <td key={cIdx} className="px-3 py-2 tabular-nums text-slate-800">
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 100 ? (
              <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Showing first 100 of {preview.rows.length} rows — download Excel for full data.
              </p>
            ) : null}
          </div>
        )}

        {!busy && stats && kind !== 'summary' ? (
          <p className="mt-3 text-xs text-slate-500">
            Dashboard snapshot: {stats.totalOrders} orders · {products.length} products · {inventory.length} inventory ·{' '}
            {stats.lowStockItems} low stock
          </p>
        ) : null}
      </div>
    </div>
  )
}
