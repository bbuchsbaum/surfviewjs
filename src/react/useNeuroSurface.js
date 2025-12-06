import React from 'react';
const { useState, useCallback, useRef } = React;
import { SurfaceHelpers } from './NeuroSurfaceViewer.jsx';

/**
 * React hook for managing brain surfaces and layers
 * 
 * @example
 * ```jsx
 * const { 
 *   surfaces, 
 *   addSurface, 
 *   removeSurface,
 *   addLayer,
 *   updateLayer,
 *   updateLayersFromBackend 
 * } = useNeuroSurface(viewerRef);
 * ```
 */
export function useNeuroSurface(viewerRef) {
  const [surfaces, setSurfaces] = useState(new Map());
  const layerIdCounter = useRef(0);

  // Add a surface to the viewer
  const addSurface = useCallback((surfaceData, id = null) => {
    if (!viewerRef.current) return null;

    const surfaceId = id || `surface-${Date.now()}`;
    
    try {
      // Create geometry
      const geometry = SurfaceHelpers.createGeometry(
        surfaceData.vertices,
        surfaceData.faces,
        surfaceData.hemisphere || 'unknown',
        surfaceData.vertexCurv
      );

      // Create surface based on type
      let surface;
      if (surfaceData.type === 'multi-layer') {
        surface = SurfaceHelpers.createMultiLayerSurface(geometry, surfaceData.config);
      } else if (surfaceData.data && surfaceData.colorMap) {
        surface = SurfaceHelpers.createColorMappedSurface(
          geometry,
          surfaceData.indices,
          surfaceData.data,
          surfaceData.colorMap,
          surfaceData.config
        );
      } else if (surfaceData.colors) {
        surface = SurfaceHelpers.createVertexColoredSurface(
          geometry,
          surfaceData.indices,
          surfaceData.colors,
          surfaceData.config
        );
      } else {
        surface = SurfaceHelpers.createMultiLayerSurface(geometry, surfaceData.config);
      }

      // Add to viewer
      viewerRef.current.addSurface(surface, surfaceId);
      
      // Update state
      setSurfaces(prev => new Map(prev).set(surfaceId, {
        id: surfaceId,
        type: surfaceData.type || 'multi-layer',
        layers: new Map()
      }));

      return surfaceId;
    } catch (error) {
      console.error('Failed to add surface:', error);
      return null;
    }
  }, [viewerRef]);

  // Remove a surface
  const removeSurface = useCallback((surfaceId) => {
    if (!viewerRef.current) return;

    viewerRef.current.removeSurface(surfaceId);
    setSurfaces(prev => {
      const next = new Map(prev);
      next.delete(surfaceId);
      return next;
    });
  }, [viewerRef]);

  // Add a layer to a surface
  const addLayer = useCallback((surfaceId, layerData) => {
    if (!viewerRef.current) return null;

    const layerId = layerData.id || `layer-${layerIdCounter.current++}`;
    
    try {
      let layer;
      
      if (layerData.type === 'rgba' || layerData.rgbaData) {
        layer = SurfaceHelpers.createRGBALayer(
          layerId,
          layerData.rgbaData || layerData.data,
          layerData.config
        );
      } else if (layerData.type === 'data' || (layerData.data && layerData.colorMap)) {
        layer = SurfaceHelpers.createDataLayer(
          layerId,
          layerData.data,
          layerData.indices,
          layerData.colorMap,
          layerData.config
        );
      } else if (layerData.type === 'base') {
        layer = SurfaceHelpers.createBaseLayer(
          layerData.color,
          layerData.config
        );
      } else {
        throw new Error(`Unknown layer type: ${layerData.type}`);
      }

      viewerRef.current.addLayer(surfaceId, layer);

      // Update state
      setSurfaces(prev => {
        const next = new Map(prev);
        const surface = next.get(surfaceId);
        if (surface) {
          surface.layers.set(layerId, {
            id: layerId,
            type: layerData.type,
            visible: layer.visible,
            opacity: layer.opacity
          });
        }
        return next;
      });

      return layerId;
    } catch (error) {
      console.error('Failed to add layer:', error);
      return null;
    }
  }, [viewerRef]);

  // Update a layer
  const updateLayer = useCallback((surfaceId, layerId, updates) => {
    if (!viewerRef.current) return;

    viewerRef.current.updateLayer(surfaceId, layerId, updates);

    // Update state
    setSurfaces(prev => {
      const next = new Map(prev);
      const surface = next.get(surfaceId);
      if (surface && surface.layers.has(layerId)) {
        const layer = surface.layers.get(layerId);
        Object.assign(layer, updates);
      }
      return next;
    });
  }, [viewerRef]);

  // Remove a layer
  const removeLayer = useCallback((surfaceId, layerId) => {
    if (!viewerRef.current) return;

    viewerRef.current.removeLayer(surfaceId, layerId);

    // Update state
    setSurfaces(prev => {
      const next = new Map(prev);
      const surface = next.get(surfaceId);
      if (surface) {
        surface.layers.delete(layerId);
      }
      return next;
    });
  }, [viewerRef]);

  const clearLayers = useCallback((surfaceId, options = {}) => {
    if (!viewerRef.current) return;

    viewerRef.current.clearLayers(surfaceId, options);
    const includeBase = options.includeBase ?? false;

    setSurfaces(prev => {
      const next = new Map(prev);
      const surface = next.get(surfaceId);
      if (surface) {
        surface.layers.forEach((layer, id) => {
          const isBase = layer?.type === 'base' || (typeof id === 'string' && id.startsWith('base'));
          if (!includeBase && isBase) {
            return;
          }
          surface.layers.delete(id);
        });
      }
      return next;
    });
  }, [viewerRef]);

  // Batch update layers from backend
  const updateLayersFromBackend = useCallback((surfaceId, layerUpdates) => {
    if (!viewerRef.current) return;

    // Convert backend format to our layer format
    const updates = layerUpdates.map(update => {
      const { id, type, ...props } = update;
      
      // Handle different data formats from backend
      if (type === 'rgba' && props.data && !props.rgbaData) {
        props.rgbaData = props.data;
        delete props.data;
      }
      
      return { id, type, ...props };
    });

    viewerRef.current.updateLayers(surfaceId, updates);

    // Update state to reflect new layers
    setSurfaces(prev => {
      const next = new Map(prev);
      const surface = next.get(surfaceId);
      if (surface) {
        updates.forEach(update => {
          if (update.type) {
            // New layer
            surface.layers.set(update.id, {
              id: update.id,
              type: update.type,
              visible: update.visible !== false,
              opacity: update.opacity || 1
            });
          } else if (surface.layers.has(update.id)) {
            // Update existing layer
            const layer = surface.layers.get(update.id);
            Object.assign(layer, update);
          }
        });
      }
      return next;
    });
  }, [viewerRef]);

  // Set layer order
  const setLayerOrder = useCallback((surfaceId, layerIds) => {
    if (!viewerRef.current) return;
    viewerRef.current.setLayerOrder(surfaceId, layerIds);
  }, [viewerRef]);

  return {
    surfaces,
    addSurface,
    removeSurface,
    addLayer,
    updateLayer,
    removeLayer,
    clearLayers,
    updateLayersFromBackend,
    setLayerOrder
  };
}
