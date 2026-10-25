# 0001. 宣发与短视频中文旁白语音合成决策 (Volcano Engine TTS)

* **状态**：已采纳 (Accepted)
* **日期**：2026-09-18
* **适用范围**：AnyReview 全局营销视频 (`marketing/product-video`、`marketing/shotcraft`) 及系统通用语音合成

---

## 背景与问题

在前期制作宣传视频（如横竖版宣发片及 `PointFix-Full.mp4` 全景视频）时，工程曾尝试使用开源 `edge-tts`（基于微软 Edge 免费朗读接口）。在实际制作过程中暴露出了无法克服的硬伤：

1. **G2P 切词与多音字硬编码偏差**：
   * 核心口号「指哪改哪」在无标点连续输入时，Edge TTS 的切词器将「指哪」硬编码判定为口语弱读，错误读成 **"zhǐ něi gǎi nǎ"**。
2. **缺乏 SSML 音素级纠音能力**：
   * Edge 免费 WebSocket 服务端会强制拦截并丢弃 `<phoneme>` 和 `<sub alias>` 标签，无法通过拼音直接校音。
3. **连读变调（Tone Sandhi）破坏**：
   * 为了避开误读，前期曾尝试「加逗号生成再切除静音拼接」，但这严重破坏了连续 4 个三声字在自然语流中的 `2-3-2-3`（zhí nǎ gái nǎ）变调规律，并切断了字间共振峰过渡，导致语调断层、生硬怪异，无法满足“四字一体连贯连读”的要求。

---

## 架构决策

### 1. 引擎选型：全面转向火山引擎（Volcano Engine / 豆包语音）
* **接口端点**：`https://openspeech.bytedance.com/api/v3/tts/unidirectional`
* **资源规格**：`resource_id = "seed-tts-1.0"`
* **凭据管理**：凭据保存在本地专用环境变量文件 `/home/ldd/lab-oppo-phone/volcano_tts.env`（读取 `api_key`）。

### 2. 音色使用规范（严格红线）
* **严禁使用个人克隆音色**：绝对禁止在宣发和公开视频中调用用户的私有克隆音色（如 `voice_timbre_id = "S_NUPV8QvW1"`），除非用户有明确书面指定。
* **统一采用官方公开系统音色**：
  * **主选推荐（默认）**：`zh_male_shaonianzixin_moon_bigtts`（**少年自信 · 男声**），音质清脆干练、富有朝气，最契合短视频快节奏解说。
  * **备选男声**：`zh_male_yangguangqingnian_mars_bigtts`（**阳光青年**），亲切沉稳。
  * **备选女声**：`zh_female_cancan_mars_bigtts`（**灿灿**），抖音/剪映经典爆款口播。

### 3. 时序与时长约束规范
* **文本保真度**：输入纯正自然文本，严禁用加逗号、换异体字（如用「圏」代「圈」）等黑魔法影响语音模型的自然韵律。
* **画面帧数预算对齐**：当端到端生成的音频超出视频分镜的时间预算时，统一采用 FFmpeg 高保真音频变速滤镜 `atempo`（如 `1.05~1.20x`）精确压缩至帧预算窗口内，既保留完美的自然连调，又确保画面与字幕严格同步。

### 4. 文案与修辞规范
* **拒绝浮夸广告辞藻**：坚决剔除“随时随地”、“随点随开”等虚浮表述，采用事实性、功能性的精准表达（如“不仅功能强大，PointFix 还支持多种网络 URL”）。
* **技术宣称精准真实**：避免使用容易引起误解或冗余的口号（如删除“零云端上传”，统一表述为“100% 本地运行，数据绝对私密”）。

---

## 工程落地与关联文件

* **生成脚本**：[`marketing/shotcraft/tools/generate_voice_volcano.mjs`](file:///home/ldd/anyreview/marketing/shotcraft/tools/generate_voice_volcano.mjs)
* **时间轴与字幕配置**：[`marketing/shotcraft/src/PointFixFullMain.tsx`](file:///home/ldd/anyreview/marketing/shotcraft/src/PointFixFullMain.tsx)
* **音频输出目录**：[`marketing/shotcraft/public/audio/voice_full/`](file:///home/ldd/anyreview/marketing/shotcraft/public/audio/voice_full/)
* **成片交付物**：[`marketing/product-video/renders/PointFix-Full.mp4`](file:///home/ldd/anyreview/marketing/product-video/renders/PointFix-Full.mp4)
* **全局 Agent 规则**：[`/home/ldd/AGENTS.md`](file:///home/ldd/AGENTS.md) 与 [`/home/ldd/.gemini/GEMINI.md`](file:///home/ldd/.gemini/GEMINI.md)
