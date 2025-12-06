import * as THREE from 'three';
import { NeuroSurface } from '../classes';

export class SurfaceDebugger {
  /**
   * Comprehensive debug check for a surface
   */
  static debugSurface(surface: NeuroSurface): void {
    console.group('🔍 Surface Debug Info');
    
    if (!surface.mesh) {
      console.error('❌ No mesh found on surface!');
      console.groupEnd();
      return;
    }
    
    const mesh = surface.mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const material = mesh.material as THREE.MeshPhongMaterial;
    
    // Check geometry
    console.group('📐 Geometry');
    console.log('Has position attribute:', !!geometry.attributes.position);
    console.log('Position count:', geometry.attributes.position?.count || 0);
    console.log('Has index:', !!geometry.index);
    console.log('Index count:', geometry.index?.count || 0);
    console.log('Has normals:', !!geometry.attributes.normal);
    console.log('Has colors:', !!geometry.attributes.color);
    if (geometry.attributes.color) {
      const colors = geometry.attributes.color.array;
      console.log('First 3 colors:', colors[0], colors[1], colors[2]);
      console.log('Color array length:', colors.length);
      
      // Check if colors are all black/zero
      let allZero = true;
      for (let i = 0; i < Math.min(colors.length, 100); i++) {
        if (colors[i] > 0.01) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        console.warn('⚠️ All colors appear to be black/zero!');
      }
    }
    console.groupEnd();
    
    // Check material
    console.group('🎨 Material');
    console.log('Type:', material.type);
    console.log('Color:', material.color.getHexString());
    console.log('Opacity:', material.opacity);
    console.log('Transparent:', material.transparent);
    console.log('Visible:', material.visible);
    console.log('Side:', material.side === THREE.FrontSide ? 'FrontSide' : 
                         material.side === THREE.BackSide ? 'BackSide' : 'DoubleSide');
    console.log('Wireframe:', material.wireframe);
    console.log('Vertex colors:', material.vertexColors);
    console.log('Emissive:', material.emissive?.getHexString());
    console.log('Specular:', material.specular?.getHexString());
    console.groupEnd();
    
    // Check mesh
    console.group('📦 Mesh');
    console.log('Visible:', mesh.visible);
    console.log('Position:', mesh.position.toArray());
    console.log('Scale:', mesh.scale.toArray());
    console.log('Rotation:', mesh.rotation.toArray());
    console.log('Parent:', mesh.parent?.type);
    console.groupEnd();
    
    // Check data
    console.group('📊 Surface Data');
    console.log('Data length:', surface.data?.length);
    console.log('Data range:', surface.data ? 
      `[${Math.min(...surface.data)}, ${Math.max(...surface.data)}]` : 'N/A');
    console.log('Indices length:', surface.indices?.length);
    console.log('Threshold:', surface.threshold);
    console.log('Range:', surface.irange);
    console.groupEnd();
    
    console.groupEnd();
  }
  
  /**
   * Create a simple test mesh to verify rendering works
   */
  static createTestCube(scene: THREE.Scene, size: number = 50): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      wireframe: true 
    });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    console.log('🧊 Test cube added to scene at origin');
    return cube;
  }
  
  /**
   * Force surface to be visible with bright colors
   */
  static forceSurfaceVisible(surface: NeuroSurface): void {
    if (!surface.mesh) return;
    
    const mesh = surface.mesh;
    const material = mesh.material as THREE.MeshPhongMaterial;
    
    // Make it super visible
    material.color.set(0xff0000); // Bright red
    material.emissive = new THREE.Color(0x440000); // Slight glow
    material.wireframe = true;
    material.opacity = 1;
    material.transparent = false;
    material.vertexColors = false; // Disable vertex colors
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
    
    mesh.visible = true;
    
    console.log('🔴 Forced surface to bright red wireframe');
  }
  
  /**
   * Check scene lighting
   */
  static debugLighting(scene: THREE.Scene): void {
    console.group('💡 Lighting');
    
    const lights: THREE.Light[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Light) {
        lights.push(child);
      }
    });
    
    if (lights.length === 0) {
      console.error('❌ No lights in scene!');
    } else {
      lights.forEach((light, i) => {
        console.log(`Light ${i}:`, {
          type: light.type,
          color: (light as any).color?.getHexString(),
          intensity: (light as any).intensity,
          position: light.position.toArray()
        });
      });
    }
    
    console.groupEnd();
  }
}