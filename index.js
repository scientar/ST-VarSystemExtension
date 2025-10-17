import { event_types, eventSource } from "/scripts/events.js";
import {
  getContext,
  renderExtensionTemplateAsync,
  writeExtensionField,
} from "/scripts/extensions.js";

const EXTENSION_NAMESPACE = "st-var-system";
const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";
const TEMPLATE_EXTENSION_KEY = "st_var_system";
const TEMPLATE_EDITOR_CONTAINER_ID = "var_system_template_editor";
const TEMPLATE_STATUS_ID = "var_system_template_status";
const TEMPLATE_SAVE_ID = "var_system_template_save";
const TEMPLATE_DISCARD_ID = "var_system_template_discard";
const TEMPLATE_RELOAD_ID = "var_system_template_reload";
const TEMPLATE_CLEAR_ID = "var_system_template_clear";
const TEMPLATE_ENABLED_TOGGLE_ID = "var_system_template_enabled";

const templateState = {
  editor: null,
  silentUpdate: false,
  dirty: false,
  hasErrors: false,
  loading: false,
  currentDraft: null,
  loadedTemplate: null,
  templateMeta: null,
  currentCharacterId: null,
  enabled: false,
  editorIsFallback: false,
};

const JSON_EDITOR_VERSION = "3.10.0";
const JSON_EDITOR_STYLE_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@3.10.0/themes/jse-theme-dark.css`;
const JSON_EDITOR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@3.10.0/standalone.js`;

let jsonEditorAssetPromise = null;
let jsonEditorAssetFailed = false;
let templateButtons = null;
let pendingTemplateRefresh = null;

const STATUS_COLORS = {
  success: "#6ee7b7",
  error: "#fca5a5",
  warn: "#fbbf24",
  info: "var(--SmartThemeBodyColor, #aaa)",
};

function bindTemplateSection(rootElement) {
  if (!rootElement || templateButtons) {
    return;
  }

  templateButtons = {
    save: rootElement.querySelector(`#${TEMPLATE_SAVE_ID}`),
    discard: rootElement.querySelector(`#${TEMPLATE_DISCARD_ID}`),
    reload: rootElement.querySelector(`#${TEMPLATE_RELOAD_ID}`),
    status: rootElement.querySelector(`#${TEMPLATE_STATUS_ID}`),
    clear: rootElement.querySelector(`#${TEMPLATE_CLEAR_ID}`),
    enableToggle: rootElement.querySelector(`#${TEMPLATE_ENABLED_TOGGLE_ID}`),
  };

  templateButtons.save?.addEventListener("click", () => {
    void saveCurrentTemplate();
  });

  templateButtons.discard?.addEventListener("click", () => {
    discardTemplateChanges();
  });

  templateButtons.reload?.addEventListener("click", () => {
    void refreshTemplateForActiveCharacter(true);
  });

  templateButtons.clear?.addEventListener("click", () => {
    void clearTemplateForActiveCharacter();
  });

  templateButtons.enableToggle?.addEventListener("change", (event) => {
    const isChecked = Boolean(event.target?.checked);
    void setEnabledForActiveCharacter(isChecked);
  });

  updateTemplateStatus("尚未加载模板", "info");
  updateTemplateControls();
  updateEnableToggleUI();
}

function updateTemplateStatus(message, level = "info") {
  const element =
    templateButtons?.status || document.getElementById(TEMPLATE_STATUS_ID);
  if (!element) {
    return;
  }

  element.textContent = message ?? "";
  element.style.color = STATUS_COLORS[level] ?? STATUS_COLORS.info;
}

function updateTemplateControls() {
  if (!templateButtons) {
    return;
  }

  const disableAll = templateState.loading || !templateState.currentDraft;

  if (templateButtons.save) {
    templateButtons.save.disabled =
      disableAll || templateState.hasErrors || !templateState.dirty;
  }

  if (templateButtons.discard) {
    templateButtons.discard.disabled =
      disableAll || !templateState.loadedTemplate || !templateState.dirty;
  }

  if (templateButtons.reload) {
    templateButtons.reload.disabled = templateState.loading;
  }

  if (templateButtons.clear) {
    templateButtons.clear.disabled =
      templateState.loading || !templateState.loadedTemplate;
  }

  updateEnableToggleUI();
}

function updateEnableToggleUI() {
  if (!templateButtons?.enableToggle) {
    return;
  }

  const shouldDisable =
    templateState.loading || !templateState.currentCharacterId;
  templateButtons.enableToggle.disabled = shouldDisable;
  templateButtons.enableToggle.checked = Boolean(templateState.enabled);
}

