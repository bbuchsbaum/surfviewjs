export interface ScenarioRunContext {
  mount: HTMLElement;
  panel: HTMLElement;
  status: (message: string) => void;
  perf: (message: string) => void;
  setBusy: (busy: boolean, label?: string) => void;
}

export type ScenarioCleanup = (() => void | Promise<void>) | void;

export interface Scenario {
  id: string;
  title: string;
  description: string;
  tags: string[];
  run: (ctx: ScenarioRunContext) => ScenarioCleanup | Promise<ScenarioCleanup>;
}
