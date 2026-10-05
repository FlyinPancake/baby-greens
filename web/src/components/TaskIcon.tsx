import type { TaskAction } from '@/lib/api'
import { careIcons, stepIcons } from '@/lib/icons'

export function TaskIcon({ task, className }: { task: TaskAction; className?: string }) {
  const Icon = task.kind === 'advance' ? stepIcons[task.action] : careIcons[task.action]
  return <Icon className={className} />
}
