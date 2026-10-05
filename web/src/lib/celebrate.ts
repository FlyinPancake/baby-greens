import confetti from 'canvas-confetti'

const colors = ['#05e17a', '#00b862', '#ffbf00', '#ffffff', '#000000']

/** A burst of confetti from the middle of the screen. Skipped for people who prefer less motion. */
export function celebrate(): void {
  void confetti({
    particleCount: 120,
    spread: 80,
    startVelocity: 45,
    origin: { y: 0.7 },
    colors,
    shapes: ['square'],
    disableForReducedMotion: true,
  })
}
