/** Common jar and lid colours. Anything else can be picked as a custom colour. */
export const containerColors = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#facc15' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Brown', hex: '#92400e' },
  { name: 'Grey', hex: '#9ca3af' },
  { name: 'Black', hex: '#111111' },
  { name: 'White', hex: '#ffffff' },
]

export function colorName(hex: string | null | undefined): string {
  if (!hex) return 'clear'
  return containerColors.find((color) => color.hex === hex)?.name.toLowerCase() ?? hex
}

/** Black or white, whichever reads better on `hex`. */
export function contrastOn(hex: string): '#000000' | '#ffffff' {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.4 ? '#000000' : '#ffffff'
}
