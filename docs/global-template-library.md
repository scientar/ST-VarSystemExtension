# 全局模板库功能草案

## 1. 目标

- 为变量系统提供可复用的全局模板管理界面，与角色卡模板共享同一编辑器体验。
- 支持模板的创建、查询、更新、删除，以及将模板应用到角色卡。
- 与后端插件提供的模板持久化接口保持一致，便于未来与快照/值池联动。

## 2. 前端模块划分

### 2.1 GlobalTemplateList（抽屉页）

- **职责**：列出所有可用全局模板，提供搜索/筛选入口。
- **关键元素**：
  - 搜索框（支持名称/标签关键字）。
  - 模板卡片：展示名称、更新时间、标签、schemaVersion。
  - “新建模板”按钮（跳转到详情页面并默认加载骨架）。

- **状态流**：
  1. 页面加载时请求 `GET /templates`。
  2. 用户搜索时更新参数重新请求。
  3. 点击列表项后触发 `GlobalTemplateStore.select(id)` 并打开详情页。

### 2.2 GlobalTemplateDetail（详情面板）

- **职责**：展示单个模板，复用 `VariableBlockEditor` 编辑 JSON，同时提供元信息表单。
- **界面组成**：
  - 模板基本信息：名称、描述、标签（多选）、schemaVersion（只读或可选）。
  - 编辑器区域：`VariableBlockEditor`，展示 templateBody。
  - 操作按钮：保存、另存为、删除、复制 ID、应用到当前角色卡。

- **工作流**：
  1. `select(id)` 后请求 `GET /templates/:id` 并使用 `setValue` 渲染。
  2. 编辑器产生改动 → 标记 `dirty`，启用保存按钮。
  3. 点击保存 → `PUT /templates/:id`；另存为 → `POST /templates`（复制 ID 由后端生成）。

### 2.3 保存为全局模板（角色卡页面入口）

- 在角色卡模板编辑器旁新增“保存为全局模板”按钮。
- 点击后弹出对话框：填写名称、描述、标签 → 调用 `POST /templates`，成功后提示并可跳转至详情页。

### 2.4 应用全局模板到角色卡

- 在详情页提供“覆盖当前角色卡模板”按钮：
  1. 询问确认（说明会替换角色卡模板字段且标记脏）。
  2. 读取模板 JSON → 调用现有角色卡保存逻辑（不立即启用变量系统，只更新模板与 schemaVersion）。
  3. 成功后在状态条显示同步结果。

## 3. 状态管理（GlobalTemplateStore）

- 持久化字段：
  - `list`：当前模板列表。
  - `filters`：搜索关键字、标签、分页信息。
  - `selectedId`、`selectedTemplate`。
  - `loadingStates`：列表加载、详情加载、保存中的布尔值。
- 暴露方法：`loadList`, `selectTemplate`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `applyToCharacter`。
- 实现形式：简单对象 + 事件订阅，暂不引入外部状态库。

## 4. 后端 API 草案

| 方法   | 路径                                                 | 描述     | 请求体                                                     | 响应                                          |
| ------ | ---------------------------------------------------- | -------- | ---------------------------------------------------------- | --------------------------------------------- |
| GET    | `/api/plugins/var-manager/var-manager/templates`     | 模板列表 | `search?`, `tag?`, `page?`, `pageSize?`                    | `{ items: TemplateSummary[], total: number }` |
| GET    | `/api/plugins/var-manager/var-manager/templates/:id` | 模板详情 | —                                                          | `TemplateDetail`                              |
| POST   | `/api/plugins/var-manager/var-manager/templates`     | 创建模板 | `{ name, description?, tags?, schemaVersion?, template }`  | `TemplateDetail`                              |
| PUT    | `/api/plugins/var-manager/var-manager/templates/:id` | 更新模板 | `{ name?, description?, tags?, schemaVersion?, template }` | `TemplateDetail`                              |
| DELETE | `/api/plugins/var-manager/var-manager/templates/:id` | 删除模板 | —                                                          | `{ success: boolean }`                        |

- `TemplateSummary` 字段：`{ id, name, tags, schemaVersion, updatedAt, createdAt }`。
- `TemplateDetail` 额外包含 `template`（完整 JSON）、`description`、`valuePoolSnapshot?`。
- 若插件暂不支持标签，可以字符串数组进行占位。

## 5. 用户交互流程

1. **创建模板**：角色卡页面 → “保存为全局模板” → 对话框填写 → 创建成功 → 弹窗提示并可跳转详情。
2. **修改模板**：在列表中选择 → 详情页面编辑 → 保存 → 状态条显示同步成功。
3. **应用模板**：详情页点击“覆盖角色卡” → 提示确认 → 保存角色卡 → 状态条显示覆盖成功。
4. **删除模板**：详情页 → “删除模板” → 二次确认 → 调用 DELETE → 列表刷新。

## 6. 风险与后续

- **数据量增长**：需关注分页与搜索性能；可限制初次加载数量。
- **并发编辑**：后端可返回 `updatedAt`，前端保存时附带，若不匹配提醒用户刷新。
- **模板引用统计**：未来可记录模板被角色卡引用次数，决定是否允许删除。

## 7. 下一步

1. 与后端对齐 API 路径与请求体字段，确认是否需要迁移旧接口数据。
2. 在实现前创建前端任务清单（列表页、详情页、角色卡入口、状态管理、对话框等）。
3. 设计 UI 草图（可先使用现有抽屉样式与按钮），并确认按钮文案。
4. 编写测试计划：
   - 单元测试：store 方法、API 适配器。
   - 手动测试：完整 CRUD 流程、角色卡覆盖流程、插件缺失时的降级提示。