function scheduleTemplateRefresh(force = false) {
  if (pendingTemplateRefresh !== null) {
    clearTimeout(pendingTemplateRefresh);
  }

  pendingTemplateRefresh = setTimeout(() => {
    pendingTemplateRefresh = null;
    void refreshTemplateForActiveCharacter(force);
  }, 0);
}

function refreshEditorRendering() {
  if (!templateState.currentDraft) {
    return;
  }

  if (!templateState.editor) {
    void ensureEditorInstance().then((editor) => {
      if (!editor) {
        return;
      }
      setEditorContent(cloneTemplate(templateState.currentDraft));
    });
    return;
  }

  setEditorContent(cloneTemplate(templateState.currentDraft));
}

function cloneTemplate(value) {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function buildExtensionPayload({
  templateBody = templateState.loadedTemplate,
  templateId = templateState.templateMeta?.templateId ?? null,
  updatedAt = templateState.templateMeta?.updatedAt ?? null,
  enabled = templateState.enabled,
  includeTemplate = templateBody !== null && templateBody !== undefined,
} = {}) {
  const payload = {
    enabled: Boolean(enabled),
  };

  if (templateId) {
    payload.templateId = templateId;
  }

  if (includeTemplate && templateBody !== undefined && templateBody !== null) {
    payload.templateBody = cloneTemplate(templateBody);
  }

  if (includeTemplate && updatedAt !== undefined && updatedAt !== null) {
    payload.updatedAt = updatedAt;
  }

  return payload;
}

function buildDefaultTemplate(character) {
  return {
    metadata: {
      name: character?.name ?? "",
      createdAt: new Date().toISOString(),
      version: 1,
    },
    variables: {},
  };
}

function generateTemplateId(character) {
  if (character?.avatar) {
    return `avatar:${character.avatar}`;
  }

  if (character?.name) {
    return `name:${character.name}`;
  }

  if (globalThis.crypto?.randomUUID) {
    return `uuid:${globalThis.crypto.randomUUID()}`;
  }

  return `uuid:${Date.now().toString(36)}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  try {
    return new Date(timestamp).toLocaleString();
  } catch (_error) {
    return String(timestamp);
  }
}

function injectResource(tagName, attributes) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(tagName);

    Object.entries(attributes).forEach(([key, value]) => {
      element[key] = value;
    });

    element.addEventListener("load", () => resolve());
    element.addEventListener("error", (event) => {
      element.remove();
      reject(event);
    });

    document.head.appendChild(element);
  });
}

function ensureJsonEditorAssets() {
  if (globalThis.JSONEditor) {
    return Promise.resolve();
  }

  if (jsonEditorAssetFailed) {
    return Promise.reject(new Error("JSON 编辑器资源加载已失败，跳过重试。"));
  }

  if (!jsonEditorAssetPromise) {
    jsonEditorAssetPromise = Promise.all([
      injectResource("link", {
        rel: "stylesheet",
        href: JSON_EDITOR_STYLE_URL,
      }),
      injectResource("script", {
        src: JSON_EDITOR_SCRIPT_URL,
        async: true,
      }),
    ])
      .then(() => {
        if (!globalThis.JSONEditor) {
          throw new Error("JSONEditor 未成功加载");
        }
      })
      .catch((error) => {
        jsonEditorAssetFailed = true;
        jsonEditorAssetPromise = null;
        throw error;
      });
  }

  return jsonEditorAssetPromise;
}

async function ensureEditorInstance() {
  if (templateState.editor) {
    return templateState.editor;
  }

  const container = document.getElementById(TEMPLATE_EDITOR_CONTAINER_ID);

  if (!container) {
    return null;
  }

  try {
    await ensureJsonEditorAssets();
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "加载 JSON 编辑器失败", error);
    return ensureFallbackEditor(container);
  }

  const { JSONEditor } = globalThis;

  if (!JSONEditor) {
    return ensureFallbackEditor(container);
  }

  // JSONEditor 构造会直接接管容器节点。
  templateState.editorIsFallback = false;
  templateState.editor = new JSONEditor({
    target: container,
    props: {
      content: { json: templateState.currentDraft ?? {} },
      mainMenuBar: false,
      navigationBar: false,
      statusBar: false,
      onChange: handleEditorChange,
      modes: ["tree", "text"],
    },
  });

  return templateState.editor;
}

function setEditorContent(json) {
  if (!templateState.editor) {
    return;
  }

  templateState.silentUpdate = true;
  templateState.editor.set({ json });
  templateState.silentUpdate = false;
}

function ensureFallbackEditor(container) {
  if (templateState.editor && templateState.editorIsFallback) {
    return templateState.editor;
  }

  templateState.editorIsFallback = true;

  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "stretch";

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

  container.appendChild(notice);
  container.appendChild(textarea);

  const handleInput = () => {
    if (templateState.silentUpdate) {
      return;
    }

    let parsed = undefined;
    let contentErrors = [];

    if (textarea.value.trim().length === 0) {
      parsed = {};
    } else {
      try {
        parsed = JSON.parse(textarea.value);
      } catch (error) {
        contentErrors = [{ message: error?.message ?? String(error) }];
      }
    }

    const content =
      contentErrors.length > 0 ? { json: undefined } : { json: parsed };
    handleEditorChange(content, null, { contentErrors });
  };

  textarea.addEventListener("input", handleInput);

  const fallbackEditor = {
    isFallback: true,
    element: textarea,
    set({ json }) {
      const normalized = json === undefined || json === null ? {} : json;
      const value = JSON.stringify(normalized, null, 2);
      textarea.value = value;
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
      container.innerHTML = "";
    },
  };

  templateState.editor = fallbackEditor;

  templateState.silentUpdate = true;
  fallbackEditor.set({ json: templateState.currentDraft ?? {} });
  templateState.silentUpdate = false;

  updateTemplateStatus("已降级为纯文本模式，请手动编辑 JSON。", "warn");

  return fallbackEditor;
}

function handleEditorChange(content, _previousContent, metadata) {
  if (templateState.silentUpdate) {
    return;
  }

  const hasErrors =
    Boolean(metadata?.contentErrors?.length) || content?.json === undefined;

  templateState.hasErrors = hasErrors;
  templateState.dirty = true;

  if (!hasErrors && content?.json !== undefined) {
    templateState.currentDraft = content.json;
  }

  updateTemplateControls();
  updateTemplateStatus(
    hasErrors ? "JSON 无法解析，请检查错误。" : "模板已修改，尚未保存。",
    hasErrors ? "error" : "warn",
  );
}

function discardTemplateChanges() {
  if (!templateState.loadedTemplate) {
    updateTemplateStatus("没有可恢复的模板版本。", "warn");
    return;
  }

  if (!templateState.editor) {
    return;
  }

  templateState.currentDraft = cloneTemplate(templateState.loadedTemplate);
  setEditorContent(cloneTemplate(templateState.loadedTemplate));
  templateState.dirty = false;
  templateState.hasErrors = false;
  updateTemplateControls();
  updateTemplateStatus("已恢复为最后保存的模板。", "info");
}

async function refreshTemplateForActiveCharacter(force = false) {
  const context = getContext();
  const activeCharacterId = context.characterId;

  if (activeCharacterId == null) {
    templateState.currentCharacterId = null;
    templateState.loadedTemplate = null;
    templateState.currentDraft = null;
    templateState.templateMeta = null;
    templateState.enabled = false;
    updateTemplateStatus("请选择角色后再编辑模板。", "warn");
    updateTemplateControls();
    return;
  }

  if (!force && templateState.currentCharacterId === activeCharacterId) {
    return;
  }

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板加载中……", "info");

  try {
    await ensureEditorInstance();

    const character = context.characters?.[activeCharacterId];
    const extensionData =
      character?.data?.extensions?.[TEMPLATE_EXTENSION_KEY] ?? null;

    const hasTemplate = Boolean(extensionData?.templateBody);
    const templateId =
      extensionData?.templateId || generateTemplateId(character);
    const resolvedTemplate = hasTemplate
      ? cloneTemplate(extensionData.templateBody)
      : buildDefaultTemplate(character);

    templateState.currentCharacterId = activeCharacterId;
    templateState.loadedTemplate = hasTemplate
      ? cloneTemplate(resolvedTemplate)
      : null;
    templateState.currentDraft = cloneTemplate(resolvedTemplate);
    templateState.templateMeta = {
      templateId,
      updatedAt: extensionData?.updatedAt ?? null,
    };
    const resolvedEnabled =
      typeof extensionData?.enabled === "boolean"
        ? extensionData.enabled
        : hasTemplate;
    templateState.enabled = Boolean(resolvedEnabled);
    templateState.dirty = !hasTemplate;
    templateState.hasErrors = false;

    if (templateState.editor) {
      setEditorContent(cloneTemplate(resolvedTemplate));
    }

    const statusMessage = hasTemplate
      ? `模板已加载（最后更新：${formatTimestamp(extensionData?.updatedAt) || "未知"}）。`
      : "已为该角色准备默认模板，请完善后保存。";

    updateTemplateStatus(statusMessage, hasTemplate ? "info" : "warn");
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "加载模板失败", error);
    updateTemplateStatus(`加载模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

async function persistTemplateToPlugin(templateId, templateBody) {
  const context = getContext();
  const headers = {
    ...context.getRequestHeaders(),
    "Content-Type": "application/json",
  };

  const response = await fetch(
    "/api/plugins/var-manager/var-manager/templates",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        characterName: templateId,
        template: templateBody,
      }),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return response.json().catch(() => null);
}

async function setEnabledForActiveCharacter(nextEnabled) {
  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法修改启用状态。", "error");
    updateEnableToggleUI();
    return;
  }

  if (templateState.loading) {
    updateEnableToggleUI();
    return;
  }

  const previousValue = templateState.enabled;
  templateState.enabled = Boolean(nextEnabled);
  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus(
    templateState.enabled ? "正在启用变量系统……" : "正在停用变量系统……",
    "info",
  );

  try {
    const includeTemplate = templateState.loadedTemplate !== null;
    const payload = buildExtensionPayload({
      includeTemplate,
      enabled: templateState.enabled,
    });

    if (!payload.templateId) {
      const character = context.characters?.[characterId];
      payload.templateId =
        templateState.templateMeta?.templateId ?? generateTemplateId(character);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    templateState.templateMeta = {
      templateId: payload.templateId ?? null,
      updatedAt: templateState.templateMeta?.updatedAt ?? null,
    };

    updateTemplateStatus(
      templateState.enabled
        ? "变量系统已为该角色启用。"
        : "变量系统已为该角色停用。",
      "success",
    );
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "更新启用状态失败", error);
    templateState.enabled = previousValue;
    updateTemplateStatus(
      `更新启用状态失败：${error?.message ?? error}`,
      "error",
    );
  } finally {
    templateState.loading = false;
    updateEnableToggleUI();
    updateTemplateControls();
  }
}

