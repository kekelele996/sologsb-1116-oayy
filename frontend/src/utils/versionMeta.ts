import type { VersionedRow } from '@/types'
import { ROLE_LABELS } from '@/types'

/** ISO 时间 → YYYY-MM-DD HH:mm（保存留痕展示用） */
export function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** “打开时看到的版本”留痕行：版本号 + 归属 + 最后修改人/时间 */
export function versionMetaText(row: VersionedRow): string {
  const owner = ROLE_LABELS[row.owner] ?? row.owner
  const by = row.updatedBy || '未知'
  return `打开版本 v${row.version} · ${owner}域 · ${by} ${formatDateTime(row.updatedAt)}`
}
