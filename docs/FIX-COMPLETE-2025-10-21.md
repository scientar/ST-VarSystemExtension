# API 使用修复完成报告 (2025-10-21)

## 修复内容

### 1. `src/events/listeners.js` - 事件监听器模块

#### 修复 1.1: 添加 `event_types` 定义

```javascript
// 添加在文件顶部（第 21 行后）
const event_types = tavern_events;
```

- **说明**：使用全局的 `tavern_events` 对象（由 SillyTavern 提供）
- **来源**：`references/iframe/event.d.ts` 定义 `declare const tavern_events`

#### 修复 1.2: 修改 `getContext()` 调用（共 4 处）

```javascript
// 修改前
const context = getContext();

// 修改后
const context = SillyTavern.getContext();
```

- **位置**：
  - `isVariableSystemEnabled()` 函数
  - `handleMessageSwiped()` 函数
  - `handleChatChanged()` 函数
  - `handleMessageDeleted()` 函数
- **说明**：使用全局对象 `SillyTavern.getContext()`
- **来源**：`SillyTavern/public/scripts/st-context.js` 导出到全局

### 2. `src/ui/messageSnapshots.js` - 楼层快照界面

#### 修复 2.1: 修正导入路径

```javascript
// 修改前
import { getContext } from "../../../../../../../scripts/extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../../../popup.js";

// 修改后
import { getContext } from "/scripts/extensions.js";
import { callGenericPopup, POPUP_TYPE } from "/scripts/popup.js";
```

- **说明**：使用绝对路径（从网站根目录）代替错误的相对路径

### 3. `src/ui/functionLibrary.js` - 函数库管理界面

#### 修复 3.1: 修正导入路径

```javascript
// 修改前
import { callGenericPopup, POPUP_TYPE } from "../../../../../../popup.js";
import {
  extension_settings,
  getContext,
  saveSettingsDebounced,
  writeExtensionField,
} from "../../../../../../scripts/extensions.js";

// 修改后
import { callGenericPopup, POPUP_TYPE } from "/scripts/popup.js";
import {
  extension_settings,
  getContext,
  saveSettingsDebounced,
  writeExtensionField,
} from "/scripts/extensions.js";
```

- **说明**：使用绝对路径（从网站根目录）代替错误的相对路径

## 验证状态

### ✅ 已验证正确的用法

| API                        | 文件                         | 状态                |
| -------------------------- | ---------------------------- | ------------------- |
| `SillyTavern.getContext()` | `src/events/processor.js`    | ✅ 正确             |
| `getContext()` (导入)      | `src/ui/reprocessButton.js`  | ✅ 正确             |
| `getContext()` (导入)      | `src/ui/messageSnapshots.js` | ✅ 已修复           |
| `getContext()` (导入)      | `src/ui/functionLibrary.js`  | ✅ 已修复           |
| `eventOn()`                | `src/events/listeners.js`    | ✅ 正确（全局函数） |
| `eventRemoveListener()`    | `src/events/listeners.js`    | ✅ 正确（全局函数） |
| `tavern_events`            | `src/events/listeners.js`    | ✅ 已修复           |

### 📋 事件监听验证清单

按照 `后续框架规划.md` 2.2 节要求，需监听的事件：

- [x] `MESSAGE_RECEIVED` - AI 回复完成
- [x] `MESSAGE_SWIPED` - 切换 swipe
- [x] `CHAT_CHANGED` - 切换聊天
- [x] `MESSAGE_DELETED` - 删除消息
- [x] `CHAT_DELETED` - 删除聊天

所有事件监听器已注册并使用正确的 API。

### 📋 处理流程验证清单（2.3 节）

以下流程逻辑已实现（`src/events/processor.js`）：

- [x] 检查最后一层 AI 消息是否有快照标识符
- [x] 向上查找快照锚点
- [x] 使用角色模板作为初始快照（找不到锚点时）
- [x] 收集需要处理的 AI 消息范围
- [x] 逐层解析函数调用
- [x] 执行函数管道生成快照
- [x] 保存快照到插件数据库
- [x] 注入快照变量到聊天作用域（`vs_stat_data`）

### 📋 注意事项验证（2.5 节）

- [x] 只在 `enabled: true` 时处理（`isVariableSystemEnabled()` 检查）
- [x] 只考虑当前启用的 swipe（`swipe_id` 参数处理）
- [x] 唯一标识符存储在消息对象和数据库中（`snapshotIdentifier.js`）

## API 使用规范总结

### 在扩展中使用 SillyTavern API

#### 方式 1：从模块导入（推荐）

```javascript
import { getContext, event_types, eventSource } from "/scripts/extensions.js";
```

- 适用文件：所有 UI 模块、主入口文件
- 示例：`index.js`, `ui/*.js`

#### 方式 2：使用全局对象

```javascript
const context = SillyTavern.getContext();
```

- 适用场景：无法导入模块的地方
- 示例：`processor.js`（逻辑模块）

#### 方式 3：使用全局事件函数（iframe 风格）

```javascript
const event_types = tavern_events;
eventOn(event_types.MESSAGE_RECEIVED, handler);
eventRemoveListener(event_types.MESSAGE_RECEIVED, handler);
```

- 适用场景：事件监听器
- 示例：`listeners.js`
- 说明：`eventOn` 和 `eventRemoveListener` 是全局函数，无需导入

### 路径规范

所有从 SillyTavern 导入的模块使用**绝对路径**：

```javascript
// ✅ 正确
import { getContext } from "/scripts/extensions.js";
import { callGenericPopup } from "/scripts/popup.js";

// ❌ 错误
import { getContext } from "../../../../../../scripts/extensions.js";
```

## 参考文档

- `references/iframe/event.d.ts` - 事件系统（全局函数和 tavern_events）
- `SillyTavern/public/scripts/events.js` - event_types 导出
- `SillyTavern/public/scripts/st-context.js` - getContext 实现
- `SillyTavern/public/scripts/extensions.js` - 扩展 API 导出
- `后续框架规划.md` - 处理流程规划（2. 处理流程）

## 下一步

建议在 SillyTavern 中实际测试：

1. 安装扩展到 SillyTavern
2. 启用变量系统
3. 触发各种事件（发送消息、切换 swipe、删除消息等）
4. 检查控制台是否有错误
5. 验证快照是否正确生成和保存
