/**
 * @file listeners.js
 * @description 事件监听器模块，响应 SillyTavern 事件并触发快照处理流程
 *
 * **监听的事件**：
 * - MESSAGE_RECEIVED: AI 生成新消息 → 处理并生成快照
 * - MESSAGE_SWIPED: 用户切换 swipe → 重新处理到该 swipe
 * - CHAT_CHANGED: 切换聊天 → 清空变量，加载新角色模板
 * - MESSAGE_DELETED: 删除消息 → 重新处理后续消息
 * - CHAT_DELETED: 删除整个聊天 → 调用插件清理快照
 *
 * **事件来源验证**：
 * - 所有事件均来自 `references/iframe/event.d.ts` 中的 `tavern_events`
 * - 参数类型参考 `ListenerType` 接口定义
 *
 * @module events/listeners
 */

import { processMessage, reprocessFromMessage } from "./processor.js";

const MODULE_NAME = "[ST-VarSystemExtension/listeners]";

// 从 SillyTavern 导入事件类型和相关 API
// 使用绝对路径（从网站根目录开始）避免沙箱环境下的路径问题
import { saveChat, eventSource, event_types } from '/script.js';

// CSRF Token 缓存
let cachedCsrfToken = null;

/**
 * 获取 CSRF Token（用于 DELETE 请求）
 * @returns {Promise<string|null>}
 */
async function getCsrfToken() {
  // 1. 尝试从全局变量读取
  if (window.token || globalThis.token) {
    return window.token || globalThis.token;
  }

  // 2. 使用缓存
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }

  // 3. 主动获取
  try {
    const response = await fetch("/csrf-token");
    if (response.ok) {
      const data = await response.json();
      cachedCsrfToken = data.token;
      return cachedCsrfToken;
    }
  } catch (error) {
    console.error(MODULE_NAME, "获取 CSRF token 失败:", error);
  }

  return null;
}

/**
 * 检查变量系统是否启用
 * @returns {boolean} 当前角色是否启用变量系统
 */
function isVariableSystemEnabled() {
  try {
    const context = window.SillyTavern.getContext();
    const character = context.characters?.[context.characterId];

    return character?.data?.extensions?.st_var_system?.enabled === true;
  } catch (error) {
    console.error(MODULE_NAME, "检查启用状态时发生错误:", error);
    return false;
  }
}

/**
 * 处理 MESSAGE_RECEIVED 事件
 *
 * **触发时机**：AI 生成新消息后
 * **参数**：message_id (number) - 新消息的 ID
 *
 * @param {number} messageId - 新消息 ID
 */
async function handleMessageReceived(messageId) {
  console.log(MODULE_NAME, `MESSAGE_RECEIVED: 消息 #${messageId}`);

  if (!isVariableSystemEnabled()) {
    console.log(MODULE_NAME, "变量系统未启用，跳过处理");
    return;
  }

  try {
    await processMessage(messageId);
  } catch (error) {
    console.error(MODULE_NAME, "MESSAGE_RECEIVED 处理失败:", error);
  }
}

/**
 * 处理 MESSAGE_SWIPED 事件
 *
 * **触发时机**：用户切换到某个 swipe
 * **参数**：message_id (number) - 被 swipe 的消息 ID
 *
 * **注意**：SillyTavern 切换 swipe 时只传递 message_id，
 * 需要从消息对象读取 swipe_id 来确定当前显示的是哪个 swipe
 *
 * @param {number} messageId - 被 swipe 的消息 ID
 */
async function handleMessageSwiped(messageId) {
  console.log(MODULE_NAME, `MESSAGE_SWIPED: 消息 #${messageId}`);

  if (!isVariableSystemEnabled()) {
    console.log(MODULE_NAME, "变量系统未启用，跳过处理");
    return;
  }

  try {
    const context = window.SillyTavern.getContext();
    const message = context.chat[messageId];
    const swipeId = message?.swipe_id ?? null;

    console.log(MODULE_NAME, `当前 swipe ID: ${swipeId}`);

    await processMessage(messageId, swipeId);
  } catch (error) {
    console.error(MODULE_NAME, "MESSAGE_SWIPED 处理失败:", error);
  }
}

/**
 * 处理 CHAT_CHANGED 事件
 *
 * **触发时机**：切换到新聊天
 * **参数**：chat_file_name (string) - 新聊天文件名
 *
 * **处理逻辑**：
 * 1. 检查新角色是否启用变量系统
 * 2. 处理最后一条 AI 消息（如果有）
 * 3. 注入新快照到聊天变量
 *
 * **注意**：不需要手动清空旧变量，酒馆的聊天变量是自动隔离的
 *
 * @param {string} chatFileName - 新聊天文件名
 */
