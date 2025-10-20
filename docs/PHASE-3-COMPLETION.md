# Phase 3 事件集成完成总结

**完成时间**: 2025-10-21  
**状态**: ✅ 已完成

---

## 实现的模块

### 1. **variableInjector.js** - 变量注入模块

**依赖**: JS-Slash-Runner (酒馆助手) 的 `TavernHelper` API

**核心 API**:

```javascript
// 注入快照变量到聊天作用域（chat scope）
await injectSnapshotVariables({ hp: 100, mp: 50, location: "森林" });

// 读取当前快照变量
const snapshot = await getCurrentSnapshotVariables();
```

**注入机制**:

- 使用 `TavernHelper.updateVariablesWith()` 修改 `chat_metadata.variables`
- **关键参数**: `{ type: 'chat' }` - 确保是聊天级别而非全局
- 注入单一变量:
  - `vs_stat_data` - 完整快照对象（可通过 `{{getvar::vs_stat_data.hp}}` 访问字段）
- **变量清理**: 不再手动清理，依赖 SillyTavern 的 chat 作用域自动隔离不同聊天的变量

**在提示词中使用**:

```
HP={{hp}}, MP={{mp}}, 位置={{location}}

调试信息:
{{ST_VAR_SNAPSHOT}}
```

---

### 2. **processor.js** - 核心处理流程

**核心函数**: `processMessage(messageId, swipeId)`

**处理流程**:

1. 检查是否已有快照 → 有则直接注入
2. 查找快照锚点（向上查找最近的快照）
3. 无锚点时使用角色模板 (`character.data.extensions.st_var_system.templateBody`)
4. 收集锚点到目标消息之间的所有 AI 消息
5. 解析所有函数调用（使用 `parseFunctionCalls()`）
6. 执行函数管道（使用 `executeFunctionPipeline()`）
7. 保存快照到插件（使用 `saveSnapshotToPlugin()`）
8. 注入快照变量到聊天作用域

**辅助函数**: `reprocessFromMessage(fromMessageId)`

- 用于重新处理从指定消息到最新消息的所有快照
- 使用场景: 角色模板修改、消息删除后重算

---

### 3. **listeners.js** - 事件监听器

**监听的事件**（均来自 `tavern_events`）:

| 事件               | 触发时机       | 参数                   | 处理逻辑                       |
| ------------------ | -------------- | ---------------------- | ------------------------------ |
| `MESSAGE_RECEIVED` | AI 生成新消息  | `messageId: number`    | 处理消息，生成快照             |
| `MESSAGE_SWIPED`   | 用户切换 swipe | `messageId: number`    | 读取 `swipe_id`，重新处理      |
| `CHAT_CHANGED`     | 切换聊天       | `chatFileName: string` | 清空变量，处理最后一条 AI 消息 |
| `MESSAGE_DELETED`  | 删除消息       | `messageId: number`    | 从删除点开始重新处理           |
| `CHAT_DELETED`     | 删除整个聊天   | _(无参数)_             | 清空变量，TODO: 调用插件删除   |

**启用检查**:

- 所有事件处理器在执行前检查 `character.data.extensions.st_var_system.enabled`
- 未启用时跳过处理（避免性能浪费）

**注册方式**:

```javascript
// 扩展初始化时调用（index.js）
registerEventListeners();

// 扩展卸载时调用（index.js）
unregisterEventListeners();
```

---

## 集成到扩展入口

**文件**: `index.js`

**修改点**:

1. 导入事件模块:

   ```javascript
   import {
     registerEventListeners,
     unregisterEventListeners,
   } from "./src/events/index.js";
   ```

2. 在 `initExtension()` 中注册:

   ```javascript
   async function initExtension() {
     // ... 其他初始化代码 ...
     registerEventListeners();
     console.log(`${EXTENSION_LOG_PREFIX} 事件监听器已注册`);
   }
   ```

3. 在 `shutdownExtension()` 中卸载:
   ```javascript
   async function shutdownExtension() {
     // ... 其他卸载代码 ...
     unregisterEventListeners();
     console.log(`${EXTENSION_LOG_PREFIX} 事件监听器已卸载`);
   }
   ```

