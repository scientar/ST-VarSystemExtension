# 统一变量块编辑器（VariableBlockEditor）设计草稿

## 1. 背景与目标

- 统一角色卡模板、全局模板、楼层快照三类 JSON 变量块的查看与编辑体验。
- 对现有 `vanilla-jsoneditor` 文本模式进行抽象，便于未来扩展树形/表单视图。
- 提供一致的状态栏与操作钩子，方便在不同页面挂载自定义按钮（保存、覆盖、应用等）。

## 2. 核心职责

1. 管理底层 JSON 编辑器实例（初始化、销毁、降级文本模式）。
2. 同步外部状态：`dirty`、`hasErrors`、`schemaVersion`、`sourceType`、`syncState`。
3. 暴露数据访问与事件接口，供上层逻辑（角色卡、全局库、快照）订阅与触发行为。
4. 在 UI 上渲染统一的状态条（来源、模板版本、保存状态、错误提示）。
5. 兼容无 JSON 编辑器资源时的降级模式（纯文本 `<textarea>`）。

## 3. 组件接口草案

```ts
interface VariableBlockEditorOptions {
  container: HTMLElement;
  sourceType: "character" | "global" | "snapshot";
  readOnly?: boolean;
  schemaVersion?: number | null;
  value?: unknown;
  status?: {
    level: "idle" | "saving" | "saved" | "error" | "warning";
    message?: string;
    timestamp?: number;
  };
  hooks?: {
    onChange?: (payload: EditorChangePayload) => void;
    onParseSuccess?: (model: ParsedTemplateModel) => void;
    onParseFailure?: (reason: Error) => void;
    onRequestAction?: (action: VariableBlockEditorAction) => void;
  };
}

type VariableBlockEditorAction =
  | { type: "save" }
  | { type: "discard" }
  | { type: "applyToCharacter"; targetCharacterId: string }
  | { type: "export" };

interface VariableBlockEditorHandle {
  mount(): void;
  update(options: Partial<VariableBlockEditorOptions>): void;
  getValue(): unknown;
  setValue(value: unknown, opts?: { silent?: boolean }): void;
  setStatus(status: VariableBlockEditorOptions["status"]): void;
  destroy(): void;
}
```

- `onRequestAction` 为后续可选：当用户点击状态条或工具栏按钮时向上冒泡。
- `ParsedTemplateModel` 待复用现有 `src/template/types.d.ts` 中的类型。

## 4. 内部状态结构

```ts
interface VariableBlockEditorState {
  editorInstance: JSONEditor | null;
  fallbackTextarea: HTMLTextAreaElement | null;
  mounted: boolean;
  currentValue: unknown;
  dirty: boolean;
  hasErrors: boolean;
  schemaVersion: number | null;
  sourceType: "character" | "global" | "snapshot";
  readOnly: boolean;
  status: VariableBlockEditorOptions["status"];
}
```

- `editorInstance` 兼容 vanilla-jsoneditor 与降级 `<textarea>`。
- `dirty`/`hasErrors` 根据 `onChange` 回调更新，并向外部透出。

## 5. 生命周期流程

1. `mount`
   - 尝试加载 JSON 编辑器资源，失败则创建 `<textarea>`。
   - 渲染状态条与工具栏容器。
   - 调用 `setValue(options.value, { silent: true })`。
2. `update`
   - 当 `sourceType`、`readOnly`、`schemaVersion` 变化时更新状态条。
   - 接受外部的 `status`，例如保存中 / 保存成功。
3. `setValue`
   - 支持 `silent` 参数避免触发 `onChange`。
   - 校验 JSON 是否可序列化，失败时回退到文本显示并触发 `onParseFailure`。
4. `getValue`
   - 优先从 JSON 编辑器实例读取，若降级则解析 `<textarea>` 文本。
5. `destroy`
   - 清理事件监听与 DOM，释放 editor 实例。

## 6. UI 组成

```html
<div class="var-block-editor">
  <header class="var-block-editor__status">
    <span class="status__source">角色卡模板</span>
    <span class="status__schema">Schema v1</span>
    <span class="status__dirty">未保存</span>
    <span class="status__message status--warn">模板已修改，尚未保存。</span>
  </header>
  <section class="var-block-editor__actions">
    <!-- 插槽，视来源类型注入按钮 -->
  </section>
  <section class="var-block-editor__editor"></section>
</div>
```

- 初版 CSS 可放在 `assets/styles/variable-block-editor.css`，后续视情况添加。
- 状态条信息来源于内部 `state` 与外部 `status`。

## 7. 与现有逻辑的集成计划

1. **阶段 1（当前）**：
   - 完成本设计文档与骨架代码，确保 API 与状态字段固定。
   - 不改动原有 `index.js` 行为。
2. **阶段 2**：
   - 在角色卡模板页面引入 `VariableBlockEditor`，替换现有 editor 初始化逻辑。
   - 将按钮事件迁移到 `onRequestAction` 或直接绑定到容器上。
3. **阶段 3**：
   - 新增“全局模板库”页面时复用该编辑器，验证跨来源配置。
   - 为快照查看器实现只读模式，测试大体量 JSON 性能。
4. **阶段 4**：
   - 增加视图模式切换（文本/树/表单）。
   - 支持 schema 校验高亮、搜索、高亮引用。

## 8. 开放问题

- 状态条布局是否需要适配窄屏模式？需在实现时验证。
- 是否需要内置快捷键（Ctrl+S）触发 `save` 动作？
- 大文件性能优化（虚拟滚动）是否提前在骨架中预留占位。

## 9. 下一步

- 在 `src/editor/variableBlockEditor.js` 写出模块骨架，实现公开函数但内部以 TODO 占位。
- 待文档确认后，开始将角色卡模板编辑器改造为该组件的首个使用者。
