# 当前构建素材来源

本文件只说明 config/assets.json 中实际使用的素材。清单中的 SHA-256 固定当前版本。

- assets/terminal.png、discord.png：参考用户提供的 Claude Code 和 Discord 截图，通过 image_gen 生成的虚构演示画面，并非真实应用录屏。
- assets/read.png：J6CJT_lw 干净状态的真实页面截图。
- assets/annotation-entry-v10.png、reading-v2-volcano.mp4、interaction-v2-volcano.mp4、image-volcano.mp4、submit-volcano.mp4：浏览器手机视口的真实截图或操作录屏，经既有制作过程裁切、重定时；未添加虚构产品 UI。录制视口为 390×844，不是真机录像。
- assets/logo.svg、font.otf：现有项目品牌和排版素材。
- volcano/voice-1.mp3 至 voice-8.mp3：用户指定 Volcano TTS 脚本生成的已选旁白，字幕及播放时刻以 config/scenes.json 为准。凭据不属于视频工程。
- ending/：来源见 ending/PROVENANCE.md。
- vendor/gsap.min.js：GSAP 3.14.2，下载地址及哈希见素材清单。

第七幕输入“用 review feedback 获取评论并解决。”为演示动画，不代表实际执行 AI 修改。

旧版原始录屏、派生中间文件、音频实验和证据报告已按用户要求清理。当前保留最终构建使用的素材；此来源说明不是对已删除原始文件的依赖。
