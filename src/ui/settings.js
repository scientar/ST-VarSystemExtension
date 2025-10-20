/**
 * 设置标签页管理模块
 * 负责设置界面的初始化和数据清理功能
 */

const MODULE_NAME = "[ST-VarSystemExtension/settings]";

/**
 * 初始化设置标签页
 */
export async function initSettings() {
  console.log(MODULE_NAME, "初始化设置标签页");

  // 绑定清理按钮事件
  $("#var-system-cleanup-snapshots-btn").on("click", handleCleanupSnapshots);
}

/**
 * 处理清理未使用快照的操作
 */
async function handleCleanupSnapshots() {
  console.log(MODULE_NAME, "开始清理未使用的快照");

  // 显示确认对话框
  const confirmation = await callGenericPopup(
    "此操作会删除数据库中不对应任何现存聊天记录的快照。\n\n" +
      "已删除的快照无法恢复，确定要继续吗？",
    POPUP_TYPE.CONFIRM,
    "",
    { okButton: "确定", cancelButton: "取消" },
  );

  if (confirmation !== POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  try {
    // 禁用按钮，显示进度
    $("#var-system-cleanup-snapshots-btn").prop("disabled", true);
    $("#var-system-cleanup-progress").show();
    $("#var-system-cleanup-result").hide();

    updateCleanupProgress(0, "正在扫描聊天记录文件...");

    // 1. 获取所有聊天记录文件名
    const activeChatFiles = await getAllChatFiles();
    console.log(MODULE_NAME, `找到 ${activeChatFiles.length} 个聊天记录文件`);

    updateCleanupProgress(
      50,
      `找到 ${activeChatFiles.length} 个聊天记录文件，正在清理...`,
    );

    // 2. 调用插件 API 清理孤立快照
    const result = await cleanupOrphanedSnapshots(activeChatFiles);

    updateCleanupProgress(100, "清理完成");

    // 3. 显示清理结果
    setTimeout(() => {
      $("#var-system-cleanup-progress").hide();
      showCleanupResult(result);
    }, 500);

    console.log(MODULE_NAME, "清理完成", result);
  } catch (error) {
    console.error(MODULE_NAME, "清理失败:", error);
    $("#var-system-cleanup-progress").hide();
    toastr.error(`清理失败：${error.message}`, "变量系统");
  } finally {
    $("#var-system-cleanup-snapshots-btn").prop("disabled", false);
  }
}

/**
 * 更新清理进度
 * @param {number} percentage - 进度百分比 (0-100)
 * @param {string} text - 进度文本
 */
function updateCleanupProgress(percentage, text) {
  $("#var-system-cleanup-progress-fill").css("width", `${percentage}%`);
  $("#var-system-cleanup-progress-text").text(text);
}

/**
 * 显示清理结果
 * @param {Object} result - 清理结果
 * @param {number} result.deletedCount - 删除的快照数量
 * @param {number} result.totalScanned - 扫描的总快照数
 * @param {string[]} result.deletedChatFiles - 被清理的聊天文件列表
 */
function showCleanupResult(result) {
  const { deletedCount, totalScanned, deletedChatFiles } = result;

  $("#var-system-cleanup-result").show();

  // 设置摘要
  if (deletedCount === 0) {
    $("#var-system-cleanup-result-summary").html(
      `<strong>未发现需要清理的快照</strong>`,
    );
    $("#var-system-cleanup-result-details").text(
      `扫描了 ${totalScanned} 个快照，全部关联到现存的聊天记录。`,
    );
  } else {
    $("#var-system-cleanup-result-summary").html(
      `<strong>成功清理 ${deletedCount} 个孤立快照</strong>`,
    );

    const detailsText =
      `扫描了 ${totalScanned} 个快照，清理了 ${deletedChatFiles.length} 个已删除聊天记录的快照。\n` +
      (deletedChatFiles.length > 0
        ? `\n已清理的聊天文件：\n${deletedChatFiles.slice(0, 5).join("\n")}` +
          (deletedChatFiles.length > 5
            ? `\n... 及其他 ${deletedChatFiles.length - 5} 个文件`
            : "")
        : "");

    $("#var-system-cleanup-result-details").text(detailsText);
  }

  toastr.success(`清理完成，删除了 ${deletedCount} 个孤立快照`, "变量系统");
}

/**
 * 获取所有聊天记录文件名
 * @returns {Promise<string[]>} 聊天记录文件名数组
 */
async function getAllChatFiles() {
  try {
    // 调用 SillyTavern API 获取所有聊天记录
    const response = await fetch("/api/characters/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`获取聊天记录失败: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(MODULE_NAME, "聊天记录数据:", data);

    // 提取所有聊天文件名
    // data 格式可能是: { "Character1": ["chat1.jsonl", "chat2.jsonl"], ... }
    const chatFiles = [];
    for (const characterName in data) {
      const chats = data[characterName];
      if (Array.isArray(chats)) {
        for (const chatFileName of chats) {
          // 移除 .jsonl 后缀，只保留文件名
          const chatFile = chatFileName.replace(/\.jsonl$/, "");
          chatFiles.push(chatFile);
        }
      }
    }

    return chatFiles;
  } catch (error) {
    console.error(MODULE_NAME, "获取聊天记录文件失败:", error);
    throw new Error("无法获取聊天记录列表");
  }
}

/**
 * 调用插件 API 清理孤立快照
 * @param {string[]} activeChatFiles - 活跃的聊天文件名列表
 * @returns {Promise<Object>} 清理结果
 */
async function cleanupOrphanedSnapshots(activeChatFiles) {
  try {
    const response = await fetch(
      "/api/plugins/var-manager/var-manager/snapshots/cleanup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": await getCsrfToken(),
        },
        body: JSON.stringify({ activeChatFiles }),
      },
    );

    if (response.status === 404) {
      throw new Error("插件未安装或未启用");
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`插件 API 错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(MODULE_NAME, "清理孤立快照失败:", error);
    throw error;
  }
}

/**
 * 获取 CSRF Token
 * @returns {Promise<string>} CSRF Token
 */
async function getCsrfToken() {
  // 尝试从 window.token 获取
  if (window.token) {
    return window.token;
  }

  // 如果不存在，调用 API 获取
  try {
    const response = await fetch("/csrf-token");
    const data = await response.json();
    window.token = data.token;
    return data.token;
  } catch (error) {
    console.warn(MODULE_NAME, "获取 CSRF Token 失败，使用空字符串", error);
    return "";
  }
}
