# ReviewLoop 视频工程

包含横版（桌面/官网）与竖版（手机/短视频）两套可复现、配置驱动的宣发视频工程。构建完全由配置生成，不再调用历史临时脚本或依赖外部网络。

## 规格一览

| 版本 | 画幅 | 帧率 | 时长 | 定位与适用渠道 | 核心入口与配置 |
|---|---|---|---|---|---|
| **横版** | 1920×1080 | 30fps | 93.9s | 桌面端、官网展示、Bilibili/YouTube 横屏 | `config/project.json` |
| **竖版** | 1080×1920 | 30fps | 53.2s | 手机端传播、微信视频号、抖音、小红书 | `config/project-vertical.json` |

## 文件职责

| 位置 | 用途 |
|---|---|
| `config/project.json` / `project-vertical.json` | 画幅、帧率、工具版本、响度目标、输出名和检查时刻 |
| `config/scenes.json` / `scenes-vertical.json` | 场景顺序与时长，每幕素材、字幕、音频、动画和分镜时刻 |
| `config/assets.json` / `assets-vertical.json` | 素材依赖清单：相对路径、来源说明、大小、SHA-256、音视频参数 |
| `templates/film*.html.template` | 按幕注释、缩进的页面结构：主手机、页面、遮罩和尾声堆叠 |
| `templates/film*.css` | 独立可编辑样式，分横版与竖版响应式视觉层 |
| `templates/captions*.html.template`、`audio*.html.template` | 字幕和旁白轨的元素绑定 |
| `vendor/gsap.min.js` | 固定 GSAP 3.14.2，播放和渲染不再依赖 CDN 请求 |
| `pipeline.py` | 统一生产构建流程，支持 `--config` 参数，Python 标准库即可运行 |
| `tests/` | 回归与配置错误检查、横/竖版合法性校验 |
| `index.html`、`captions.srt`、`timing.json` | 自动生成，不直接编辑 |
| `ASSETS.md`、`SCENES.md` | 自动生成的可读素材清单与分镜旁白 |
| `renders/` | 当前构建的检查报告、原始渲染、最终 MP4、字幕、证明帧和分镜网页 |

现有 `assets/`、`volcano/`、`vertical-audio/`、`sfx/`、`ending/` 里的素材继续原地使用，避免复制大文件或破坏来源记录。文件名中保留的版本号表示素材来源，不构成构建链依赖。

## 日常命令

工程位于仓库的 `marketing/product-video/`，与产品应用独立构建。

在本目录运行，需要 Python 3.10+、Node 22+、pnpm 10.23.0、FFmpeg/ffprobe 和 Chrome/Chromium。

### 横版视频命令
```sh
pnpm run build          # 配置 → index.html、SRT、时间轴、素材表、分镜旁白
pnpm run validate       # 配置与素材哈希强校验
pnpm test               # 迁移回归、越界、重复 ID、素材替换与竖版配置检查
pnpm run check          # 构建后执行 HyperFrames 浏览器检查
pnpm run dev            # 构建后启动 HyperFrames Studio 预览
pnpm run release        # 构建 → 检查 → 高质量渲染 → 响度处理 → 解码校验 → 分镜导出
```

### 竖版短视频命令
```sh
pnpm run build:vertical    # 竖版构建：配置 → 页面/字幕/分镜
pnpm run validate:vertical # 竖版配置与素材哈希校验
pnpm run dev:vertical      # 竖版 HyperFrames Studio 预览
pnpm run check:vertical    # 竖版浏览器渲染检查
pnpm run release:vertical  # 竖版全流程导出（成片、SRT、分镜、关键证明帧）
```

也可直接使用 `python3 pipeline.py [--config <path>] build|validate|check|preview|render|finish|release`。

默认使用 `pnpm dlx hyperframes@0.8.33`；版本固定在 project 配置文件中。首次使用 pnpm dlx 需要网络。可通过 `HYPERFRAMES_BIN` 指定已安装的 CLI，通过 `HYPERFRAMES_BROWSER_PATH` 指定浏览器。

