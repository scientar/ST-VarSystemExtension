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

import { getContext } from "../../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../popup.js";
import { createVariableBlockEditor } from "../editor/variableBlockEditor.js";

const MODULE_NAME = "[ST-VarSystemExtension/MessageSnapshots]";

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
}

/**
 * 加载楼层列表（只显示有快照的楼层）
 */
async function loadFloorList() {
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
      const $option = $("<option>");
      $option.val(i);
      $option.text(`第 ${i} 层 - AI 消息 (Swipe ${swipeId})`);
      $select.append($option);
    }
  }

  if (!hasSnapshots) {
    $select.html('<option value="">暂无快照楼层</option>');
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
        headers: { "Content-Type": "application/json" },
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
    return data.snapshot;
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

  // 创建新编辑器
  editorController = createVariableBlockEditor(container);
  await editorController.ensureReady();
  editorController.set(snapshot);

  // 监听编辑器变化
  editorController.onChange(() => {
    snapshotState.dirty = true;
    snapshotState.hasErrors = false; // 简化：假设没有语法错误
    $("#var-system-save-snapshot-btn").prop("disabled", false);

    try {
      snapshotState.draftBody = editorController.get();
    } catch (_error) {
      snapshotState.hasErrors = true;
      $("#var-system-save-snapshot-btn").prop("disabled", true);
    }
  });
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
    const snapshot = editorController.get();

    // 调用插件更新快照
    const response = await fetch(
      `/api/plugins/var-manager/var-manager/snapshots/${snapshotState.currentSnapshotId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
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
  const snapshot = editorController.get();

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
    // 调用全局快照 API
    const response = await fetch(
      "/api/plugins/var-manager/var-manager/global-snapshots",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot,
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
  const template = $("#var-system-import-snapshot-template").html();
  const $dialog = $(template);

  const result = await callGenericPopup(
    $dialog,
    POPUP_TYPE.CONFIRM,
    "导入快照 JSON",
    {
      okButton: "导入",
      cancelButton: "取消",
    },
  );

  if (result !== POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  try {
    const jsonText = $dialog.find("#import-json-textarea").val().trim();
    let snapshot = JSON.parse(jsonText);

    // 是否移除 MVU 元数据
    const stripMvu = $dialog
      .find("#strip-mvu-metadata-checkbox")
      .prop("checked");
    if (stripMvu) {
      snapshot = stripMvuMetadata(snapshot);
    }

    // 更新编辑器
    editorController.set(snapshot);
    snapshotState.draftBody = snapshot;
    snapshotState.dirty = true;
    $("#var-system-save-snapshot-btn").prop("disabled", false);

    toastr.success("快照已导入（未保存）");
  } catch (error) {
    console.error(MODULE_NAME, "导入快照失败:", error);
    toastr.error(`导入失败：${error.message}`);
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
      if (key !== "$meta" && key !== "$arrayMeta") {
        result[key] = stripMvuMetadata(obj[key]);
      }
    }
    return result;
  }
  return obj;
}

// 导出用于弹窗的常量
const POPUP_RESULT = {
  AFFIRMATIVE: 1,
  NEGATIVE: 0,
  CANCELLED: -1,
};
