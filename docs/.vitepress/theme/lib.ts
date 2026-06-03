/**
 * Client-only helpers for the live <SurfaceViewer /> embeds.
 *
 * IMPORTANT: this module statically imports Three.js / WebGL-dependent code, so it
 * must NEVER be imported at the top level of a component or theme file. Pull it in
 * only via a dynamic `await import('../theme/lib')` from inside `onMounted`, which
 * runs exclusively on the client and keeps it out of the SSR / `docs:build` bundle.
 */
import { gunzipSync, unzlibSync } from 'fflate'
import {
  NeuroSurfaceViewer,
  MultiLayerNeuroSurface,
  DataLayer,
  loadSurface,
} from 'surfview'

export interface MountOptions {
  /** Surface geometry URL (GIFTI). Defaults to the bundled fs_LR.32k inflated L surface. */
  surface?: string
  /** Functional overlay URL (GIFTI metric). Defaults to the bundled gaussian-splat demo. */
  overlay?: string
  /** Colormap for the data overlay. */
  colormap?: string
  /** Initial named viewpoint (e.g. 'lateral', 'medial', 'dorsal'). */
  viewpoint?: string
  /** Show the built-in Tweakpane control overlay. */
  showControls?: boolean
}

export interface ViewerHandle {
  destroy(): void
}

// ---------------------------------------------------------------------------
// GIFTI metric (func.gii) parsing — mirrors the repo's demo loader.
// ---------------------------------------------------------------------------

function base64ToUint8(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '')
  const binary = atob(clean)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toTypedArray(buffer: ArrayBuffer, dataType: string): Float32Array | Uint32Array {
  switch (dataType) {
    case 'NIFTI_TYPE_INT32':
      return new Uint32Array(buffer)
    case 'NIFTI_TYPE_FLOAT32':
    default:
      return new Float32Array(buffer)
  }
}

function parseGiiDataArray(dataArray: Element): Float32Array | Uint32Array | null {
  const dataType = dataArray.getAttribute('DataType') || ''
  const encoding = dataArray.getAttribute('Encoding') || 'ASCII'
  const data = dataArray.getElementsByTagName('Data')[0]
  if (!data || !data.textContent) return null

  const text = data.textContent.trim()

  if (encoding === 'ASCII') {
    const values = text.split(/\s+/).filter(Boolean).map(parseFloat)
    return new Float32Array(values)
  }

  if (encoding === 'Base64Binary') {
    return toTypedArray(base64ToUint8(text).buffer, dataType)
  }

  if (encoding === 'GZipBase64Binary') {
    const compressed = base64ToUint8(text)
    let unzipped: Uint8Array
    try {
      unzipped = gunzipSync(compressed)
    } catch {
      unzipped = unzlibSync(compressed)
    }
    const buffer = new ArrayBuffer(unzipped.byteLength)
    new Uint8Array(buffer).set(unzipped)
    return toTypedArray(buffer, dataType)
  }

  return null
}

async function loadMetric(url: string): Promise<Float32Array> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Could not fetch overlay (${resp.status}) — ${url}`)
  const text = await resp.text()

  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const dataArrays = Array.from(doc.getElementsByTagName('DataArray'))
  const metricArray =
    dataArrays.find((da) => {
      const intent = (da.getAttribute('Intent') || '').toUpperCase()
      return intent.includes('INTENT_SHAPE') || intent.includes('INTENT_SCALAR')
    }) ?? dataArrays[0]
  if (!metricArray) throw new Error('No metric DataArray found in overlay')

  const parsed = parseGiiDataArray(metricArray)
  if (!parsed) throw new Error('Failed to parse overlay metric array')

  const out = new Float32Array(parsed.length)
  for (let i = 0; i < parsed.length; i++) {
    const v = (parsed as ArrayLike<number>)[i]
    out[i] = Number.isFinite(v) ? v : 0
  }
  return out
}

function computeRange(data: Float32Array): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return [0, 1]
  return [min, max]
}

/** Load a surface (+ optional overlay) and mount an interactive viewer into `el`. */
export async function mountSurfaceViewer(
  el: HTMLElement,
  opts: MountOptions = {},
): Promise<ViewerHandle> {
  const base = import.meta.env.BASE_URL
  const surfaceUrl = opts.surface ?? `${base}data/fs_LR.32k.L.inflated.surf.gii`
  const overlayUrl = opts.overlay ?? `${base}data/gaussian_splat_demo.func.gii`
  const colormap = opts.colormap ?? 'Spectral'

  const width = el.clientWidth || el.parentElement?.clientWidth || 480
  const height = el.clientHeight || el.parentElement?.clientHeight || 480

  const viewer = new NeuroSurfaceViewer(
    el,
    width,
    height,
    {
      showControls: opts.showControls ?? false,
      useControls: false,
      backgroundColor: 0x06080b,
      ambientLightColor: 0x404040,
    },
    opts.viewpoint ?? 'lateral',
  )
  viewer.startRenderLoop()

  const [geometry, metric] = await Promise.all([
    loadSurface(surfaceUrl, 'gifti', 'left', 30000, true, 120),
    loadMetric(overlayUrl),
  ])

  const surface = new MultiLayerNeuroSurface(geometry, {
    baseColor: 0xd9d9e3,
    useGPUCompositing: true,
  })
  viewer.addSurface(surface, 'cortex')
  viewer.centerCamera()

  const layer = new DataLayer('overlay', metric, null, colormap, {
    range: computeRange(metric),
    opacity: 0.92,
    threshold: [0, 0],
    blendMode: 'normal',
  })
  viewer.addLayer('cortex', layer)
  viewer.requestRender()

  const handleResize = () => viewer.resize(el.clientWidth, el.clientHeight)
  window.addEventListener('resize', handleResize)

  return {
    destroy() {
      window.removeEventListener('resize', handleResize)
      try {
        viewer.dispose()
      } catch {
        /* viewer may already be torn down; ignore */
      }
    },
  }
}
