# 状态栏占位符使用指南

## 什么是状态栏占位符？

变量系统扩展会在每条 AI 消息的尾部自动添加 `<VarSystemStatusPlaceholder/>` 标签，供酒馆正则脚本替换为实际的状态栏 HTML。

## 设计参考

- **MVU**: 使用 `<StatusPlaceHolderImpl/>`
- **SAM**: 使用 `$`
- **本系统**: 使用 `<VarSystemStatusPlaceholder/>`

## 为什么需要占位符？

在传统方式中，如果要在 AI 消息尾部显示状态栏，需要：

1. AI 自己在输出中生成状态栏代码（浪费 token，且 AI 可能生成错误）
2. 或在世界书/提示词中要求 AI 输出特定格式（容易被 AI 忽略）

使用占位符后：

1. ✅ **零 token 消耗**：占位符在 AI 输出完成后由扩展自动添加
2. ✅ **格式统一**：使用正则替换确保状态栏格式一致
3. ✅ **数据最新**：占位符在变量注入后添加，确保 `{{vs_stat_data}}` 是最新值
4. ✅ **易于维护**：修改状态栏样式只需修改正则脚本，无需修改角色卡

## 使用示例

### 基础示例：显示 HP/MP

**步骤 1**: 在酒馆设置 → Chat/Message Regex → 新建正则脚本

**步骤 2**: 配置正则替换规则

```
脚本名称: 变量系统状态栏
查找模式: <VarSystemStatusPlaceholder/>
替换为:
<div class="status-bar">
  <div class="status-item">HP: {{vs_stat_data.hp}}/{{vs_stat_data.max_hp}}</div>
  <div class="status-item">MP: {{vs_stat_data.mp}}/{{vs_stat_data.max_mp}}</div>
  <div class="status-item">位置: {{vs_stat_data.location}}</div>
</div>
运行时机: Display (仅格式显示)
优先级: 100
```

**步骤 3**: 保存并启用脚本

### 进阶示例：带样式的状态栏

```html
<VarSystemStatusPlaceholder/>
```

替换为：

```html
<style>
  .vs-status-bar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px;
    border-radius: 8px;
    margin-top: 10px;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
  .vs-status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }
  .vs-status-item {
    background: rgba(255, 255, 255, 0.1);
    padding: 8px;
    border-radius: 4px;
  }
  .vs-status-label {
    font-size: 0.85em;
    opacity: 0.9;
  }
  .vs-status-value {
    font-size: 1.2em;
    font-weight: bold;
  }
</style>

<div class="vs-status-bar">
  <div class="vs-status-grid">
    <div class="vs-status-item">
      <div class="vs-status-label">生命值</div>
      <div class="vs-status-value">{{vs_stat_data.hp}}/{{vs_stat_data.max_hp}}</div>
    </div>
    <div class="vs-status-item">
      <div class="vs-status-label">魔力值</div>
      <div class="vs-status-value">{{vs_stat_data.mp}}/{{vs_stat_data.max_mp}}</div>
    </div>
    <div class="vs-status-item">
      <div class="vs-status-label">当前位置</div>
      <div class="vs-status-value">{{vs_stat_data.location}}</div>
    </div>
  </div>
</div>
```

### 条件显示示例

使用酒馆的 `{{#if}}` 语法进行条件显示：

```html
<div class="vs-status-bar">
  {{#if vs_stat_data.hp}}
  <div class="status-item">HP: {{vs_stat_data.hp}}/{{vs_stat_data.max_hp}}</div>
  {{/if}}

  {{#if vs_stat_data.status_effects}}
  <div class="status-effects">
    状态: {{vs_stat_data.status_effects}}
  </div>
  {{/if}}
</div>
```

## 技术细节

### 添加时机

占位符在**变量处理完成后**添加，确保时序正确：

1. AI 生成消息 → 触发 `MESSAGE_RECEIVED` 事件
2. 处理消息中的函数调用 → 生成新快照
3. 注入快照到 `vs_stat_data` 变量 ✅
4. **添加占位符到消息尾部** ← 此时 `vs_stat_data` 已是最新值
5. 正则替换占位符为实际 HTML

### 添加规则

- ✅ **仅 AI 消息**：只在 `role !== 'user'` 的消息中添加
- ✅ **避免重复**：检查消息是否已包含占位符，避免重复添加
- ✅ **支持 swipe**：切换 swipe 时会自动处理占位符
- ✅ **不影响保存**：占位符添加后使用 `refresh: 'affected'` 仅刷新当前楼层

### 实现位置