async function clearTemplateForActiveCharacter() {
  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法清空模板。", "error");
    return;
  }

  if (!templateState.loadedTemplate) {
    updateTemplateStatus("当前没有保存的模板，无需清空。", "info");
    return;
  }

  const confirmationMessage =
    "确定要清空模板吗？这会从角色卡中移除模板字段，但不会改变启用状态。";
  const confirmed =
    window.confirm?.(confirmationMessage) ?? confirm(confirmationMessage);

  if (!confirmed) {
    updateTemplateStatus("已取消清空模板。", "info");
    return;
  }

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("正在清空模板……", "info");

  try {
    const payload = buildExtensionPayload({
      includeTemplate: false,
      enabled: templateState.enabled,
      templateId: templateState.templateMeta?.templateId ?? null,
    });

    if (!payload.templateId) {
      const character = context.characters?.[characterId];
      payload.templateId = generateTemplateId(character);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    const character = context.characters?.[characterId];
    const editor = await ensureEditorInstance();
    const defaultTemplate = buildDefaultTemplate(character);

    templateState.loadedTemplate = null;
    templateState.currentDraft = cloneTemplate(defaultTemplate);
    templateState.templateMeta = {
      templateId: payload.templateId,
      updatedAt: null,
    };
    templateState.dirty = true;
    templateState.hasErrors = false;

    if (editor) {
      setEditorContent(cloneTemplate(defaultTemplate));
    }

    updateTemplateStatus(
      "模板字段已清空，编辑器已恢复默认骨架，请视需要重新保存。",
      "warn",
    );
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "清空模板失败", error);
    updateTemplateStatus(`清空模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

async function saveCurrentTemplate() {
  if (templateState.hasErrors) {
    updateTemplateStatus("存在未解决的 JSON 错误，无法保存。", "error");
    return;
  }

  const editor = await ensureEditorInstance();

  if (!editor) {
    updateTemplateStatus("编辑器尚未准备就绪。", "error");
    return;
  }

  const content = editor.get();
  const json = content?.json;

  if (json === undefined) {
    updateTemplateStatus("请修复模板中的错误后再保存。", "error");
    return;
  }

  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法保存模板。", "error");
    return;
  }

  const character = context.characters?.[characterId];
  const templateId =
    templateState.templateMeta?.templateId || generateTemplateId(character);
  const payload = {
    templateId,
    templateBody: json,
    updatedAt: Date.now(),
    enabled: templateState.enabled,
  };

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板保存中……", "info");

  try {
    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    let pluginFailed = false;

    try {
      await persistTemplateToPlugin(templateId, json);
    } catch (pluginError) {
      console.warn(EXTENSION_LOG_PREFIX, "模板写入服务器失败", pluginError);
      updateTemplateStatus(
        `模板已保存到角色卡，但写入服务器失败：${pluginError?.message ?? pluginError}`,
        "warn",
      );
      pluginFailed = true;
    }

    templateState.loadedTemplate = cloneTemplate(json);
    templateState.currentDraft = cloneTemplate(json);
    templateState.templateMeta = {
      templateId,
      updatedAt: payload.updatedAt,
    };
    templateState.dirty = false;
    templateState.hasErrors = false;

    if (!pluginFailed) {
      updateTemplateStatus("模板已保存。", "success");
    }
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "保存模板失败", error);
    updateTemplateStatus(`保存模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

function onContextChanged() {
  scheduleTemplateRefresh(true);
}

function animateDrawer(element, shouldOpen) {
  const editor = window.EDITOR;
  if (editor?.slideToggle) {
    const options = {
      ...(editor.getSlideToggleOptions?.() ?? {}),
      onAnimationEnd: (el) => {
        el.closest(".drawer-content")?.classList.remove("resizing");
      },
    };
    element.classList.add("resizing");
    editor.slideToggle(element, options);
    return;
  }

  const $el = $(element);
  if (shouldOpen) {
    $el.stop(true, true).slideDown(200);
  } else {
    $el.stop(true, true).slideUp(200);
  }
}

function closeDrawer($icon, $content) {
  if (!$icon.hasClass("openIcon")) {
    return;
  }

  $icon.toggleClass("openIcon closedIcon");
  $content.toggleClass("openDrawer closedDrawer");
  animateDrawer($content.get(0), false);
}

function openDrawer($icon, $content) {
  if ($icon.hasClass("openIcon")) {
    return;
  }

  // 关闭其他已经打开的抽屉，保持与主题样式一致
  $(".drawer-icon.openIcon")
    .not($icon)
    .each((_, icon) => {
      const $otherIcon = $(icon);
      const $otherContent = $otherIcon
        .closest(".drawer")
        .find(".drawer-content")
        .first();
      closeDrawer($otherIcon, $otherContent);
    });

  $icon.toggleClass("closedIcon openIcon");
  $content.toggleClass("closedDrawer openDrawer");
  animateDrawer($content.get(0), true);

  setTimeout(() => {
    refreshEditorRendering();
  }, 250);
}

async function injectAppHeaderEntry() {
  if (document.querySelector("#var_system_drawer")) {
    return;
  }

  let templateHtml = null;
  try {
    templateHtml = await renderExtensionTemplateAsync(
      "third-party/ST-VarSystemExtension/assets/templates",
      "appHeaderVarSystemDrawer",
    );
  } catch (error) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 加载失败`,
      error,
    );
    return;
  }

  if (!templateHtml) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 返回空内容`,
    );
    return;
  }

  const $drawer = $(templateHtml);
  const $anchor = $("#extensions-settings-button");
  if ($anchor.length === 0) {
    console.warn(`${EXTENSION_LOG_PREFIX} 找不到扩展设置按钮，无法插入入口`);
    return;
  }

  $anchor.after($drawer);

  const $icon = $drawer.find("#var_system_drawer_icon");
  const $content = $drawer.find("#var_system_drawer_content");

  $content.hide();

  $drawer.find(".drawer-toggle").on("click", () => {
    if ($icon.hasClass("openIcon")) {
      closeDrawer($icon, $content);
    } else {
      openDrawer($icon, $content);
    }
  });

  bindTemplateSection($drawer.get(0));

  scheduleTemplateRefresh(true);

  console.log(`${EXTENSION_LOG_PREFIX} 自定义入口已注入`);
}

async function initExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} (${EXTENSION_NAMESPACE}) 初始化`);
  await injectAppHeaderEntry();
  eventSource.on(event_types.CHAT_CHANGED, onContextChanged);
  eventSource.on(event_types.CHARACTER_EDITOR_OPENED, onContextChanged);
}

async function shutdownExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} 卸载`);
  eventSource.removeListener(event_types.CHAT_CHANGED, onContextChanged);
  eventSource.removeListener(
    event_types.CHARACTER_EDITOR_OPENED,
    onContextChanged,
  );
}

// 允许外部在需要时显式调用
window.STVarSystemExtension = {
  init: initExtension,
  exit: shutdownExtension,
};

// 自动初始化
$(async () => {
  try {
    await initExtension();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 初始化失败`, error);
  }
});
