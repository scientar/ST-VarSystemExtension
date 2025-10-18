import { event_types, eventSource } from "/scripts/events.js";
import {
  getContext,
  renderExtensionTemplateAsync,
  writeExtensionField,
} from "/scripts/extensions.js";
import { createVariableBlockEditor } from "./src/editor/variableBlockEditor.js";

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

// 简化后的模板状态：只保留最小必要字段
const templateState = {
  editorController: null,
  currentCharacterId: null,
  templateBody: null, // 角色卡中保存的模板 JSON
  draftBody: null, // 编辑器中的副本
  enabled: false, // 是否启用变量系统
  dirty: false, // 是否有未保存修改
  hasErrors: false, // JSON 编辑器是否有错误
  loading: false, // 是否正在加载
};

const JSON_EDITOR_VERSION = "3.10.0";
const JSON_EDITOR_STYLE_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/themes/jse-theme-dark.css`;
const JSON_EDITOR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/standalone.js`;
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
    void discardTemplateChanges();
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

  const hasTemplate = templateState.templateBody !== null;
  const disableAll = templateState.loading || !templateState.draftBody;

  if (templateButtons.save) {
    templateButtons.save.disabled =
      disableAll || templateState.hasErrors || !templateState.dirty;
  }

  if (templateButtons.discard) {
    templateButtons.discard.disabled =
      disableAll || !hasTemplate || !templateState.dirty;
  }

  if (templateButtons.reload) {
    templateButtons.reload.disabled = templateState.loading;
  }

  if (templateButtons.clear) {
    templateButtons.clear.disabled = templateState.loading || !hasTemplate;
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

function cloneJSON(value) {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function buildDefaultTemplate(character) {
  return {
    metadata: {
      name: character?.name ?? "",
      createdAt: new Date().toISOString(),
    },
    variables: {},
  };
}

async function ensureEditorInstance({ readOnly = false } = {}) {
  const container = document.getElementById(TEMPLATE_EDITOR_CONTAINER_ID);

  if (!container) {
    return null;
  }

  if (!templateState.editorController) {
    templateState.editorController = createVariableBlockEditor({
      container,
      initialValue: templateState.draftBody ?? {},
      styleUrl: JSON_EDITOR_STYLE_URL,
      scriptUrl: JSON_EDITOR_SCRIPT_URL,
      readOnly,
      onChange: handleEditorChange,
      onFallback: () => {
        updateTemplateStatus(
          "JSON 编辑器资源加载失败，已降级为纯文本模式。",
          "warn",
        );
        updateTemplateControls();
      },
    });
  } else {
    templateState.editorController.setContainer(container);
  }

  try {
    await templateState.editorController.ensureReady();
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "初始化编辑器失败", error);
    return null;
  }

  return templateState.editorController;
}

function handleEditorChange(content, _previousContent, metadata) {
  const hasErrors =
    Boolean(metadata?.contentErrors?.length) || content?.json === undefined;

  templateState.hasErrors = hasErrors;
  templateState.dirty = true;

  if (!hasErrors && content?.json !== undefined) {
    templateState.draftBody = cloneJSON(content.json);
  }

  updateTemplateControls();
  updateTemplateStatus(
    hasErrors ? "JSON 无法解析，请检查错误。" : "模板已修改，尚未保存。",
    hasErrors ? "error" : "warn",
  );
}

async function discardTemplateChanges() {
  if (!templateState.templateBody) {
    updateTemplateStatus("没有可恢复的模板版本。", "warn");
    return;
  }

  templateState.draftBody = cloneJSON(templateState.templateBody);
  templateState.dirty = false;
  templateState.hasErrors = false;

  const controller = await ensureEditorInstance();
  if (controller) {
    controller.setValue(templateState.draftBody ?? {}, { silent: true });
  }

  updateTemplateControls();
  updateTemplateStatus("已恢复为最后保存的模板。", "info");
}

async function refreshTemplateForActiveCharacter(force = false) {
  const context = getContext();
  const activeCharacterId = context.characterId;

  if (activeCharacterId == null) {
    templateState.currentCharacterId = null;
    templateState.templateBody = null;
    templateState.draftBody = null;
    templateState.enabled = false;
    templateState.dirty = false;
    templateState.hasErrors = false;
    templateState.loading = false;

    if (templateState.editorController) {
      templateState.editorController.setValue({}, { silent: true });
    }

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
    const controller = await ensureEditorInstance();

    const character = context.characters?.[activeCharacterId];
    const extensionData =
      character?.data?.extensions?.[TEMPLATE_EXTENSION_KEY] ?? null;

    const hasTemplate = Boolean(extensionData?.templateBody);
    const loadedBody = hasTemplate
      ? extensionData.templateBody
      : buildDefaultTemplate(character);

    templateState.currentCharacterId = activeCharacterId;
    templateState.templateBody = hasTemplate ? cloneJSON(loadedBody) : null;
    templateState.draftBody = cloneJSON(loadedBody);
    templateState.enabled = Boolean(extensionData?.enabled);
    templateState.dirty = !hasTemplate;
    templateState.hasErrors = false;

    if (controller) {
      controller.setValue(templateState.draftBody ?? {}, { silent: true });
    }

    const statusMessage = hasTemplate
      ? "模板已加载。"
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
    const payload = {
      enabled: templateState.enabled,
    };

    if (templateState.templateBody) {
      payload.templateBody = cloneJSON(templateState.templateBody);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

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

  if (!templateState.templateBody) {
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
    const payload = {
      enabled: templateState.enabled,
    };

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    const character = context.characters?.[characterId];
    const controller = await ensureEditorInstance();
    const defaultTemplate = buildDefaultTemplate(character);

    templateState.templateBody = null;
    templateState.draftBody = cloneJSON(defaultTemplate);
    templateState.dirty = true;
    templateState.hasErrors = false;

    if (controller) {
      controller.setValue(defaultTemplate, { silent: false });
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

  const controller = await ensureEditorInstance();
  if (!controller) {
    updateTemplateStatus("编辑器尚未准备就绪。", "error");
    return;
  }

  const content = controller.get();
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

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板保存中……", "info");

  try {
    const payload = {
      templateBody: json,
      enabled: templateState.enabled,
    };

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    templateState.templateBody = cloneJSON(json);
    templateState.draftBody = cloneJSON(json);
    templateState.dirty = false;
    templateState.hasErrors = false;

    updateTemplateStatus("模板已保存。", "success");
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
