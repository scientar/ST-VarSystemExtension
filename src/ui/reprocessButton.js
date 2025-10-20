/**
 * @file reprocessButton.js
 * @description "重新处理变量"按钮 - 添加到消息扩展菜单
 * 功能：清除最后一层 AI 消息的快照标识符，重新运行处理流程
 */

import { getContext } from '/scripts/extensions.js';
import { saveChat } from '/script.js';
import { reprocessFromMessage } from "../events/processor.js";

const MODULE_NAME = "[ST-VarSystemExtension/reprocessButton]";

/**
 * 初始化"重新处理变量"按钮
 */
export function initReprocessButton() {
  console.log(MODULE_NAME, "初始化重新处理变量按钮");

  // 添加按钮到扩展消息按钮区域
  const buttonHtml = `
    <div 
      id="var-system-reprocess-btn" 
      class="mes_button" 
      title="重新处理变量系统快照"
      style="display: none;"
    >
      <i class="fa-solid fa-rotate"></i>
      <span>重新处理变量</span>
    </div>
  `;

  // 确保 extraMesButtons 容器存在
  if ($(".extraMesButtons").length === 0) {
    console.warn(MODULE_NAME, "extraMesButtons 容器不存在，稍后重试");
    // 延迟重试
    setTimeout(initReprocessButton, 1000);
    return;
  }

  // 添加按钮（如果还没添加）
  if ($("#var-system-reprocess-btn").length === 0) {
    $(".extraMesButtons").append(buttonHtml);
  }

  // 绑定点击事件
  $(document).off("click", "#var-system-reprocess-btn");
  $(document).on("click", "#var-system-reprocess-btn", handleReprocessClick);

  // 监听角色/聊天变化，动态显示/隐藏按钮
  updateButtonVisibility();
}

/**
 * 处理"重新处理变量"按钮点击
 */
async function handleReprocessClick() {
  console.log(MODULE_NAME, "点击重新处理变量按钮");

  try {
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
      toastr.warning("当前聊天为空", "变量系统");
      return;
    }

    // 检查变量系统是否启用
    const character = context.characters[context.characterId];
    const enabled =
      character?.data?.extensions?.st_var_system?.enabled ?? false;

    if (!enabled) {
      toastr.warning("当前角色未启用变量系统", "变量系统");
      return;
    }

    // 找到最后一层 AI 消息
    let lastAiMessageIndex = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
      if (!chat[i].is_user) {
        lastAiMessageIndex = i;
        break;
      }
    }

    if (lastAiMessageIndex === -1) {
      toastr.warning("没有找到 AI 消息", "变量系统");
      return;
    }

    const message = chat[lastAiMessageIndex];
    const currentSwipeId = message.swipe_id || 0;

    // 清除标识符（如果存在）
    const snapshotId =
      message.swipes_info?.[currentSwipeId]?.st_var_system_snapshot_id;

    if (snapshotId) {
      console.log(
        MODULE_NAME,
        `清除第 ${lastAiMessageIndex} 层 (swipe ${currentSwipeId}) 的快照标识符:`,
        snapshotId,
      );
      delete message.swipes_info[currentSwipeId].st_var_system_snapshot_id;

      // 保存聊天记录
      await saveChat();
    } else {
      console.log(
        MODULE_NAME,
        `第 ${lastAiMessageIndex} 层 (swipe ${currentSwipeId}) 没有快照标识符，直接重新处理`,
      );
    }

    // 重新处理该消息
    toastr.info("开始重新处理变量...", "变量系统");

    await reprocessFromMessage(lastAiMessageIndex);

    toastr.success("变量重新处理完成", "变量系统");
  } catch (error) {
    console.error(MODULE_NAME, "重新处理变量失败:", error);
    toastr.error(`重新处理变量失败：${error.message}`, "变量系统");
  }
}

/**
 * 更新按钮显示状态
 * 只在启用变量系统的角色聊天中显示
 */
export function updateButtonVisibility() {
  try {
    const context = getContext();
    const character = context.characters?.[context.characterId];
    const enabled =
      character?.data?.extensions?.st_var_system?.enabled ?? false;
    const hasChat = context.chat && context.chat.length > 0;

    if (enabled && hasChat) {
      $("#var-system-reprocess-btn").show();
    } else {
      $("#var-system-reprocess-btn").hide();
    }
  } catch (error) {
    console.error(MODULE_NAME, "更新按钮显示状态失败:", error);
    $("#var-system-reprocess-btn").hide();
  }
}
