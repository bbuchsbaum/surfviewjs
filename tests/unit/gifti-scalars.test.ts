import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { gzipSync, zlibSync } from 'fflate';
import { parseGIfTIScalars, SurfaceLoadError } from '../../src/loaders';

const parser = new JSDOM().window.DOMParser;
function array(options: { encoding?:string; endian?:string; dims?:number[]; order?:string; type?:string; intent?:string; values?:number[]; payload?:string } = {}) {
  const { encoding='ASCII', endian='LittleEndian', dims=[3], order='RowMajorOrder', type='NIFTI_TYPE_FLOAT32', intent='NIFTI_INTENT_SHAPE', values=[-2,0,3] } = options;
  const bytes = new Uint8Array(values.length*4);
  const view = new DataView(bytes.buffer);
  values.forEach((value,index) => view.setFloat32(index*4,value,endian==='LittleEndian'));
  const payload = options.payload ?? (encoding==='ASCII' ? values.join(' ') : Buffer.from(encoding==='GZipBase64Binary'?gzipSync(bytes):bytes).toString('base64'));
  return `<DataArray Intent="${intent}" DataType="${type}" ArrayIndexingOrder="${order}" Dimensionality="${dims.length}" ${dims.map((n,i)=>`Dim${i}="${n}"`).join(' ')} Encoding="${encoding}" Endian="${endian}"><Data>${payload}</Data></DataArray>`;
}
const xml = (...arrays:string[]) => `<GIFTI Version="1.0" NumberOfDataArrays="${arrays.length}">${arrays.join('')}</GIFTI>`;

describe('per-vertex GIFTI scalars', () => {
  it.each(['ASCII','Base64Binary','GZipBase64Binary'])('decodes %s with negative values and genuine zeros', encoding => {
    expect(Array.from(parseGIfTIScalars(xml(array({ encoding })), parser) as Float32Array)).toEqual([-2,0,3]);
  });
  it('decodes big endian and zlib-framed compatibility payloads', () => {
    expect(Array.from(parseGIfTIScalars(xml(array({ encoding:'Base64Binary', endian:'BigEndian' })), parser) as Float32Array)).toEqual([-2,0,3]);
    const warning = vi.spyOn(console,'warn').mockImplementation(()=>{});
    try {
      const bytes = new Uint8Array(new Float32Array([-2,0,3]).buffer);
      const data = parseGIfTIScalars(xml(array({ encoding:'GZipBase64Binary', payload:Buffer.from(zlibSync(bytes)).toString('base64') })), parser);
      expect(Array.from(data as Float32Array)).toEqual([-2,0,3]);
    } finally { warning.mockRestore(); }
  });
  it('preserves array order and splits row/column-major N×T matrices into vertex vectors', () => {
    const result = parseGIfTIScalars(xml(array(), array({ dims:[3,2], values:[1,10,2,20,3,30] })), parser) as Float32Array[];
    expect(result.map(values=>Array.from(values))).toEqual([[-2,0,3],[1,2,3],[10,20,30]]);
    const column = parseGIfTIScalars(xml(array({ dims:[3,2], order:'ColumnMajorOrder', values:[1,2,3,10,20,30] })), parser) as Float32Array[];
    expect(column.map(values=>Array.from(values))).toEqual([[1,2,3],[10,20,30]]);
  });
  it('preserves missing Float32 values as NaN', () => {
    for (const encoding of ['ASCII','Base64Binary','GZipBase64Binary']) {
      const values = parseGIfTIScalars(xml(array({ encoding, values:[1,NaN,0] })),parser) as Float32Array;
      expect(values[1]).toBeNaN();
      expect(values[2]).toBe(0);
    }
  });
  it('loads the existing sulcal-depth and functional fixtures', () => {
    for (const file of ['fs_LR.32k.L.sulcal_depth.shape.gii','SensorimotorAssociation_Axis_LH.fslr32k.func.gii','gaussian_splat_demo.func.gii']) {
      const result = parseGIfTIScalars(readFileSync(`tests/data/${file}`,'utf8'),parser);
      expect(result).toBeInstanceOf(Float32Array);
      expect((result as Float32Array).length).toBeGreaterThan(1000);
    }
  });
  it.each([
    { intent:'NIFTI_INTENT_POINTSET' }, { intent:'NIFTI_INTENT_LABEL' },
    { dims:[3,0] }, { dims:[3,1,1] }, { order:'UnknownOrder' },
    { type:'NIFTI_TYPE_COMPLEX64' }, { values:[1,Infinity,3] },
    { payload:'1 2' }, { payload:'1 2 3 4' },
    { encoding:'ExternalFileBinary' }, { encoding:'Base64Binary', payload:'AA==' },
    { encoding:'GZipBase64Binary', dims:[2] }, { encoding:'GZipBase64Binary', payload:'AA==' }
  ])('rejects malformed arrays %j with typed errors', options => {
    expect(()=>parseGIfTIScalars(xml(array(options)),parser)).toThrow(SurfaceLoadError);
  });
  it('decodes Float64 and integer scalars, rejecting integer range violations and Float32 overflow', () => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    [-2.5,0,3.25].forEach((v,i)=>view.setFloat64(i*8,v,false));
    const decoded = parseGIfTIScalars(xml(array({ type:'NIFTI_TYPE_FLOAT64', encoding:'GZipBase64Binary', endian:'BigEndian', payload:Buffer.from(gzipSync(bytes)).toString('base64') })),parser) as Float32Array;
    expect(Array.from(decoded)).toEqual([-2.5,0,3.25]);
    expect(Array.from(parseGIfTIScalars(xml(array({ type:'NIFTI_TYPE_INT16', values:[-2,0,3] })),parser) as Float32Array)).toEqual([-2,0,3]);
    for (const values of [[256,0,3],[-1,0,3],[0.5,0,3],[NaN,0,3]]) {
      expect(()=>parseGIfTIScalars(xml(array({ type:'NIFTI_TYPE_UINT8',values })),parser)).toThrow(SurfaceLoadError);
    }
    expect(()=>parseGIfTIScalars(xml(array({ type:'NIFTI_TYPE_FLOAT64', values:[1e100,0,3] })),parser)).toThrow(/Float32/);
    expect(()=>parseGIfTIScalars(xml(array({ dims:[1,65537] })),parser)).toThrow(/safety limit/);
    expect(()=>parseGIfTIScalars(xml(array({ dims:[10000001] })),parser)).toThrow(SurfaceLoadError);
  });

  it('rejects mismatched vertex counts, invalid XML/root and declared array count', () => {
    expect(()=>parseGIfTIScalars(xml(array(),array({ dims:[2],values:[1,2] })),parser)).toThrow(/share a vertex count/);
    expect(()=>parseGIfTIScalars(xml(array()).replace('NumberOfDataArrays="1"','NumberOfDataArrays="2"'),parser)).toThrow(/NumberOfDataArrays/);
    expect(()=>parseGIfTIScalars('<WRONG><DataArray /></WRONG>',parser)).toThrow(/root/);
    expect(()=>parseGIfTIScalars('<GIFTI><DataArray></GIFTI>',parser)).toThrow(/parse error/);
  });
});
