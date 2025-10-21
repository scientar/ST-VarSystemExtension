/**
 * 楼层快照界面
 *
 * 功能：
 * - 查看/编辑消息楼层绑定的快照
 * - 支持几百上千层的下拉选择（只显示有标识符的楼层）
 * - 保存快照、保存为全局快照
 * - 导入/导出 JSON（含 MVU 元数据移除）
 *
 * 编辑器复用：VariableBlockEditor（与角色模板/全局快照相同）
 */

import { getContext } from "@sillytavern/scripts/extensions";
import { callGenericPopup, POPUP_TYPE } from "@sillytavern/scripts/popup";
import { getRequestHeaders, eventSource, event_types } from "@sillytavern/script";
import { createVariableBlockEditor } from "../editor/variableBlockEditor";

const MODULE_NAME = "[ST-VarSystemExtension/MessageSnapshots]";

// JSON 编辑器资源 URL
const JSON_EDITOR_VERSION = "3.10.0";
const JSON_EDITOR_STYLE_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/themes/jse-theme-dark.css`;
const JSON_EDITOR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/standalone.js`;

// 编辑器实例
let editorController = null;

// 当前状态
const snapshotState = {
  currentFloor: null, // 当前选中的楼层号
  currentSwipeId: null, // 当前 swipe ID
  currentSnapshotId: null, // 当前快照 ID
  draftBody: null, // 编辑器中的副本（未保存）
  dirty: false, // 是否有未保存修改
  hasErrors: false, // JSON 是否有错误
};

/**
 * 初始化楼层快照界面
 */
export async function initMessageSnapshots() {
  console.log(MODULE_NAME, "初始化楼层快照界面");

  // 绑定事件处理器
  bindEventHandlers();

  // 加载楼层列表
  await loadFloorList();
}

/**
 * 绑定事件处理器
 */
function bindEventHandlers() {
  // 楼层选择
  $("#var-system-floor-select").on("change", async (e) => {
    const floorNumber = parseInt(e.target.value, 10);
    if (!Number.isNaN(floorNumber)) {
      await loadFloorSnapshot(floorNumber);
    }
  });

  // 跳转按钮
  $("#var-system-jump-btn").on("click", async () => {
    const floorNumber = parseInt($("#var-system-jump-input").val(), 10);
    if (Number.isNaN(floorNumber)) {
      toastr.error("请输入有效的层号");
      return;
    }

    // 检查该层是否有快照
    const hasSnapshot = await checkFloorHasSnapshot(floorNumber);
    if (!hasSnapshot) {
      toastr.error(`第 ${floorNumber} 层没有绑定快照`);
      return;
    }

    // 更新下拉选择并加载
    $("#var-system-floor-select").val(floorNumber).trigger("change");
  });

  // 刷新按钮
  $("#var-system-refresh-snapshot-btn").on("click", async () => {
    if (snapshotState.currentFloor !== null) {
      await loadFloorSnapshot(snapshotState.currentFloor);
      toastr.info("已刷新快照");
    }
  });

  // 保存快照
  $("#var-system-save-snapshot-btn").on("click", async () => {
    await saveSnapshot();
  });

  // 保存为全局快照
  $("#var-system-save-as-global-btn").on("click", async () => {
    await saveAsGlobalSnapshot();
  });

  // 导出 JSON
  $("#var-system-export-snapshot-btn").on("click", async () => {
    await exportSnapshot();
  });

  // 导入 JSON
  $("#var-system-import-snapshot-btn").on("click", async () => {
    await importSnapshot();
  });

  // 分离 Schema
  $("#var-system-strip-schema-btn").on("click", async () => {
    await stripSchemaFromMessageSnapshot();
  });
}

/**
 * 加载楼层列表（只显示有快照的楼层）
 */
export async function loadFloorList() {
  const context = getContext();
  const chat = context.chat;

  if (!chat || chat.length === 0) {
    $("#var-system-floor-select").html(
      '<option value="">当前无聊天记录</option>',
    );
    return;
  }

  const $select = $("#var-system-floor-select");
  $select.empty();

  let hasSnapshots = false;
  let maxFloorNumber = -1; // 【新增】跟踪最大楼层号

  // 遍历所有消息，只添加有快照标识符的楼层
  for (let i = 0; i < chat.length; i++) {
    const message = chat[i];

    // 只处理 AI 消息
    if (message.is_user) continue;

    // 获取当前 swipe 的快照标识符
    const swipeId = message.swipe_id || 0;
    const snapshotId =
      message.swipes_info?.[swipeId]?.st_var_system_snapshot_id;

    if (snapshotId) {
      hasSnapshots = true;
      maxFloorNumber = i; // 【新增】更新最大楼层号
      const $option = $("<option>");
      $option.val(i);
      $option.text(`第 ${i} 层 - AI 消息 (Swipe ${swipeId})`);
      $select.append($option);
    }
  }

  if (!hasSnapshots) {
    $select.html('<option value="">暂无快照楼层</option>');
  } else if (maxFloorNumber >= 0) {
    // 【新增】自动加载最后一层快照
    $select.val(maxFloorNumber);
    await loadFloorSnapshot(maxFloorNumber);
  }
}

