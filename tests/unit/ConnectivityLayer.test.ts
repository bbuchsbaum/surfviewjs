import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectivityLayer } from '../../src/ConnectivityLayer';
import type { ConnectivityEdge, CSRData } from '../../src/ConnectivityLayer';
import { Layer } from '../../src/layers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEdges(n: number): ConnectivityEdge[] {
  const edges: ConnectivityEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({ source: i, target: i + 1, weight: (i + 1) * 0.1 });
  }
  return edges;
}

function makeVertices(n: number): Float32Array {
  // Place vertices along x-axis: v0=(0,0,0), v1=(1,0,0), ...
  const verts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    verts[i * 3] = i;
    verts[i * 3 + 1] = 0;
    verts[i * 3 + 2] = 0;
  }
  return verts;
}

function makeMockSurface(vertexCount: number) {
  const vertices = makeVertices(vertexCount);
  const mesh = {
    add: (_obj: any) => {},
    remove: (_obj: any) => {}
  };
  return { geometry: { vertices }, mesh };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectivityLayer', () => {

  // --- Construction ---------------------------------------------------------

  describe('construction', () => {
    it('creates with valid edges', () => {
      const edges = makeEdges(5);
      const layer = new ConnectivityLayer('test', edges);
      expect(layer.id).toBe('test');
      expect(layer.getEdgeCount()).toBe(5);
      expect(layer.getRenderMode()).toBe('tube');
      expect(layer.getShowNodes()).toBe(true);
    });

    it('throws on empty edges', () => {
      expect(() => new ConnectivityLayer('bad', [])).toThrow('non-empty');
    });

    it('throws on negative vertex index', () => {
      expect(() => new ConnectivityLayer('bad', [
        { source: -1, target: 2, weight: 1 }
      ])).toThrow('negative');
    });

    it('infers weight range from edges', () => {
      const edges = [
        { source: 0, target: 1, weight: 0.3 },
        { source: 1, target: 2, weight: 0.9 },
        { source: 2, target: 3, weight: -0.6 }
      ];
      const layer = new ConnectivityLayer('wr', edges);
      const [lo, hi] = layer.getWeightRange();
      expect(lo).toBeCloseTo(0.3, 5);
      expect(hi).toBeCloseTo(0.9, 5);
    });

    it('accepts custom config', () => {
      const layer = new ConnectivityLayer('cfg', makeEdges(3), {
        renderMode: 'line',
        showNodes: false,
        opacity: 0.5,
        threshold: 0.15,
        topN: 2,
        colorMap: 'viridis'
      });
      expect(layer.getRenderMode()).toBe('line');
      expect(layer.getShowNodes()).toBe(false);
      expect(layer.opacity).toBeCloseTo(0.5, 5);
      expect(layer.getThreshold()).toBe(0.15);
      expect(layer.getTopN()).toBe(2);
      expect(layer.getColorMapName()).toBe('viridis');
    });
  });

  // --- getRGBAData ----------------------------------------------------------

  describe('getRGBAData', () => {
    it('returns zeroed buffer (non-compositing)', () => {
      const layer = new ConnectivityLayer('rgba', makeEdges(3));
      const buf = layer.getRGBAData(100);
      expect(buf.length).toBe(400);
      expect(buf.every(v => v === 0)).toBe(true);
    });
  });

  // --- Filtering ------------------------------------------------------------

  describe('filtering', () => {
    const edges: ConnectivityEdge[] = [
      { source: 0, target: 1, weight: 0.1 },
      { source: 1, target: 2, weight: 0.5 },
      { source: 2, target: 3, weight: 0.9 },
      { source: 3, target: 4, weight: 0.3 },
      { source: 4, target: 5, weight: 0.7 }
    ];

    it('threshold filters by |weight|', () => {
      const layer = new ConnectivityLayer('th', edges, { threshold: 0.5 });
      expect(layer.getEdgeCount()).toBe(3); // 0.5, 0.9, 0.7
    });

    it('topN keeps highest-weight edges', () => {
      const layer = new ConnectivityLayer('top', edges, { topN: 2 });
      expect(layer.getEdgeCount()).toBe(2);
      const filtered = layer.getFilteredEdges();
      expect(filtered[0].weight).toBe(0.9);
      expect(filtered[1].weight).toBe(0.7);
    });

    it('regionFilter keeps edges touching specified vertices', () => {
      const layer = new ConnectivityLayer('rf', edges, { regionFilter: [0, 1] });
      // Edges touching vertex 0 or 1: (0,1), (1,2)
      expect(layer.getEdgeCount()).toBe(2);
    });

    it('combines threshold + topN + regionFilter', () => {
      const layer = new ConnectivityLayer('combo', edges, {
        threshold: 0.2,
        regionFilter: [1, 2, 3, 4, 5],
        topN: 2
      });
      // After threshold (>=0.2): 0.5, 0.9, 0.3, 0.7 (drop 0.1)
      // After regionFilter (touches 1-5): 0.5, 0.9, 0.3, 0.7 (all)
      // After topN=2: 0.9, 0.7
      expect(layer.getEdgeCount()).toBe(2);
    });

    it('negative weights use absolute value for threshold', () => {
      const neg = [
        { source: 0, target: 1, weight: -0.8 },
        { source: 1, target: 2, weight: 0.2 }
      ];
      const layer = new ConnectivityLayer('neg', neg, { threshold: 0.5 });
      expect(layer.getEdgeCount()).toBe(1);
      expect(layer.getFilteredEdges()[0].weight).toBe(-0.8);
    });
  });

  // --- Update ---------------------------------------------------------------

  describe('update', () => {
    it('updates threshold and rebuilds filters', () => {
      const layer = new ConnectivityLayer('upd', makeEdges(5));
      expect(layer.getEdgeCount()).toBe(5);
      layer.update({ threshold: 0.35 });
      // weights: 0.1, 0.2, 0.3, 0.4, 0.5 → keep 0.4, 0.5
      expect(layer.getEdgeCount()).toBe(2);
    });

    it('updates renderMode', () => {
      const layer = new ConnectivityLayer('rm', makeEdges(3));
      expect(layer.getRenderMode()).toBe('tube');
      layer.update({ renderMode: 'line' });
      expect(layer.getRenderMode()).toBe('line');
    });

    it('updates showNodes', () => {
      const layer = new ConnectivityLayer('sn', makeEdges(3));
      expect(layer.getShowNodes()).toBe(true);
      layer.update({ showNodes: false });
      expect(layer.getShowNodes()).toBe(false);
    });

    it('updates opacity', () => {
      const layer = new ConnectivityLayer('op', makeEdges(3));
      layer.update({ opacity: 0.3 });
      expect(layer.opacity).toBeCloseTo(0.3, 5);
    });

    it('updates edges entirely', () => {
      const layer = new ConnectivityLayer('ed', makeEdges(3));
      layer.update({ edges: makeEdges(10) });
      expect(layer.getEdgeCount()).toBe(10);
    });

    it('throws on empty edges update', () => {
      const layer = new ConnectivityLayer('bad', makeEdges(3));
      expect(() => layer.update({ edges: [] })).toThrow('non-empty');
    });
  });

  // --- Static factories -----------------------------------------------------

  describe('fromMatrix', () => {
    it('creates from 2D number array', () => {
      const matrix = [
        [0, 0.5, 0.3],
        [0.5, 0, 0.8],
        [0.3, 0.8, 0]
      ];
      const layer = ConnectivityLayer.fromMatrix('mat', matrix);
      // Upper triangle: (0,1)=0.5, (0,2)=0.3, (1,2)=0.8
      expect(layer.getEdgeCount()).toBe(3);
    });

    it('creates from flat Float32Array', () => {
      const flat = new Float32Array([
        0, 0.5, 0,
        0.5, 0, 0.7,
        0, 0.7, 0
      ]);
      const layer = ConnectivityLayer.fromMatrix('flat', flat);
      expect(layer.getEdgeCount()).toBe(2);
    });

    it('applies vertexIndices mapping', () => {
      const matrix = [
        [0, 1.0],
        [1.0, 0]
      ];
      const layer = ConnectivityLayer.fromMatrix('vi', matrix, {
        vertexIndices: [10, 20]
      });
      const edges = layer.getFilteredEdges();
      expect(edges[0].source).toBe(10);
      expect(edges[0].target).toBe(20);
    });

    it('throws on all-zero matrix', () => {
      const matrix = [[0, 0], [0, 0]];
      expect(() => ConnectivityLayer.fromMatrix('z', matrix)).toThrow('no non-zero');
    });

    it('throws on non-square flat array', () => {
      const flat = new Float32Array([1, 2, 3, 4, 5]);
      expect(() => ConnectivityLayer.fromMatrix('ns', flat)).toThrow('perfect square');
    });
  });

  describe('fromSparse', () => {
    it('creates from CSR data', () => {
      // 3x3 symmetric matrix:
      //   0  0.5  0
      //   0.5  0  0.8
      //   0    0.8  0
      const csr: CSRData = {
        indptr: [0, 1, 3, 4],
        indices: [1, 0, 2, 1],
        data: [0.5, 0.5, 0.8, 0.8]
      };
      const layer = ConnectivityLayer.fromSparse('csr', csr);
      // Upper triangle only: (0,1)=0.5, (1,2)=0.8
      expect(layer.getEdgeCount()).toBe(2);
    });

    it('applies vertexIndices mapping', () => {
      const csr: CSRData = {
        indptr: [0, 1, 1],
        indices: [1],
        data: [0.9]
      };
      const layer = ConnectivityLayer.fromSparse('csrv', csr, {
        vertexIndices: [100, 200]
      });
      const edges = layer.getFilteredEdges();
      expect(edges[0].source).toBe(100);
      expect(edges[0].target).toBe(200);
    });
  });

  // --- Attach / Detach ------------------------------------------------------

  describe('attach / detach', () => {
    it('attaches group to surface mesh', () => {
      const layer = new ConnectivityLayer('att', makeEdges(3));
      const children: any[] = [];
      const surface = {
        geometry: { vertices: makeVertices(10) },
        mesh: {
          add: (obj: any) => children.push(obj),
          remove: (obj: any) => {
            const idx = children.indexOf(obj);
            if (idx >= 0) children.splice(idx, 1);
          }
        }
      };
      layer.attach(surface);
      expect(children.length).toBe(1);
      expect(children[0]).toBe(layer.getGroup());

      layer.detach();
      // Group removed from parent (in real THREE.js, parent.remove works)
      // Here we just verify no error
    });
  });

  // --- getEdgeColors --------------------------------------------------------

  describe('getEdgeColors', () => {
    it('returns RGBA array with correct length', () => {
      const layer = new ConnectivityLayer('ec', makeEdges(4));
      const colors = layer.getEdgeColors();
      expect(colors.length).toBe(16); // 4 edges × 4 channels
    });

    it('colors are in [0,1] range', () => {
      const layer = new ConnectivityLayer('ecr', makeEdges(4));
      const colors = layer.getEdgeColors();
      for (let i = 0; i < colors.length; i++) {
        expect(colors[i]).toBeGreaterThanOrEqual(0);
        expect(colors[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  // --- Layer.fromConfig registration ----------------------------------------

  describe('Layer.fromConfig', () => {
    it('creates ConnectivityLayer from config', () => {
      const layer = Layer.fromConfig({
        type: 'connectivity',
        id: 'fc',
        edges: makeEdges(3),
        colorMap: 'plasma',
        threshold: 0.2
      });
      expect(layer).toBeInstanceOf(ConnectivityLayer);
      expect(layer.id).toBe('fc');
      expect((layer as ConnectivityLayer).getColorMapName()).toBe('plasma');
    });

    it('throws on missing edges', () => {
      expect(() => Layer.fromConfig({
        type: 'connectivity',
        id: 'bad'
      })).toThrow('requires edges');
    });

    it('still handles other types', () => {
      const layer = Layer.fromConfig({
        type: 'base',
        id: 'base',
        color: 0xff0000
      });
      expect(layer.id).toBe('base');
    });
  });

  // --- Dispose --------------------------------------------------------------

  describe('dispose', () => {
    it('clears edges and filtered edges', () => {
      const layer = new ConnectivityLayer('disp', makeEdges(5));
      expect(layer.getEdgeCount()).toBe(5);
      layer.dispose();
      expect(layer.getEdgeCount()).toBe(0);
    });

    it('can be called multiple times safely', () => {
      const layer = new ConnectivityLayer('safe', makeEdges(3));
      layer.dispose();
      layer.dispose();
      expect(layer.getEdgeCount()).toBe(0);
    });
  });
});
