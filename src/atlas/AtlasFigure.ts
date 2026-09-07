import { renderAtlasPlateSVG } from './AtlasPlateView';
import type { AtlasPlateStyle } from './AtlasPlateView';
import { parseAtlasPlateLayout } from './atlasLayout';
import type { AtlasPlateLayout } from './atlasLayout';
import type { AtlasPlate } from './types';

export interface AtlasFigureSpec {
  version: 1;
  title: string;
  subtitle: string;
  columns: 1 | 2;
  panels: { key: string; title: string; layout: AtlasPlateLayout }[];
  legend: { label: string; color: string }[];
}

export interface AtlasFigureSource { plate: AtlasPlate; style?: AtlasPlateStyle }

function xml(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Read a composition against its current source plates, before applying any pins.
 * Fills remain data-driven and are supplied separately to renderAtlasFigureSVG. */
export function parseAtlasFigureSpec(value: unknown, sources: ReadonlyMap<string, AtlasFigureSource>): AtlasFigureSpec {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid atlas figure');
  const spec = value as AtlasFigureSpec;
  if (spec.version !== 1) throw new RangeError('Unsupported atlas figure version');
  if (spec.columns !== 1 && spec.columns !== 2) throw new RangeError('Figure columns must be 1 or 2');
  const text = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || value.length > max) throw new TypeError(`Figure text must be a string of at most ${max} characters`);
    return value;
  };
  if (!Array.isArray(spec.panels) || spec.panels.length < 1 || spec.panels.length > 16) throw new RangeError('A figure needs 1–16 panels');
  if (!Array.isArray(spec.legend) || spec.legend.length > 100) throw new RangeError('Invalid figure legend');
  const seen = new Set<string>();
  const panels = spec.panels.map(panel => {
    if (!panel || typeof panel !== 'object') throw new TypeError('Invalid figure panel');
    const key = text(panel.key, 200), source = sources.get(key);
    if (!source) throw new RangeError(`Missing figure source ${key}`);
    if (seen.has(key)) throw new RangeError(`Duplicate figure panel ${key}`);
    seen.add(key);
    return { key, title: text(panel.title, 120), layout: parseAtlasPlateLayout(source.plate, panel.layout) };
  });
  const legend = spec.legend.map(item => {
    if (!item || typeof item !== 'object' || typeof item.color !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(item.color)) {
      throw new TypeError('Legend colors must use #RGB or #RRGGBB');
    }
    return { label: text(item.label, 100), color: item.color };
  });
  return { version: 1, title: text(spec.title, 120), subtitle: text(spec.subtitle, 300), columns: spec.columns, panels, legend };
}

function lines(text: string, capacity: number): string[] {
  const result: string[] = [];
  let line = '';
  for (const character of text) {
    if (character === '\n' || line.length >= capacity) { result.push(line); line = ''; }
    if (character !== '\n') line += character;
  }
  if (line) result.push(line);
  return result;
}

/** Compose editable vector panels, a title, and one shared categorical legend.
 * Always exports overview geometry and saved pins, independent of inspection zoom. */
export function renderAtlasFigureSVG(value: AtlasFigureSpec, sources: ReadonlyMap<string, AtlasFigureSource>): string {
  const spec = parseAtlasFigureSpec(value, sources);
  const columns = Math.min(spec.columns, spec.panels.length), margin = 36, gap = 32;
  const cellWidth = Math.max(...spec.panels.map(p => sources.get(p.key)!.plate.width));
  const width = margin * 2 + columns * cellWidth + (columns - 1) * gap;
  let y = margin;
  const content: string[] = [];
  for (const [text, size, family] of [[spec.title, 36, 'Georgia, serif'], [spec.subtitle, 14, 'Arial, sans-serif']] as const) {
    for (const line of lines(text, Math.floor((width - margin * 2) / (size * 0.8)))) {
      y += size * 1.35;
      content.push(`<text x="${margin}" y="${y}" font-size="${size}" font-family="${family}" fill="#443b33">${xml(line)}</text>`);
    }
  }
  y += 28;
  let x = margin;
  for (const item of spec.legend) {
    const itemLines = lines(item.label, Math.max(10, Math.floor((width - margin * 2 - 36) / 9)));
    const itemWidth = Math.max(...itemLines.map(line => line.length)) * 9 + 36;
    if (x > margin && x + itemWidth > width - margin) { x = margin; y += 26; }
    content.push(`<rect x="${x}" y="${y - 11}" width="11" height="11" rx="2" fill="${item.color}"/>`);
    for (const [i, line] of itemLines.entries()) content.push(`<text x="${x + 18}" y="${y + i * 20}" font-size="13" font-family="Arial, sans-serif" fill="#65584c">${xml(line)}</text>`);
    if (itemLines.length > 1) { y += (itemLines.length - 1) * 20 + 26; x = margin; }
    else x += itemWidth;
  }
  if (spec.legend.length) y += 30;
  content.push(`<path d="M${margin},${y}H${width - margin}" stroke="#ddd5cc"/>`);
  y += 16;
  for (let row = 0; row < spec.panels.length; row += columns) {
    const entries = spec.panels.slice(row, row + columns);
    const headingHeight = Math.max(...entries.map(panel => Math.max(1,
      lines(panel.title, Math.floor((cellWidth - 45) / 13)).length))) * 27 + 15;
    let rowHeight = 0;
    for (const [column, panel] of entries.entries()) {
      const { plate, style } = sources.get(panel.key)!;
      const px = margin + column * (cellWidth + gap);
      const scale = cellWidth / plate.width;
      const heading = lines(panel.title, Math.floor((cellWidth - 45) / 13));
      content.push(`<text x="${px}" y="${y + 25}" font-family="Georgia, serif" font-style="italic" font-size="25">${String.fromCharCode(65 + row + column)}</text>`);
      for (const [i, line] of heading.entries()) content.push(`<text x="${px + 35}" y="${y + 24 + i * 27}" font-family="Arial, sans-serif" font-size="17" fill="#756a5f">${xml(line)}</text>`);
      const svg = renderAtlasPlateSVG(plate, { ...style, selectedParcelId: null }, { layout: panel.layout });
      content.push(`<g transform="translate(${px} ${y + headingHeight}) scale(${scale})">${svg}</g>`);
      rowHeight = Math.max(rowHeight, headingHeight + plate.height * scale);
    }
    y += rowHeight + gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + margin}" viewBox="0 0 ${width} ${y + margin}" role="img" aria-label="${xml(spec.title)}">` +
    `<title>${xml(spec.title)}</title><metadata>${xml(JSON.stringify(spec))}</metadata><rect width="100%" height="100%" fill="#ffffff"/>${content.join('')}</svg>`;
}
