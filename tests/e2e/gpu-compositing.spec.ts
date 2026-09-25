import { expect, test } from '@playwright/test';

interface GPUCaseResult {
  name: string;
  actual: number[];
  expected: number[];
  maxError: number;
  material: {
    transparent: boolean;
    depthTest: boolean;
    depthWrite: boolean;
    premultipliedAlpha: boolean;
    blending: number;
  };
}

test('GPU compositor matches the straight-RGBA oracle through production blending', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/index.ts';
    const {
      BaseLayer,
      GPULayerCompositor,
      RGBALayer,
      THREE,
      compositeStraightRGBA,
      premultiplyStraightRGBA
    } = await import(moduleUrl);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        premultipliedAlpha: true
      });
    } catch (error) {
      return {
        skipped: true,
        reason: `WebGL renderer unavailable: ${String(error)}`,
        cases: []
      };
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      return {
        skipped: true,
        reason: 'WebGL2 unavailable; SurfView explicitly falls back to CPU compositing',
        cases: []
      };
    }

    renderer.setSize(8, 8, false);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(8, 8, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;

    const compositor = new GPULayerCompositor(1);
    const material = compositor.getMaterial();
    if (!material) throw new Error('GPU compositor did not create a material');
    material.uniforms.ambientLight.value.setRGB(1, 1, 1);
    material.uniforms.directionalLight.value.setRGB(0, 0, 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0,
      3, -1, 0,
      -1, 3, 0
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1
    ], 3));
    geometry.setAttribute('vertexIndex', new THREE.Float32BufferAttribute([0, 0, 0], 1));
    const mesh = new THREE.Mesh(geometry, material);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const colors = {
      destination: [0.2, 0.4, 0.6, 0.5],
      source: [0.8, 0.2, 0.4, 0.5],
      red: [1, 0, 0, 0.5],
      blue: [0, 0, 1, 0.5]
    };
    const rgbaLayer = (id, color, options = {}) => new RGBALayer(
      id,
      new Float32Array(color),
      options
    );
    const cases = [
      { name: 'empty transparent stack', layers: [], clear: [0, 0, 0, 0] },
      {
        name: 'normal opacity zero',
        layers: [rgbaLayer('source', colors.source, { opacity: 0 })],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'normal fractional opacity',
        layers: [rgbaLayer('source', colors.source, { opacity: 0.5 })],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'normal opaque opacity',
        layers: [rgbaLayer('source', colors.source, { opacity: 1 })],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'multiply translucent stack',
        layers: [
          rgbaLayer('destination', colors.destination),
          rgbaLayer('source', colors.source, { blendMode: 'multiply', opacity: 0.5 })
        ],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'additive translucent stack',
        layers: [
          rgbaLayer('destination', colors.destination),
          rgbaLayer('source', colors.source, { blendMode: 'additive', opacity: 0.5 })
        ],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'invisible overlay',
        layers: [
          rgbaLayer('destination', colors.destination),
          rgbaLayer('hidden', colors.source, { visible: false })
        ],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'red then blue order',
        layers: [rgbaLayer('red', colors.red), rgbaLayer('blue', colors.blue)],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'blue then red order',
        layers: [rgbaLayer('blue', colors.blue), rgbaLayer('red', colors.red)],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'opaque anatomical base and overlay',
        layers: [
          new BaseLayer(0x336699),
          rgbaLayer('source', colors.source, { opacity: 0.5 })
        ],
        clear: [0, 0, 0, 0]
      },
      {
        name: 'transparent surface over opaque canvas',
        layers: [rgbaLayer('source', colors.source, { opacity: 0.5 })],
        clear: [0.1, 0.3, 0.7, 1]
      }
    ];

    const results = [];
    const pixel = new Uint8Array(4);
    for (const testCase of cases) {
      compositor.clearBaseColor();
      compositor.updateLayers(testCase.layers);
      const clear = testCase.clear;
      renderer.setClearColor(
        new THREE.Color(clear[0], clear[1], clear[2]),
        clear[3]
      );
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixel);

      let surfaceColor = [0, 0, 0, 0];
      for (const layer of testCase.layers.filter(layer => layer.visible)) {
        const rgba = layer.getRGBAData(1);
        surfaceColor = compositeStraightRGBA(
          surfaceColor,
          [rgba[0], rgba[1], rgba[2], rgba[3]],
          layer.blendMode,
          layer.opacity
        );
      }
      const expectedStraight = clear[3] === 0
        ? surfaceColor
        : compositeStraightRGBA(clear, surfaceColor, 'normal', 1);
      const framebuffer = clear[3] === 0
        ? premultiplyStraightRGBA(expectedStraight)
        : expectedStraight;
      const expected = framebuffer.map(value => Math.round(value * 255));
      const actual = Array.from(pixel);
      const maxError = Math.max(...actual.map((value, index) => (
        Math.abs(value - expected[index])
      )));
      results.push({
        name: testCase.name,
        actual,
        expected,
        maxError,
        material: {
          transparent: material.transparent,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
          premultipliedAlpha: material.premultipliedAlpha,
          blending: material.blending
        }
      });
    }

    renderer.setRenderTarget(null);
    geometry.dispose();
    target.dispose();
    compositor.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    return { skipped: false, cases: results };
  });

  expect(result.skipped, result.reason ?? 'WebGL2 must be available').toBe(false);
  expect(result.cases).toHaveLength(11);
  for (const testCase of result.cases as GPUCaseResult[]) {
    expect(testCase.maxError, `${testCase.name}: ${JSON.stringify(testCase)}`).toBeLessThanOrEqual(2);
    expect(testCase.material).toMatchObject({
      transparent: true,
      depthTest: true,
      // Closed meshes must occlude themselves; alpha-0 fragments are discarded
      // in the shader so an empty stack still writes no depth.
      depthWrite: true,
      premultipliedAlpha: false
    });
  }
  const ordered = Object.fromEntries(
    (result.cases as GPUCaseResult[]).map(testCase => [testCase.name, testCase.actual])
  );
  expect(ordered['red then blue order']).not.toEqual(ordered['blue then red order']);
});
