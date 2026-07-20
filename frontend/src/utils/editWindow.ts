export const EDIT_WINDOW_HOURS = 48

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function getEditWindowInfo(
  role: string | undefined,
  createdAt: string | undefined,
  createdBy?: number,
  userId?: number
) {
  if (!createdAt) {
    return { canEdit: role === 'admin', createdLabel: '—', expiresLabel: '—', remainingLabel: '—' }
  }

  if (role === 'admin') {
    return {
      canEdit: true,
      createdLabel: formatDateTime(createdAt),
      expiresLabel: 'No limit (admin)',
      remainingLabel: 'Always editable',
    }
  }

  const created = new Date(createdAt)
  const expires = new Date(created.getTime() + EDIT_WINDOW_HOURS * 60 * 60 * 1000)
  const now = Date.now()
  const owned = createdBy == null || userId == null || createdBy === userId
  const withinWindow = now <= expires.getTime()
  const canEdit = owned && withinWindow

  const remainingMs = expires.getTime() - now
  let remainingLabel = 'Edit expired'
  if (remainingMs > 0) {
    const hrs = Math.floor(remainingMs / (1000 * 60 * 60))
    const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))
    remainingLabel = hrs > 0 ? `${hrs}h ${mins}m left to edit` : `${mins}m left to edit`
  }

  return {
    canEdit,
    createdLabel: formatDateTime(createdAt),
    expiresLabel: formatDateTime(expires),
    remainingLabel,
  }
}
