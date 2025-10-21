/**
 * 快照标识符管理模块
 * 负责生成、读写、管理消息快照的唯一标识符
 */

import { getCurrentSwipeId } from "./messageUtils.js";

const SNAPSHOT_ID_KEY = "st_var_system_snapshot_id";

/**
 * 生成快照唯一标识符(UUID v4)
 * @returns {string} UUID 格式的唯一标识符
 */
export function generateSnapshotId() {
  // 使用 crypto.randomUUID() (浏览器原生 API)
  // 如果不支持,降级到简单的随机 ID
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // 降级方案:生成简单的唯一 ID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * 从消息获取当前 swipe 的快照标识符
 * @param {Object} message - 消息对象
 * @returns {string|null} 快照标识符,不存在返回 null
 */
export function getSnapshotId(message) {
  if (!message) {
    return null;
  }

  const swipeId = getCurrentSwipeId(message);

  // 检查 swipes_info 数组
  if (!Array.isArray(message.swipes_info)) {
    return null;
  }

  const swipeInfo = message.swipes_info[swipeId];
  if (!swipeInfo) {
    return null;
  }

  // 获取标识符
  const identifier = swipeInfo[SNAPSHOT_ID_KEY];
  return typeof identifier === "string" ? identifier : null;
}

/**
 * 设置消息的快照标识符
 * @param {Object} message - 消息对象
 * @param {string} snapshotId - 快照标识符
 * @param {number|null} swipeId - swipe ID，null 表示使用当前 swipe
 * @returns {boolean} 是否设置成功
 */
export function setSnapshotId(message, snapshotId, swipeId = null) {
  if (!message || typeof snapshotId !== "string") {
    return false;
  }

  // 如果未指定 swipeId，使用消息当前的 swipe_id
  const targetSwipeId = swipeId !== null ? swipeId : getCurrentSwipeId(message);

  // 确保 swipes_info 数组存在
  if (!Array.isArray(message.swipes_info)) {
    message.swipes_info = [];
  }

  // 确保当前 swipe 的 info 对象存在
  if (!message.swipes_info[targetSwipeId]) {
    message.swipes_info[targetSwipeId] = {};
  }

  // 设置标识符
  message.swipes_info[targetSwipeId][SNAPSHOT_ID_KEY] = snapshotId;
  return true;
}

/**
 * 清除消息的快照标识符
 * @param {Object} message - 消息对象
 * @returns {boolean} 是否清除成功
 */
export function clearSnapshotId(message) {
  if (!message) {
    return false;
  }

  const swipeId = getCurrentSwipeId(message);

  // 检查 swipes_info 数组
  if (!Array.isArray(message.swipes_info) || !message.swipes_info[swipeId]) {
    return false;
  }

  // 删除标识符
  delete message.swipes_info[swipeId][SNAPSHOT_ID_KEY];
  return true;
}

/**
 * 检查消息是否有快照标识符
 * @param {Object} message - 消息对象
 * @returns {boolean} 是否有标识符
 */
export function hasSnapshotId(message) {
  return getSnapshotId(message) !== null;
}

/**
 * 从插件加载快照
 * @param {string} identifier - 快照标识符
 * @returns {Promise<Object|null>} 快照记录,失败返回 null
 */
export async function loadSnapshot(identifier) {
  if (!identifier) {
    console.error("[ST-VarSystemExtension] loadSnapshot: identifier 为空");
    return null;
  }

  try {
    const response = await fetch(
      `/api/plugins/var-manager/var-manager/snapshots/${identifier}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[ST-VarSystemExtension] 快照不存在: ${identifier}`);
        return null;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const record = await response.json();
    return record;
  } catch (error) {
    console.error(`[ST-VarSystemExtension] 加载快照失败: ${identifier}`, error);
    return null;
  }
}

/**
 * 保存快照到插件
 * @param {Object} params - 快照参数
 * @param {string} params.chatFile - 聊天文件名
 * @param {number} params.messageId - 消息层号
 * @param {Object} params.payload - 快照数据(完整的变量对象)
 * @param {string} [params.identifier] - 可选的标识符(不提供则自动生成)
 * @returns {Promise<Object|null>} 保存结果,失败返回 null
 */
export async function saveSnapshot(params) {
  const { chatFile, messageId, payload, identifier } = params;

  if (!chatFile || messageId === undefined || !payload) {
    console.error("[ST-VarSystemExtension] saveSnapshot: 缺少必要参数", params);
    return null;
  }

  try {
    const response = await fetch(
      "/api/plugins/var-manager/var-manager/snapshots",
      {
        method: "POST",
        headers: {
          ...getRequestHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatFile,
          messageId: String(messageId),
          payload,
          identifier,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("[ST-VarSystemExtension] 保存快照失败", params, error);
    return null;
  }
}

/**
 * 保存快照到插件（便捷包装函数）
 *
 * 此函数自动获取聊天文件名，并将快照标识符写入消息对象
 *
 * @param {number} messageId - 消息层号
 * @param {number|null} swipeId - swipe ID，null 表示使用当前 swipe
 * @param {Object} snapshot - 快照数据（完整的变量对象）
 * @returns {Promise<string|null>} 返回快照标识符，失败返回 null
 */
export async function saveSnapshotToPlugin(messageId, swipeId, snapshot) {
  try {
    // 1. 获取上下文和聊天文件名
    const context = window.SillyTavern.getContext();
    const chatFile = context.getCurrentChatId?.() || context.chatId;

    if (!chatFile) {
      console.warn(
        "[ST-VarSystemExtension] saveSnapshotToPlugin: 无法获取聊天文件名",
      );
      return null;
    }

    const chat = context.chat;
    if (!chat || messageId >= chat.length) {
      console.error(
        "[ST-VarSystemExtension] saveSnapshotToPlugin: 消息 ID 无效",
        { messageId, chatLength: chat?.length },
      );
      return null;
    }

    // 2. 获取消息对象
    const message = chat[messageId];
    if (!message) {
      console.error(
        "[ST-VarSystemExtension] saveSnapshotToPlugin: 消息不存在",
        messageId,
      );
      return null;
    }

    // 3. 生成新的快照标识符
    const identifier = generateSnapshotId();

    // 4. 保存到插件数据库
    const result = await saveSnapshot({
      chatFile,
      messageId,
      payload: snapshot,
      identifier,
    });

    if (!result) {
      // 插件不可用或保存失败
      console.warn(
        "[ST-VarSystemExtension] saveSnapshotToPlugin: 插件保存失败（插件可能不可用）",
      );
      return null;
    }

    // 5. 将标识符写入消息对象
    // 如果 swipeId 为 null，setSnapshotId 会自动使用消息的当前 swipe_id
    if (!setSnapshotId(message, identifier, swipeId)) {
      console.error(
        "[ST-VarSystemExtension] saveSnapshotToPlugin: 写入快照标识符失败",
        { messageId, swipeId },
      );
      return null;
    }

    const actualSwipeId =
      swipeId !== null ? swipeId : getCurrentSwipeId(message);
    console.log(
      `[ST-VarSystemExtension] 快照已保存: 消息 #${messageId}, swipe=${actualSwipeId}, ID=${identifier}`,
    );
    return identifier;
  } catch (error) {
    console.error("[ST-VarSystemExtension] saveSnapshotToPlugin 失败:", error);
    return null;
  }
}
