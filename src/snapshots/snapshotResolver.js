/**
 * 快照查找与解析模块
 * 负责查找快照锚点、获取消息范围等
 */

import { isAIMessage } from "./messageUtils.js";
import { getSnapshotId, loadSnapshot } from "./snapshotIdentifier.js";

/**
 * 向上查找最近的快照锚点(有标识符的 AI 消息)
 * @param {number} startMessageId - 开始查找的消息层号
 * @param {Array} chat - 聊天记录数组
 * @returns {Promise<Object|null>} 返回 {anchorMessageId, snapshotId, snapshot} 或 null
 */
export async function findSnapshotAnchor(startMessageId, chat) {
  if (
    !Array.isArray(chat) ||
    startMessageId < 0 ||
    startMessageId >= chat.length
  ) {
    console.error("[ST-VarSystemExtension] findSnapshotAnchor: 参数无效", {
      startMessageId,
      chatLength: chat?.length,
    });
    return null;
  }

  // 从 startMessageId 向上查找
  for (let i = startMessageId; i >= 0; i--) {
    const message = chat[i];

    // 只检查 AI 消息
    if (!isAIMessage(message)) {
      continue;
    }

    // 检查是否有快照标识符
    const snapshotId = getSnapshotId(message);
    if (!snapshotId) {
      continue;
    }

    // 尝试加载快照
    console.log(
      `[ST-VarSystemExtension] 找到快照锚点: 第 ${i} 层, ID: ${snapshotId}`,
    );
    const record = await loadSnapshot(snapshotId);

    if (!record) {
      // 标识符存在但快照不存在(数据库中丢失)
      console.warn(
        `[ST-VarSystemExtension] 快照标识符存在但数据丢失: ${snapshotId}, 将清除该标识符`,
      );
      // 清除标识符,继续向上查找
      // 注意: 这里不调用 clearSnapshotId,因为我们稍后会重新生成
      continue;
    }

    // 找到有效的锚点
    return {
      anchorMessageId: i,
      snapshotId,
      snapshot: record.payload, // 插件返回的 payload 已经是完整的 JSON
    };
  }

  // 没有找到任何锚点,需要使用角色模板
  console.log("[ST-VarSystemExtension] 未找到快照锚点,需要使用角色模板");
  return null;
}

/**
 * 获取指定范围内的所有 AI 消息
 * @param {number} startId - 起始消息层号(包含)
 * @param {number} endId - 结束消息层号(包含)
 * @param {Array} chat - 聊天记录数组
 * @returns {Array<Object>} AI 消息数组,每个元素包含 {messageId, message, content}
 */
export function getAIMessageRange(startId, endId, chat) {
  if (!Array.isArray(chat)) {
    console.error("[ST-VarSystemExtension] getAIMessageRange: chat 不是数组");
    return [];
  }

  if (startId < 0 || endId >= chat.length || startId > endId) {
    console.error("[ST-VarSystemExtension] getAIMessageRange: 范围无效", {
      startId,
      endId,
      chatLength: chat.length,
    });
    return [];
  }

  const result = [];

  for (let i = startId; i <= endId; i++) {
    const message = chat[i];

    // 只收集 AI 消息
    if (!isAIMessage(message)) {
      continue;
    }

    // 获取当前 swipe 的内容
    const swipeId = message.swipe_id ?? 0;
    const content = Array.isArray(message.swipes)
      ? message.swipes[swipeId]
      : message.mes || "";

    result.push({
      messageId: i,
      message,
      content,
    });
  }

  return result;
}

/**
 * 获取从锚点到目标层之间的所有 AI 消息
 * 如果没有锚点(返回 null),则从第 0 层开始
 * @param {Object|null} anchor - 锚点对象,可能为 null
 * @param {number} targetMessageId - 目标消息层号
 * @param {Array} chat - 聊天记录数组
 * @returns {Array<Object>} AI 消息数组
 */
export function getMessagesToProcess(anchor, targetMessageId, chat) {
  if (
    !Array.isArray(chat) ||
    targetMessageId < 0 ||
    targetMessageId >= chat.length
  ) {
    console.error("[ST-VarSystemExtension] getMessagesToProcess: 参数无效", {
      targetMessageId,
      chatLength: chat?.length,
    });
    return [];
  }

  // 确定起始层号
  let startId;
  if (anchor === null) {
    // 没有锚点,从第 0 层开始
    startId = 0;
    console.log("[ST-VarSystemExtension] 从第 0 层开始处理(无锚点)");
  } else {
    // 从锚点的下一层开始(锚点本身已经有快照了)
    startId = anchor.anchorMessageId + 1;
    console.log(
      `[ST-VarSystemExtension] 从第 ${startId} 层开始处理(锚点: ${anchor.anchorMessageId})`,
    );
  }

  // 获取范围内的所有 AI 消息
  return getAIMessageRange(startId, targetMessageId, chat);
}

/**
 * 检查最新层 AI 消息是否已有快照
 * 这是处理流程的第一步检查
 * @param {number} messageId - 消息层号
 * @param {Array} chat - 聊天记录数组
 * @returns {Promise<Object|null>} 返回 {snapshotId, snapshot} 或 null
 */
export async function checkLatestSnapshot(messageId, chat) {
  if (!Array.isArray(chat) || messageId < 0 || messageId >= chat.length) {
    return null;
  }

  const message = chat[messageId];

  // 检查是否为 AI 消息
  if (!isAIMessage(message)) {
    console.log(
      `[ST-VarSystemExtension] 第 ${messageId} 层不是 AI 消息,跳过检查`,
    );
    return null;
  }

  // 检查是否有快照标识符
  const snapshotId = getSnapshotId(message);
  if (!snapshotId) {
    console.log(`[ST-VarSystemExtension] 第 ${messageId} 层没有快照标识符`);
    return null;
  }

  // 尝试加载快照
  console.log(
    `[ST-VarSystemExtension] 第 ${messageId} 层已有快照: ${snapshotId}`,
  );
  const record = await loadSnapshot(snapshotId);

  if (!record) {
    console.warn(
      `[ST-VarSystemExtension] 第 ${messageId} 层快照数据丢失: ${snapshotId}`,
    );
    return null;
  }

  return {
    snapshotId,
    snapshot: record.payload,
  };
}
