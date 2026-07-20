import { Clock } from 'lucide-react'
import { getEditWindowInfo } from '../utils/editWindow'

interface EditWindowBadgeProps {
  role?: string
  createdAt?: string
  createdBy?: number
  userId?: number
  compact?: boolean
}

export default function EditWindowBadge({ role, createdAt, createdBy, userId, compact }: EditWindowBadgeProps) {
  if (role === 'admin') return null

  const info = getEditWindowInfo(role, createdAt, createdBy, userId)

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${info.canEdit ? 'text-amber-700' : 'text-slate-400'}`}>
        <Clock className="h-3 w-3" />
        {info.canEdit ? info.remainingLabel : 'Edit locked'}
      </span>
    )
  }

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${info.canEdit ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      <div className="flex items-center gap-1 font-medium">
        <Clock className="h-3.5 w-3.5" />
        {info.canEdit ? 'Editable within 48 hours' : '48-hour edit window expired'}
      </div>
      <p className="mt-1">Added: {info.createdLabel}</p>
      <p>Expires: {info.expiresLabel}</p>
      <p className="font-medium">{info.remainingLabel}</p>
    </div>
  )
}
