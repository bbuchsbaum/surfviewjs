import React, { useRef, useState, useEffect } from 'react';
import NeuroSurfaceViewer, { SurfaceHelpers } from '../src/react/NeuroSurfaceViewer.jsx';
import { useNeuroSurface } from '../src/react/useNeuroSurface.js';

/**
 * Example React app demonstrating the NeuroSurfaceViewer
 */
function BrainVisualizationApp() {
  const viewerRef = useRef();
  const [isLoading, setIsLoading] = useState(false);
  const [currentSurfaceId, setCurrentSurfaceId] = useState(null);
  
  const {
    surfaces,
    addSurface,
    removeSurface,
    addLayer,
    updateLayer,
    removeLayer,
    updateLayersFromBackend
  } = useNeuroSurface(viewerRef);

  // Load demo surface
  const loadDemoSurface = async () => {
    setIsLoading(true);
    
    try {
      // In real app, this would load from backend
      const surfaceData = await generateDemoSurfaceData();
      
      const surfaceId = addSurface({
        type: 'multi-layer',
        vertices: surfaceData.vertices,
        faces: surfaceData.faces,
        hemisphere: 'left',
        config: {
          baseColor: 0xdddddd
        }
      });
      
      setCurrentSurfaceId(surfaceId);
      
      // Center camera on new surface
      viewerRef.current.centerCamera();
    } catch (error) {
      console.error('Failed to load surface:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate backend layer update
  const simulateBackendUpdate = () => {
    if (!currentSurfaceId) return;

    // Simulate receiving layer data from backend
    const backendLayers = [
      {
        id: 'base',
        type: 'base',
        color: 0xcccccc,
        opacity: 1
      },
      {
        id: 'activation-1',
        type: 'rgba',
        data: generateRandomRGBAData(10000), // Pre-computed RGBA from backend
        opacity: 0.8,
        blendMode: 'normal'
      },
      {
        id: 'activation-2',
        type: 'data',
        data: generateActivationData(10000), // Raw values
        colorMap: 'jet',
        range: [0, 10],
        threshold: [2, 8],
        opacity: 0.7,
        blendMode: 'additive'
      }
    ];

    updateLayersFromBackend(currentSurfaceId, backendLayers);
  };

  // Add custom layer
  const addCustomLayer = () => {
    if (!currentSurfaceId) return;

    const layerId = addLayer(currentSurfaceId, {
      type: 'data',
      data: generateActivationData(10000),
      colorMap: 'hot',
      config: {
        range: [0, 5],
        threshold: [1, 4],
        opacity: 0.6,
        blendMode: 'normal'
      }
    });

    console.log('Added layer:', layerId);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Control Panel */}
      <div style={{ 
        padding: '10px', 
        backgroundColor: '#f0f0f0',
        borderBottom: '1px solid #ccc',
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
      }}>
        <button onClick={loadDemoSurface} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Load Demo Surface'}
        </button>
        
        <button 
          onClick={simulateBackendUpdate} 
          disabled={!currentSurfaceId}
        >
          Update Layers (Backend)
        </button>
        
        <button 
          onClick={addCustomLayer} 
          disabled={!currentSurfaceId}
        >
          Add Custom Layer
        </button>
        
        <button 
          onClick={() => viewerRef.current?.toggleControls()} 
        >
          Toggle UI Controls
        </button>
        
        <div style={{ marginLeft: 'auto' }}>
          Surfaces: {surfaces.size} | 
          {currentSurfaceId && ` Layers: ${surfaces.get(currentSurfaceId)?.layers.size || 0}`}
        </div>
      </div>

      {/* Viewer */}
      <div style={{ flex: 1, position: 'relative' }}>
        <NeuroSurfaceViewer
          ref={viewerRef}
          width={window.innerWidth}
          height={window.innerHeight - 51} // Account for control panel
          config={{
            showControls: false,
            ambientLightColor: 0x404040,
            directionalLightIntensity: 0.5
          }}
          viewpoint="lateral"
          onReady={(viewer) => {
            console.log('Viewer ready:', viewer);
          }}
          onError={(error) => {
            console.error('Viewer error:', error);
          }}
        />
      </div>

      {/* Layer Controls */}
      {currentSurfaceId && surfaces.get(currentSurfaceId) && (
        <LayerControls
          surface={surfaces.get(currentSurfaceId)}
          onUpdateLayer={(layerId, updates) => 
            updateLayer(currentSurfaceId, layerId, updates)
          }
          onRemoveLayer={(layerId) => 
            removeLayer(currentSurfaceId, layerId)
          }
        />
      )}
    </div>
  );
}

/**
 * Layer control panel component
 */
function LayerControls({ surface, onUpdateLayer, onRemoveLayer }) {
  return (
    <div style={{
      position: 'absolute',
      top: '60px',
      right: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      padding: '15px',
      borderRadius: '5px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      minWidth: '250px'
    }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Layers</h3>
      
      {Array.from(surface.layers.values()).map(layer => (
        <div key={layer.id} style={{
          marginBottom: '10px',
          padding: '10px',
          backgroundColor: '#f5f5f5',
          borderRadius: '3px'
        }}>
          <div style={{ fontWeight: 'bold' }}>{layer.id}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Type: {layer.type}</div>
          
          <div style={{ marginTop: '5px' }}>
            <label>
              Opacity: 
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={layer.opacity * 100}
                onChange={(e) => onUpdateLayer(layer.id, { 
                  opacity: e.target.value / 100 
                })}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          
          <div style={{ marginTop: '5px', display: 'flex', gap: '5px' }}>
            <button 
              onClick={() => onUpdateLayer(layer.id, { 
                visible: !layer.visible 
              })}
              style={{ fontSize: '12px' }}
            >
              {layer.visible ? 'Hide' : 'Show'}
            </button>
            
            <button 
              onClick={() => onRemoveLayer(layer.id)}
              style={{ fontSize: '12px' }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Helper functions to generate demo data
function generateDemoSurfaceData() {
  // In real app, this would load actual brain surface data
  const geometry = new THREE.SphereGeometry(50, 64, 64);
  const vertices = new Float32Array(geometry.attributes.position.array);
  const indices = new Uint32Array(geometry.index.array);
  
  return { vertices, indices };
}

function generateRandomRGBAData(vertexCount) {
  const data = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * 4;
    data[offset] = Math.random();     // R
    data[offset + 1] = Math.random() * 0.5; // G
    data[offset + 2] = Math.random() * 0.5; // B
    data[offset + 3] = 0.8;           // A
  }
  return data;
}

function generateActivationData(vertexCount) {
  const data = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    // Simulate activation pattern
    data[i] = Math.sin(i * 0.1) * 5 + Math.random() * 2;
  }
  return data;
}

export default BrainVisualizationApp;