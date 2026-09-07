import { defineConfig, type DefaultTheme } from 'vitepress'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Deployed at https://bbuchsbaum.github.io/surfviewjs/ (base set in CI), '/' locally.
const base = process.env.GITHUB_ACTIONS ? '/surfviewjs/' : '/'

// TypeDoc (via typedoc-vitepress-theme) writes the API sidebar here on `docs:api`.
// Load it defensively so `vitepress dev` works even before the first generation.
function apiSidebar(): DefaultTheme.SidebarItem[] {
  try {
    const json = readFileSync(
      fileURLToPath(new URL('../api/typedoc-sidebar.json', import.meta.url)),
      'utf-8',
    )
    return JSON.parse(json) as DefaultTheme.SidebarItem[]
  } catch {
    return [{ text: 'Run `npm run docs:api` to generate the reference', link: '/api/' }]
  }
}

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'SurfView.js',
  titleTemplate: ':title · SurfView.js',
  description:
    'Brain surface visualization for JavaScript — GPU-accelerated cortical meshes, multi-layer data overlays, scientific colormaps, and temporal playback, powered by Three.js.',
  cleanUrls: true,
  // TypeDoc creates hundreds of pages. VitePress otherwise spawns one git
  // process per page to compute timestamps and can exhaust CI process limits.
  lastUpdated: false,
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#0ea5a0' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'SurfView.js — brain surface visualization for JavaScript' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'GPU-accelerated cortical surfaces, multi-layer data overlays, scientific colormaps, and temporal playback in the browser, powered by Three.js.',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      { text: 'Demo', link: 'https://bbuchsbaum.github.io/surfviewjs/demo/' },
      {
        text: 'v2.2.0',
        items: [
          { text: 'Release Notes', link: 'https://github.com/bbuchsbaum/surfviewjs/releases' },
          { text: 'npm', link: 'https://www.npmjs.com/package/surfview' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'First-party controls', link: '/guide/controls' },
            { text: 'Portable report scenes', link: '/guide/portable-scenes' },
          ],
        },
        {
          text: 'Core Concepts',
          collapsed: false,
          items: [
            { text: 'Viewer', link: '/guide/viewer' },
            { text: 'Surfaces', link: '/guide/surfaces' },
            { text: 'Atlas illustration', link: '/guide/atlas-illustration' },
            { text: 'Layers', link: '/guide/layers' },
            { text: 'Colormaps', link: '/guide/colormaps' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: false,
          items: [
            { text: 'Temporal Playback', link: '/guide/temporal' },
            { text: 'React Integration', link: '/guide/react' },
            { text: 'Events', link: '/guide/events' },
            { text: 'Performance', link: '/guide/performance' },
          ],
        },
      ],
      '/api/': [{ text: 'API Reference', items: apiSidebar() }],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/bbuchsbaum/surfviewjs' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/bbuchsbaum/surfviewjs/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024–present Bradley Buchsbaum',
    },

    outline: { level: [2, 3] },
  },

  vite: {
    resolve: {
      alias: {
        // The live demos import the library straight from source.
        surfview: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    },
  },

  // Agent docs / internal notes live under docs/ but are not part of the site.
  srcExclude: ['**/AGENTS.md'],
})