- 模块：[src/events/statusPlaceholder.ts](../src/events/statusPlaceholder.ts)
- 集成：[src/events/processor.ts:315](../src/events/processor.ts#L315)
- 调用时机：在 `injectSnapshotVariables()` 之后

## 常见问题

### Q: 为什么我的状态栏不显示？

**检查清单**：

1. ✅ 角色是否启用了变量系统？
   - 角色编辑 → Extensions → ST Variable System → Enable
2. ✅ 正则脚本是否已启用？
   - 设置 → Chat/Message Regex → 确认脚本前有勾选
3. ✅ 正则脚本运行时机是否正确？
   - 必须设置为 "Display (仅格式显示)"
4. ✅ 变量是否存在？
   - F12 打开控制台 → 输入 `getVariables({type:'chat'})` 查看 `vs_stat_data`

### Q: 占位符出现在消息中间而不是尾部？

这是正常的，因为：
1. 占位符添加到**消息字符串尾部**
2. 如果 AI 输出中已经有其他占位符（如 MVU 的），占位符会在它们之前
3. 可以通过调整正则脚本的**优先级**来控制替换顺序

### Q: 可以自定义占位符吗？

目前占位符是硬编码为 `<VarSystemStatusPlaceholder/>`，未来可能添加配置选项。

临时方案：修改 [src/events/statusPlaceholder.ts](../src/events/statusPlaceholder.ts) 中的 `STATUS_PLACEHOLDER` 常量并重新构建。

### Q: 占位符会影响 AI 生成吗？

不会。占位符在 **AI 生成完成后** 才添加，因此：
- ✅ 不会被发送到 AI
- ✅ 不会影响上下文
- ✅ 不会消耗 token

### Q: 如何在多个角色间共享状态栏样式？

**方法 1**: 全局正则脚本
- 在设置 → Chat/Message Regex 中创建全局脚本
- 所有角色都会应用

**方法 2**: 导出/导入正则脚本
- 设置 → Chat/Message Regex → Export
- 在其他酒馆实例中 Import

### Q: 占位符会被保存到聊天文件吗？

会。占位符是消息内容的一部分，会被保存到聊天文件（`*.jsonl`）。

但这不影响：
- ✅ 切换角色
- ✅ 导出聊天
- ✅ 分享聊天

只要接收方也安装了变量系统扩展和相应的正则脚本，状态栏就能正常显示。

### Q: 如何隐藏占位符本身？

如果不想显示占位符标签，可以在正则脚本中替换为空字符串：

```
查找: <VarSystemStatusPlaceholder/>
替换为: (留空)
运行时机: Display
```

或者使用 CSS 隐藏：

```html
<style>
  /* 隐藏未被替换的占位符 */
  VarSystemStatusPlaceholder {
    display: none !important;
  }
</style>
```

## 与社区方案对比

| 方案 | 占位符 | 变量名 | 使用场景 |
|------|--------|--------|----------|
| **MVU** | `<StatusPlaceHolderImpl/>` | `stat_data` | 变量更新系统，支持 AI 主动修改变量 |
| **SAM** | `$` | `SAM_data` | 简单状态栏，专注于显示 |
| **本系统** | `<VarSystemStatusPlaceholder/>` | `vs_stat_data` | 快照系统，支持函数调用和时间旅行 |

**兼容性**：三者可以共存使用，互不冲突。

## 最佳实践

### 1. 使用语义化的变量名

```typescript
// ✅ 推荐
{
  player: {
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50
  },
  location: "森林"
}

// ❌ 不推荐
{
  h: 100,
  mh: 100,
  m: 50,
  mm: 50,
  l: "森林"
}
```

### 2. 提供默认值

在正则脚本中使用 `{{#if}}` 或 `||` 提供默认值：

```html
<div>HP: {{vs_stat_data.hp || 0}}/{{vs_stat_data.max_hp || 100}}</div>
```

### 3. 优化性能

- 避免在状态栏中使用过于复杂的嵌套结构
- 使用 CSS Grid/Flexbox 而不是 Table 布局
- 压缩 CSS（去除空格和注释）

### 4. 测试兼容性

在不同主题下测试状态栏显示效果：
- 默认主题
- 暗色主题
- 自定义主题

## 相关文档

- [函数库使用指南](./FUNCTIONS.md) - 了解如何通过函数修改变量
- [快照系统设计](./SNAPSHOTS.md) - 了解快照的工作原理
- [变量注入机制](./VARIABLE_INJECTION.md) - 了解 vs_stat_data 如何注入

## 贡献

如果你有更好的状态栏样式示例，欢迎提交 PR 或在 Issues 中分享！
