/**
 * @file statusPlaceholder.ts
 * @description 状态栏占位符模块，在 AI 消息尾部添加占位符供正则替换使用
 *
 * **设计参考**：
 * - MVU: 使用 <StatusPlaceHolderImpl/>
 * - SAM: 使用 $
 * - 本系统: 使用 <VarSystemStatusPlaceholder/>
 *
 * **使用场景**：
 * 在酒馆正则脚本中使用替换功能，将占位符替换为实际的状态栏 HTML
 *
 * @example
 * // 正则脚本示例（替换模式）
 * // 查找: <VarSystemStatusPlaceholder/>
 * // 替换为: <div class="status-bar">HP: {{vs_stat_data.hp}}</div>
 *
 * @module events/statusPlaceholder
 */

const MODULE_NAME = "[ST-VarSystemExtension/statusPlaceholder]";

/** 状态栏占位符常量 */
export const STATUS_PLACEHOLDER = "<VarSystemStatusPlaceholder/>";

/**
 * 在 AI 消息尾部添加状态栏占位符
 *
 * **关键设计**：
 * - 仅对 AI 消息添加（role !== 'user'）
 * - 避免重复添加（检查 includes）
 * - 在变量处理完成后调用，确保 vs_stat_data 已是最新值
 * - 使用 refresh: 'affected' 仅刷新当前楼层
 *
 * @param messageId - 目标消息 ID
 * @returns {Promise<boolean>} 是否成功添加占位符
 */
export async function addStatusPlaceholder(
  messageId: number,
): Promise<boolean> {
  try {
    // 获取目标消息
    const messages = window.TavernHelper.getChatMessages(messageId);
    if (!messages || messages.length === 0) {
      console.warn(MODULE_NAME, `消息 #${messageId} 不存在`);
      return false;
    }

    const message = messages[0];

    // 仅对 AI 消息添加占位符
    if (message.role === "user") {
      console.log(
        MODULE_NAME,
        `消息 #${messageId} 是用户消息，跳过添加占位符`,
      );
      return false;
    }

    // 检查是否已包含占位符，避免重复添加
    if (message.message.includes(STATUS_PLACEHOLDER)) {
      console.log(MODULE_NAME, `消息 #${messageId} 已包含占位符`);
      return false;
    }

    // 在消息尾部添加占位符
    const updatedMessage = message.message + `\n\n${STATUS_PLACEHOLDER}`;

    // 更新消息内容
    await window.TavernHelper.setChatMessages(
      [
        {
          message_id: messageId,
          message: updatedMessage,
        },
      ],
      {
        refresh: "affected", // 仅刷新当前楼层，避免整个聊天重载
      },
    );

    console.log(MODULE_NAME, `已为消息 #${messageId} 添加状态栏占位符`);
    return true;
  } catch (error) {
    console.error(MODULE_NAME, `添加占位符时发生错误:`, error);
    return false;
  }
}
