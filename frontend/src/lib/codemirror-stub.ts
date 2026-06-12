/**
 * Stub for CodeMirror peer-dependencies of @vitaliysimkin/t-components.
 *
 * Чому це існує: барель кіту (`dist/index.js`) еагерно імпортує codemirror на
 * верхньому рівні модуля (для свого компонента-редактора коду). Statok цей
 * редактор НЕ використовує і не тягне codemirror у залежності. При `vite build`
 * Rollup tree-shake-ає ці гілки (вони ще й позначені `external` у vite.config),
 * але `vite dev` через esbuild optimizeDeps сканує весь барель і падає на
 * нерезолвлених `codemirror`, `@codemirror/state`, `@codemirror/lang-json`,
 * `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`.
 *
 * Тому в `vite.config.ts` усі п'ять specifier-ів алясяться сюди. Експорти —
 * no-op заглушки лише для задоволення bind-ів на верхньому рівні барелю; код,
 * що їх реально викликає, у Statok ніколи не виконується.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- "codemirror" ---
export class EditorView {
  static theme(..._args: any[]): any {
    return []
  }
  static updateListener = { of: (..._args: any[]): any => [] }
  static lineWrapping: any = []
  constructor(..._args: any[]) {
    /* no-op */
  }
  dispatch(..._args: any[]): void {
    /* no-op */
  }
  destroy(): void {
    /* no-op */
  }
}

export const basicSetup: any = []

// --- "@codemirror/state" ---
export class Compartment {
  of(..._args: any[]): any {
    return []
  }
  reconfigure(..._args: any[]): any {
    return []
  }
}

export class EditorState {
  static readOnly = { of: (..._args: any[]): any => [] }
  static create(..._args: any[]): any {
    return {}
  }
}

// --- "@codemirror/lang-json" ---
export function json(..._args: any[]): any {
  return []
}

// --- "@codemirror/lang-markdown" ---
export function markdown(..._args: any[]): any {
  return []
}

// --- "@codemirror/theme-one-dark" ---
export const oneDark: any = []
