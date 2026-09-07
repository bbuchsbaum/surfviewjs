// Presentation colors only; network identity comes from the source label table.
export const mutedNetworkColors: Readonly<Record<string, string>> = {
  Vis: '#b7a3c5', SomMot: '#9db9cb', DorsAttn: '#a8bb9c',
  SalVentAttn: '#c9aec4', Limbic: '#d7d1a8', Cont: '#d9b685', Default: '#cea8a1',
  VisCent: '#b29bc0', VisPeri: '#cdc0d6', SomMotA: '#92b4c8', SomMotB: '#bfd0d9',
  DorsAttnA: '#a0b897', DorsAttnB: '#c2cfac', SalVentAttnA: '#c8aac5', SalVentAttnB: '#dccbd8',
  LimbicA: '#d2cc9f', LimbicB: '#e0dabc', ContA: '#d8b283', ContB: '#e3c7a0', ContC: '#bba58c',
  DefaultA: '#c99794', DefaultB: '#d9b5aa', DefaultC: '#b5848c', TempPar: '#a1bfb9'
};

export const networkNames: Readonly<Record<string, string>> = {
  Vis: 'Visual', SomMot: 'Somatomotor', DorsAttn: 'Dorsal attention',
  SalVentAttn: 'Salience / ventral attention', Limbic: 'Limbic', Cont: 'Control', Default: 'Default'
};
