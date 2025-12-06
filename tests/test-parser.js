#!/usr/bin/env node

/**
 * Test script for GIFTI parser
 * Uses local fixtures in tests/data to avoid network dependency.
 */

// Use built bundle to avoid module resolution issues when running under Node directly
import { parseGIfTISurface } from '../dist/neurosurface.es.js';
import { JSDOM } from 'jsdom';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Make DOMParser available globally for the parser
global.DOMParser = new JSDOM().window.DOMParser;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_FILES = [
  {
    name: 'ASCII Surface',
    path: path.join(__dirname, 'data', 'ascii.surf.gii')
  },
  {
    name: 'Base64 Surface', 
    path: path.join(__dirname, 'data', 'base64.surf.gii')
  },
  {
    name: 'GZip Base64 Surface',
    path: path.join(__dirname, 'data', 'tetrahedron_gzip.gii')
  },
  {
    name: 'fsaverage5 LH pial (deflate mislabelled as GZipBase64Binary)',
    path: path.join(__dirname, 'data', 'fsaverage5-lh-pial.gii')
  },
  {
    name: 'fsaverage5 RH pial (deflate mislabelled as GZipBase64Binary)',
    path: path.join(__dirname, 'data', 'fsaverage5-rh-pial.gii')
  }
];

async function testGIfTIFile(name, filePath) {
  console.log(`\nTesting ${name}...`);
  console.log(`Path: ${filePath}`);
  
  try {
    const text = await readFile(filePath, 'utf8');
    console.log(`File size: ${text.length} bytes`);
    
    // Parse the GIFTI
    const result = parseGIfTISurface(text);
    
    if (result.vertices && result.faces) {
      console.log(`✓ Successfully parsed`);
      console.log(`  - Vertices: ${result.vertices.length / 3}`);
      console.log(`  - Faces: ${result.faces.length / 3}`);
      console.log(`  - Vertex range: [${Math.min(...result.vertices)}, ${Math.max(...result.vertices)}]`);
      
      // Basic validation
      if (result.vertices.length % 3 !== 0) {
        console.warn('  ⚠ Warning: Vertex count not divisible by 3');
      }
      if (result.faces.length % 3 !== 0) {
        console.warn('  ⚠ Warning: Face count not divisible by 3');
      }
      
      // Check face indices are valid
      const maxIndex = Math.max(...result.faces);
      const numVertices = result.vertices.length / 3;
      if (maxIndex >= numVertices) {
        console.warn(`  ⚠ Warning: Face index ${maxIndex} exceeds vertex count ${numVertices}`);
      }
      
      return true;
    } else {
      console.error('✗ Failed to parse - missing vertices or faces');
      return false;
    }
    
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('GIFTI Parser Test Suite');
  console.log('======================');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of TEST_FILES) {
    const success = await testGIfTIFile(test.name, test.path);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n======================');
  console.log(`Tests passed: ${passed}`);
  console.log(`Tests failed: ${failed}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}
