# 变量生命周期管理

> **创建日期**: 2025-10-21  
> **最后更新**: 2025-10-21

## 核心设计原则

### 只写不删 (Write-Only)

扩展对聊天变量的管理遵循 **只写不删** 原则：

- ✅ **只负责注入**: 通过 `injectSnapshotVariables()` 更新变量
- ❌ **不手动清理**: 不调用任何删除变量的操作
- 🔄 **信任作用域**: 依赖 SillyTavern 的变量作用域系统自动管理生命周期

---

## SillyTavern 变量作用域

### 三种作用域类型

| 类型          | 说明                       | 生命周期                       |
| ------------- | -------------------------- | ------------------------------ |
| `'global'`    | 全局变量，跨所有角色和聊天 | 手动管理，永久保存             |
| `'character'` | 角色变量，跨同一角色的聊天 | 切换角色时清空                 |
| `'chat'`      | 聊天变量，绑定到当前聊天   | **切换聊天时自动清空**（关键） |

### 我们使用的作用域

```javascript
TavernHelper.updateVariablesWith(
  (variables) => {
    variables.vs_stat_data = snapshot; // 注入快照对象
  },
  { type: "chat" }, // 🔑 关键：聊天级别作用域
);
```

**为什么选择 `chat` 作用域**：

- ✅ **自动隔离**: 不同聊天的变量互不干扰
- ✅ **自动清理**: 切换聊天时，SillyTavern 自动清空旧聊天的 `vs_stat_data`
- ✅ **简化逻辑**: 扩展无需维护清理逻辑，减少出错可能

---

## 变量注入流程

### 当前实现 (src/events/variableInjector.js)

```javascript
/**
 * 注入快照变量到聊天作用域
 * @param {Object} snapshot - 快照对象 (如 {hp: 100, mp: 50, location: "森林"})
 */
export async function injectSnapshotVariables(snapshot) {
  if (!isTavernHelperAvailable()) {
    console.warn(MODULE_NAME, "酒馆助手不可用，无法注入变量");
    return;
  }

  try {
    // 直接注入整个快照对象
    window.TavernHelper.updateVariablesWith(
      (variables) => {
        variables.vs_stat_data = snapshot;
      },
      { type: "chat" },
    );

    console.log(MODULE_NAME, "快照变量已注入:", snapshot);
  } catch (error) {
    console.error(MODULE_NAME, "注入快照变量时发生错误:", error);
  }
}
```

### 关键要点

1. **单一变量**: 只注入 `vs_stat_data`，不拆分为多个变量
2. **整体注入**: 快照作为完整对象保存，保持结构完整
3. **覆盖更新**: 新快照直接覆盖旧值，无需先清空

---

## 事件处理中的变量管理

### 1. 消息接收/切换 (MESSAGE_RECEIVED, MESSAGE_SWIPED)

```javascript
async function handleMessageReceived(mesId) {
  const snapshot = await processMessage(mesId);
  if (snapshot) {
    await injectSnapshotVariables(snapshot); // ✅ 只写入
  }
}
```

- **不需要**: 先清空旧变量
- **原因**: 新快照直接覆盖

### 2. 聊天切换 (CHAT_CHANGED)

```javascript
async function handleChatChanged() {
  const lastAiMessage = findLastAiMessage();
  if (lastAiMessage) {
    const snapshot = await processMessage(lastAiMessage.index);
    if (snapshot) {
      await injectSnapshotVariables(snapshot); // ✅ 只写入
    }
  }
  // ❌ 不调用 clearSnapshotVariables()
  // ✅ SillyTavern 已自动清空旧聊天的 chat 作用域变量
}
```

- **不需要**: 手动清空旧聊天的变量
- **原因**: `chat` 作用域自动清空

### 3. 消息删除 (MESSAGE_DELETED)

```javascript
async function handleMessageDeleted(mesId) {
  // 重新处理最新消息
  await reprocessFromMessage(mesId - 1);
  // ❌ 不调用 clearSnapshotVariables()
  // ✅ reprocessFromMessage 会调用 injectSnapshotVariables 覆盖
}
```

