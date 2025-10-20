/**
 * @file processor.js
 * @description 快照生成核心处理流程
 *
 * **处理流程**：
 * 1. 检查目标消息是否已有快照 → 有则直接注入，无则继续
 * 2. 向上查找最近的快照锚点（或角色模板）
 * 3. 收集锚点到目标消息之间的所有 AI 消息
 * 4. 从每条 AI 消息中解析函数调用
 * 5. 按位置顺序执行函数（passive before → active → passive after）
 * 6. 生成新快照并保存到插件数据库
 * 7. 注入快照变量到聊天作用域
 *
 * @module events/processor
 */

import { executeFunctionPipeline } from "../functions/executor.js";
import { functionRegistry } from "../functions/registry.js";
import {
  getSnapshotId,
  saveSnapshotToPlugin,
} from "../snapshots/snapshotIdentifier.js";
import {
  findSnapshotAnchor,
  getAIMessageRange,
} from "../snapshots/snapshotResolver.js";
import { injectSnapshotVariables } from "./variableInjector.js";

const MODULE_NAME = "[ST-VarSystemExtension/processor]";

/**
 * 获取角色模板作为初始快照
 *
 * @returns {Object|null} 角色模板对象，如果不存在或未启用则返回 null
 */
function getCharacterTemplate() {
  try {
    const context = window.SillyTavern.getContext();
    const character = context.characters[context.characterId];

    if (!character?.data?.extensions?.st_var_system) {
      console.log(MODULE_NAME, "角色未配置变量模板");
      return null;
    }

    const { enabled, templateBody } = character.data.extensions.st_var_system;

    if (!enabled) {
      console.log(MODULE_NAME, "角色变量模板未启用");
      return null;
    }

    if (!templateBody || typeof templateBody !== "object") {
      console.warn(MODULE_NAME, "角色模板格式无效:", templateBody);
      return null;
    }

    console.log(
      MODULE_NAME,
      "使用角色模板作为初始快照:",
      Object.keys(templateBody),
    );
    return structuredClone(templateBody); // 深拷贝，避免修改原始模板
  } catch (error) {
    console.error(MODULE_NAME, "读取角色模板时发生错误:", error);
    return null;
  }
}

/**
 * 从插件读取快照内容
 *
 * @param {string} snapshotId - 快照 UUID
 * @returns {Promise<Object|null>} 快照对象，失败则返回 null
 */
async function fetchSnapshotFromPlugin(snapshotId) {
  try {
    const response = await fetch(
      `/api/plugins/var-manager/var-manager/snapshots/${snapshotId}`,
    );

    if (response.status === 404) {
      console.warn(MODULE_NAME, `快照不存在: ${snapshotId}`);
      return null;
    }

    if (!response.ok) {
      console.error(
        MODULE_NAME,
        `读取快照失败 (${response.status}): ${snapshotId}`,
      );
      return null;
    }

    const data = await response.json();
    // 插件返回: { identifier, chatFile, messageId, createdAt, payload }
    return data.payload;
  } catch (error) {
    console.error(MODULE_NAME, "从插件读取快照时发生错误:", error);
    return null;
  }
}

/**
 * 检查消息是否已有快照
 *
 * @param {number} messageId - 消息 ID
 * @param {number} swipeId - swipe ID（默认为当前 swipe）
 * @returns {Promise<Object|null>} 如果存在快照则返回 { snapshotId, snapshot }，否则返回 null
 */
async function checkExistingSnapshot(messageId, swipeId = null) {
  // 获取消息对象
  const context = window.SillyTavern.getContext();
  const chat = context.chat;

  if (!chat || messageId >= chat.length) {
    console.error(MODULE_NAME, "checkExistingSnapshot: 消息 ID 无效", {
      messageId,
      chatLength: chat?.length,
    });
    return null;
  }

  const message = chat[messageId];
  if (!message) {
    console.error(MODULE_NAME, "checkExistingSnapshot: 消息不存在", messageId);
    return null;
  }

  // 获取快照标识符
  const snapshotId = getSnapshotId(message);

  if (!snapshotId) {
    return null;
  }

  console.log(
    MODULE_NAME,
    `消息 #${messageId} swipe=${swipeId ?? "current"} 已有快照: ${snapshotId}`,
  );

  // 从插件读取完整快照内容
  const snapshot = await fetchSnapshotFromPlugin(snapshotId);

  if (!snapshot) {
    console.warn(
      MODULE_NAME,
      `快照 ID 存在但无法从插件读取，将重新生成: ${snapshotId}`,
    );
    return null;
  }

  return { snapshotId, snapshot };
}

/**
 * 处理单条消息，生成快照
 *
 * **核心逻辑**：
 * 1. 检查是否已有快照 → 有则直接注入并返回
 * 2. 查找快照锚点（向上查找最近的快照，或使用角色模板）
 * 3. 收集锚点到目标消息之间的 AI 消息
 * 4. 解析并执行所有函数调用
 * 5. 生成新快照，保存到插件，注入到聊天变量
 *
 * @param {number} targetMessageId - 目标消息 ID
 * @param {number} [swipeId=null] - swipe ID，null 表示使用当前 swipe
 * @returns {Promise<Object|null>} 生成的快照对象，失败则返回 null
 */
