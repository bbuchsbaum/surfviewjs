#!/usr/bin/env node

/**
 * Lightweight unit checks for ColorMap behavior and events.
 */
import { ColorMap } from '../dist/neurosurface.es.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const cm = ColorMap.fromPreset('viridis');

  let rangeEvent = null;
  let thresholdEvent = null;
  let alphaEvent = null;

  cm.on('rangeChanged', (range) => { rangeEvent = range; });
  cm.on('thresholdChanged', (thresh) => { thresholdEvent = thresh; });
  cm.on('alphaChanged', (alpha) => { alphaEvent = alpha; });

  cm.setRange([0, 10]);
  cm.setThreshold([2, 4]);
  cm.setAlpha(0.5);

  assert(rangeEvent && rangeEvent[0] === 0 && rangeEvent[1] === 10, 'rangeChanged event not fired');
  assert(thresholdEvent && thresholdEvent[0] === 2 && thresholdEvent[1] === 4, 'thresholdChanged event not fired');
  assert(alphaEvent === 0.5, 'alphaChanged event not fired');

  // Value inside threshold band should be fully transparent for RGBA maps
  const hidden = cm.getColor(3);
  assert(hidden.length === 4, 'Expected RGBA color');
  assert(hidden[3] === 0, 'Thresholded value should be transparent');

  // Value outside threshold should be opaque
  const visible = cm.getColor(8);
  assert(visible[3] > 0, 'Value outside threshold should be visible');

  console.log('✓ ColorMap events and threshold behavior OK');
}

run().catch((err) => {
  console.error('ColorMap test failed:', err);
  process.exit(1);
});
