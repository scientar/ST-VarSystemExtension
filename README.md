# ST-VarSystemExtension

这是一个为 SillyTavern 提供可视化变量管理的前端扩展。配合后端插件 [ST-VarSystemPlugin](https://github.com/scientar/ST-VarSystemPlugin) 使用，为角色卡对话提供直观、强大的变量管理和编辑体验。

本扩展参考了社区中多个优秀项目的设计思路，希望能为创作者和玩家提供更好的变量管理工具。

## 主要功能

### 1. 角色模板管理

为每个角色卡设置变量初始模板，作为对话开始时的变量基础状态。

- 📝 使用专业的 JSON 编辑器可视化编辑模板
- 💾 支持启用/禁用模板功能
- 📤 导出模板为 JSON 文件
- 📥 从 JSON 文件导入模板
- 🧹 一键分离 MVU Schema（方便跨系统迁移）
- 🌍 将模板保存为全局快照以供复用

### 2. 全局快照管理

创建和管理可在不同角色卡、不同对话间复用的变量快照。

- ✨ 创建、编辑、删除全局快照
- 🔍 支持按名称、描述搜索
- 🏷️ 标签系统，方便分类管理
- 📋 查看快照详细信息（创建时间、更新时间等）
- 📤 导出快照为 JSON 文件
- 📥 从 JSON 文件导入快照
- 🧹 分离 MVU Schema 支持
- 💡 可直接应用到角色模板

### 3. 楼层快照管理

查看和编辑对话中每个消息楼层绑定的变量快照。

- 📊 查看当前对话所有楼层的快照列表
- 🎯 下拉选择或直接跳转到指定楼层
- ✏️ 编辑楼层快照内容
- 💾 保存修改并自动更新后续楼层
- 📤 导出楼层快照
- 📥 导入快照到编辑器
- 🧹 分离 Schema 功能
- 🌍 将楼层快照保存为全局快照

### 4. 函数库管理

管理用于处理变量的自定义函数，支持 MVU 和 SAM 语法。

- 🔧 全局函数和局域函数分类管理
- ➕ 可视化新增、编辑、删除函数
- 🔀 拖拽排序调整执行顺序
- 🔄 在全局和局域之间移动函数
- 📦 批量导入/导出函数
- 📝 生成 AI 提示词，方便告知 AI 可用函数
- ⚙️ 支持主动函数（需 AI 调用）和被动函数（自动执行）

### 5. 专业编辑体验

- 🌳 使用 [vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) 提供专业的 JSON 编辑器
- 🔄 树形视图和代码视图无缝切换
- ✨ 语法高亮和实时错误检查
- 🎨 深色模式适配
- ⚡ 大数据量优化

## 安装方法

### 前提条件

本扩展需要配合后端插件 [ST-VarSystemPlugin](https://github.com/scientar/ST-VarSystemPlugin) 使用。请先按照插件文档完成后端安装。

### 安装扩展

1. 打开 SillyTavern 的扩展管理界面
2. 点击"安装扩展"
3. 输入本仓库的 URL：`https://github.com/scientar/ST-VarSystemExtension`
4. 点击确认安装

### 验证安装

安装成功后，在 SillyTavern 顶部菜单栏应该能看到一个新的变量系统图标。点击图标可以打开变量管理面板，面板中包含五个标签页：

- 角色模板
- 全局快照
- 楼层快照
- 函数库
- 设置

## 使用说明

### 快速开始

1. **启用角色模板**：打开角色模板标签页，编辑初始变量，点击保存并启用
2. **开始对话**：与角色对话，扩展会自动处理变量更新
3. **查看快照**：切换到楼层快照标签页，查看每层对话的变量状态
4. **管理函数**：在函数库标签页添加自定义变量处理函数

### MVU Schema 分离功能

如果您从使用 [MagVarUpdate (MVU)](https://github.com/MagicalAstrogy/MagVarUpdate) 的项目迁移数据：

1. 导入包含 MVU Schema 的 JSON 文件
2. 点击"分离 Schema"按钮
3. 系统会自动移除所有 `$` 开头的 Schema 字段
4. 保存清理后的纯数据

这使得数据可以在不同变量系统间灵活迁移。

## 依赖说明

- **后端插件**：[ST-VarSystemPlugin](https://github.com/scientar/ST-VarSystemPlugin) （必需）
- **SillyTavern**：需要较新版本的 SillyTavern（建议使用最新的 staging 分支）

## 致谢

本项目的开发离不开以下优秀项目的启发和参考：

- **[酒馆助手 (JS-Slash-Runner)]**：感谢提供的宝贵参考文件和 SillyTavern 扩展开发指引
- **[MagVarUpdate (MVU)]**、**[SAM]**、[记忆增强]提供的灵感

## 开发说明

如果您想参与开发或自定义功能：

1. Fork 本仓库
2. 修改源代码
3. 在 SillyTavern 的 `public/scripts/extensions/third-party/` 目录下创建符号链接或直接复制文件
4. 刷新 SillyTavern 测试修改

欢迎提交 Issue 和 Pull Request！

## 许可证

本项目采用 MIT 许可证。详见 LICENSE 文件。
