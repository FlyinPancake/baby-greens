import {
  createLucideIcon,
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

/** A jar with a screw lid and a label. Lucide has no jar, and its amphora reads as a vase. */
export const Jar = createLucideIcon('jar', [
  ['rect', { x: '6', y: '2', width: '12', height: '3.5', rx: '1', key: 'lid' }],
  [
    'path',
    {
      d: 'M7 5.5V7a2 2 0 0 1-1 1.7A3 3 0 0 0 4.5 11.3V19a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-7.7A3 3 0 0 0 18 8.7 2 2 0 0 1 17 7V5.5',
      key: 'body',
    },
  ],
  ['rect', { x: '8', y: '12', width: '8', height: '6', rx: '1', key: 'label' }],
])

export const containerIcons: Record<ContainerKind, LucideIcon> = {
  jar: Jar,
  tray: Inbox,
}

export const containerKindOptions: { value: ContainerKind; label: string; icon: LucideIcon }[] = [
  { value: 'jar', label: 'Jar', icon: Jar },
  { value: 'tray', label: 'Tray', icon: Inbox },
]
