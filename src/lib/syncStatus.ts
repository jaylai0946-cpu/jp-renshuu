import type { useSync } from '../useSync'

export function syncStatusText(status: ReturnType<typeof useSync>['status']): string {
  switch (status.kind) {
    case 'off':
      return '進度存在這台裝置'
    case 'busy':
      return '同步中…'
    case 'idle':
      return status.at ? '已同步' : '已啟用'
    case 'merged':
      return '已合併兩台的進度'
    case 'error':
      return `同步失敗：${status.message}`
  }
}
