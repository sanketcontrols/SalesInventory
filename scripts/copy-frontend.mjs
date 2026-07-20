import { cpSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(root, '..', 'frontend', 'dist')
const dest = path.join(root, '..', 'backend', 'public')

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })

console.log(`Copied frontend build to ${dest}`)