输出：
- 横版：`renders/ReviewLoop.mp4`、`renders/captions.srt`、`renders/storyboard/index.html`
- 竖版：`renders/ReviewLoop-Vertical.mp4`、`renders/ReviewLoop-Vertical.srt`、`renders/storyboard-ReviewLoop-Vertical/index.html`

审阅命令：
- `review renders/ReviewLoop.mp4 --local`
- `review renders/ReviewLoop-Vertical.mp4 --local`

## 如何编辑

场景顺序决定起点，`duration` 是场景长度。所有 `offset` 都是相对所属场景的秒数；移动场景后其字幕、声音和动作一起移动。`poster_offset` 是该幕在分镜中取帧的位置。

`clips` 的 `id` 对应模板中的稳定元素 ID：`asset` 引用素材清单；`offset`/`duration` 指定播放窗口；`track` 是时间轴轨道；`text` 是字幕正文。视频素材已经做过的剪辑仍保存在素材文件里，改变播放窗口不会自动重新剪辑素材。片段可以跨幕延续，但不能超过全片。

`motion` 记录 GSAP 的 `set`/`to`、选择器、参数和场景内偏移。`order` 保留 GSAP 指令注册顺序，不能随意重新排序；添加指令时使用唯一序号。修改动作时保留手机主体和遮罩，不把用户界面重新画成示意图。

换素材时，先把新文件放入工程，登记路径、来源、大小和 SHA-256，再修改 clip.asset。哈希不一致会阻止构建，避免同名文件偷偷替换。旁白文本变更后必须重新生成音频并调整字幕分段和时刻；系统不会把旧音轨自动变成新文案。

新增可视片段也需要在模板增加对应的带 ID 元素和占位符。模板负责布局，配置负责素材和时刻，不再在 Python 中替换某个旧版 HTML 字符串。

## 防止混用旧结果

render 完成时记录页面和渲染文件哈希；finish 会验证当前配置生成的页面仍与该记录一致，且渲染文件未被替换。修改了场景或素材后，必须重新 render，不能拿旧 MP4 做新发布。历史输出已清理；需要成片时重新执行 release。

旧版本构建脚本、一次性迁移脚本、历代成片、旧分镜、原始录制中间文件与未采用的音频实验已清理。新的九幕分镜直接从本次最终成片生成。`tests/fixtures/` 中保留的小型基准文件是回归测试依赖，不能作为垃圾删除。

## 验证边界

回归检查验证 v10 的 DOM/CSS/素材、字幕和所有动画指令，动画时间容差为微秒量级；另外执行浏览器检查和完整导出。旧测试 fixture 表示迁移基准，后续有意改内容时需要评审后更新该基准。代码检查不能代替最终试听和观看。

## 本次整理的验收记录

7 项测试通过，HyperFrames 检查通过并完成全片渲染、响度处理、完整解码和九幕分镜生成。与 v10 对比，解码后的音轨和字幕完全一致；5 个关键时刻的缩小灰度帧平均差异为 0–0.143/255。这是清理前的迁移验收结果；相关可生成报告已清理。

## 模板编辑约定

先在 film.html.template 按场景注释定位结构，外观修改在 film.css，文字/素材/时间修改在 config/scenes.json。`{{include:文件名}}` 在构建时展开为单个自包含 HTML；`{{clip:ID:start}}` 等占位符绑定配置。保留元素 ID，以免动画失去目标。

构建会去除源文件注释和换行缩进，避免逐字动画引入额外空格。需要可见空格时使用 `&nbsp;`；不要依赖排版换行显示空白。新增片段可放在 templates/ 下，由主模板直接 include（不支持嵌套 include）。

## Git 管理

提交 config/、templates/、assets/、volcano/、ending/、vendor/、tests/、tools/ 及构建脚本和说明。当前依赖约 14 MB，可直接由 Git 保存。生成的 HTML、SRT、时间轴、素材表、分镜表、renders/ 和缓存由本目录 .gitignore 排除。

从仓库根目录可运行 `pnpm --dir marketing/product-video run build`，完整导出使用 `pnpm --dir marketing/product-video run release`。构建路径基于脚本自身位置，不依赖原 output 目录。
