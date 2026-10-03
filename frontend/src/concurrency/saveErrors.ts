import { ElMessage, ElMessageBox } from 'element-plus'
import { OwnershipError, VersionConflictError } from '@/concurrency/versioning'

/**
 * 统一处理带版本保存抛出的错误：
 * - 越权：明确告知该归谁写；
 * - 版本冲突：逐项点出会被盖回旧值的字段，停下不写；
 * - 其他：按 IO/未知错误提示。
 * 返回是否属于「已妥善处理的业务错误」（冲突 / 越权），方便调用方决定是否落草稿。
 */
export interface SaveErrorResult {
  conflict: boolean
  conflictError?: VersionConflictError
  ownership: boolean
  message: string
}

export async function reportSaveError(error: unknown, scopeLabel: string): Promise<SaveErrorResult> {
  if (error instanceof VersionConflictError) {
    const lines: string[] = []
    if (error.deleted) lines.push('该记录在你打开后已被另一窗口删除。')
    if (error.clobberedFields.length) {
      lines.push(`会被你这次保存盖回旧值的字段：${error.clobberedFields.join('、')}`)
    }
    if (error.divergedFields.length) {
      lines.push(`双方都改过、需要人工核对的字段：${error.divergedFields.join('、')}`)
    }
    lines.push(
      `你打开时是 v${error.baseVersion}，现在库里已经是 v${error.currentVersion}。本次未写入任何内容，请重新载入最新值再改。`
    )
    try {
      await ElMessageBox.alert(lines.join('<br/>'), `${scopeLabel}保存被拦下：他人已修改`, {
        type: 'warning',
        dangerouslyUseHTMLString: true,
        confirmButtonText: '我知道了'
      })
    } catch {
      // 用户直接关掉弹框即可
    }
    return { conflict: true, conflictError: error, ownership: false, message: error.message }
  }
  if (error instanceof OwnershipError) {
    ElMessage.error(error.message)
    return { conflict: false, ownership: true, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  ElMessage.error(`${scopeLabel}保存失败：${message}`)
  return { conflict: false, ownership: false, message }
}
