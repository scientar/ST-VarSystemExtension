<template>
  <Teleport defer to="#extensionsMenu">
    <div v-if="isVisible" class="extension_container">
      <div
        class="list-group-item flex-container flexGap5 interactable"
        tabindex="0"
        role="listitem"
        @click="handleReprocess"
      >
        <div class="fa-solid fa-rotate extensionsMenuExtensionButton" />
        <span>重新处理变量</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { getContext } from '@sillytavern/scripts/extensions';
import { saveChat, eventSource, event_types } from '@sillytavern/script';
import { reprocessFromMessage } from '../events/processor';

const MODULE_NAME = '[ST-VarSystemExtension/reprocessMenuItem]';

// 响应式状态
const characterId = ref<number | null>(null);
const hasChat = ref(false);
const isEnabled = ref(false);

// 计算属性：按钮是否可见
const isVisible = computed(() => isEnabled.value && hasChat.value);

/**
 * 更新可见性状态
 */
function updateVisibility() {
  try {
    const context = getContext();
    const character = context.characters?.[context.characterId];

    characterId.value = context.characterId;
    hasChat.value = Boolean(context.chat && context.chat.length > 0);
    isEnabled.value = character?.data?.extensions?.st_var_system?.enabled ?? false;
  } catch (error) {
    console.error(MODULE_NAME, '更新可见性状态失败:', error);
    isEnabled.value = false;
    hasChat.value = false;
  }
}

/**
 * 处理重新处理按钮点击
 */
async function handleReprocess() {
  console.log(MODULE_NAME, '点击重新处理变量按钮');

  try {
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
      toastr.warning('当前聊天为空', '变量系统');
      return;
    }

    // 检查变量系统是否启用
    const character = context.characters[context.characterId];
    const enabled = character?.data?.extensions?.st_var_system?.enabled ?? false;

    if (!enabled) {
      toastr.warning('当前角色未启用变量系统', '变量系统');
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
      toastr.warning('没有找到 AI 消息', '变量系统');
      return;
    }

    const message = chat[lastAiMessageIndex];
    const currentSwipeId = message.swipe_id || 0;

    // 清除标识符（如果存在）
    const snapshotId = message.swipes_info?.[currentSwipeId]?.st_var_system_snapshot_id;

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
    toastr.info('开始重新处理变量...', '变量系统');

    await reprocessFromMessage(lastAiMessageIndex);

    toastr.success('变量重新处理完成', '变量系统');
  } catch (error) {
    console.error(MODULE_NAME, '重新处理变量失败:', error);
    toastr.error(`重新处理变量失败：${error.message}`, '变量系统');
  }
}

// 初始化和事件监听
updateVisibility();

// 监听聊天和角色变化
eventSource.on(event_types.CHAT_CHANGED, updateVisibility);
eventSource.on(event_types.MESSAGE_RECEIVED, updateVisibility);
eventSource.on(event_types.MESSAGE_DELETED, updateVisibility);
eventSource.on(event_types.CHARACTER_SELECTED, updateVisibility);
</script>
