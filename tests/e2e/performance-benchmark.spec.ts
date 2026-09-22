import { expect, test } from '@playwright/test';
import baseline from '../../benchmarks/performance-baseline.json' with { type: 'json' };

test('cortical-scale GPU update, draw, pick, and resize budgets', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');

  const result = await page.evaluate(async ({ samples }) => {
    const {
      GPULayerCompositor,
      GPUPicker,
      RGBALayer,
      THREE
    } = await import('/src/index.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      return { skipped: true, reason: 'WebGL2 unavailable', workloads: [], picking: [] };
    }

    document.body.replaceChildren(renderer.domElement);
    renderer.setPixelRatio(1);
    renderer.setSize(64, 64, false);
    const gl = renderer.getContext();
    const target = new THREE.WebGLRenderTarget(64, 64, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    });
    renderer.setRenderTarget(target);

    const measure = (operation: (sample: number) => void) => {
      operation(-1);
      const timings: number[] = [];
      for (let sample = 0; sample < samples; sample += 1) {
        const start = performance.now();
        operation(sample);
        gl.finish();
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      return {
        medianMs: timings[1]!,
        minMs: timings[0]!,
        maxMs: timings[2]!
      };
    };

    const vertexCounts = [32_492, 163_842, 324_002];
    const layerCounts = [1, 4, 8];
    const workloads: Array<Record<string, unknown>> = [];
    const picking: Array<Record<string, unknown>> = [];

    for (const vertexCount of vertexCounts) {
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      const vertexIndices = new Float32Array(vertexCount);
      positions.set([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const offset = vertex * 3;
        if (vertex >= 3) {
          positions[offset] = 1000;
          positions[offset + 1] = 1000;
        }
        normals[offset + 2] = 1;
        vertexIndices[vertex] = vertex;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('vertexIndex', new THREE.BufferAttribute(vertexIndices, 1));
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      camera.position.z = 5;
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const allLayers = Array.from({ length: 8 }, (_, layerIndex) => {
        const rgba = new Float32Array(vertexCount * 4);
        for (let vertex = 0; vertex < vertexCount; vertex += 1) {
          const offset = vertex * 4;
          const value = ((vertex * 17 + layerIndex * 31) % 997) / 996;
          rgba[offset] = value;
          rgba[offset + 1] = 1 - value;
          rgba[offset + 2] = (value + layerIndex * 0.071) % 1;
          rgba[offset + 3] = 0.75;
        }
        return new RGBALayer(`layer-${layerIndex}`, rgba);
      });

      for (const layerCount of layerCounts) {
        const layers = allLayers.slice(0, layerCount);
        layers.forEach(layer => {
          layer.visible = true;
          layer.needsUpdate = true;
        });
        const capacity = GPULayerCompositor.assessCapacity(renderer, vertexCount, layerCount);
        if (!capacity.supported) {
          throw new Error(`Unexpected GPU capacity failure: ${capacity.reason}`);
        }
        const compositor = new GPULayerCompositor(vertexCount, layerCount);
        const material = compositor.getMaterial();
        if (!material) throw new Error('GPU material unavailable');
        material.uniforms.ambientLight.value.setRGB(1, 1, 1);
        material.uniforms.directionalLight.value.setRGB(0, 0, 0);
        const mesh = new THREE.Mesh(geometry, material);
        const scene = new THREE.Scene();
        scene.add(mesh);

        const fullUploadAndDraw = measure(() => {
          layers.forEach(layer => { layer.needsUpdate = true; });
          compositor.updateLayers(layers);
          layers.forEach(layer => { layer.needsUpdate = false; });
          renderer.render(scene, camera);
        });
        const dirtyIndex = Math.floor(layerCount / 2);
        const dirtyLayerAndDraw = measure(() => {
          layers[dirtyIndex]!.needsUpdate = true;
          compositor.updateLayers(layers);
          layers[dirtyIndex]!.needsUpdate = false;
          renderer.render(scene, camera);
        });
        let reverse = false;
        const reorderAndDraw = measure(() => {
          reverse = !reverse;
          const ordered = reverse ? [...layers].reverse() : layers;
          compositor.updateLayers(ordered);
          layers.forEach(layer => { layer.needsUpdate = false; });
          renderer.render(scene, camera);
        });
        let visible = true;
        const visibilityAndDraw = measure(() => {
          visible = !visible;
          layers[layerCount - 1]!.visible = visible;
          layers[layerCount - 1]!.needsUpdate = true;
          compositor.updateLayers(layers);
          layers.forEach(layer => { layer.needsUpdate = false; });
          renderer.render(scene, camera);
        });
        const resizeAndDraw = measure(sample => {
          const size = sample % 2 === 0 ? 96 : 64;
          renderer.setSize(size, size, false);
          renderer.render(scene, camera);
        });
        renderer.setSize(64, 64, false);

        workloads.push({
          vertexCount,
          layerCount,
          textureBytes: compositor.getTextureMemoryUsage().totalBytes,
          fullUploadAndDraw,
          dirtyLayerAndDraw,
          reorderAndDraw,
          visibilityAndDraw,
          resizeAndDraw
        });
        scene.remove(mesh);
        compositor.dispose();
      }

      const pickMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      const picker = new GPUPicker(renderer);
      picker.setThrottleMs(0);
      const addSurface = measure(() => {
        picker.removeSurface('surface');
        picker.addSurface('surface', pickMesh);
      });
      const gpuPick = measure(() => {
        picker.pick(32, 32, camera, {
          left: 0,
          top: 0,
          width: 64,
          height: 64,
          right: 64,
          bottom: 64,
          x: 0,
          y: 0,
          toJSON: () => ({})
        });
      });
      picking.push({ vertexCount, addSurface, gpuPick });
      picker.dispose();
      pickMesh.material.dispose();
      geometry.dispose();
    }

    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = {
      vendor: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),
      renderer: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
    };
    renderer.setRenderTarget(null);
    target.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    return {
      skipped: false,
      reason: null,
      gpu,
      workloads,
      picking
    };
  }, { samples: baseline.noise.browserSamples });

  expect(result.skipped, result.reason ?? 'GPU benchmark must be available').toBe(false);
  const budgets = baseline.budgets;
  expect(result.workloads).toHaveLength(9);
  for (const workload of result.workloads as any[]) {
    expect(workload.fullUploadAndDraw.medianMs).toBeLessThan(budgets.browserFullUploadAndDrawMs);
    expect(workload.dirtyLayerAndDraw.medianMs).toBeLessThan(budgets.browserDirtyLayerAndDrawMs);
    expect(workload.reorderAndDraw.medianMs).toBeLessThan(budgets.browserReorderAndDrawMs);
    expect(workload.visibilityAndDraw.medianMs).toBeLessThan(budgets.browserVisibilityAndDrawMs);
    expect(workload.resizeAndDraw.medianMs).toBeLessThan(budgets.browserResizeAndDrawMs);
  }
  expect(result.picking).toHaveLength(3);
  for (const picking of result.picking as any[]) {
    expect(picking.addSurface.medianMs).toBeLessThan(budgets.browserFullUploadAndDrawMs);
    expect(picking.gpuPick.medianMs).toBeLessThan(budgets.browserGPUPickMs);
  }
  console.log(`browser performance evidence: ${JSON.stringify(result)}`);
});
