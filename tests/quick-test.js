import { readFileSync } from 'fs';
import { parseGIfTISurface } from '../src/loaders.js';
import { JSDOM } from 'jsdom';

// Make DOMParser available
global.DOMParser = new JSDOM().window.DOMParser;

// Read and parse the ASCII GIFTI file
const asciiContent = readFileSync('./tests/data/ascii.surf.gii', 'utf-8');
console.log('File size:', asciiContent.length, 'bytes');

// Check file structure
console.log('\nFirst 500 characters:');
console.log(asciiContent.substring(0, 500));

// Parse it
console.log('\nParsing GIFTI...');
const result = parseGIfTISurface(asciiContent);

console.log('\nParse result:');
console.log('- Vertices:', result.vertices ? `${result.vertices.length / 3} points` : 'null');
console.log('- Faces:', result.faces ? `${result.faces.length / 3} triangles` : 'null');

if (result.vertices) {
  console.log('- Vertex data type:', result.vertices.constructor.name);
  console.log('- First vertex:', result.vertices.slice(0, 3));
  console.log('- Vertex range:', `[${Math.min(...result.vertices).toFixed(2)}, ${Math.max(...result.vertices).toFixed(2)}]`);
}

if (result.faces) {
  console.log('- Face data type:', result.faces.constructor.name);
  console.log('- First face:', result.faces.slice(0, 3));
  console.log('- Max vertex index:', Math.max(...result.faces));
}