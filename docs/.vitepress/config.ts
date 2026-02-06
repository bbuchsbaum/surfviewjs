import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SurfView.js',
  description: 'A modular Three.js-based brain surface visualization library',
  base: process.env.GITHUB_ACTIONS ? '/surfviewjs/' : '/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'Demo', link: 'https://bbuchsbaum.github.io/surfviewjs/demo/' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Quick Start', link: '/guide/quick-start' }
          ]
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Viewer', link: '/guide/viewer' },
            { text: 'Surfaces', link: '/guide/surfaces' },
            { text: 'Layers', link: '/guide/layers' },
            { text: 'Colormaps', link: '/guide/colormaps' }
          ]
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Temporal Playback', link: '/guide/temporal' },
            { text: 'React Integration', link: '/guide/react' },
            { text: 'Events', link: '/guide/events' },
            { text: 'Performance', link: '/guide/performance' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bbuchsbaum/surfviewjs' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024 Bradley Buchsbaum'
    },

    search: {
      provider: 'local'
    }
  }
})