/**
 * 检查指定楼层是否有快照
 * @param {number} floorNumber - 楼层号
 * @returns {Promise<boolean>}
 */
async function checkFloorHasSnapshot(floorNumber) {
  const context = getContext();
  const chat = context.chat;

  if (!chat || floorNumber >= chat.length) {
    return false;
  }

  const message = chat[floorNumber];
  if (message.is_user) {
    return false;
  }

  const swipeId = message.swipe_id || 0;
  const snapshotId = message.swipes_info?.[swipeId]?.st_var_system_snapshot_id;

  return !!snapshotId;
}

/**
 * 加载指定楼层的快照
 * @param {number} floorNumber - 楼层号
 */
async function loadFloorSnapshot(floorNumber) {
  const context = getContext();
  const chat = context.chat;

  if (!chat || floorNumber >= chat.length) {
    toastr.error("无效的楼层号");
    return;
  }

  const message = chat[floorNumber];
  const swipeId = message.swipe_id || 0;
  const snapshotId = message.swipes_info?.[swipeId]?.st_var_system_snapshot_id;

  if (!snapshotId) {
    toastr.error(`第 ${floorNumber} 层没有绑定快照`);
    return;
  }

  // 从插件加载快照
  const snapshot = await fetchSnapshotFromPlugin(snapshotId);
  if (!snapshot) {
    toastr.error("加载快照失败");
    return;
  }

  // 更新状态
  snapshotState.currentFloor = floorNumber;
  snapshotState.currentSwipeId = swipeId;
  snapshotState.currentSnapshotId = snapshotId;
  snapshotState.draftBody = snapshot;
  snapshotState.dirty = false;
  snapshotState.hasErrors = false;

  // 显示楼层信息
  $("#var-system-current-floor-info").show();
  $("#current-floor-number").text(floorNumber);
  $("#current-swipe-id").text(swipeId);
  $("#current-snapshot-id").text(snapshotId);

  // 显示消息时间
  const messageTime = message.send_date
    ? new Date(message.send_date).toLocaleString("zh-CN")
    : "未知";
  $("#current-message-time").text(messageTime);

  // 初始化编辑器
  await initializeEditor(snapshot);

  // 显示操作按钮
  $("#var-system-snapshot-actions").show();
  $("#var-system-save-snapshot-btn").prop("disabled", true);
}

/**
 * 从插件获取快照
 * @param {string} snapshotId - 快照 ID
 * @returns {Promise<Object|null>}
 */
async function fetchSnapshotFromPlugin(snapshotId) {
  try {
    const response = await fetch(
      `/api/plugins/var-manager/var-manager/snapshots/${snapshotId}`,
      {
        method: "GET",
        headers: {
          ...getRequestHeaders(),
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(MODULE_NAME, `快照不存在: ${snapshotId}`);
      } else {
        console.error(
          MODULE_NAME,
          `读取快照失败 (${response.status}): ${snapshotId}`,
        );
      }
      return null;
    }

    const data = await response.json();
    return data.payload;
  } catch (error) {
    console.error(MODULE_NAME, "从插件读取快照时发生错误:", error);
    return null;
  }
}

/**
 * 初始化编辑器
 * @param {Object} snapshot - 快照对象
 */
async function initializeEditor(snapshot) {
  const container = document.getElementById(
    "var-system-snapshot-editor-container",
  );

  // 移除空状态
  $(container).find(".var-system-empty-state").remove();

  // 如果编辑器已存在，销毁它
  if (editorController) {
    editorController.destroy();
    editorController = null;
  }

  // 创建新编辑器（【修复】传入 options 对象并包含 onChange 回调）
  editorController = createVariableBlockEditor({
    container,
    styleUrl: JSON_EDITOR_STYLE_URL,
    scriptUrl: JSON_EDITOR_SCRIPT_URL,
    onChange: (content, _previousContent, metadata) => {
      // 【调试】记录编辑器变化
      console.log('[MessageSnapshots] Editor change:', {
        hasContent: !!content,
        hasJson: content?.json !== undefined,
        jsonType: typeof content?.json,
        hasContentErrors: !!metadata?.contentErrors?.length,
        contentErrors: metadata?.contentErrors,
      });

      // 【修复】只有当 JSON 无法解析时才报告错误
      // content.json === undefined 表示 JSON 解析失败
      const hasErrors = content?.json === undefined;

      snapshotState.hasErrors = hasErrors;
      snapshotState.dirty = true;

      // 只要 JSON 解析成功就更新 draftBody
      if (!hasErrors) {
        snapshotState.draftBody = content.json;
      }

      // 更新保存按钮状态
      $("#var-system-save-snapshot-btn").prop("disabled", hasErrors);
    },
    onFallback: () => {
      console.warn(MODULE_NAME, 'JSON 编辑器资源加载失败，已降级为纯文本模式');
    },
  });

  await editorController.ensureReady();
  editorController.set({ json: snapshot });
}

/**
 * 保存快照
 */
async function saveSnapshot() {
  if (snapshotState.hasErrors) {
    toastr.error("快照数据有错误，无法保存");
    return;
  }

  if (!snapshotState.dirty) {
    toastr.info("快照未修改");
    return;
  }

  try {
    const content = editorController.get();

    // 【新增】验证 JSON 是否解析成功
    if (content?.json === undefined) {
      toastr.error("快照数据格式错误，请检查 JSON");
      return;
    }

    // 调用插件更新快照（【修复】添加 CSRF headers，只发送 json 数据）
    const response = await fetch(
      `/api/plugins/var-manager/var-manager/snapshots/${snapshotState.currentSnapshotId}`,
      {
        method: "PUT",
        headers: {
          ...getRequestHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ snapshot: content.json }),
      },
    );

    if (!response.ok) {
      throw new Error(`更新快照失败 (${response.status})`);
    }

    snapshotState.dirty = false;
    $("#var-system-save-snapshot-btn").prop("disabled", true);

    toastr.success("快照已保存");

    // 重新执行处理流程（更新聊天变量）
    // TODO: 调用 reprocessFromMessage(snapshotState.currentFloor)
  } catch (error) {
    console.error(MODULE_NAME, "保存快照失败:", error);
    toastr.error(`保存失败：${error.message}`);
  }
}

