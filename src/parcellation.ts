export type AtlasRepresentation = 'volume' | 'surface' | 'derived';
export type AtlasConfidence = 'exact' | 'high' | 'approximate' | 'uncertain';

export interface AtlasRef {
  family: string;
  model: string;
  representation: AtlasRepresentation;
  template_space?: string | null;
  coord_space?: string | null;
  resolution?: string | null;
  density?: string | null;
  provenance?: string | null;
  source?: string | null;
  lineage?: string | null;
  confidence: AtlasConfidence;
  notes?: string | null;
}

export interface ParcelAtlasMetadata {
  id: string;
  name: string;
  version?: string | null;
  space?: string | null;
  n_parcels?: number;

  // Additional atlas metadata used by neuroatlas::as_parcel_data.atlas()
  family?: string;
  model?: string;
  representation?: AtlasRepresentation;
  coord_space?: string | null;
  confidence?: AtlasConfidence;
}

export interface ParcelRecord {
  id: number;
  label: string;
  hemi: string | null;
  [key: string]: unknown;
}

export interface ParcelData {
  schema_version: string;
  atlas: ParcelAtlasMetadata;
  parcels: ParcelRecord[];
}

export interface ParcelValidationOptions {
  strict?: boolean;
}

const VALID_REPRESENTATIONS: AtlasRepresentation[] = ['volume', 'surface', 'derived'];
const VALID_CONFIDENCE: AtlasConfidence[] = ['exact', 'high', 'approximate', 'uncertain'];

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`'${field}' must be a non-empty string`);
  }
}

function asVertexLabelArray(vertexLabels: Uint32Array | Int32Array | number[]): Uint32Array {
  if (vertexLabels instanceof Uint32Array) {
    return vertexLabels;
  }
  if (vertexLabels instanceof Int32Array) {
    return new Uint32Array(vertexLabels);
  }
  return new Uint32Array(vertexLabels);
}

export function validateAtlasRef(ref: AtlasRef): AtlasRef {
  assertNonEmptyString(ref.family, 'family');
  assertNonEmptyString(ref.model, 'model');

  if (!VALID_REPRESENTATIONS.includes(ref.representation)) {
    throw new Error(`'representation' must be one of: ${VALID_REPRESENTATIONS.join(', ')}`);
  }
  if (!VALID_CONFIDENCE.includes(ref.confidence)) {
    throw new Error(`'confidence' must be one of: ${VALID_CONFIDENCE.join(', ')}`);
  }

  return ref;
}

/**
 * Validate a parcel-level data object.
 *
 * Mirrors the core structure/invariants of neuroatlas::validate_parcel_data().
 */
export function validateParcelData(
  data: ParcelData,
  options: ParcelValidationOptions = {}
): ParcelData {
  const strict = options.strict ?? true;

  if (!data || typeof data !== 'object') {
    throw new Error('parcel data must be an object');
  }
  if (typeof data.schema_version !== 'string' || data.schema_version.length === 0) {
    throw new Error("'schema_version' must be a non-empty string");
  }

  if (!data.atlas || typeof data.atlas !== 'object') {
    throw new Error("'atlas' must be an object");
  }
  assertNonEmptyString(data.atlas.id, 'atlas.id');

  if (!Array.isArray(data.parcels)) {
    throw new Error("'parcels' must be an array");
  }

  const ids = new Set<number>();
  for (let i = 0; i < data.parcels.length; i++) {
    const row = data.parcels[i];
    const rowId = `${i}`;

    if (!row || typeof row !== 'object') {
      throw new Error(`parcels[${rowId}] must be an object`);
    }
    if (!isFiniteInteger(row.id)) {
      throw new Error(`parcels[${rowId}].id must be a finite integer`);
    }
    if (ids.has(row.id)) {
      throw new Error(`parcel ids must be unique; duplicate id '${row.id}'`);
    }
    ids.add(row.id);

    if (typeof row.label !== 'string') {
      throw new Error(`parcels[${rowId}].label must be a string`);
    }
    if (!(typeof row.hemi === 'string' || row.hemi === null || row.hemi === undefined)) {
      throw new Error(`parcels[${rowId}].hemi must be a string, null, or undefined`);
    }
  }

  if (strict && typeof data.atlas.n_parcels === 'number') {
    if (!isFiniteInteger(data.atlas.n_parcels)) {
      throw new Error("'atlas.n_parcels' must be an integer when provided");
    }
    if (data.atlas.n_parcels !== data.parcels.length) {
      throw new Error("'atlas.n_parcels' does not match parcel row count");
    }
  }

  if (data.atlas.representation !== undefined && data.atlas.representation !== null) {
    if (!VALID_REPRESENTATIONS.includes(data.atlas.representation)) {
      throw new Error(`'atlas.representation' must be one of: ${VALID_REPRESENTATIONS.join(', ')}`);
    }
  }

  if (data.atlas.confidence !== undefined && data.atlas.confidence !== null) {
    if (!VALID_CONFIDENCE.includes(data.atlas.confidence)) {
      throw new Error(`'atlas.confidence' must be one of: ${VALID_CONFIDENCE.join(', ')}`);
    }
  }

  return data;
}

export function buildParcelLookup(parcelData: ParcelData): Map<number, ParcelRecord> {
  validateParcelData(parcelData);

  const lookup = new Map<number, ParcelRecord>();
  for (const row of parcelData.parcels) {
    lookup.set(row.id, row);
  }
  return lookup;
}

function coerceNumericValue(value: unknown, fieldName: string): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  if (typeof value !== 'number') {
    throw new Error(`Parcel value '${fieldName}' must be numeric`);
  }
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Map one parcel-level numeric column to all vertices via per-vertex parcel IDs.
 *
 * Missing parcel ids produce NaN values (transparent in DataLayer rendering).
 */
export function mapParcelValuesToVertices(
  vertexLabels: Uint32Array | Int32Array | number[],
  parcelData: ParcelData,
  valueColumn: string = 'value'
): Float32Array {
  if (typeof valueColumn !== 'string' || valueColumn.length === 0) {
    throw new Error("'valueColumn' must be a non-empty string");
  }

  const labels = asVertexLabelArray(vertexLabels);
  const lookup = buildParcelLookup(parcelData);
  const out = new Float32Array(labels.length);

  for (let i = 0; i < labels.length; i++) {
    const row = lookup.get(labels[i]);
    if (!row) {
      out[i] = Number.NaN;
      continue;
    }

    out[i] = coerceNumericValue(row[valueColumn], valueColumn);
  }

  return out;
}

/**
 * Return a value vector aligned to an explicit parcel id order.
 * Missing parcel ids produce NaN.
 */
export function parcelValuesInOrder(
  parcelData: ParcelData,
  orderedParcelIds: ArrayLike<number>,
  valueColumn: string = 'value'
): Float32Array {
  if (typeof valueColumn !== 'string' || valueColumn.length === 0) {
    throw new Error("'valueColumn' must be a non-empty string");
  }

  const lookup = buildParcelLookup(parcelData);
  const out = new Float32Array(orderedParcelIds.length);

  for (let i = 0; i < orderedParcelIds.length; i++) {
    const row = lookup.get(orderedParcelIds[i]);
    if (!row) {
      out[i] = Number.NaN;
      continue;
    }
    out[i] = coerceNumericValue(row[valueColumn], valueColumn);
  }

  return out;
}
