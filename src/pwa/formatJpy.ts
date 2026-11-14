export function formatJpy(value: number) {
  return `¥${new Intl.NumberFormat('ja-JP').format(value)}`
}
