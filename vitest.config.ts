import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    allowOnly: false,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 65,
        lines: 60,
        'src/utils/statistics.ts': { statements: 90, branches: 85, functions: 100, lines: 93 },
        'src/loaders.ts': { statements: 75, branches: 68, functions: 95, lines: 77 },
        'src/utils/meshAdjacency.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
        'src/utils/curvature.ts': { statements: 94, branches: 72, functions: 100, lines: 95 },
        'src/utils/rgbaCompositing.ts': { statements: 90, branches: 90, functions: 100, lines: 94 },
        'src/utils/validation.ts': { statements: 92, branches: 90, functions: 100, lines: 92 },
        'src/utils/Picking.ts': { statements: 80, branches: 55, functions: 100, lines: 80 },
        'src/utils/GPUPicker.ts': { statements: 40, branches: 30, functions: 45, lines: 40 },
        'src/serialization/ViewerState.ts': { statements: 85, branches: 78, functions: 100, lines: 85 },
        'src/serialization/StateSerializer.ts': { statements: 78, branches: 48, functions: 80, lines: 80 },
        'src/serialization/StateDeserializer.ts': { statements: 65, branches: 58, functions: 85, lines: 68 },
        'src/viewer/ViewerPickingController.ts': { statements: 68, branches: 48, functions: 58, lines: 70 },
        'src/viewer/ViewerRenderScheduler.ts': { statements: 90, branches: 82, functions: 100, lines: 95 },
        'src/viewer/WebGLContextLifecycle.ts': { statements: 90, branches: 85, functions: 100, lines: 95 },
        'src/react/NeuroSurfaceViewer.tsx': { statements: 60, branches: 48, functions: 45, lines: 62 },
        'src/react/useNeuroSurface.ts': { statements: 44, branches: 24, functions: 45, lines: 50 }
      }
    }
  }
});