- **不需要**: 先清空再重新注入
- **原因**: 重新处理时会自动覆盖

### 4. 聊天删除 (CHAT_DELETED)

```javascript
async function handleChatDeleted(chatFileName) {
  // 只调用插件 API 删除数据库中的快照
  const url = `/api/plugins/var-manager/var-manager/snapshots/by-chat/${chatFileName}`;
  await fetch(url, {
    method: "DELETE",
    headers: { "X-CSRF-Token": await getCsrfToken() },
  });
  // ❌ 不调用 clearSnapshotVariables()
  // ✅ 变量由 SillyTavern 管理，聊天文件删除时自动清理
}
```

- **不需要**: 清空聊天变量
- **原因**: 聊天已不存在，变量无关紧要（且切换聊天时会自动清空）

---

## 历史变更记录

### 2025-10-21: 移除手动清理逻辑

**变更内容**:

1. 删除 `clearSnapshotVariables()` 函数
2. 移除所有事件处理器中的 `clearSnapshotVariables()` 调用
3. 简化为"只写不删"模式

**影响文件**:

- `src/events/variableInjector.js` - 删除 30 行代码
- `src/events/listeners.js` - 移除 4 处调用
- `src/events/index.js` - 移除导出

**技术原因**:

- SillyTavern 的 `type: 'chat'` 作用域已提供自动隔离
- 手动清理是多余的，且增加代码复杂度
- 社区其他变量系统 (MVU, SAM) 也采用类似模式

---

## 提示词中使用变量

### 访问快照数据

```handlebars
当前生命值：{{getvar::vs_stat_data.hp}}
当前魔力值：{{getvar::vs_stat_data.mp}}
当前位置：{{getvar::vs_stat_data.location}}
```

### 完整快照 JSON

```handlebars
当前状态：
{{getvar::vs_stat_data}}
```

---

## 与社区方案对比

| 方案         | 变量名       | 作用域  | 清理方式           |
| ------------ | ------------ | ------- | ------------------ |
| **本系统**   | vs_stat_data | chat    | 自动（作用域隔离） |
| **MVU**      | stat_data    | chat(?) | 自动               |
| **SAM**      | SAM_data     | chat(?) | 自动               |
| **记忆增强** | 自定义       | global  | 手动管理           |

---

## 最佳实践

### ✅ 推荐做法

1. **只调用 `injectSnapshotVariables()`** - 更新变量
2. **信任 SillyTavern 的作用域** - 不手动删除
3. **使用 `type: 'chat'`** - 确保聊天级别隔离
4. **单一变量命名** - `vs_stat_data` 对齐社区习惯

### ❌ 避免做法

1. **手动删除变量** - 交给作用域管理
2. **拆分快照字段** - 保持整体结构
3. **使用 `global` 作用域** - 会污染全局命名空间
4. **复杂清理逻辑** - 增加维护成本

---

## 调试建议

### 检查当前快照

```javascript
const snapshot = await getCurrentSnapshotVariables();
console.log("当前快照:", snapshot);
```

### 验证作用域隔离

1. 在聊天 A 中注入快照 `{hp: 100}`
2. 切换到聊天 B
3. 检查 `vs_stat_data` 应为 `undefined` 或新聊天的值

### 常见问题

**Q: 为什么切换聊天后变量还在？**

A: 检查是否错误使用了 `type: 'global'` 或 `type: 'character'`

**Q: 变量更新不生效？**

A: 检查 `TavernHelper` 是否可用，以及是否正确传递 `{ type: 'chat' }`

---

## 参考资料

- [VARIABLE-INJECTION-FIX.md](VARIABLE-INJECTION-FIX.md) - 变量注入修复记录
- [PHASE-3-COMPLETION.md](PHASE-3-COMPLETION.md) - Phase 3 完成总结
- [MESSAGE-SNAPSHOT-DESIGN.md](MESSAGE-SNAPSHOT-DESIGN.md) - 消息快照设计
- SillyTavern 源码: `public/scripts/variables.js` - 变量系统实现
