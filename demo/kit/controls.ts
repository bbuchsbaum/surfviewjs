import type { Corner, FilmOverlay } from './film';

/**
 * Margin controls. Every control is a native element (input, select, button, radio),
 * labelled, keyboard-operable, and optionally prints its value into a film corner.
 */

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

export interface Print {
  film: FilmOverlay;
  corner: Corner;
  /** Stable key for the corner line. */
  key: string;
  /** Short label printed before the value, e.g. "WINDOW". */
  label: string;
}

function print(target: Print | undefined, value: string) {
  target?.film.set(target.corner, target.key, target.label, value);
}

export function section(parent: HTMLElement, title?: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'margin-section';
  if (title) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    element.append(heading);
  }
  parent.append(element);
  return element;
}

export function note(parent: HTMLElement, text: string, className = 'margin-note'): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export interface SliderOptions {
  id?: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  print?: Print;
  onInput: (value: number) => void;
}

export interface SliderHandle {
  input: HTMLInputElement;
  set: (value: number, notify?: boolean) => void;
}

export function slider(parent: HTMLElement, options: SliderOptions): SliderHandle {
  const id = options.id ?? nextId('slider');
  const format = options.format ?? ((value: number) => String(value));
  const row = document.createElement('div');
  row.className = 'control control-slider';
  row.innerHTML = `<label for="${id}"></label><output for="${id}"></output>`;
  const label = row.querySelector('label')!;
  const output = row.querySelector('output')!;
  label.textContent = options.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  row.append(input);
  parent.append(row);
  const show = (value: number) => {
    const text = format(value);
    output.textContent = text;
    input.setAttribute('aria-valuetext', text);
    print(options.print, text);
  };
  input.addEventListener('input', () => {
    const value = Number(input.value);
    show(value);
    options.onInput(value);
  });
  show(options.value);
  return {
    input,
    set: (value, notify = false) => {
      input.value = String(value);
      show(value);
      if (notify) options.onInput(value);
    }
  };
}

export interface Choice<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceOptions<T extends string> {
  id?: string;
  label: string;
  options: ReadonlyArray<Choice<T>>;
  value: T;
  print?: Print;
  onChange: (value: T) => void;
}

/** A short set of mutually exclusive options as a radio group (segmented look). */
export function choice<T extends string>(parent: HTMLElement, options: ChoiceOptions<T>) {
  const name = options.id ?? nextId('choice');
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'control control-choice';
  fieldset.id = name;
  const legend = document.createElement('legend');
  legend.textContent = options.label;
  const group = document.createElement('div');
  group.className = 'choice-group';
  // Even rows: up to four options sit on one row; otherwise rows of three (four for 7–8).
  const count = options.options.length;
  group.style.setProperty('--choice-columns', String(count <= 4 ? count : count === 7 || count === 8 ? 4 : 3));
  fieldset.append(legend, group);
  const inputs = new Map<T, HTMLInputElement>();
  for (const option of options.options) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === options.value;
    const text = document.createElement('span');
    text.textContent = option.label;
    label.append(input, text);
    group.append(label);
    inputs.set(option.value, input);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      print(options.print, option.label);
      options.onChange(option.value);
    });
  }
  parent.append(fieldset);
  const initial = options.options.find(option => option.value === options.value);
  if (initial) print(options.print, initial.label);
  return {
    element: fieldset,
    set: (value: T, notify = false) => {
      const input = inputs.get(value);
      if (!input) return;
      input.checked = true;
      const option = options.options.find(entry => entry.value === value)!;
      print(options.print, option.label);
      if (notify) options.onChange(value);
    }
  };
}

export interface SelectOptions<T extends string> extends ChoiceOptions<T> {}

export function select<T extends string>(parent: HTMLElement, options: SelectOptions<T>) {
  const id = options.id ?? nextId('select');
  const row = document.createElement('div');
  row.className = 'control control-select';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = options.label;
  const element = document.createElement('select');
  element.id = id;
  for (const option of options.options) {
    const entry = document.createElement('option');
    entry.value = option.value;
    entry.textContent = option.label;
    element.append(entry);
  }
  element.value = options.value;
  row.append(label, element);
  parent.append(row);
  const labelOf = (value: string) => options.options.find(option => option.value === value)?.label ?? value;
  element.addEventListener('change', () => {
    print(options.print, labelOf(element.value));
    options.onChange(element.value as T);
  });
  print(options.print, labelOf(options.value));
  return { element, set: (value: T) => { element.value = value; print(options.print, labelOf(value)); } };
}

export interface ToggleOptions {
  id?: string;
  label: string;
  checked: boolean;
  print?: Print;
  onChange: (checked: boolean) => void;
}

export function toggle(parent: HTMLElement, options: ToggleOptions) {
  const id = options.id ?? nextId('toggle');
  const row = document.createElement('div');
  row.className = 'control control-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = options.checked;
  input.setAttribute('role', 'switch');
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = options.label;
  row.append(input, label);
  parent.append(row);
  input.addEventListener('change', () => {
    print(options.print, input.checked ? 'ON' : 'OFF');
    options.onChange(input.checked);
  });
  print(options.print, options.checked ? 'ON' : 'OFF');
  return { input, set: (checked: boolean) => { input.checked = checked; print(options.print, checked ? 'ON' : 'OFF'); } };
}

export interface ActionOptions {
  id?: string;
  label: string;
  /** "primary" is the chapter's one main action; everything else is plain. */
  kind?: 'primary' | 'plain';
  onClick: (button: HTMLButtonElement) => void | Promise<void>;
}

export function action(parent: HTMLElement, options: ActionOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.kind === 'primary' ? 'action action-primary' : 'action';
  if (options.id) button.id = options.id;
  button.textContent = options.label;
  button.addEventListener('click', () => {
    void options.onClick(button);
  });
  parent.append(button);
  return button;
}

/** A row of buttons laid out together. */
export function actions(parent: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'control-actions';
  parent.append(row);
  return row;
}

export function readout(parent: HTMLElement, label: string, id?: string) {
  const row = document.createElement('div');
  row.className = 'control control-readout';
  const name = document.createElement('span');
  name.className = 'readout-label';
  name.textContent = label;
  const value = document.createElement('output');
  if (id) value.id = id;
  value.setAttribute('aria-live', 'polite');
  row.append(name, value);
  parent.append(row);
  return { element: value, set: (text: string) => { value.textContent = text; } };
}

/** Fixed-precision number formatting with a real minus sign. */
export function fmt(value: number, digits = 2): string {
  return value.toFixed(digits).replace('-', '−');
}
