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

      editorInstance = createJSONEditor({
        target: targetContainer,
        props: {
          content: { json: currentValue ?? {} },
          mainMenuBar: false,
          navigationBar: false,
          statusBar: false,
          readOnly,
          onChange: (content, previousContent, metadata) => {
            if (silentUpdate) {
              return;
            }
            currentValue = cloneValue(content?.json ?? currentValue ?? {});
            if (typeof onChange === "function") {
              onChange(content, previousContent, metadata);
            }
          },
          modes: ["tree", "text"],
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

  return {
    ensureReady,
    setValue,
    getValue,
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
