import type * as THREE from 'three';

export type SurfViewStylePresetName =
  | 'default'
  | 'presentation'
  | 'paper-light'
  | 'talk-dark'
  | 'clinical-qc'
  | 'retinotopy'
  | 'glass-brain-surface';

export type LabelDensity = 'none' | 'sparse' | 'normal' | 'dense';

export interface StylePresetBackground {
  css: string;
  clearColor: number;
  clearAlpha: number;
}

export interface StylePresetLighting {
  ambientColor: number;
  ambientIntensity: number;
  directionalColor: number;
  directionalIntensity: number;
  directionalPosition: [number, number, number];
  rimStrength: number;
  ssaoRadius: number;
  ssaoKernelSize: number;
}

export interface StylePresetMaterial {
  baseColor: THREE.ColorRepresentation;
  materialType: 'phong' | 'standard' | 'physical';
  metalness: number;
  roughness: number;
  alpha: number;
}

export interface StylePresetCurvature {
  brightness: number;
  contrast: number;
  smoothness: number;
}

export interface StylePresetROI {
  strokeColor: string;
  strokeWidth: number;
  labelDensity: LabelDensity;
  labelColor: string;
  labelFont: string;
}

export interface StylePresetAnnotation {
  radius: number;
  colorOn: number;
  colorOff: number;
  style: 'marker' | 'pin' | 'minimal';
}

export interface StylePresetColormaps {
  sequential: string;
  diverging: string;
  cyclic?: string;
  label?: string;
  curvature?: string;
}

export interface StylePresetFigure {
  width: number;
  height: number;
  dpi: number;
  transparent: boolean;
  colorbar: boolean;
  roiLabels: boolean;
  scaleBar: boolean;
  fontScale: number;
}

export interface SurfViewStylePreset {
  name: SurfViewStylePresetName;
  label: string;
  background: StylePresetBackground;
  lighting: StylePresetLighting;
  material: StylePresetMaterial;
  curvature: StylePresetCurvature;
  roi: StylePresetROI;
  annotation: StylePresetAnnotation;
  colormaps: StylePresetColormaps;
  figure: StylePresetFigure;
  labelDensity: LabelDensity;
  fontScale: number;
}

export interface FigureExportLabel {
  text: string;
  x: number;
  y: number;
  color?: string;
  background?: string;
  normalized?: boolean;
}

export interface FigureExportOptions {
  preset?: SurfViewStylePresetName | SurfViewStylePreset;
  width?: number;
  height?: number;
  dpi?: number;
  transparent?: boolean;
  colorbar?: boolean;
  colorbarLabel?: string;
  colorbarRange?: [number, number];
  colorbarColors?: string[];
  roiLabels?: boolean | FigureExportLabel[];
  scaleBar?: boolean;
  scaleBarLabel?: string;
  scaleBarLength?: number;
  fontScale?: number;
  backgroundColor?: number;
  title?: string;
  subtitle?: string;
  downloadFilename?: string;
}

export interface ResolvedFigureExportOptions {
  width: number;
  height: number;
  dpi: number;
  transparent: boolean;
  colorbar: boolean;
  colorbarLabel: string;
  colorbarRange?: [number, number];
  colorbarColors: string[];
  roiLabels: boolean | FigureExportLabel[];
  scaleBar: boolean;
  scaleBarLabel: string;
  scaleBarLength: number;
  fontScale: number;
  backgroundColor: number;
  title?: string;
  subtitle?: string;
  downloadFilename?: string;
  preset: SurfViewStylePreset;
}

const defaultLighting: StylePresetLighting = {
  ambientColor: 0xb5b5b5,
  ambientIntensity: 1.25,
  directionalColor: 0xffffff,
  directionalIntensity: 1.6,
  directionalPosition: [1, 1, 1],
  rimStrength: 0,
  ssaoRadius: 4,
  ssaoKernelSize: 32
};

const defaultFigure: StylePresetFigure = {
  width: 1800,
  height: 1350,
  dpi: 300,
  transparent: false,
  colorbar: false,
  roiLabels: false,
  scaleBar: false,
  fontScale: 1
};

