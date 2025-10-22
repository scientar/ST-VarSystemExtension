import { destr, safeDestr } from "destr";
import { debounce } from "lodash";
import { createJSONEditor, type Mode } from "vanilla-jsoneditor";
import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import type {
  EditorContent,
  EditorMetadata,
  EditorMode,
  FallbackInstance,
  JSONEditorInstance,
  VariableBlockEditorInstance,
  VariableBlockEditorOptions,
} from "./variableBlockEditor.types";

export function createVariableBlockEditor(
  options: VariableBlockEditorOptions = {},
): VariableBlockEditorInstance {
  const {
    container,
    containerId,
    initialValue,
    readOnly = false,
    onChange,
    onFallback,
    onReady,
    defaultMode = null, // 新增：默认模式（'tree', 'text', 'table'）
  } = options;

  let targetContainer: HTMLElement | null = resolveContainer(
    container,
    containerId,
  );
  let editorInstance: JSONEditorInstance | null = null;
  let fallbackInstance: FallbackInstance | null = null;
  let mounted = false;
  let currentValue: unknown = cloneValue(initialValue ?? {});
  let pendingValue: unknown | null = null;
  let silentUpdate = false;

  // 从 localStorage 读取用户偏好的模式，或使用传入的默认模式
  const savedMode = localStorage.getItem(
    "varSystemEditorMode",
  ) as EditorMode | null;
  let currentMode: EditorMode = (savedMode ||
    defaultMode ||
    "text") as EditorMode; // 追踪当前模式

  function resolveContainer(
    containerOrElement: HTMLElement | string | undefined,
    id: string | undefined,
  ): HTMLElement | null {
    if (containerOrElement instanceof HTMLElement) {
      return containerOrElement;
    }
    if (typeof containerOrElement === "string") {
      return document.getElementById(containerOrElement);
    }
    if (typeof id === "string") {
      return document.getElementById(id);
    }
    return null;
  }

  function cloneValue(value: unknown): unknown {
    if (value == null) {
      return value;
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (_error) {
        return JSON.parse(JSON.stringify(value));
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  async function ensureReady(): Promise<
    JSONEditorInstance | FallbackInstance | null
  > {
    if (editorInstance) {
      return editorInstance;
    }

    targetContainer =
      targetContainer || resolveContainer(container, containerId);

    if (!targetContainer) {
      return null;
    }

    try {
      // 【参照酒馆助手】创建 updateModel 函数处理内容更新
      function updateModel(
        updated: EditorContent,
        previousContent: EditorContent | null,
        metadata: EditorMetadata,
      ) {
        if (silentUpdate) {
          return;
        }

        // text 模式：只有验证通过才更新
        if (updated?.text !== undefined) {
          if (
            editorInstance?.validate &&
            editorInstance.validate() === undefined
          ) {
            // 验证通过，解析并更新
            currentValue = cloneValue(destr(updated.text));
            if (typeof onChange === "function") {
              onChange(
                { json: currentValue, text: updated.text },
                previousContent,
                metadata,
              );
            }
          }
          // 验证失败：直接 return，不更新任何东西（关键！）
          return;
        }

        // tree/table 模式：直接使用 json
        if (updated?.json !== undefined) {
          currentValue = cloneValue(updated.json);
          if (typeof onChange === "function") {
            onChange(updated, previousContent, metadata);
          }
        }
      }

      // 【参照酒馆助手】text 模式使用 300ms 防抖
      const updateModelDebounced = debounce(updateModel, 300);

      editorInstance = createJSONEditor({
        target: targetContainer,
        props: {
          content: { json: currentValue ?? {} },
          mode: currentMode, // 使用追踪的当前模式
          readOnly,
          // 【中文化】设置编辑器界面语言为中文
          language: "zh",
          // 【关键】设置自定义 parser，使用 safeDestr 而不是 JSON.parse
          parser: {
            parse: safeDestr,
            stringify: JSON.stringify,
          },
          // 【参照酒馆助手】追踪模式变化
          onChangeMode: (newMode: EditorMode) => {
            currentMode = newMode;
            // 保存用户偏好到 localStorage
            localStorage.setItem("varSystemEditorMode", newMode);
          },
          // 【参照酒馆助手】根据模式选择是否防抖
          onChange: (
            updated: EditorContent,
            previousContent: EditorContent | null,
            metadata: EditorMetadata,
          ) => {
            if (currentMode === "text") {
              // text 模式:使用防抖版本
              updateModelDebounced(updated, previousContent, metadata);
            } else {
              // tree/table 模式:立即更新
              updateModel(updated, previousContent, metadata);
            }
          },
        },
      });

      mounted = true;

      if (!editorInstance || typeof editorInstance.set !== "function") {
        throw new Error("JSON 编辑器实例缺少 set 方法");
      }

      editorInstance.isFallback = false;

      if (pendingValue !== null) {
        setValue(pendingValue, { silent: true });
        pendingValue = null;
      }

      return editorInstance;
    } catch (error) {
      console.error("[VariableBlockEditor] 初始化 JSON 编辑器失败", error);
      return ensureFallback();
    }
  }

  function ensureFallback(): FallbackInstance | null {
    targetContainer =
      targetContainer || resolveContainer(container, containerId);

    // 统一的空值检查
    if (!targetContainer) {
      return null;
    }

    if (fallbackInstance) {
      return fallbackInstance;
    }

    // 此时 targetContainer 已经通过了上面的空值检查
    // 为了满足 TypeScript 类型检查，使用非空断言或再次检查
    targetContainer.innerHTML = "";
    targetContainer.style.display = "flex";
    targetContainer.style.flexDirection = "column";
    targetContainer.style.alignItems = "stretch";

    const notice = document.createElement("div");
    notice.style.fontSize = "12px";
    notice.style.padding = "6px";
    notice.style.background = "rgba(255, 255, 255, 0.05)";
    notice.style.borderBottom = "1px solid var(--SmartThemeBorderColor, #333)";
    notice.textContent = "JSON 编辑器资源加载失败,已降级为纯文本模式。";

    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    textarea.style.width = "100%";
    textarea.style.height = "calc(100% - 32px)";
    textarea.style.minHeight = "220px";
    textarea.style.background = "transparent";
    textarea.style.color = "inherit";
    textarea.style.border = "none";
    textarea.style.padding = "10px";
    textarea.style.resize = "vertical";
    textarea.style.fontFamily = "var(--monospaceFont, monospace)";
    textarea.style.fontSize = "13px";
    textarea.style.lineHeight = "1.4";
    textarea.style.borderRadius = "0";
    textarea.readOnly = Boolean(readOnly);

    targetContainer.appendChild(notice);
    targetContainer.appendChild(textarea);

    const handleInput = () => {
      if (silentUpdate) {
        return;
      }

      let parsed: unknown;
      const contentErrors: Array<{ message: string }> = [];

      if (textarea.value.trim().length === 0) {
        parsed = {};
      } else {
        try {
          parsed = JSON.parse(textarea.value);
        } catch (error: unknown) {
          contentErrors.push({
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const content =
        contentErrors.length > 0 ? { json: undefined } : { json: parsed };

      currentValue = cloneValue(content?.json ?? currentValue ?? {});

      if (typeof onChange === "function") {
        onChange(content, null, { contentErrors });
      }
    };

    textarea.addEventListener("input", handleInput);

    fallbackInstance = {
      isFallback: true,
      set({ json }: { json: unknown }) {
        silentUpdate = true;
        try {
          const value = json === undefined || json === null ? {} : json;
          textarea.value = JSON.stringify(value, null, 2);
        } catch (_error) {
          textarea.value = "{}";
        }
        silentUpdate = false;
      },
      get(): EditorContent {
        try {
          const json = textarea.value.trim().length
            ? JSON.parse(textarea.value)
            : {};
          return { json };
        } catch (_error) {
          return { json: undefined };
        }
      },
      destroy(): void {
        textarea.removeEventListener("input", handleInput);
        targetContainer.innerHTML = "";
      },
    };

    mounted = true;

    const initial = pendingValue !== null ? pendingValue : (currentValue ?? {});
    fallbackInstance.set({ json: initial });
    pendingValue = null;

    if (typeof onFallback === "function") {
      onFallback();
    }

    return fallbackInstance;
  }

  function setValue(
    value: unknown,
    { silent = false }: { silent?: boolean } = {},
  ): void {
    const normalized = value === undefined || value === null ? {} : value;
    currentValue = cloneValue(normalized);

    if (!mounted || (!editorInstance && !fallbackInstance)) {
      pendingValue = cloneValue(normalized);
      return;
    }

    if (silent) {
      silentUpdate = true;
    }

    try {
      // 优先使用 editorInstance，否则使用 fallbackInstance
      const instance = editorInstance || fallbackInstance;
      instance?.set({ json: cloneValue(normalized) });
    } catch (error) {
      console.error("[VariableBlockEditor] 设置编辑内容失败", error);
    }

    if (silent) {
      silentUpdate = false;
    }
  }

  function getValue(): unknown {
    // 优先使用 editorInstance，否则使用 fallbackInstance
    const instance = editorInstance || fallbackInstance;
    if (!instance) {
      return cloneValue(currentValue ?? {});
    }

    try {
      const content = instance.get();
      // 添加类型守卫：检查 content 是否是对象且有 json 属性
      if (
        content &&
        typeof content === "object" &&
        "json" in content &&
        content.json !== undefined
      ) {
        return cloneValue(content.json);
      }
    } catch (error) {
      console.error("[VariableBlockEditor] 读取编辑内容失败", error);
    }

    return cloneValue(currentValue ?? {});
  }

  function destroy(): void {
    if (!mounted) {
      return;
    }

    try {
      editorInstance?.destroy?.();
      fallbackInstance?.destroy?.();
    } catch (error) {
      console.error("[VariableBlockEditor] 销毁编辑器失败", error);
    }

    editorInstance = null;
    fallbackInstance = null;
    mounted = false;

    // 保持现有的空值检查
    if (targetContainer) {
      targetContainer.innerHTML = "";
    }
    targetContainer = null;
  }

  function isFallback(): boolean {
    return Boolean(fallbackInstance) && !editorInstance;
  }

  function setContainer(nextContainer: HTMLElement | string): void {
    targetContainer = resolveContainer(nextContainer, containerId);
  }

  // 代理方法：直接调用底层编辑器实例的 set/get（如果已初始化）
  function set(content: EditorContent): void {
    // 优先使用 editorInstance，否则使用 fallbackInstance
    const instance = editorInstance || fallbackInstance;
    if (instance && typeof instance.set === "function") {
      // 确保传递的内容包含 json 属性
      const normalizedContent = {
        json: content?.json ?? {},
      };
      instance.set(normalizedContent);
      return;
    }
    // 如果还没初始化，通过 setValue 缓存
    if (content?.json !== undefined) {
      setValue(content.json);
    }
  }

  function get(): EditorContent {
    // 优先使用 editorInstance，否则使用 fallbackInstance
    const instance = editorInstance || fallbackInstance;
    if (instance && typeof instance.get === "function") {
      const content = instance.get();

      // 处理 text 模式：如果只有 text 没有 json，尝试验证并解析
      // 添加类型守卫检查
      if (
        content &&
        typeof content === "object" &&
        "text" in content &&
        content.text !== undefined
      ) {
        // 检查是否缺少 json 属性
        if (!("json" in content) || content.json === undefined) {
          // 更严格的检查：确保 validate 方法存在（只有 editorInstance 有）
          if (
            editorInstance?.validate &&
            typeof editorInstance.validate === "function"
          ) {
            const validationErrors = editorInstance.validate();
            if (validationErrors === undefined) {
              // 验证通过，解析 text 为 json
              return {
                json: destr(content.text),
                text: content.text,
              };
            }
          }
          // 验证失败或方法不存在，返回原始 content（json === undefined 表示有错误）
          return content;
        }
      }

      return content;
    }
    // 降级：返回当前值
    return { json: cloneValue(currentValue ?? {}) };
  }

  /**
   * 切换编辑器模式
   */
  function setMode(mode: "tree" | "text" | "table"): void {
    if (!editorInstance || typeof editorInstance.updateProps !== "function") {
      console.warn("[VariableBlockEditor] 编辑器未初始化或不支持 updateProps");
      return;
    }

    // 保存用户偏好到 localStorage
    localStorage.setItem("varSystemEditorMode", mode);

    // 更新编辑器模式 - 使用正确的 Mode 类型
    editorInstance.updateProps({ mode: mode as Mode });
  }

  /**
   * 获取当前编辑器模式
   */
  function getMode(): EditorMode | null {
    const savedMode = localStorage.getItem("varSystemEditorMode");
    return savedMode as EditorMode | null;
  }

  const instance: VariableBlockEditorInstance = {
    ensureReady,
    setValue,
    getValue,
    set,
    get,
    setMode,
    getMode,
    destroy,
    isFallback,
    setContainer,
  };

  // 在返回实例前调用 onReady，传入完整的 API 实例
  if (typeof onReady === "function") {
    // 异步调用，确保编辑器初始化完成后通知
    instance.ensureReady().then(() => {
      onReady(instance);
    });
  }

  return instance;
}
