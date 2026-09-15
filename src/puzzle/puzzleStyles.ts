export const puzzleStyles = `
.sv-parcel-puzzle{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 292px;width:100%;height:100%;min-height:420px;background:#f0f3f4;color:#253843;font:14px/1.5 system-ui,-apple-system,sans-serif;overflow:hidden;border-radius:12px}
.sv-parcel-puzzle *{box-sizing:border-box}
.sv-parcel-puzzle-stage{position:relative;min-width:0;min-height:0;overflow:hidden}
.sv-parcel-puzzle-stage canvas{display:block;touch-action:none;outline-offset:-3px}
.sv-parcel-puzzle-status{position:absolute;left:18px;bottom:14px;right:18px;pointer-events:none;font-size:13px;color:#405762;overflow-wrap:anywhere}
.sv-parcel-puzzle-detail{padding:22px 20px;background:#fafbfb;border-left:1px solid #dce3e6;overflow-y:auto;min-width:0}
.sv-parcel-puzzle-detail h2{font-size:19px;line-height:1.25;margin:0 0 8px;font-weight:600;overflow-wrap:anywhere}
.sv-parcel-puzzle-detail p{margin:8px 0;color:#536671}
.sv-parcel-puzzle-detail select{width:100%;padding:8px 6px;margin:6px 0 20px;color:#253843;background:#fff;border:1px solid #cbd6dc;border-radius:6px;font:inherit}
.sv-parcel-puzzle-detail label{font-size:12px;color:#536671}
.sv-parcel-puzzle-detail button{font:inherit;color:#253843;background:#fff;border:1px solid #cbd6dc;border-radius:6px;padding:7px 10px;cursor:pointer}
.sv-parcel-puzzle-detail button:hover{background:#edf3f5}
.sv-parcel-puzzle-detail button:focus-visible,.sv-parcel-puzzle-detail select:focus-visible,.sv-parcel-puzzle canvas:focus-visible{outline:2px solid #23748a;outline-offset:2px}
.sv-parcel-puzzle-preview{height:220px;width:100%;margin:10px 0;position:relative;background:#edf1f2;border-radius:8px;overflow:hidden}
.sv-parcel-puzzle-preview canvas{display:block;width:100%;height:100%;touch-action:none}
.sv-parcel-puzzle-actions{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.sv-parcel-puzzle-custom{border-top:1px solid #dce3e6;margin-top:18px;padding-top:16px;overflow-wrap:anywhere}
.sv-parcel-puzzle-custom dl{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,1.7fr);gap:8px;margin:0}
.sv-parcel-puzzle-custom dt{color:#536671}
.sv-parcel-puzzle-custom dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.sv-parcel-puzzle-help{font-size:12px;color:#536671}
.sv-parcel-puzzle-empty{margin-top:24px}
@media(max-width:720px){.sv-parcel-puzzle{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(320px,1fr) auto;min-height:620px;overflow:visible;height:auto}.sv-parcel-puzzle-stage{height:420px}.sv-parcel-puzzle-detail{border-left:0;border-top:1px solid #dce3e6;overflow:visible}.sv-parcel-puzzle-preview{height:240px}}
`;
