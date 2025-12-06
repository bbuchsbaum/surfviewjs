# Colormaps

SurfView.js includes a comprehensive set of scientific colormaps for data visualization.

## Available Colormaps

### Sequential

Best for data with a natural ordering from low to high.

| Name | Description |
|------|-------------|
| `viridis` | Perceptually uniform, colorblind-friendly |
| `plasma` | Perceptually uniform, vibrant |
| `inferno` | Perceptually uniform, dark to bright |
| `magma` | Perceptually uniform, dark purple to yellow |
| `hot` | Black to red to yellow to white |
| `cool` | Cyan to magenta |

### Diverging

Best for data with a meaningful center point.

| Name | Description |
|------|-------------|
| `RdBu` | Red to white to blue |
| `bwr` | Blue to white to red |
| `coolwarm` | Cool blue to warm red |
| `seismic` | Blue to white to red (sharp) |
| `Spectral` | Multi-hue diverging |

### Qualitative

Best for categorical data.

| Name | Description |
|------|-------------|
| `jet` | Rainbow (blue to red) |
| `hsv` | Full hue spectrum |
| `rainbow` | Rainbow colors |

### Monochrome

Single-hue gradients.

| Name | Description |
|------|-------------|
| `greys` | Black to white |
| `blues` | White to blue |
| `reds` | White to red |
| `greens` | White to green |

## Using Colormaps

### With DataLayer

```javascript
import { DataLayer } from 'surfview';

const layer = new DataLayer('activation', data, null, 'viridis', {
  range: [-5, 5]
});
```

### With ColorMappedNeuroSurface

```javascript
import { ColorMappedNeuroSurface } from 'surfview';

const surface = new ColorMappedNeuroSurface(
  geometry,
  null,
  data,
  'plasma'
);
```

### Changing Colormaps

```javascript
// For DataLayer
layer.setColorMap('hot');
surface.updateColors();

// For ColorMappedNeuroSurface
surface.setColorMap('inferno');
```

## Custom Colormaps

### From Color Array

```javascript
import { ColorMap } from 'surfview';

const customMap = new ColorMap([
  [0, 0, 1],    // blue (low)
  [0, 1, 0],    // green (mid)
  [1, 1, 0],    // yellow
  [1, 0, 0]     // red (high)
], {
  range: [0, 100]
});
```

### Get Available Maps

```javascript
import { ColorMap } from 'surfview';

const mapNames = ColorMap.getAvailableMaps();
console.log(mapNames);
// ['viridis', 'plasma', 'inferno', 'magma', 'hot', ...]
```

## Data Range and Thresholding

### Setting Range

The range determines how data values map to colors.

```javascript
const layer = new DataLayer('stats', data, null, 'RdBu', {
  range: [-3, 3]  // values outside this range are clamped
});

// Update range dynamically
layer.setRange([-5, 5]);
surface.updateColors();
```

### Thresholding

Values inside the threshold range become transparent.

```javascript
const layer = new DataLayer('activation', data, null, 'hot', {
  range: [-10, 10],
  threshold: [-2, 2]  // values between -2 and 2 are transparent
});

// Update threshold dynamically
layer.setThreshold([-1, 1]);
surface.updateColors();
```

## Colormap Tips

1. **Use perceptually uniform maps** (`viridis`, `plasma`) for accurate data representation
2. **Avoid `jet`** for quantitative data - it creates artificial boundaries
3. **Use diverging maps** (`RdBu`, `coolwarm`) when zero or center is meaningful
4. **Consider colorblindness** - `viridis` and `cividis` are colorblind-friendly
5. **Match the data** - sequential for ordered data, diverging for +/- data
