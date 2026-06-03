<script setup lang="ts">
/**
 * Live, in-browser surfviewjs viewer. Renders a real GIFTI cortical surface with
 * the actual NeuroSurfaceViewer from the library — no screenshots, no video.
 *
 * All heavy, browser-only code (Three.js, the library, GIFTI parsing) is pulled in
 * via a dynamic import inside onMounted so it never executes during SSR / docs:build.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { MountOptions } from '../theme/lib'

const props = withDefaults(
  defineProps<{
    /** Surface URL. Defaults to the bundled fs_LR.32k inflated L surface. */
    surface?: string
    /** Overlay (func.gii) URL. Defaults to the bundled gaussian-splat demo. */
    overlay?: string
    /** Colormap for the data overlay. */
    colormap?: string
    /** Initial named viewpoint. */
    viewpoint?: string
    /** Stage height in px. */
    height?: number
    caption?: string
    /** Show the built-in Tweakpane control overlay. */
    showControls?: boolean
  }>(),
  {
    height: 480,
    colormap: 'Spectral',
    viewpoint: 'lateral',
    showControls: false,
  },
)

const el = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('Loading cortical surface…')
let handle: { destroy(): void } | undefined

onMounted(async () => {
  try {
    const lib = await import('../theme/lib')

    message.value = 'Parsing GIFTI…'
    const opts: MountOptions = {
      surface: props.surface,
      overlay: props.overlay,
      colormap: props.colormap,
      viewpoint: props.viewpoint,
      showControls: props.showControls,
    }

    message.value = 'Rendering…'
    handle = await lib.mountSurfaceViewer(el.value!, opts)
    state.value = 'ready'
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[SurfaceViewer]', err)
    state.value = 'error'
    message.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  try {
    handle?.destroy()
  } catch {
    /* viewer may not expose destroy(); ignore */
  }
})
</script>

<template>
  <figure class="surface-viewer">
    <div class="surface-viewer__stage" :style="{ height: `${height}px` }">
      <div ref="el" class="surface-viewer__canvas" />
      <div v-if="state !== 'ready'" class="surface-viewer__overlay" :class="state">
        <div v-if="state === 'loading'" class="surface-viewer__spinner" />
        <p>{{ state === 'error' ? '⚠ ' + message : message }}</p>
      </div>
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
