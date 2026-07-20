export interface MenuItem {
  name: string
  path: string
  icon: string
}

export interface DashboardCardData {
  title: string
  value: string
  growth: string
  icon: string
  accent: string
}

export interface OrderItem {
  orderNo: string
  company: string
  state: string
  date: string
  quantity: number
  amount: string
  status: 'Pending' | 'Completed' | 'Cancelled'
}

export interface InventoryItem {
  name: string
  available: number
  pending: number
  status: 'Normal' | 'Low Stock' | 'Available'
}

export interface NotificationItem {
  title: string
  description: string
  tone: 'blue' | 'amber' | 'green' | 'red'
}
