# 浏览器实拍素材记录

2026-09-10，代码提交 dfaa02f。Playwright Chromium，390×844 手机视口，isMobile=true，hasTouch=true；静态截图 DPR 3，视频 DPR 2。

- Word：samples/documents/reviewloop-prd.docx，/live/N9MgZO_M。
- Excel：samples/documents/reviewloop-cached-formulas.xlsx，/live/B_uVZAug，带缓存计算结果的原始示例。
- PPT：samples/documents/reviewloop-quarterly.pptx，/live/ApUc_lQu，浏览器点击下一页后第 2 页。
- MP4：本宣传片 v6，/live/5RJvQWfQ。点击时间轴 41 秒，选择范围，再点 43 秒；逐字输入“这里停顿太长，衔接紧凑一点。”，保存评论并打开标注列表。

未修改应用 DOM、按钮文字、批注状态或页面布局。录制画布大于 CSS 视口，成片只裁掉录制画布右侧/下侧的灰边；没有修改网页像素内容。成片取真实录屏第 1–3.35 秒，展示已选范围及输入过程；原始完整录屏已清理，当前保留实际入片的派生素材。

旁白通过用户指定 Volcano 脚本及 env 合成。只去除首 0.35 秒和末尾静音，保留自然语速。当前尾声时长与旁白时刻以 config/scenes.json 为准。

## v10 派生素材

markdown-v10.png：reading-v2-volcano.mp4 的 0.58 秒（全片 32.8 秒）。video-stable-v10.mp4：video-hold-v8.mp4 保留 0.233333–1.033333、1.4–2.35 秒，拼接后延长最后真实帧，去除录屏中的短暂页面缩放。
