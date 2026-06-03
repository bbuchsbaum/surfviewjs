import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import SurfaceViewer from '../components/SurfaceViewer.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Drop a real, interactive cortical surface into the hero image slot.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-image': () =>
        h(SurfaceViewer, {
          height: 400,
          viewpoint: 'lateral',
          class: 'hero-surface',
        }),
    }),
  enhanceApp({ app }) {
    // Make <SurfaceViewer /> usable directly in any markdown page.
    app.component('SurfaceViewer', SurfaceViewer)
  },
} satisfies Theme
