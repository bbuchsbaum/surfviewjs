import { GeometryError } from './GeometryError';
import { GeodesicIndex } from './GeodesicIndex';
import { type SurfaceBoundaryCurve } from './SurfaceBoundaries';
import { evaluateSurfaceLocation, type SurfaceLocation, type SurfacePositionBinding } from './SurfaceLocation';

/** Independent editable copy: changing controls never silently relabels the source parcel graph. */
export class EditableSurfaceCurve {
  private controls: SurfaceLocation[];
  readonly closed: boolean;
  constructor(controls: readonly SurfaceLocation[], closed = false) {
    if (controls.length < 2 || controls.some(x => x.domain !== controls[0]!.domain)) throw new GeometryError('invalid-domain', 'Curve controls must share one domain');
    this.controls = [...controls]; this.closed = closed;
  }
  get locations(): readonly SurfaceLocation[] { return [...this.controls]; }
  move(index: number, location: SurfaceLocation): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.controls.length || location.domain !== this.controls[0]!.domain) throw new GeometryError('invalid-domain', 'Invalid curve control or domain');
    this.controls[index] = location;
    if (this.closed) { if (index === 0) this.controls[this.controls.length - 1] = location; else if (index === this.controls.length - 1) this.controls[0] = location; }
  }
  connect(index: GeodesicIndex): { locations: SurfaceLocation[]; lengthMm: number } {
    const locations: SurfaceLocation[] = []; let lengthMm = 0;
    for (let i = 1; i < this.controls.length; i++) {
      const path = index.shortestPathLocations(this.controls[i - 1]!, this.controls[i]!);
      if (!Number.isFinite(path.lengthMm)) throw new GeometryError('invalid-domain', 'Curve crosses disconnected surface components');
      locations.push(...(locations.length ? path.locations.slice(1) : path.locations)); lengthMm += path.lengthMm;
    }
    return { locations, lengthMm };
  }
}
export function boundaryCurveToEditable(curve: SurfaceBoundaryCurve): EditableSurfaceCurve { return new EditableSurfaceCurve(curve.locations, curve.closed); }
/** Local polyline coordinates; apply the mesh matrix only for world-space export. */
export function evaluateSurfacePolyline(locations: readonly SurfaceLocation[], binding: SurfacePositionBinding): Float64Array {
  const output = new Float64Array(locations.length * 3), point = new Float64Array(3);
  locations.forEach((location, i) => output.set(evaluateSurfaceLocation(location, binding, point), i * 3)); return output;
}