async function handleChatChanged(chatFileName) {
  console.log(MODULE_NAME, `CHAT_CHANGED: ${chatFileName}`);

  try {
    if (!isVariableSystemEnabled()) {
      console.log(MODULE_NAME, "新角色未启用变量系统");
      return;
    }

    // 如果当前聊天有消息，重新处理最后一条 AI 消息
    const context = window.SillyTavern.getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
      console.log(MODULE_NAME, "新聊天无消息");
      return;
    }

    // 查找最后一条 AI 消息并处理
    for (let i = chat.length - 1; i >= 0; i--) {
      const message = chat[i];
      if (message.is_user === false || message.role === "assistant") {
        console.log(MODULE_NAME, `处理最后一条 AI 消息: #${i}`);
        await processMessage(i);
        break;
      }
    }
  } catch (error) {
    console.error(MODULE_NAME, "CHAT_CHANGED 处理失败:", error);
  }
}

/**
 * 处理 MESSAGE_DELETED 事件
 *
 * **触发时机**：用户删除消息
 * **参数**：message_id (number) - 被删除消息的原 ID
 *
 * **关键设计**：
 * - **不删除快照**（快照仍在数据库中，因为是 UUID 索引）
 * - **重新处理后续消息**（从删除点开始重新计算）
 *
 * @param {number} deletedMessageId - 被删除消息的原 ID
 */
async function handleMessageDeleted(deletedMessageId) {
  console.log(MODULE_NAME, `MESSAGE_DELETED: 消息 #${deletedMessageId}`);

  if (!isVariableSystemEnabled()) {
    console.log(MODULE_NAME, "变量系统未启用，跳过处理");
    return;
  }

  try {
    const context = window.SillyTavern.getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
      console.log(MODULE_NAME, "聊天已清空，无需重新处理");
      return;
    }

    // 从被删除消息的位置开始重新处理
    // 注意：消息删除后，后续消息的 ID 会前移，所以从 deletedMessageId 开始
    console.log(MODULE_NAME, `从消息 #${deletedMessageId} 开始重新处理`);
    await reprocessFromMessage(deletedMessageId);
  } catch (error) {
    console.error(MODULE_NAME, "MESSAGE_DELETED 处理失败:", error);
  }
}

/**
 * 处理 CHAT_DELETED 事件
 *
 * **触发时机**：用户删除整个聊天文件
 * **参数**：chat_file_name (string) - 被删除的聊天文件名
 *
 * **关键设计**：
 * - 调用插件 DELETE /snapshots/by-chat/:chatFile 批量删除快照
 * - 不需要手动清空聊天变量（酒馆会自动清理 chat_metadata）
 *
 * @param {string} chatFileName - 被删除的聊天文件名
 */
async function handleChatDeleted(chatFileName) {
  console.log(MODULE_NAME, `CHAT_DELETED: ${chatFileName}`);

  try {
    // 调用插件删除该聊天的所有快照
    if (!chatFileName) {
      console.warn(MODULE_NAME, "聊天文件名为空，无法删除快照");
      return;
    }

    const csrfToken = await getCsrfToken();
    if (!csrfToken) {
      console.warn(MODULE_NAME, "无法获取 CSRF Token，跳过插件删除");
      return;
    }

    const url = `/api/plugins/var-manager/var-manager/snapshots/by-chat/${encodeURIComponent(chatFileName)}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": csrfToken,
      },
    });

    if (response.status === 404) {
      console.log(MODULE_NAME, "插件不可用或快照不存在，跳过数据库清理");
      return;
    }

    if (!response.ok) {
      console.error(
        MODULE_NAME,
        `删除聊天快照失败 (${response.status}): ${chatFileName}`,
      );
      return;
    }

    const result = await response.json();
    console.log(
      MODULE_NAME,
      `已删除聊天 "${chatFileName}" 的 ${result.deletedCount ?? 0} 条快照`,
    );
  } catch (error) {
    console.error(MODULE_NAME, "CHAT_DELETED 处理失败:", error);
  }
}

/**
 * 注册所有事件监听器
 *
 * **调用时机**：扩展初始化时调用一次
 */
export function registerEventListeners() {
  console.log(MODULE_NAME, "注册事件监听器");

  // 使用 eventSource.on 注册监听器（酒馆原生扩展 API）
  eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.on(event_types.MESSAGE_SWIPED, handleMessageSwiped);
  eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
  eventSource.on(event_types.MESSAGE_DELETED, handleMessageDeleted);
  eventSource.on(event_types.CHAT_DELETED, handleChatDeleted);

  console.log(MODULE_NAME, "事件监听器已注册");
}

/**
 * 手动卸载所有事件监听器
 *
 * **注意**：通常不需要调用，eventOn 会在扩展关闭时自动卸载
 * 仅用于特殊场景（如扩展重载）
 */
export function unregisterEventListeners() {
  console.log(MODULE_NAME, "卸载事件监听器");

  eventSource.removeListener(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  eventSource.removeListener(event_types.MESSAGE_SWIPED, handleMessageSwiped);
  eventSource.removeListener(event_types.CHAT_CHANGED, handleChatChanged);
  eventSource.removeListener(event_types.MESSAGE_DELETED, handleMessageDeleted);
  eventSource.removeListener(event_types.CHAT_DELETED, handleChatDeleted);

  console.log(MODULE_NAME, "事件监听器已卸载");
}
