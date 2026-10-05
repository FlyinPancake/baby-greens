import {
  Droplet,
  Droplets,
  type LucideIcon,
  Moon,
  Scissors,
  SprayCan,
  Sprout,
  Sun,
  Waves,
} from 'lucide-react'
import type { CareAction, StepAction } from './api'

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
