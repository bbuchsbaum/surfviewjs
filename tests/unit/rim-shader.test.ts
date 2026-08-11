import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import { EventEmitter } from '../../src/EventEmitter';
import type { ViewerEventMap } from '../../src/events';

describe('rim lighting shader patch', () => {
  it('reuses Three shader varyings instead of redeclaring them', () => {
    const viewer = new EventEmitter<ViewerEventMap>() as any;
    Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
    (viewer as any).config = { rimStrength: 0.35 };
    (viewer as any).rimStrengthUniforms = [];

    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshPhongMaterial()
    );

    viewer.addRimLightingShader(mesh);

    const material = mesh.material as THREE.MeshPhongMaterial;
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <dithering_fragment>'
    };

    material.onBeforeCompile(shader as any, {} as any);

    expect(shader.uniforms.rimStrength).toEqual({ value: 0.35 });
    expect(shader.vertexShader).not.toContain('varying vec3 vNormal');
    expect(shader.vertexShader).not.toContain('varying vec3 vViewPosition');
    expect(shader.fragmentShader).not.toContain('varying vec3 vNormal');
    expect(shader.fragmentShader).not.toContain('varying vec3 vViewPosition');
    expect(shader.fragmentShader).toContain('uniform float rimStrength');
    expect(shader.fragmentShader).toContain('surfviewRimNormal');
    expect((material as any).userData.hasRimShader).toBe(true);
  });
});
