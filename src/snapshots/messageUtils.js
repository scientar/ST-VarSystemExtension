/**
 * 消息相关工具函数
 * 用于判断消息类型、获取消息信息等
 */

/**
 * 判断消息是否为 AI 消息
 * @param {Object} message - 消息对象
 * @returns {boolean} 是否为 AI 消息
 */
export function isAIMessage(message) {
  if (!message) {
    return false;
  }

  // 检查 is_user 字段(SillyTavern 标准字段)
  if (message.is_user === false) {
    return true;
  }

  // 检查 role 字段(新版 API)
  if (message.role === "assistant") {
    return true;
  }

  return false;
}

/**
 * 获取消息的当前 swipe ID
 * @param {Object} message - 消息对象
 * @returns {number} 当前激活的 swipe ID,默认为 0
 */
export function getCurrentSwipeId(message) {
  if (!message) {
    return 0;
  }

  // swipe_id 可能是 undefined 或 0
  return message.swipe_id ?? 0;
}

/**
 * 获取消息的内容(当前 swipe 的内容)
 * @param {Object} message - 消息对象
 * @returns {string} 消息内容
 */
export function getMessageContent(message) {
  if (!message) {
    return "";
  }

  const swipeId = getCurrentSwipeId(message);

  // 如果有 swipes 数组,从中获取
  if (Array.isArray(message.swipes) && message.swipes[swipeId]) {
    return message.swipes[swipeId];
  }

  // 否则返回 mes 字段
  return message.mes || "";
}

/**
 * 获取消息的层号(在 chat 数组中的索引)
 * @param {Object} message - 消息对象
 * @param {Array} chat - 聊天记录数组
 * @returns {number} 消息层号,找不到返回 -1
 */
export function getMessageId(message, chat) {
  if (!message || !Array.isArray(chat)) {
    return -1;
  }

  return chat.indexOf(message);
}

/**
 * 判断消息是否为系统消息(隐藏消息)
 * @param {Object} message - 消息对象
 * @returns {boolean} 是否为系统消息
 */
export function isSystemMessage(message) {
  if (!message) {
    return false;
  }

  // 检查 is_system 字段
  if (message.is_system === true) {
    return true;
  }

  // 检查 role 字段
  if (message.role === "system") {
    return true;
  }

  return false;
}
