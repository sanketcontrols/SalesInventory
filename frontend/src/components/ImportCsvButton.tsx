import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { readCsvFile } from '../utils/importCsv'

interface ImportCsvButtonProps {
  onImport: (rows: Record<string, string>[]) => Promise<void>
  label?: string
}

export default function ImportCsvButton({ onImport, label = 'Import CSV' }: ImportCsvButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const rows = await readCsvFile(file)
      if (rows.length === 0) {
        alert('CSV file is empty or invalid')
        return
      }
      await onImport(rows)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to import CSV')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
      >
        <Upload className="h-4 w-4" />
        {loading ? 'Importing...' : label}
      </button>
    </>
  )
}