---

## 技术要点

### 1. **变量作用域**

- ✅ **使用 `chat` 作用域**（`{ type: 'chat' }`）
- ❌ **不使用 `global` 作用域**
- 原因: 避免跨角色污染，每个聊天独立管理变量

### 2. **依赖关系**

- **必需**: JS-Slash-Runner (酒馆助手)
- 原因: 提供 `TavernHelper.getVariables()` 和 `updateVariablesWith()` API
- 用户已确认: "酒馆助手是肯定会一起使用的"

### 3. **事件参数验证**

- 所有事件类型和参数均参考 `references/iframe/event.d.ts`
- `ListenerType` 接口定义了每个事件的参数类型
- 示例:
  ```typescript
  [tavern_events.MESSAGE_SWIPED]: (message_id: number) => void;
  [tavern_events.CHAT_CHANGED]: (chat_file_name: string) => void;
  ```

### 4. **错误处理**

- 所有异步操作使用 `try-catch` 包裹
- 错误时记录到控制台，不中断其他处理流程
- 酒馆助手不可用时提示用户安装

---

## 待完成的 TODO

### 1. **插件快照读取接口** (Priority: High)

- 目前 `checkExistingSnapshot()` 只检查快照 ID，未读取内容
- 需要插件实现 `GET /snapshots/:id` 接口
- 需要在 `processor.js` 中集成该接口

### 2. **聊天删除清理** (Priority: Medium)

- 目前 `handleChatDeleted()` 只清空变量，未调用插件删除
- 需要确定如何获取被删除的聊天文件名
- 需要调用 `DELETE /snapshots/by-chat/:chatFile`

### 3. **~~变量清理优化~~** (已完成)

- ✅ 已移除 `clearSnapshotVariables()` 函数及所有调用
- ✅ 依赖 SillyTavern 的 `type: 'chat'` 作用域自动隔离
- 设计原则: 扩展只写不删，聊天切换时酒馆自动清理旧聊天的变量

### 4. **CSRF Token 获取**

- 插件 DELETE 请求需要 CSRF Token
- 参考全局快照模块中的 `getCsrfToken()` 实现

---

## 测试建议

### 1. **基本流程测试**

1. 启用角色变量模板
2. AI 回复包含函数调用（如 `@.SET("hp", 100);`）
3. 检查控制台日志确认快照生成
4. 在提示词中使用 `{{hp}}` 验证变量注入

### 2. **Swipe 测试**

1. 生成多个 swipe
2. 切换到不同 swipe
3. 验证每个 swipe 都有独立快照

### 3. **消息删除测试**

1. 删除中间某条消息
2. 验证后续消息重新处理
3. 检查快照是否正确更新

### 4. **聊天切换测试**

1. 切换到新角色
2. 验证变量已清空
3. 验证新角色模板已加载

---

## 文件结构

```
ST-VarSystemExtension/
├── index.js                           # 扩展入口（已集成事件监听器）
└── src/
    ├── events/
    │   ├── index.js                   # 统一导出
    │   ├── variableInjector.js        # 变量注入（TavernHelper API）
    │   ├── processor.js               # 核心处理流程
    │   └── listeners.js               # 事件监听器
    ├── functions/
    │   ├── registry.js                # parseFunctionCalls()
    │   └── executor.js                # executeFunctionPipeline()
    └── snapshots/
        ├── messageUtils.js            # findSnapshotAnchor(), getAIMessageRange()
        └── snapshotIdentifier.js      # getSnapshotId(), saveSnapshotToPlugin()
```

---

## 下一步计划

1. **优先**: 实现插件 `GET /snapshots/:id` 接口
2. **优先**: 集成插件读取到 `processor.js`
3. **次要**: 实现聊天删除清理逻辑
4. **次要**: 优化变量清理机制
5. **未来**: 开始 Phase 4 UI 实现（函数库管理界面）

---

**总结**: Phase 3 事件集成已完成核心功能，实现了从 AI 回复到快照生成、变量注入的完整流程。主要待完善点是插件快照读取接口和聊天删除清理。