export async function processMessage(targetMessageId, swipeId = null) {
  console.log(
    MODULE_NAME,
    `开始处理消息 #${targetMessageId}, swipe=${swipeId ?? "current"}`,
  );

  // 获取聊天上下文
  const context = window.SillyTavern.getContext();
  const chat = context.chat;

  if (!chat || chat.length === 0) {
    console.warn(MODULE_NAME, "当前无聊天记录");
    return null;
  }

  // 1. 检查是否已有快照
  const existing = await checkExistingSnapshot(targetMessageId, swipeId);
  if (existing?.snapshot) {
    // 快照已存在且成功读取，直接注入
    await injectSnapshotVariables(existing.snapshot);
    console.log(MODULE_NAME, "消息已有快照，直接注入");
    return existing.snapshot;
  }

  // 2. 查找快照锚点
  const anchorResult = await findSnapshotAnchor(targetMessageId, chat);

  let baseSnapshot;
  let startMessageId;

  if (anchorResult) {
    // 从锚点快照继续
    console.log(
      MODULE_NAME,
      `找到快照锚点: 消息 #${anchorResult.anchorMessageId}, ID: ${anchorResult.snapshotId}`,
    );

    // 从插件读取完整快照内容
    baseSnapshot = await fetchSnapshotFromPlugin(anchorResult.snapshotId);

    if (!baseSnapshot) {
      console.warn(
        MODULE_NAME,
        `锚点快照读取失败，将从角色模板重新开始: ${anchorResult.snapshotId}`,
      );
      baseSnapshot = getCharacterTemplate() || {};
      startMessageId = 0;
    } else {
      startMessageId = anchorResult.anchorMessageId + 1; // 从锚点下一条消息开始
    }
  } else {
    // 从角色模板开始
    console.log(MODULE_NAME, "未找到快照锚点，使用角色模板");
    baseSnapshot = getCharacterTemplate();

    if (!baseSnapshot) {
      console.warn(MODULE_NAME, "无角色模板且无快照锚点，使用空快照");
      baseSnapshot = {};
    }

    startMessageId = 0; // 从第一条消息开始
  }

  // 3. 收集需要处理的 AI 消息
  const aiMessages = getAIMessageRange(startMessageId, targetMessageId, chat);

  if (aiMessages.length === 0) {
    console.log(MODULE_NAME, "无需处理的 AI 消息，直接使用基础快照");
    await injectSnapshotVariables(baseSnapshot);
    return baseSnapshot;
  }

  console.log(MODULE_NAME, `需要处理 ${aiMessages.length} 条 AI 消息`);

  // 4-7. 逐层处理：解析函数调用 → 执行 → 生成快照 → 保存（每层都保存）
  let currentSnapshot = structuredClone(baseSnapshot);

  for (let i = 0; i < aiMessages.length; i++) {
    const msg = aiMessages[i];
    const isLastMessage = i === aiMessages.length - 1;

    console.log(
      MODULE_NAME,
      `处理第 ${i + 1}/${aiMessages.length} 层: 消息 #${msg.messageId}`,
    );

    // 解析该层的函数调用
    const content = msg.content || msg.mes || "";
    const calls = functionRegistry.parseFunctionCalls(content);

    if (calls.length > 0) {
      console.log(
        MODULE_NAME,
        `消息 #${msg.messageId} 解析到 ${calls.length} 个函数调用`,
      );

      // 执行该层的函数调用，生成新快照
      try {
        currentSnapshot = await executeFunctionPipeline(calls, currentSnapshot);
        console.log(MODULE_NAME, `消息 #${msg.messageId} 函数执行完成`);
      } catch (error) {
        console.error(
          MODULE_NAME,
          `消息 #${msg.messageId} 执行函数时发生错误:`,
          error,
        );
        // 即使执行失败，也继续处理并保存当前状态
      }
    } else {
      console.log(MODULE_NAME, `消息 #${msg.messageId} 无函数调用，快照不变`);
    }

    // 保存该层快照到插件
    // 对于最后一层，使用传入的 swipeId；其他层使用消息当前的 swipe_id
    const layerSwipeId = isLastMessage
      ? swipeId
      : (msg.message?.swipe_id ?? null);

    const snapshotId = await saveSnapshotToPlugin(
      msg.messageId,
      layerSwipeId,
      currentSnapshot,
    );

    if (snapshotId) {
      console.log(
        MODULE_NAME,
        `消息 #${msg.messageId} 快照已保存，ID: ${snapshotId}`,
      );
    } else {
      console.warn(
        MODULE_NAME,
        `消息 #${msg.messageId} 保存快照到插件失败（插件可能不可用）`,
      );
    }
  }

  // 8. 注入最终快照变量到聊天作用域
  await injectSnapshotVariables(currentSnapshot);

  console.log(MODULE_NAME, "处理完成，已注入快照变量");
  return currentSnapshot;
}

/**
 * 重新处理从指定消息到最新消息的所有快照
 *
 * **使用场景**：
 * - 用户修改了角色模板
 * - 用户删除了某条消息（需要重新计算后续快照）
 * - 函数库更新后需要重新应用
 *
 * @param {number} fromMessageId - 起始消息 ID（包含）
 * @returns {Promise<void>}
 */
export async function reprocessFromMessage(fromMessageId) {
  const context = window.SillyTavern.getContext();
  const chat = context.chat;

  if (!chat || chat.length === 0) {
    console.warn(MODULE_NAME, "当前无聊天记录，无法重新处理");
    return;
  }

  const lastMessageId = chat.length - 1;

  console.log(
    MODULE_NAME,
    `重新处理消息 #${fromMessageId} 到 #${lastMessageId}`,
  );

  // 依次处理每条 AI 消息
  for (let i = fromMessageId; i <= lastMessageId; i++) {
    const message = chat[i];

    // 只处理 AI 消息
    if (message.is_user !== false && message.role !== "assistant") {
      continue;
    }

    // TODO: 清除现有快照标识符（强制重新生成）
    // 目前简化：直接覆盖

    await processMessage(i);
  }

  console.log(MODULE_NAME, "重新处理完成");
}
