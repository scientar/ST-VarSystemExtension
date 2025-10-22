import type { createJSONEditor } from "vanilla-jsoneditor";

/**
 * JSON 编辑器配置选项
 */
export interface VariableBlockEditorOptions {
  /** 编辑器容器（HTMLElement 或 ID 字符串） */
  container?: HTMLElement | string;
  /** 容器元素 ID */
  containerId?: string;
  /** 初始 JSON 值 */
  initialValue?: unknown;
  /** 是否只读 */
  readOnly?: boolean;
  /** 内容变化回调 */
  onChange?: (
    content: EditorContent,
    previousContent: EditorContent | null,
    metadata: EditorMetadata,
  ) => void;
  /** 降级为纯文本模式时的回调 */
  onFallback?: () => void;
  /** 编辑器准备就绪时的回调 */
  onReady?: (instance: VariableBlockEditorInstance) => void;
  /** 默认编辑器模式 */
  defaultMode?: EditorMode | null;
}

/**
 * 编辑器模式
 */
export type EditorMode = "tree" | "text" | "table";

/**
 * 编辑器内容格式
 */
export interface EditorContent {
  /** JSON 对象（解析成功时存在） */
  json?: unknown;
  /** 原始文本（text 模式时存在） */
  text?: string;
}

/**
 * 编辑器元数据
 */
export interface EditorMetadata {
  /** 内容错误列表 */
  contentErrors?: Array<{ message: string }>;
}

/**
 * 降级实例（纯文本模式）
 */
export interface FallbackInstance {
  isFallback: true;
  set(content: { json: unknown }): void;
  get(): EditorContent;
  destroy(): void;
}

/**
 * JSON 编辑器实例（vanilla-jsoneditor）
 */
export type JSONEditorInstance = ReturnType<typeof createJSONEditor>;

/**
 * 变量块编辑器实例
 */
export interface VariableBlockEditorInstance {
  /** 确保编辑器已初始化 */
  ensureReady(): Promise<JSONEditorInstance | FallbackInstance | null>;
  /** 设置编辑器内容 */
  setValue(value: unknown, options?: { silent?: boolean }): void;
  /** 获取编辑器内容 */
  getValue(): unknown;
  /** 直接设置内容（代理方法） */
  set(content: EditorContent): void;
  /** 直接获取内容（代理方法） */
  get(): EditorContent;
  /** 设置编辑器模式 */
  setMode(mode: EditorMode): void;
  /** 获取当前模式 */
  getMode(): EditorMode | null;
  /** 销毁编辑器 */
  destroy(): void;
  /** 是否处于降级模式 */
  isFallback(): boolean;
  /** 设置容器 */
  setContainer(container: HTMLElement | string): void;
}
