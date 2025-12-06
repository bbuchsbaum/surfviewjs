import React from 'react';
const { useRef, useEffect, useImperativeHandle, forwardRef } = React;
import { 
  NeuroSurfaceViewer as CoreViewer,
  SurfaceGeometry,
  MultiLayerNeuroSurface,
  ColorMappedNeuroSurface,
  VertexColoredNeuroSurface,
  RGBALayer,
  DataLayer,
  BaseLayer
} from '../index.js';

/**
 * React wrapper for NeuroSurfaceViewer
 * 
 * @example
 * ```jsx
 * const viewerRef = useRef();
 * 
 * <NeuroSurfaceViewer
 *   ref={viewerRef}
 *   width={800}
 *   height={600}
 *   config={{ showControls: false }}
 *   onReady={(viewer) => console.log('Viewer ready', viewer)}
 * />
 * 
 * // Use the ref to control the viewer
 * viewerRef.current.addSurface(surface, 'surface-1');
 * ```
 */
const NeuroSurfaceViewer = forwardRef(({
  width = 800,
  height = 600,
  config = {},
  viewpoint = 'lateral',
  className = '',
  style = {},
  onReady,
  onSurfaceClick,
  onError,
  children
}, ref) => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const readyRef = useRef(false);

  // Expose viewer methods through ref
  useImperativeHandle(ref, () => ({
    // Core viewer instance
    get viewer() {
      return viewerRef.current;
    },

    // Surface management
    addSurface: (surface, id) => {
      if (viewerRef.current) {
        return viewerRef.current.addSurface(surface, id);
      }
    },
    removeSurface: (id) => {
      if (viewerRef.current) {
        return viewerRef.current.removeSurface(id);
      }
    },
    getSurface: (id) => {
      if (viewerRef.current) {
        return viewerRef.current.surfaces.get(id);
      }
    },

    // Layer management for MultiLayerNeuroSurface
    addLayer: (surfaceId, layer) => {
      if (viewerRef.current) {
        return viewerRef.current.addLayer(surfaceId, layer);
      }
    },
    removeLayer: (surfaceId, layerId) => {
      if (viewerRef.current) {
        return viewerRef.current.removeLayer(surfaceId, layerId);
      }
    },
    clearLayers: (surfaceId, options) => {
      if (viewerRef.current) {
        return viewerRef.current.clearLayers(surfaceId, options);
      }
    },
    updateLayer: (surfaceId, layerId, updates) => {
      if (viewerRef.current) {
        return viewerRef.current.updateLayer(surfaceId, layerId, updates);
      }
    },
    updateLayers: (surfaceId, updates) => {
      if (viewerRef.current) {
        return viewerRef.current.updateLayers(surfaceId, updates);
      }
    },

    // Camera controls
    setViewpoint: (viewpoint) => {
      if (viewerRef.current) {
        viewerRef.current.setViewpoint(viewpoint);
      }
    },
    centerCamera: () => {
      if (viewerRef.current) {
        viewerRef.current.centerCamera();
      }
    },
    resetCamera: () => {
      if (viewerRef.current) {
        viewerRef.current.resetCamera();
      }
    },

    // UI controls
    toggleControls: (show) => {
      if (viewerRef.current) {
        viewerRef.current.toggleControls(show);
      }
    },

    // Utility methods
    resize: (newWidth, newHeight) => {
      if (viewerRef.current) {
        viewerRef.current.resize(newWidth, newHeight);
      }
    },
    dispose: () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    }
  }), []);

  // Initialize viewer
  useEffect(() => {
    if (!containerRef.current || readyRef.current) return;

    try {
      const viewer = new CoreViewer(
        containerRef.current,
        width,
        height,
        config,
        viewpoint
      );

      // Start render loop
      viewer.startRenderLoop();

      // Store reference
      viewerRef.current = viewer;
      readyRef.current = true;

      // Set up event handlers
      if (onSurfaceClick) {
        viewer.onSurfaceClick = onSurfaceClick;
      }

      // Notify parent component
      if (onReady) {
        onReady(viewer);
      }
    } catch (error) {
      console.error('Failed to initialize NeuroSurfaceViewer:', error);
      if (onError) {
        onError(error);
      }
    }

    // Cleanup
    return () => {
      if (viewerRef.current) {
        viewerRef.current.stop();
        viewerRef.current.dispose();
        viewerRef.current = null;
        readyRef.current = false;
      }
    };
  }, []); // Only run once on mount

  // Handle resize
  useEffect(() => {
    if (viewerRef.current && readyRef.current) {
      viewerRef.current.resize(width, height);
    }
  }, [width, height]);

  // Handle config changes
  useEffect(() => {
    if (viewerRef.current && readyRef.current) {
      // Update relevant config options
      if (config.showControls !== undefined) {
        viewerRef.current.toggleControls(config.showControls);
      }
      // Add other config updates as needed
    }
  }, [config.showControls]);

  return (
    <div 
      ref={containerRef}
      className={`neurosurface-viewer ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        ...style
      }}
    >
      {children}
    </div>
  );
});

NeuroSurfaceViewer.displayName = 'NeuroSurfaceViewer';

// Export helper components for creating surfaces and layers
export const SurfaceHelpers = {
  /**
   * Create a surface geometry from vertex and face data
   */
  createGeometry: (vertices, faces, hemisphere, vertexCurv = null) => {
    return new SurfaceGeometry(vertices, faces, hemisphere, vertexCurv);
  },

  /**
   * Create a multi-layer surface
   */
  createMultiLayerSurface: (geometry, config = {}) => {
    return new MultiLayerNeuroSurface(geometry, config);
  },

  /**
   * Create a color-mapped surface (single layer)
   */
  createColorMappedSurface: (geometry, indices, data, colorMap, config = {}) => {
    return new ColorMappedNeuroSurface(geometry, indices, data, colorMap, config);
  },

  /**
   * Create a vertex-colored surface
   */
  createVertexColoredSurface: (geometry, indices, colors, config = {}) => {
    return new VertexColoredNeuroSurface(geometry, indices, colors, config);
  },

  /**
   * Create an RGBA layer
   */
  createRGBALayer: (id, rgbaData, config = {}) => {
    return new RGBALayer(id, rgbaData, config);
  },

  /**
   * Create a data layer with colormap
   */
  createDataLayer: (id, data, indices, colorMap, config = {}) => {
    return new DataLayer(id, data, indices, colorMap, config);
  },

  /**
   * Create a base layer
   */
  createBaseLayer: (color = 0xcccccc, config = {}) => {
    return new BaseLayer(color, config);
  }
};

export default NeuroSurfaceViewer;
