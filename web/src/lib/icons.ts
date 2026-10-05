import {
  Amphora,
  Droplet,
  Droplets,
  Inbox,
  type LucideIcon,
  Moon,
  Scissors,
  SprayCan,
  Sprout,
  Sun,
  Waves,
} from 'lucide-react'
import type { CareAction, ContainerKind, StepAction } from './api'

export const stepIcons: Record<StepAction, LucideIcon> = {
  soak: Waves,
  sprout: Sprout,
  blackout: Moon,
  light: Sun,
  harvest: Scissors,
}

export const careIcons: Record<CareAction, LucideIcon> = {
  rinse: Droplets,
  water: Droplet,
  mist: SprayCan,
}

export const containerIcons: Record<ContainerKind, LucideIcon> = {
  jar: Amphora,
  tray: Inbox,
}

export const containerKindOptions: { value: ContainerKind; label: string; icon: LucideIcon }[] = [
  { value: 'jar', label: 'Jar', icon: Amphora },
  { value: 'tray', label: 'Tray', icon: Inbox },
]
