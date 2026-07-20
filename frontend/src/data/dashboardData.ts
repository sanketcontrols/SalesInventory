import type { DashboardCardData, InventoryItem, NotificationItem, OrderItem } from '../types'

export const dashboardCards: DashboardCardData[] = [
  { title: 'Total Orders', value: '124', growth: '+8%', icon: 'Package', accent: 'bg-blue-50 text-blue-600' },
  { title: 'Total Customers', value: '86', growth: '+12%', icon: 'Users', accent: 'bg-emerald-50 text-emerald-600' },
  { title: 'Total Products', value: '53', growth: '+4%', icon: 'Boxes', accent: 'bg-amber-50 text-amber-600' },
  { title: 'Total Sales', value: '$48.2K', growth: '+15%', icon: 'BarChart3', accent: 'bg-violet-50 text-violet-600' },
]

export const recentOrders: OrderItem[] = [
  { orderNo: '#SO-1042', company: 'Northwind Tools', state: 'Texas', date: '14 Jul', quantity: 24, amount: '$8,240', status: 'Pending' },
  { orderNo: '#SO-1039', company: 'Apex Components', state: 'Illinois', date: '13 Jul', quantity: 16, amount: '$5,120', status: 'Completed' },
  { orderNo: '#SO-1035', company: 'BluePeak Industries', state: 'Arizona', date: '12 Jul', quantity: 12, amount: '$3,840', status: 'Cancelled' },
  { orderNo: '#SO-1031', company: 'Harbor Parts', state: 'Ohio', date: '11 Jul', quantity: 32, amount: '$11,200', status: 'Completed' },
]

export const inventoryItems: InventoryItem[] = [
  { name: 'Relay 24V', available: 120, pending: 20, status: 'Normal' },
  { name: 'Terminal Block', available: 18, pending: 50, status: 'Low Stock' },
  { name: 'MCB', available: 35, pending: 10, status: 'Available' },
]

export const notifications: NotificationItem[] = [
  { title: 'Low stock alert', description: 'Terminal Block stock is below reorder threshold.', tone: 'amber' },
  { title: 'Pending order reminder', description: '2 orders need dispatch approval before noon.', tone: 'blue' },
  { title: 'Today\'s delivery', description: 'Scheduled inbound shipment from Apex Components.', tone: 'green' },
  { title: 'New customer added', description: 'Northwind Tools joined the active account list.', tone: 'red' },
]
