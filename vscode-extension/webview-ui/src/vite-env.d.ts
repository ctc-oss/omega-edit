interface VsCodeApi<State = unknown> {
  getState(): State | undefined
  setState(state: State): void
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>
