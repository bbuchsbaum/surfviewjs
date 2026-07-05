import { describe, it, expect } from 'vitest';
import {
  exportScene,
  exportSceneBlob,
  exportSceneJSON,
  exportStaticHTML,
  SURFVIEW_EXPORT_SCHEMA,
  SURFVIEW_VERSION
} from '../../src/serialization';
import type { SubjectPackageManifest } from '../../src/SubjectPackage';
import type { ViewerStateV1 } from '../../src/serialization';

function makeState(): ViewerStateV1 {
  return {
    version: 1,
    camera: {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
      fov: 45
    },
    config: {
      background: 0x000000,
      lighting: {
        ambientIntensity: 0.5,
        directionalIntensity: 1,
        directionalPosition: [1, 1, 1]
      }
    },
    surfaces: {
      lh: {
        id: 'lh',
        type: 'MultiLayerNeuroSurface',
        hemisphere: 'left',
        visible: true,
        layers: [
          {
            id: 'activation',
            type: 'data',
            visible: true,
            opacity: 0.75,
            blendMode: 'normal',
            order: 1,
            colorMapName: 'RdBu',
            range: [-4, 4],
            threshold: [-2, 2]
          }
        ],
        clipPlanes: []
      }
    },
    crosshair: {
      visible: false,
      surfaceId: null,
      vertexIndex: null,
      size: 1.5,
      color: 0xffcc00,
      mode: null
    },
    timeline: null,
    selection: {
      surfaceId: 'lh',
      layerId: 'activation'
    }
  };
}

function makeViewer() {
  return {
    camera: {
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      fov: 45
    },
    controls: {
      target: { x: 0, y: 0, z: 0 }
    },
    config: { backgroundColor: 0x000000 },
    ambientLight: { intensity: 0.5 },
    directionalLight: {
      intensity: 1,
      position: { x: 1, y: 1, z: 1 }
    },
    selectedSurfaceId: 'lh',
    selectedLayerId: 'activation',
    surfaces: new Map([
      ['lh', {
        constructor: { name: 'MultiLayerNeuroSurface' },
        hemisphere: 'left',
        mesh: { visible: true },
        layerStack: {
          getAllLayers: () => [{
            toStateJSON: () => makeState().surfaces.lh.layers[0]
          }]
        },
        clipPlanes: {
          toStateJSON: () => []
        }
      }]
    ])
  };
}

function makeSubject(): SubjectPackageManifest {
  return {
    schemaVersion: '1.0.0',
    id: 'sub-01',
    provenance: {
      sourceFiles: ['derivatives/fmriprep/sub-01/anat/sub-01_desc-preproc_T1w.nii.gz']
    },
    surfaces: [{
      id: 'lh',
      hemisphere: 'left',
      defaultVariant: 'inflated',
      variants: [
        {
          name: 'inflated',
          kind: 'inflated',
          file: { uri: 'surfaces/lh.inflated.surf.gii', format: 'GIFTI' },
          vertexCount: 3,
          faceCount: 1,
          hemisphere: 'left'
        }
      ]
    }],
    metrics: [{
      id: 'curv',
      kind: 'curvature',
      file: 'metrics/lh.curv.func.gii',
      surface: 'lh',
      vertexCount: 3,
      hemisphere: 'left'
    }],
    transforms: [{
      id: 'anat-to-bold',
      from: 'anat',
      to: 'boldref',
      kind: 'affine',
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]
    }],
    volumes: [{
      id: 'zstat1',
      file: 'volumes/zstat1.nii.gz.br',
      dims: [64, 64, 40],
      transform: 'anat-to-bold'
    }]
  };
}

describe('scene export', () => {
  it('exports state, subject assets, transforms, and provenance', () => {
    const scene = exportScene(makeViewer(), {
      id: 'figure-1',
      createdAt: '2026-07-02T00:00:00.000Z',
      subject: makeSubject(),
      provenance: {
        sourceFiles: ['analysis/model-fit.json'],
        softwareVersions: { generator: 'unit-test' }
      },
      metadata: { label: 'subject 01 activation' }
    });

    expect(scene.schemaVersion).toBe(SURFVIEW_EXPORT_SCHEMA);
    expect(scene.surfviewVersion).toBe(SURFVIEW_VERSION);
    expect(scene.id).toBe('figure-1');
    expect(scene.state.surfaces.lh.layers[0]).toMatchObject({
      id: 'activation',
      range: [-4, 4],
      threshold: [-2, 2]
    });
    expect(scene.assets.map(asset => asset.uri)).toEqual(expect.arrayContaining([
      'surfaces/lh.inflated.surf.gii',
      'metrics/lh.curv.func.gii',
      'volumes/zstat1.nii.gz.br'
    ]));
    expect(scene.provenance.sourceFiles).toEqual(expect.arrayContaining([
      'analysis/model-fit.json',
      'derivatives/fmriprep/sub-01/anat/sub-01_desc-preproc_T1w.nii.gz',
      'surfaces/lh.inflated.surf.gii'
    ]));
    expect(scene.provenance.transforms['anat-to-bold']).toMatchObject({
      from: 'anat',
      to: 'boldref',
      matrix: expect.any(Array)
    });
    expect(scene.provenance.softwareVersions).toMatchObject({
      surfview: SURFVIEW_VERSION,
      generator: 'unit-test'
    });
  });

  it('exports JSON and Blob artifacts', () => {
    const json = exportSceneJSON(makeViewer(), {
      id: 'json-scene',
      state: makeState(),
      pretty: false
    });
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('json-scene');
    expect(parsed.state.selection.layerId).toBe('activation');

    const blob = exportSceneBlob(makeViewer(), { state: makeState() });
    expect(blob.type).toBe('application/vnd.surfview.scene+json');
  });

  it('exports static HTML with an embedded escaped scene manifest', () => {
    const html = exportStaticHTML(makeViewer(), {
      id: 'scene-<unsafe>',
      title: '<unsafe scene>',
      state: makeState(),
      scriptUrl: '/dist/surfview.es.js'
    });

    expect(html).toContain('<title>&lt;unsafe scene&gt;</title>');
    expect(html).toContain('window.surfviewSceneManifest');
    expect(html).toContain('\\u003cunsafe>');
    expect(html).not.toContain('scene-<unsafe>');

    const match = html.match(/<script type="application\/json" id="surfview-scene-manifest">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const manifest = JSON.parse(match![1]);
    expect(manifest.id).toBe('scene-<unsafe>');
    expect(manifest.state.camera.position).toEqual([1, 2, 3]);
  });
});
