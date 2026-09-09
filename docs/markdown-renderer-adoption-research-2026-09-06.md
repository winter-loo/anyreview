# ReviewLoop 开源 Markdown 渲染器选型

**日期：2026-09-06**

> **2026-09-09 更新：** 本文保留为历史选型记录。用户已提出 TOC 跳转、数学公式、更多图表和整体阅读 UI 的改进需求，并指定 markdown-viewer-extension 为参考。“眼下只缺 Mermaid”及下文的绝对技术路线限制不再代表最新需求；后续以 [Markdown 渲染改进方向](markdown-rendering-roadmap.md) 为准。

## 决策

**方案方向只对一半：可以借用成熟 npm 包，但不应整体替换 `markdown-it`，更不能复制或 fork 上游源码。**

ReviewLoop 当前依赖 `markdown-it` token 的源码行范围，把文档拆成稳定 block；字符选区、服务端校验和恢复高亮依赖“服务端规范化文本 offset = 浏览器 DOM 文本 offset”。完整 Viewer 接管 DOM、图形把源码替换成 SVG 后，这个不变量会失效。

**当前最小正确方案：保留 `markdown-it`；眼下只缺 Mermaid，就引入 Mermaid 正式包并显式使用 `securityLevel: 'strict'`。** Mermaid 官方说明 `strict` 会编码 HTML 并禁用点击，`loose` 则允许 HTML 和点击行为。[13] 等 Graphviz/ECharts 等成为真实需求，再评估 Vditor 的 method bundle 对 fenced code 做局部后处理。

## 候选比较

| 项目 | 预览/图形能力 | 许可 | 适配判断 |
|---|---|---|---|
| **Cherry Markdown** | 官方纯预览、移动端；Mermaid、数学、表格图表、媒体；Full/Core/Stream/Engine 构建；内置白名单和 DOMPurify。[6] | Apache-2.0，许可证同时列明第三方组件许可。[7] | 若以后新建独立 Viewer，它是全家桶候选；对当前 block/offset 模型不是最小替换。 |
| **Vditor** | 一个 `preview` 调用会统一执行 Mermaid、SMILES、Markmap、Flowchart、Graphviz、WaveDrom、ECharts、Mindmap、PlantUML、ABC、数学和代码高亮。[2][3] | MIT。[2] | 功能最广，适配器能识别 `markdown-it` 的 fenced-code class。[12] 但 Mermaid 固定为 `securityLevel: "loose"`。[4] |
| **Milkdown** | 成熟的插件化 Markdown 编辑器框架，但官方首页没有提供上述“图形全家桶”的开箱清单。[8] | MIT。[8] | 会把问题重新变成逐插件集成，不符合此次目标。 |
| **TOAST UI Editor** | 有 chart、code syntax、color syntax、merge table、UML 插件。[9] | MIT。[9] | 官方仓库已归档；不作为新基础设施。 |

包大小不是决定因素，但也说明不应整包照搬：npm 当前元数据中 Vditor 4.0.0 解包约 23.6 MB，Cherry Markdown 0.11.10 解包约 50.3 MB。[10][11] 应使用 Cherry 的 Engine/Core 构建并实测浏览器产物，而不是根据 npm tarball 大小猜最终 bundle。

## 为什么不选 Vditor

Vditor 是仍在维护的完整 Markdown 编辑/预览项目。[1] 它最接近“一次支持所有图形”：其 `previewRender` 的确集中调用所有图形渲染器。[3] 但 Mermaid 渲染器源码固定使用 `securityLevel: "loose"`，并把生成 SVG 写入 `innerHTML`。[4] 我们的公网 Review 页面不能为了少写集成代码而降低 XSS 边界。

除非后续满足以下任一条件，否则不采用：

1. 上游允许配置 Mermaid strict/sandbox；
2. 我们仅启用经过独立净化的 SVG 输出；
3. 所有文档都成为明确可信输入，且不再公开分享。

## 最小接入方式

不搬源码，不新增后端服务，不改评论协议：

```text
本地原 Markdown
→ markdown-it 继续负责 SSR、分块和安全转义
→ 客户端仅增强 fenced diagram block
→ 浏览器原生 Selection
→ 现有 text-range / page-region 批注协议
```

第一步只做 Mermaid：

1. 安装 Mermaid 正式包；
2. 客户端动态导入，只扫描 `.language-mermaid`；
3. 固定 `securityLevel: 'strict'`，将结果留在原 diagram block 内；
4. diagram block 不提供源码文字批注，正文 block 的选择和 offset 保持不变；
5. 在 iPhone 上验证图形宽度、正文选区和 XSS fixture。

以后真实需要多图形时，可动态导入 `vditor/dist/method.min` 对 fenced code 后处理，但必须避开其 Mermaid loose 实现，或等上游允许覆盖安全级别。Cherry 只在“独立完整 Viewer”成为需求时再基于官方项目做原型。[5] Milkdown 和 ByteMD 都会回到插件/迁移成本问题。[8][14]

## 验收线

- 当前 Mermaid `sequenceDiagram` 在 390px 宽度下显示为 SVG，而不是代码块；无页面级横向溢出。
- 文本标注状态机不回退：选区调整期间无 backdrop，确认后才打开 composer。
- 图形前后正文的字符锚点 round-trip 通过。
- 恶意 HTML、`javascript:` 链接、事件属性和 Mermaid payload 不能执行脚本。
- 浏览器不从第三方 CDN 动态加载脚本；依赖资产由 ReviewLoop 自己提供。
- 本地 Markdown 仍不上传、不复制、不进入文档数据库。

## Sources

[1] https://github.com/Vanessa219/vditor
[2] https://raw.githubusercontent.com/Vanessa219/vditor/4535ffb0c6b70809a0d5bcb477d9568e297ae83f/README.md
[3] https://raw.githubusercontent.com/Vanessa219/vditor/4535ffb0c6b70809a0d5bcb477d9568e297ae83f/src/ts/markdown/previewRender.ts
[4] https://raw.githubusercontent.com/Vanessa219/vditor/4535ffb0c6b70809a0d5bcb477d9568e297ae83f/src/ts/markdown/mermaidRender.ts
[5] https://github.com/Tencent/cherry-markdown
[6] https://raw.githubusercontent.com/Tencent/cherry-markdown/5bb02e30e5da6e579cdb383882b1e880a44f627b/README.md
[7] https://raw.githubusercontent.com/Tencent/cherry-markdown/5bb02e30e5da6e579cdb383882b1e880a44f627b/LICENSE
[8] https://github.com/Milkdown/milkdown
[9] https://github.com/nhn/tui.editor
[10] https://registry.npmjs.org/vditor/latest
[11] https://registry.npmjs.org/cherry-markdown/latest
[12] https://raw.githubusercontent.com/Vanessa219/vditor/4535ffb0c6b70809a0d5bcb477d9568e297ae83f/src/ts/markdown/adapterRender.ts
[13] https://github.com/mermaid-js/mermaid/blob/develop/docs/config/usage.md
[14] https://github.com/pd4d10/bytemd
