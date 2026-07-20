export interface User {
  id?: number
  name: string
  email: string
  role?: 'admin' | 'inventory' | 'sales' | 'pending'
}

export interface AuthResponse {
  message: string
  user: User
  token: string
}

function getToken(): string | null {
  return localStorage.getItem('token')
}

export function clearAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function saveAuth(token: string, user: User) {
  localStorage.setItem('token', token)
  localStorage.setItem('user', JSON.stringify(user))
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export async function refreshStoredUser(): Promise<User | null> {
  const token = getToken()
  if (!token) return null

  try {
    const data = await apiFetch<User & { created_at?: string }>('/api/auth/me')
    const user: User = {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
    }
    saveAuth(token, user)
    return user
  } catch {
    return getStoredUser()
  }
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(apiUrl(url), { ...options, headers })
  const data = await response.json()

  if (response.status === 401 && token) {
    clearAuth()
    window.location.href = '/login'
    throw new Error('Session expired')
  }

  if (!response.ok) {
    throw new Error(data.message || 'Request failed')
  }

  return data as T
}

async function publicFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.message || 'Request failed')
  }
  return data as T
}

export async function login(email: string, password: string) {
  return publicFetch<AuthResponse>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}
