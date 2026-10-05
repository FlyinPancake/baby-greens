import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

// Generates the PWA icons and favicon from public/logo.svg. Run `bunx pwa-assets-generator`
// after changing the logo, and commit the results in public/.
const background = '#dcfce7'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions: { background } },
    apple: { ...preset.apple, resizeOptions: { background } },
  },
  images: ['public/logo.svg'],
})
