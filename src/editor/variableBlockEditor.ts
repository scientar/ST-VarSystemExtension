const stylePromises = new Map();
const modulePromises = new Map();
const assetFailures = new Map();

export function createVariableBlockEditor(options = {}) {
  const {
    container,
    containerId,
    initialValue,
    styleUrl,
    scriptUrl,
    readOnly = false,
    onChange,
    onFallback,
    onReady,
    defaultMode = null, // 新增：默认模式（'tree', 'text', 'table'）
  } = options;

  let targetContainer = resolveContainer(container, containerId);
  let editorInstance = null;
  let fallbackInstance = null;
  let mounted = false;
  let currentValue = cloneValue(initialValue ?? {});
  let pendingValue = null;
  let silentUpdate = false;

  function resolveContainer(containerOrElement, id) {
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

  function cloneValue(value) {
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

  async function ensureReady() {
    if (editorInstance) {
      return editorInstance;
    }

    targetContainer =
      targetContainer || resolveContainer(container, containerId);

    if (!targetContainer) {
      return null;
    }

    try {
      await ensureStyle(styleUrl);
      const moduleExports = await ensureModule(scriptUrl);
      const createJSONEditor =
        moduleExports?.createJSONEditor ?? globalThis.createJSONEditor;

      if (typeof createJSONEditor !== "function") {
        throw new Error("JSON 编辑器模块未提供 createJSONEditor");
      }

      // 从 localStorage 读取用户偏好的模式，或使用传入的默认模式
      const savedMode = localStorage.getItem("varSystemEditorMode");
      const initialMode = savedMode || defaultMode || "text";

      editorInstance = createJSONEditor({
        target: targetContainer,
        props: {
          content: { json: currentValue ?? {} },
          mode: initialMode, // 使用保存的或默认的模式
          mainMenuBar: true, // 保留主菜单（格式化、压缩等功能）
          navigationBar: false, // 隐藏导航栏（节省空间）
          statusBar: false, // 隐藏状态栏（节省空间）
          readOnly,
          onChange: (content, previousContent, metadata) => {
            if (silentUpdate) {
              return;
            }

            // 【新增】处理 text 模式
            let processedContent = content;
            if (content?.text !== undefined) {
              // Text 模式：需要验证并解析
              const validationErrors = editorInstance.validate();
              if (validationErrors === undefined) {
                // 无错误，使用 JSON.parse 解析
                try {
                  const parsed = JSON.parse(content.text);
                  processedContent = { json: parsed, text: content.text };
                } catch (e) {
                  processedContent = { json: undefined, text: content.text };
                }
              } else {
                // 有错误
                processedContent = { json: undefined, text: content.text };
              }
            }

            currentValue = cloneValue(processedContent?.json ?? currentValue ?? {});
            if (typeof onChange === "function") {
              onChange(processedContent, previousContent, metadata);
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

      if (typeof onReady === "function") {
        onReady(editorInstance);
      }

      return editorInstance;
    } catch (error) {
      console.error("[VariableBlockEditor] 初始化 JSON 编辑器失败", error);
      return ensureFallback();
    }
  }

  function ensureFallback() {
    targetContainer =
      targetContainer || resolveContainer(container, containerId);
    if (!targetContainer) {
      return null;
    }

    if (fallbackInstance) {
      return fallbackInstance;
    }

    targetContainer.innerHTML = "";
    targetContainer.style.display = "flex";
    targetContainer.style.flexDirection = "column";
    targetContainer.style.alignItems = "stretch";

    const notice = document.createElement("div");
    notice.style.fontSize = "12px";
    notice.style.padding = "6px";
    notice.style.background = "rgba(255, 255, 255, 0.05)";
    notice.style.borderBottom = "1px solid var(--SmartThemeBorderColor, #333)";
    notice.textContent = "JSON 编辑器资源加载失败，已降级为纯文本模式。";

    const textarea = document.createElement("textarea");
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

      let parsed;
      const contentErrors = [];

      if (textarea.value.trim().length === 0) {
        parsed = {};
      } else {
        try {
          parsed = JSON.parse(textarea.value);
        } catch (error) {
          contentErrors.push({ message: error?.message ?? String(error) });
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
      set({ json }) {
        silentUpdate = true;
        try {
          const value = json === undefined || json === null ? {} : json;
          textarea.value = JSON.stringify(value, null, 2);
        } catch (_error) {
          textarea.value = "{}";
        }
        silentUpdate = false;
      },
      get() {
        try {
          const json = textarea.value.trim().length
            ? JSON.parse(textarea.value)
            : {};
          return { json };
        } catch (_error) {
          return { json: undefined };
        }
      },
      destroy() {
        textarea.removeEventListener("input", handleInput);
        targetContainer.innerHTML = "";
      },
    };

    editorInstance = fallbackInstance;
    mounted = true;

    const initial = pendingValue !== null ? pendingValue : (currentValue ?? {});
    fallbackInstance.set({ json: initial });
    pendingValue = null;

    if (typeof onFallback === "function") {
      onFallback();
    }

    return fallbackInstance;
  }

  function setValue(value, { silent = false } = {}) {
    const normalized = value === undefined || value === null ? {} : value;
    currentValue = cloneValue(normalized);

    if (!mounted || !editorInstance) {
      pendingValue = cloneValue(normalized);
      return;
    }

    if (silent) {
      silentUpdate = true;
    }

    try {
      editorInstance.set({ json: cloneValue(normalized) });
    } catch (error) {
      console.error("[VariableBlockEditor] 设置编辑内容失败", error);
    }

    if (silent) {
      silentUpdate = false;
    }
  }

  function getValue() {
    if (!editorInstance) {
      return cloneValue(currentValue ?? {});
    }

    try {
      const content = editorInstance.get();
      if (content?.json !== undefined) {
        return cloneValue(content.json);
      }
    } catch (error) {
      console.error("[VariableBlockEditor] 读取编辑内容失败", error);
    }

    return cloneValue(currentValue ?? {});
  }

  function destroy() {
    if (!mounted) {
      return;
    }

    try {
      editorInstance?.destroy?.();
    } catch (error) {
      console.error("[VariableBlockEditor] 销毁编辑器失败", error);
    }

    editorInstance = null;
    fallbackInstance = null;
    mounted = false;
    targetContainer = null;
  }

  function isFallback() {
    return Boolean(fallbackInstance);
  }

  function setContainer(nextContainer) {
    targetContainer = resolveContainer(nextContainer, containerId);
  }

  // 代理方法：直接调用底层编辑器实例的 set/get（如果已初始化）
  function set(content) {
    if (editorInstance && typeof editorInstance.set === "function") {
      return editorInstance.set(content);
    }
    // 如果还没初始化，通过 setValue 缓存
    if (content?.json !== undefined) {
      setValue(content.json);
    }
  }

  function get() {
    if (editorInstance && typeof editorInstance.get === "function") {
      return editorInstance.get();
    }
    // 降级：返回当前值
    return { json: cloneValue(currentValue ?? {}) };
  }

  /**
   * 切换编辑器模式
   * @param {string} mode - 'tree', 'text', 或 'table'
   */
  function setMode(mode) {
    if (!editorInstance || typeof editorInstance.updateProps !== "function") {
      console.warn("[VariableBlockEditor] 编辑器未初始化或不支持 updateProps");
      return;
    }

    // 保存用户偏好到 localStorage
    localStorage.setItem("varSystemEditorMode", mode);

    // 更新编辑器模式
    editorInstance.updateProps({ mode });
  }

  /**
   * 获取当前编辑器模式
   * @returns {string|null}
   */
  function getMode() {
    return localStorage.getItem("varSystemEditorMode");
  }

  return {
    ensureReady,
    setValue,
    getValue,
    set, // 新增：代理底层实例的 set 方法
    get, // 新增：代理底层实例的 get 方法
    setMode, // 新增：切换编辑器模式
    getMode, // 新增：获取当前模式
    destroy,
    isFallback,
    setContainer,
  };
}

function ensureStyle(url) {
  if (!url) {
    return Promise.resolve();
  }

  if (stylePromises.has(url)) {
    return stylePromises.get(url);
  }

  const existing = document.querySelector(
    `link[data-jsoneditor-style="${CSS.escape(url)}"]`,
  );
  if (existing) {
    stylePromises.set(url, Promise.resolve());
    return stylePromises.get(url);
  }

  const promise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.jsoneditorStyle = url;
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", (event) => {
      link.remove();
      stylePromises.delete(url);
      reject(event);
    });
    document.head.appendChild(link);
  });

  stylePromises.set(url, promise);
  return promise;
}

function ensureModule(url) {
  if (!url) {
    return Promise.resolve({ createJSONEditor: globalThis.createJSONEditor });
  }

  if (assetFailures.get(url)) {
    return Promise.reject(new Error("JSON 编辑器模块加载已失败"));
  }

  if (modulePromises.has(url)) {
    return modulePromises.get(url);
  }

  const promise = import(/* webpackIgnore: true */ /* @vite-ignore */ url)
    .then((module) => {
      if (!module?.createJSONEditor && !globalThis.createJSONEditor) {
        throw new Error("JSON 编辑器模块未提供 createJSONEditor");
      }
      return module;
    })
    .catch((error) => {
      modulePromises.delete(url);
      assetFailures.set(url, true);
      throw error;
    });

  modulePromises.set(url, promise);
  return promise;
}
