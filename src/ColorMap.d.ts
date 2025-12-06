export type ColorMapName = 'jet' | 'hot' | 'cool' | 'spring' | 'summer' | 'autumn' | 'winter' | 
  'bone' | 'copper' | 'greys' | 'greens' | 'blues' | 'reds' | 'YIGnBu' | 'RdBu' | 
  'picnic' | 'rainbow' | 'portland' | 'blackbody' | 'earth' | 'electric' |
  'viridis' | 'inferno' | 'magma' | 'plasma' | 'warm' | 'bathymetry' |
  'cdom' | 'chlorophyll' | 'density' | 'freesurface-blue' | 'freesurface-red' |
  'oxygen' | 'par' | 'phase' | 'salinity' | 'temperature' | 'turbidity' |
  'velocity-blue' | 'velocity-green' | 'cubehelix';

export interface ColorMapOptions {
  range?: [number, number];
  threshold?: [number, number];
  alpha?: number | number[];
}

export declare class ColorMap {
  colors: number[][];
  range: [number, number];
  threshold: [number, number];
  hasAlpha: boolean;
  alphaValues: number[] | null;

  constructor(colors: (string | number[])[], options?: ColorMapOptions);
  
  setRange(range: [number, number]): void;
  setThreshold(threshold: [number, number]): void;
  setAlpha(alpha?: number | number[]): void;
  getColor(value: number): number[];
  getColorArray(values: Float32Array | number[]): Float32Array;
  
  static fromPreset(name: ColorMapName | string, options?: ColorMapOptions): ColorMap;
  static fromArray(colors: (string | number[])[], options?: ColorMapOptions): ColorMap;
  static toHex(color: number | string): number;
  static getAvailableMaps(): string[];
  static isValidPreset(name: string): boolean;
  static presets: Record<string, (string | number[])[]>;
}