export const STYLE_PRESETS: Record<SurfViewStylePresetName, SurfViewStylePreset> = {
  default: {
    name: 'default',
    label: 'Default',
    background: { css: '#000000', clearColor: 0x000000, clearAlpha: 1 },
    lighting: defaultLighting,
    material: {
      baseColor: 0xcccccc,
      materialType: 'phong',
      metalness: 0.1,
      roughness: 0.6,
      alpha: 1
    },
    curvature: { brightness: 0.5, contrast: 0.5, smoothness: 1 },
    roi: {
      strokeColor: '#ffd166',
      strokeWidth: 2,
      labelDensity: 'normal',
      labelColor: '#111827',
      labelFont: '12px sans-serif'
    },
    annotation: { radius: 0.75, colorOn: 0x00ff00, colorOff: 0xff0000, style: 'marker' },
    colormaps: { sequential: 'viridis', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: defaultFigure,
    labelDensity: 'normal',
    fontScale: 1
  },
  presentation: {
    name: 'presentation',
    label: 'Presentation',
    background: {
      css: 'linear-gradient(135deg, #f7f7f9 0%, #e3e7ed 100%)',
      clearColor: 0x000000,
      clearAlpha: 0
    },
    lighting: {
      ambientColor: 0xb0b0b0,
      ambientIntensity: 1.4,
      directionalColor: 0xffffff,
      directionalIntensity: 1.0,
      directionalPosition: [1.5, 1.2, 1],
      rimStrength: 0.35,
      ssaoRadius: 6,
      ssaoKernelSize: 32
    },
    material: {
      baseColor: 0xd0d4dc,
      materialType: 'physical',
      metalness: 0.05,
      roughness: 0.35,
      alpha: 1
    },
    curvature: { brightness: 0.54, contrast: 0.42, smoothness: 0.7 },
    roi: {
      strokeColor: '#f59e0b',
      strokeWidth: 2.5,
      labelDensity: 'normal',
      labelColor: '#111827',
      labelFont: '13px sans-serif'
    },
    annotation: { radius: 0.9, colorOn: 0x0ea5e9, colorOff: 0xef4444, style: 'pin' },
    colormaps: { sequential: 'viridis', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: { ...defaultFigure, width: 1920, height: 1080, colorbar: true, fontScale: 1.15 },
    labelDensity: 'normal',
    fontScale: 1.15
  },
  'paper-light': {
    name: 'paper-light',
    label: 'Paper Light',
    background: { css: '#ffffff', clearColor: 0xffffff, clearAlpha: 1 },
    lighting: {
      ambientColor: 0xd6d6d6,
      ambientIntensity: 1.25,
      directionalColor: 0xffffff,
      directionalIntensity: 1.2,
      directionalPosition: [1, 1.25, 1.4],
      rimStrength: 0.12,
      ssaoRadius: 4,
      ssaoKernelSize: 32
    },
    material: {
      baseColor: 0xd8dbe0,
      materialType: 'standard',
      metalness: 0,
      roughness: 0.72,
      alpha: 1
    },
    curvature: { brightness: 0.58, contrast: 0.34, smoothness: 0.55 },
    roi: {
      strokeColor: '#111827',
      strokeWidth: 1.8,
      labelDensity: 'sparse',
      labelColor: '#111827',
      labelFont: '11px sans-serif'
    },
    annotation: { radius: 0.72, colorOn: 0x0f766e, colorOff: 0xb91c1c, style: 'minimal' },
    colormaps: { sequential: 'viridis', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: { width: 2400, height: 1800, dpi: 300, transparent: true, colorbar: true, roiLabels: true, scaleBar: true, fontScale: 1 },
    labelDensity: 'sparse',
    fontScale: 1
  },
  'talk-dark': {
    name: 'talk-dark',
    label: 'Talk Dark',
    background: { css: '#0b0f14', clearColor: 0x0b0f14, clearAlpha: 1 },
    lighting: {
      ambientColor: 0x7f8da3,
      ambientIntensity: 1.35,
      directionalColor: 0xffffff,
      directionalIntensity: 1.65,
      directionalPosition: [1.2, 1.1, 0.9],
      rimStrength: 0.55,
      ssaoRadius: 6,
      ssaoKernelSize: 32
    },
    material: {
      baseColor: 0x9aa6b2,
      materialType: 'physical',
      metalness: 0.02,
      roughness: 0.42,
      alpha: 1
    },
    curvature: { brightness: 0.42, contrast: 0.52, smoothness: 0.7 },
    roi: {
      strokeColor: '#fbbf24',
      strokeWidth: 3,
      labelDensity: 'normal',
      labelColor: '#f8fafc',
      labelFont: '13px sans-serif'
    },
    annotation: { radius: 1.05, colorOn: 0x38bdf8, colorOff: 0xfb7185, style: 'pin' },
    colormaps: { sequential: 'magma', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: { width: 1920, height: 1080, dpi: 150, transparent: false, colorbar: true, roiLabels: true, scaleBar: true, fontScale: 1.25 },
    labelDensity: 'normal',
    fontScale: 1.25
  },
  'clinical-qc': {
    name: 'clinical-qc',
    label: 'Clinical QC',
    background: { css: '#f3f4f6', clearColor: 0xf3f4f6, clearAlpha: 1 },
    lighting: {
      ambientColor: 0xc7ccd4,
      ambientIntensity: 1.15,
      directionalColor: 0xffffff,
      directionalIntensity: 1.35,
      directionalPosition: [0.8, 1.4, 1.1],
      rimStrength: 0.2,
      ssaoRadius: 3,
      ssaoKernelSize: 16
    },
    material: {
      baseColor: 0xcbd5e1,
      materialType: 'standard',
      metalness: 0,
      roughness: 0.78,
      alpha: 1
    },
    curvature: { brightness: 0.52, contrast: 0.45, smoothness: 0.6 },
    roi: {
      strokeColor: '#dc2626',
      strokeWidth: 2.2,
      labelDensity: 'dense',
      labelColor: '#111827',
      labelFont: '12px sans-serif'
    },
    annotation: { radius: 0.8, colorOn: 0x2563eb, colorOff: 0xdc2626, style: 'marker' },
    colormaps: { sequential: 'viridis', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: { width: 1800, height: 1200, dpi: 200, transparent: false, colorbar: true, roiLabels: true, scaleBar: true, fontScale: 1 },
    labelDensity: 'dense',
    fontScale: 1
  },
  retinotopy: {
    name: 'retinotopy',
    label: 'Retinotopy',
    background: { css: '#111111', clearColor: 0x111111, clearAlpha: 1 },
    lighting: {
      ambientColor: 0x9ca3af,
      ambientIntensity: 1.2,
      directionalColor: 0xffffff,
      directionalIntensity: 1.25,
      directionalPosition: [1, 1, 1.3],
      rimStrength: 0.28,
      ssaoRadius: 4,
      ssaoKernelSize: 32
    },
    material: {
      baseColor: 0xb8bec8,
      materialType: 'standard',
      metalness: 0,
      roughness: 0.58,
      alpha: 1
    },
    curvature: { brightness: 0.38, contrast: 0.62, smoothness: 0.45 },
    roi: {
      strokeColor: '#ffffff',
      strokeWidth: 2,
      labelDensity: 'dense',
      labelColor: '#ffffff',
      labelFont: '12px sans-serif'
    },
    annotation: { radius: 0.85, colorOn: 0xffffff, colorOff: 0x94a3b8, style: 'minimal' },
    colormaps: { sequential: 'hsv', diverging: 'RdBu', cyclic: 'hsv', label: 'glasbey', curvature: 'gray' },
    figure: { width: 2200, height: 1600, dpi: 300, transparent: false, colorbar: true, roiLabels: true, scaleBar: false, fontScale: 1.05 },
    labelDensity: 'dense',
    fontScale: 1.05
  },
  'glass-brain-surface': {
    name: 'glass-brain-surface',
    label: 'Glass Surface',
    background: { css: '#f8fafc', clearColor: 0xf8fafc, clearAlpha: 1 },
    lighting: {
      ambientColor: 0xdbeafe,
      ambientIntensity: 1.2,
      directionalColor: 0xffffff,
      directionalIntensity: 1.45,
      directionalPosition: [1.4, 1.1, 1.2],
      rimStrength: 0.45,
      ssaoRadius: 5,
      ssaoKernelSize: 32
    },
    material: {
      baseColor: 0xdbeafe,
      materialType: 'physical',
      metalness: 0,
      roughness: 0.18,
      alpha: 0.62
    },
    curvature: { brightness: 0.6, contrast: 0.26, smoothness: 0.8 },
    roi: {
      strokeColor: '#2563eb',
      strokeWidth: 2.4,
      labelDensity: 'sparse',
      labelColor: '#0f172a',
      labelFont: '12px sans-serif'
    },
    annotation: { radius: 0.8, colorOn: 0x2563eb, colorOff: 0x64748b, style: 'pin' },
    colormaps: { sequential: 'viridis', diverging: 'RdBu', label: 'glasbey', curvature: 'gray' },
    figure: { width: 2200, height: 1500, dpi: 300, transparent: true, colorbar: true, roiLabels: true, scaleBar: true, fontScale: 1.05 },
    labelDensity: 'sparse',
    fontScale: 1.05
  }
};

export function listStylePresets(): SurfViewStylePresetName[] {
  return Object.keys(STYLE_PRESETS) as SurfViewStylePresetName[];
}

export function getStylePreset(name: SurfViewStylePresetName): SurfViewStylePreset {
  return cloneStylePreset(STYLE_PRESETS[name]);
}

export function resolveStylePreset(preset: SurfViewStylePresetName | SurfViewStylePreset | undefined): SurfViewStylePreset {
  if (!preset) return getStylePreset('default');
  if (typeof preset === 'string') {
    const style = STYLE_PRESETS[preset];
    if (!style) {
      throw new Error(`Unknown SurfView style preset: ${preset}`);
    }
    return cloneStylePreset(style);
  }
  return cloneStylePreset(preset);
}

export function resolveFigureExportOptions(
  presetOrName: SurfViewStylePresetName | SurfViewStylePreset | undefined,
  options: FigureExportOptions = {},
  fallbackSize: { width: number; height: number } = { width: defaultFigure.width, height: defaultFigure.height }
): ResolvedFigureExportOptions {
  const preset = resolveStylePreset(options.preset ?? presetOrName);
  const figure = preset.figure;
  const width = positiveInteger(options.width, figure.width || fallbackSize.width, 'width');
  const height = positiveInteger(options.height, figure.height || fallbackSize.height, 'height');
  const dpi = positiveInteger(options.dpi, figure.dpi, 'dpi');
  const fontScale = finitePositive(options.fontScale, figure.fontScale, 'fontScale');

  return {
    width,
    height,
    dpi,
    transparent: options.transparent ?? figure.transparent,
    colorbar: options.colorbar ?? figure.colorbar,
    colorbarLabel: options.colorbarLabel ?? 'Value',
    colorbarRange: options.colorbarRange,
    colorbarColors: options.colorbarColors ?? defaultColorbarColors(preset),
    roiLabels: options.roiLabels ?? figure.roiLabels,
    scaleBar: options.scaleBar ?? figure.scaleBar,
    scaleBarLabel: options.scaleBarLabel ?? '',
    scaleBarLength: finitePositive(options.scaleBarLength, 0.18, 'scaleBarLength'),
    fontScale,
    backgroundColor: options.backgroundColor ?? preset.background.clearColor,
    title: options.title,
    subtitle: options.subtitle,
    downloadFilename: options.downloadFilename,
    preset
  };
}

function defaultColorbarColors(preset: SurfViewStylePreset): string[] {
  if (preset.colormaps.diverging === 'RdBu') {
    return ['#2166ac', '#f7f7f7', '#b2182b'];
  }
  if (preset.colormaps.sequential === 'magma') {
    return ['#000004', '#b73779', '#fcfdbf'];
  }
  if (preset.colormaps.sequential === 'hsv' || preset.colormaps.cyclic === 'hsv') {
    return ['#ff0000', '#ffff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'];
  }
  return ['#440154', '#21908c', '#fde725'];
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`Figure export ${label} must be a positive number`);
  }
  return Math.round(resolved);
}

function finitePositive(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`Figure export ${label} must be a positive number`);
  }
  return resolved;
}

function cloneStylePreset(preset: SurfViewStylePreset): SurfViewStylePreset {
  return {
    ...preset,
    background: { ...preset.background },
    lighting: {
      ...preset.lighting,
      directionalPosition: [...preset.lighting.directionalPosition]
    },
    material: { ...preset.material },
    curvature: { ...preset.curvature },
    roi: { ...preset.roi },
    annotation: { ...preset.annotation },
    colormaps: { ...preset.colormaps },
    figure: { ...preset.figure }
  };
}
