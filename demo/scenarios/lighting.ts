import { ColorMappedNeuroSurface, SurfaceGeometry, THREE } from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

function buildGeometry(detail = 4): SurfaceGeometry {
  const geometry = new THREE.IcosahedronGeometry(60, detail);
  const vertices = new Float32Array(geometry.attributes.position.array);
  // If geometry is non-indexed, generate a simple sequential index buffer
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : new Uint32Array(Array.from({ length: vertices.length / 3 }, (_, i) => i));
  return new SurfaceGeometry(vertices, indices, 'lighting');
}

function makeBands(vertices: Float32Array): Float32Array {
  const data = new Float32Array(vertices.length / 3);
  for (let i = 0; i < data.length; i++) {
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const r = Math.hypot(y, z);
    data[i] = Math.sin(r * 0.08) * 8 + Math.random() * 0.4;
  }
  return data;
}

export const lighting: Scenario = {
  id: 'lighting',
  title: 'Lighting & materials',
  description: 'PBR material knobs plus flat vs smooth shading sanity check.',
  tags: ['materials', 'lighting', 'presentation'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Setting up lighting scene');
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      backgroundColor: 0x0a0f1e,
      ambientLightColor: 0xb0b0b0,
      directionalLightIntensity: 1.4
    });

    const geom = buildGeometry();
    const data = makeBands(geom.vertices);
    const surface = new ColorMappedNeuroSurface(
      geom,
      null,
      data,
      'plasma',
      {
        alpha: 1,
        materialType: 'phong', // simple, reliable shading
        shininess: 70,
        specularColor: 0xffffff,
        flatShading: false,
        emissive: 0x0b0f18,
        emissiveIntensity: 0.2
      }
    );

    viewer.addSurface(surface, 'lighting');
    viewer.centerCamera(); // centerCamera sets a sensible distance; avoid overriding with viewpoint move
    ctx.status('Ready - adjust material values');

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Material</h4>
        <div class="panel-controls">
          <label class="stat">Shininess <input id="shininess" type="range" min="5" max="150" step="5" value="70" /></label>
          <label class="stat">Specular boost <input id="specular" type="range" min="0" max="1" step="0.05" value="1" /></label>
          <label class="stat">Flat shading <input id="flat" type="checkbox" /></label>
          <label class="stat">Use PBR <input id="pbr" type="checkbox" /></label>
        </div>
      </div>
      <div class="panel-section">
        <h4>Data field</h4>
        <div class="panel-controls">
          <button id="reroll-bands" class="ghost">Reroll bands</button>
          <button id="reset-light" class="ghost">Reset settings</button>
        </div>
      </div>
    `;

    const shinyInput = ctx.panel.querySelector('#shininess') as HTMLInputElement | null;
    const specInput = ctx.panel.querySelector('#specular') as HTMLInputElement | null;
    const flatInput = ctx.panel.querySelector('#flat') as HTMLInputElement | null;
    const pbrInput = ctx.panel.querySelector('#pbr') as HTMLInputElement | null;
    const rerollBtn = ctx.panel.querySelector('#reroll-bands');
    const resetBtn = ctx.panel.querySelector('#reset-light');

    const updateMaterial = () => {
      const usePbr = pbrInput?.checked || false;
      const specBoost = specInput ? parseFloat(specInput.value) : 1;
      // Scale specular color by boost value (0 = black/no specular, 1 = full white)
      const specValue = Math.round(specBoost * 255);
      const specularColor = (specValue << 16) | (specValue << 8) | specValue;
      surface.updateConfig({
        materialType: usePbr ? 'physical' : 'phong',
        metalness: usePbr ? 0.25 : undefined,
        roughness: usePbr ? 0.55 : undefined,
        shininess: usePbr ? undefined : (shinyInput ? parseFloat(shinyInput.value) : 70),
        specularColor: usePbr ? undefined : specularColor,
        flatShading: flatInput?.checked || false
      });
      viewer.requestRender();
      const label = usePbr
        ? `PBR mode | metalness ${surface.config.metalness?.toFixed(2)} roughness ${surface.config.roughness?.toFixed(2)}`
        : `Phong | shininess ${surface.config.shininess} specular ${specBoost.toFixed(2)}`;
      ctx.perf(label);
    };

    shinyInput?.addEventListener('input', updateMaterial);
    specInput?.addEventListener('input', updateMaterial);
    flatInput?.addEventListener('change', updateMaterial);
    pbrInput?.addEventListener('change', updateMaterial);

    rerollBtn?.addEventListener('click', () => {
      const next = makeBands(geom.vertices);
      surface.setData(next);
      ctx.status('Regenerated band pattern');
      viewer.requestRender();
    });

    resetBtn?.addEventListener('click', () => {
      if (shinyInput) shinyInput.value = '70';
      if (specInput) specInput.value = '1';
      if (flatInput) flatInput.checked = false;
      if (pbrInput) pbrInput.checked = false;
      updateMaterial();
      ctx.status('Reset material defaults');
    });

    return () => {
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