/**
 * 保存为全局快照
 */
async function saveAsGlobalSnapshot() {
  const content = editorController.get();

  // 【新增】验证 JSON 是否解析成功
  if (content?.json === undefined) {
    toastr.error("快照数据格式错误，请检查 JSON");
    return;
  }

  // 弹窗输入标签
  const tags = await callGenericPopup(
    "请输入标签（用逗号分隔）：",
    POPUP_TYPE.INPUT,
    "",
    { rows: 1 },
  );

  if (!tags) {
    return;
  }

  const tagArray = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);

  try {
    // 调用全局快照 API（【修复】添加 CSRF headers，只发送 json 数据）
    const response = await fetch(
      "/api/plugins/var-manager/var-manager/global-snapshots",
      {
        method: "POST",
        headers: {
          ...getRequestHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snapshot: content.json,
          tags: tagArray,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`保存失败 (${response.status})`);
    }

    toastr.success("已保存为全局快照");
  } catch (error) {
    console.error(MODULE_NAME, "保存全局快照失败:", error);
    toastr.error(`保存失败：${error.message}`);
  }
}

/**
 * 导出快照
 */
async function exportSnapshot() {
  const snapshot = editorController.get();

  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const $a = $("<a>");
  $a.attr("href", url);
  $a.attr(
    "download",
    `snapshot-floor-${snapshotState.currentFloor}-${Date.now()}.json`,
  );
  $a[0].click();

  URL.revokeObjectURL(url);

  toastr.success("快照已导出");
}

/**
 * 导入快照
 */
async function importSnapshot() {
  // 创建文件输入元素
  const $input = $("<input>");
  $input.attr("type", "file");
  $input.attr("accept", ".json");

  return new Promise((resolve) => {
    $input.on("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        resolve();
        return;
      }

      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);

        // 更新编辑器
        editorController.set(snapshot);
        snapshotState.draftBody = snapshot;
        snapshotState.dirty = true;
        $("#var-system-save-snapshot-btn").prop("disabled", false);

        toastr.success("快照已导入（未保存）");
        resolve();
      } catch (error) {
        console.error(MODULE_NAME, "导入快照失败:", error);
        toastr.error(`导入失败：${error.message}`);
        resolve();
      }
    });

    $input.click();
  });
}

/**
 * 从当前编辑器内容中分离 MVU Schema
 */
async function stripSchemaFromMessageSnapshot() {
  if (!editorController) {
    toastr.error("编辑器尚未初始化");
    return;
  }

  try {
    const snapshot = editorController.get();

    // 应用 schema 剥离
    const stripped = stripMvuMetadata(snapshot);

    // 更新编辑器
    editorController.set(stripped);
    snapshotState.draftBody = stripped;
    snapshotState.dirty = true;
    $("#var-system-save-snapshot-btn").prop("disabled", false);

    toastr.success("已移除 MVU Schema 字段");
  } catch (error) {
    console.error(MODULE_NAME, "分离 Schema 失败:", error);
    toastr.error(`分离 Schema 失败：${error.message}`);
  }
}

/**
 * 移除 MVU 元数据
 * @param {any} obj - 待处理的对象
 * @returns {any} 清理后的对象
 */
function stripMvuMetadata(obj) {
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== "$__META_EXTENSIBLE__$")
      .map((item) => stripMvuMetadata(item));
  } else if (_.isObject(obj) && !_.isDate(obj)) {
    const result = {};
    for (const key in obj) {
      // 移除所有以 $ 开头的字段
      if (!key.startsWith('$')) {
        result[key] = stripMvuMetadata(obj[key]);
      }
    }
    return result;
  }
  return obj;
}

// ============================================================================
// 楼层列表刷新现已由处理流程统一调度（listeners.ts）
// 移除独立的事件监听器以避免竞态条件
// ============================================================================
