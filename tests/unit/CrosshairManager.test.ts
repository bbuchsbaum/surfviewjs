import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CrosshairManager } from '../../src/CrosshairManager';

function makeMesh(vertexCount: number): THREE.Mesh {
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = i;
    positions[i * 3 + 1] = i * 2;
    positions[i * 3 + 2] = i * 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

describe('CrosshairManager', () => {
  let renderCb: ReturnType<typeof vi.fn>;
  let manager: CrosshairManager;
  let mesh: THREE.Mesh;

  beforeEach(() => {
    renderCb = vi.fn();
    manager = new CrosshairManager(renderCb);
    mesh = makeMesh(4);
  });

  describe('show', () => {
    it('positions crosshair at vertex and sets state', () => {
      manager.show(mesh, 'surf1', 2);
      expect(manager.visible).toBe(true);
      expect(manager.surfaceId).toBe('surf1');
      expect(manager.vertexIndex).toBe(2);
      expect(manager.mode).toBe('selection');
      expect(renderCb).toHaveBeenCalled();
    });

    it('attaches group as child of mesh', () => {
      manager.show(mesh, 'surf1', 0);
      // The crosshair group should be a child of the mesh
      const group = mesh.children.find(c => c.name === 'neurosurface-crosshair');
      expect(group).toBeDefined();
      expect(group!.visible).toBe(true);
    });

    it('supports hover mode', () => {
      manager.show(mesh, 'surf1', 1, { mode: 'hover' });
      expect(manager.mode).toBe('hover');
    });

    it('rejects invalid vertex index', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      manager.show(mesh, 'surf1', 999);
      expect(manager.visible).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('rejects negative vertex index', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      manager.show(mesh, 'surf1', -1);
      expect(manager.visible).toBe(false);
      warnSpy.mockRestore();
    });

    it('respects custom size and color', () => {
      manager.show(mesh, 'surf1', 0, { size: 3.0, color: 0xff0000 });
      expect(manager.size).toBe(3.0);
      expect(manager.color).toBe(0xff0000);
    });

    it('re-parents when switching meshes', () => {
      const mesh2 = makeMesh(3);
      manager.show(mesh, 'surf1', 0);
      expect(mesh.children.length).toBe(1);

      manager.show(mesh2, 'surf2', 1);
      // Old mesh should have no crosshair children
      const oldGroup = mesh.children.find(c => c.name === 'neurosurface-crosshair');
      expect(oldGroup).toBeUndefined();
      // New mesh should have it
      const newGroup = mesh2.children.find(c => c.name === 'neurosurface-crosshair');
      expect(newGroup).toBeDefined();
    });
  });

  describe('hide', () => {
    it('clears state and detaches from parent', () => {
      manager.show(mesh, 'surf1', 0);
      manager.hide();
      expect(manager.visible).toBe(false);
      expect(manager.surfaceId).toBeNull();
      expect(manager.vertexIndex).toBeNull();
      expect(manager.mode).toBeNull();
    });

    it('is safe to call when not shown', () => {
      expect(() => manager.hide()).not.toThrow();
    });
  });

  describe('toggle', () => {
    it('hides when visible', () => {
      manager.show(mesh, 'surf1', 0);
      manager.toggle(mesh, 'surf1', 0);
      expect(manager.visible).toBe(false);
    });

    it('shows when hidden with valid target', () => {
      manager.toggle(mesh, 'surf1', 1);
      expect(manager.visible).toBe(true);
      expect(manager.vertexIndex).toBe(1);
    });

    it('does nothing when hidden with no target', () => {
      manager.toggle(null);
      expect(manager.visible).toBe(false);
    });
  });

  describe('canHoverUpdate', () => {
    it('allows first call', () => {
      expect(manager.canHoverUpdate()).toBe(true);
    });

    it('throttles rapid calls', () => {
      // First call succeeds and sets lastHoverUpdate to now
      manager.canHoverUpdate();
      // Immediate second call within default 80ms throttle should be blocked
      expect(manager.canHoverUpdate()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('cleans up geometries and material', () => {
      manager.show(mesh, 'surf1', 0);
      manager.dispose();
      // After disposal, internal group should be null
      // Show should still work (re-creates resources)
      manager.show(mesh, 'surf1', 0);
      expect(manager.visible).toBe(true);
    });

    it('is safe to call multiple times', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
