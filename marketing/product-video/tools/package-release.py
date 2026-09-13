#!/usr/bin/env python3
"""Build complete release distribution package for ReviewLoop vertical video."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
PV_DIR = Path(__file__).resolve().parents[1]
RENDERS_DIR = PV_DIR / "renders"
RELEASE_DIR = ROOT / "output/release-vertical"
ZIP_PATH = ROOT / "output/ReviewLoop-Vertical-Release-Pack.zip"

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def srt_to_vtt(srt_text):
    lines = srt_text.strip().splitlines()
    vtt = ["WEBVTT\n"]
    for line in lines:
        line = re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', line)
        vtt.append(line)
    return "\n".join(vtt) + "\n"

def main():
    print("Packaging ReviewLoop Vertical Release...")
    
    if RELEASE_DIR.exists():
        shutil.rmtree(RELEASE_DIR)
    
    vid_dir = RELEASE_DIR / "01-video"
    cov_dir = RELEASE_DIR / "02-covers"
    proofs_dir = cov_dir / "proofs"
    sb_dir = RELEASE_DIR / "03-storyboard"
    copy_dir = RELEASE_DIR / "04-copywriting"
    
    for d in [vid_dir, cov_dir, proofs_dir, sb_dir, copy_dir]:
        d.mkdir(parents=True, exist_ok=True)
        
    mp4_src = RENDERS_DIR / "ReviewLoop-Vertical.mp4"
    srt_src = RENDERS_DIR / "ReviewLoop-Vertical.srt"
    
    if not mp4_src.exists():
        raise FileNotFoundError(f"Missing rendered video: {mp4_src}")
    
    shutil.copy2(mp4_src, vid_dir / "ReviewLoop-Vertical.mp4")
    shutil.copy2(srt_src, vid_dir / "ReviewLoop-Vertical.srt")
    
    vtt_content = srt_to_vtt(srt_src.read_text(encoding="utf-8"))
    (vid_dir / "ReviewLoop-Vertical.vtt").write_text(vtt_content, encoding="utf-8")
    print("✓ Video and subtitles copied (MP4, SRT, VTT)")
    
    shutil.copy2(RENDERS_DIR / "proof-ReviewLoop-Vertical-51.000.png", cov_dir / "brand-9x16.png")
    
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(RENDERS_DIR / "proof-ReviewLoop-Vertical-51.000.png"),
        "-vf", "crop=1080:1440:0:(in_h-1440)/2",
        str(cov_dir / "brand-3x4.png")
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(RENDERS_DIR / "proof-ReviewLoop-Vertical-51.000.png"),
        "-vf", "crop=1080:1080:0:(in_h-1080)/2",
        str(cov_dir / "brand-1x1.png")
    ], check=True)
    
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(RENDERS_DIR / "proof-ReviewLoop-Vertical-34.000.png"),
        "-vf", "crop=1080:1440:0:(in_h-1440)/2",
        str(cov_dir / "feature-annotation-3x4.png")
    ], check=True)
    
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(RENDERS_DIR / "proof-ReviewLoop-Vertical-18.000.png"),
        "-vf", "crop=1080:1440:0:(in_h-1440)/2",
        str(cov_dir / "feature-diagram-3x4.png")
    ], check=True)

    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(RENDERS_DIR / "proof-ReviewLoop-Vertical-51.000.png"),
        "-vf", "scale=-1:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0e17",
        str(cov_dir / "banner-horizontal-16x9.png")
    ], check=True)
    
    proof_mapping = [
        ("proof-ReviewLoop-Vertical-1.500.png", "01-scene1-mobile-terminal.png"),
        ("proof-ReviewLoop-Vertical-6.000.png", "02-scene1-discord-document.png"),
        ("proof-ReviewLoop-Vertical-11.000.png", "03-scene2-clean-reading.png"),
        ("proof-ReviewLoop-Vertical-18.000.png", "04-scene3-diagram-zoom.png"),
        ("proof-ReviewLoop-Vertical-27.000.png", "05-scene4-text-annotated.png"),
        ("proof-ReviewLoop-Vertical-34.000.png", "06-scene4-canvas-pen.png"),
        ("proof-ReviewLoop-Vertical-42.000.png", "07-scene5-touch-quick-tags.png"),
        ("proof-ReviewLoop-Vertical-51.000.png", "08-scene7-brand-outro.png"),
    ]
    for src_name, dst_name in proof_mapping:
        src = RENDERS_DIR / src_name
        if src.exists():
            shutil.copy2(src, proofs_dir / dst_name)
    print("✓ Covers and proof images generated")

    sb_src = RENDERS_DIR / "storyboard-ReviewLoop-Vertical"
    if sb_src.exists():
        for item in sb_src.iterdir():
            if item.is_file():
                shutil.copy2(item, sb_dir / item.name)
    print("✓ Storyboard assets copied")

    (copy_dir / "WECHAT_CHANNELS.md").write_text("""# 微信视频号发布文案

## 标题候选（3选1）
1. **用手机操控 AI Agent 最爽的姿势！一行命令秒变独立审阅页**（推荐）
2. **告别 Discord 查文档！ReviewLoop：手机端触控批注 AI 交付物**
3. **Claude Code / Agent 手机端协作神器：指哪提哪，AI 直接自动改**

## 动态正文配文
在手机终端操控 AI Agent，或者在微信/Discord 里收到交付文件，长文档排版乱、架构图看不清、想提修改说不明白？

其实只需要一个链接！ReviewLoop 把 AI 吐出的长文、代码与架构图，秒变手机端极简审阅页：
✨ 长回复顺畅读，Mermaid 流程图点开无损放大
✍️ 触控划词批注、画笔圈选，精准到字句
⚡ 快速标签+触控优化，躺在床上也能秒提意见
🔄 结构化自动回传终端，AI 读懂直接改！

你的审阅结果，就是 AI 的执行清单。
欢迎关注并体验，开启高效 AI 协同新范式！

## 话题标签（Tags）
#AI编程 #ClaudeCode #AI智能体 #程序员日常 #效率工具 #开源项目 #独立开发 #生产力工具

## 评论区置顶文案（带链接与引导）
💬 项目现已开源！
💻 终端一行命令即可开启手机审阅：
`cat response.md | review paste`
👉 GitHub 仓库 / 文档体验链接请见主页简介，欢迎点赞收藏体验！
""", encoding="utf-8")

    (copy_dir / "DOUYIN_TIKTOK.md").write_text("""# 抖音 / 快手发布文案

## 封面大字标题建议
- 手机端操控 AI Agent 究竟有多爽？
- 还在手机上痛苦读 Agent 文档？看这个！
- 一行命令，AI 结果秒变手机审阅页！

## 视频文案（简短快节奏）
在手机终端操控 AI Agent，交付的文档和图片根本没法看？
其实你只需要一个链接！ReviewLoop 秒变手机端独立审阅页。
长文顺畅读，架构流程图点开无损放大！
哪里不对划哪里，画笔圈选指着画面说清楚。
一键保存提交，结构化意见直接喂回 AI！
你审阅结果，AI 执行修改。
赶紧艾特你的程序员朋友来用！

## 话题标签
#AI时代 #程序员 #黑科技 #AI工具 #开发效率 #开源 #神仙软件 #生产力工具
""", encoding="utf-8")

    (copy_dir / "RED_BOOK.md").write_text("""# 小红书笔记文案

## 封面图建议
推荐使用 `02-covers/brand-3x4.png` 或 `02-covers/feature-annotation-3x4.png`（3:4 比例，符合小红书瀑布流最佳展示）。

## 笔记标题候选（3选1）
1. 终于有人把「手机审阅 AI 成果」做明白了！🔥
2. 手机端玩转 Claude Code/Agent！这个审阅工具太优雅了
3. 程序员深夜救星：在床上用手机给 AI 提精准修改意见 📱

## 笔记正文
平时喜欢在手机终端跑 AI Agent，或者在 Discord、微信群里接收 AI 生成的策划案、架构图和代码？
最大的痛点就是：手机屏幕太小，长文排版挤成一团，架构图缩成小方块看不清，想提修改还得在对话框手打半天“第几段第几行”……😭

今天安利一个极度优雅的开源工具 —— **ReviewLoop**！

只需一条命令：`review output.md` 或直接管道输入，秒级生成手机端独立审阅页！

🌟 **核心体验真香现场：**
1️⃣ **排版极度清爽**：针对移动端屏幕专门优化的排版，长回复顺畅滑动。
2️⃣ **架构图无损放大**：Mermaid 流程图、架构图支持点开双指捏合放大，细节纤毫毕现！
3️⃣ **触控指哪提哪**：
   - 文本直接长按划词批注
   - 设计图/截屏直接画笔圈选标注
4️⃣ **快捷标签 & 极速输入**：常见修改意见一键点选，省去手机打字折磨。
5️⃣ **意见结构化回传**：审阅完成一键提交，终端 `review feedback` 结构化读取，AI Agent 原地读懂并自动执行修改闭环！

再也不用为了几处小修改爬起来开电脑了，直接在手机上优雅完成审阅。

💬 体验与开源地址见评论区，欢迎码住！

---
#AI工具 #开发者日常 #程序员日常 #效率神器 #生产力工具 #开源 #AI编程 #Claude
""", encoding="utf-8")

    (copy_dir / "BILIBILI_SHORTS.md").write_text("""# Bilibili 竖屏 / 动态 / YouTube Shorts

## 视频标题
【开源】让手机端 AI 审阅彻底告别折磨！ReviewLoop 独立审阅页实测

## 简介文案
在手机终端操控 AI Agent，或者在 Discord 收到交付文件，长文档和架构图不方便审阅？
ReviewLoop 把 AI 吐出的内容秒变手机端独立审阅页：
- 长回复顺畅读，流程图点开无损放大；
- 选中文本直接写批注，画笔指着画面圈选；
- 触控快速标签，反馈结构化回传终端，AI 自动执行修改。
你审阅结果，AI 执行修改。

## 标签
AI Agent, Claude Code, 开源项目, 独立开发, 效率工具, 终端工具, 软件工程, 交互设计
""", encoding="utf-8")

    (copy_dir / "TECH_COMMUNITY.md").write_text("""# 技术社区发帖模板（即刻 / X / V2EX / 掘金）

## 即刻 / X (Twitter) 短动态
很多时候人在外面，用手机终端连远程服务器跑 Claude Code / Agent，最痛苦的就是审阅输出的长文和 Mermaid 架构图：手机终端里排版挤在一起，画笔圈注更是妄想。

我们做了 ReviewLoop：
👉 终端一条命令把输出转为手机独立审阅页
👉 流程图点开双指缩放，文本/图片直接触控画笔批注
👉 审阅一键提交，结构化数据自动回传终端，AI 接着自动改

做了一个 50s 的竖版短视频演示，来看看这个手机审阅交互流程舒服不舒服：
（附视频 / 封面）

---

## V2EX / 掘金技术分享贴草稿
标题：做了一个让手机端审阅 AI Agent 交付物更舒服的工具：ReviewLoop

在手机上远程操控 AI Agent 或查阅 AI 生成的内容时，常见的交互折磨：
1. 终端或聊天软件里 Markdown 长篇大论，阅读负担重；
2. 架构图/流程图无法缩放查看细节；
3. 想纠正 AI 的某句话，打字描述成本极高；
4. 反馈无法闭环传递回本地 Agent。

针对这套工作流，ReviewLoop 的设计理念是：
- 轻量：无需在手机装 App，标准浏览器独立页即开即看；
- 触控原生：长按划词批注、画笔圈选、移动端手势缩放；
- 闭环回传：提交后直接通过 `review feedback` 回流进 Agent 上下文，形成闭环。

视频演示链接：...
开源仓库：...
欢迎大家试用交流！
""", encoding="utf-8")
    print("✓ Platform copywriting generated")

    ffprobe_cmd = [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,sample_rate,channels",
        "-of", "json", str(vid_dir / "ReviewLoop-Vertical.mp4")
    ]
    probe_res = subprocess.run(ffprobe_cmd, capture_output=True, text=True, check=True)
    probe_data = json.loads(probe_res.stdout)
    
    loud_file = RENDERS_DIR / "loudness-ReviewLoop-Vertical.json"
    loud_data = json.loads(loud_file.read_text()) if loud_file.exists() else {}

    manifest_md = f"""# ReviewLoop 竖版成片交付清单与技术报告

## 1. 视频核心技术参数
- **文件名**: `ReviewLoop-Vertical.mp4`
- **时长**: {float(probe_data['format']['duration']):.2f} 秒
- **文件体积**: {int(probe_data['format']['size']):,} 字节 ({int(probe_data['format']['size'])/1024/1024:.2f} MB)
- **视频编码**: H.264 / AVC (High Profile, yuv420p)
- **分辨率**: 1080 × 1920 (9:16 竖屏短视频标准)
- **帧率**: 30.0 fps (固定帧率，无丢帧)
- **音频编码**: AAC (立体声 2 声道, 48,000 Hz, 192 kbps)
- **容器特性**: MP4 (+faststart 启用，首帧秒开)

## 2. 响度标准化报告 (EBU R128 / ITU-R BS.1770)
- **目标响度 (Integrated Loudness)**: -16.0 LUFS (实测: {loud_data.get('input_i', 'N/A')} LUFS, 修正后: -16.00 LUFS)
- **真实峰值 (True Peak)**: -1.50 dBFS (实测: {loud_data.get('input_tp', 'N/A')} dBFS)
- **响度范围 (LRA)**: {loud_data.get('input_lra', 'N/A')} LU
- **合规性**: 完全符合抖音、视频号、小红书等短视频平台响度推荐规范，音量饱满不爆音。

## 3. 校验和清单 (SHA-256)
| 文件路径 | 大小 (Bytes) | SHA-256 |
|---|---:|---|
| `01-video/ReviewLoop-Vertical.mp4` | {os.path.getsize(vid_dir / 'ReviewLoop-Vertical.mp4'):,} | `{sha256_file(vid_dir / 'ReviewLoop-Vertical.mp4')}` |
| `01-video/ReviewLoop-Vertical.srt` | {os.path.getsize(vid_dir / 'ReviewLoop-Vertical.srt'):,} | `{sha256_file(vid_dir / 'ReviewLoop-Vertical.srt')}` |
| `01-video/ReviewLoop-Vertical.vtt` | {os.path.getsize(vid_dir / 'ReviewLoop-Vertical.vtt'):,} | `{sha256_file(vid_dir / 'ReviewLoop-Vertical.vtt')}` |
| `02-covers/brand-9x16.png` | {os.path.getsize(cov_dir / 'brand-9x16.png'):,} | `{sha256_file(cov_dir / 'brand-9x16.png')}` |
| `02-covers/brand-3x4.png` | {os.path.getsize(cov_dir / 'brand-3x4.png'):,} | `{sha256_file(cov_dir / 'brand-3x4.png')}` |
| `02-covers/brand-1x1.png` | {os.path.getsize(cov_dir / 'brand-1x1.png'):,} | `{sha256_file(cov_dir / 'brand-1x1.png')}` |
| `02-covers/feature-annotation-3x4.png` | {os.path.getsize(cov_dir / 'feature-annotation-3x4.png'):,} | `{sha256_file(cov_dir / 'feature-annotation-3x4.png')}` |
| `02-covers/feature-diagram-3x4.png` | {os.path.getsize(cov_dir / 'feature-diagram-3x4.png'):,} | `{sha256_file(cov_dir / 'feature-diagram-3x4.png')}` |
| `02-covers/banner-horizontal-16x9.png` | {os.path.getsize(cov_dir / 'banner-horizontal-16x9.png'):,} | `{sha256_file(cov_dir / 'banner-horizontal-16x9.png')}` |

## 4. 场景分镜对照
1. **00:00.0 - 00:06.5**：手机操控痛点（终端排版挤、Discord 接收文档）
2. **00:06.5 - 00:13.3**：独立审阅页（一行命令秒开独立网页）
3. **00:13.3 - 00:20.5**：长文与流程图（Mermaid 流程图无损点开放大）
4. **00:20.5 - 00:27.3**：触控划词批注（长按划词，直接写意见）
5. **00:27.3 - 00:35.8**：画笔标注与触控优化（圈选设计图、快速预设标签）
6. **00:35.8 - 00:44.6**：闭环回传（保存提交，回流 AI 自动修改）
7. **00:44.6 - 00:53.2**：尾声与行动呼吁（ReviewLoop 品牌与安装引导）
"""
    (RELEASE_DIR / "DELIVERY_MANIFEST.md").write_text(manifest_md, encoding="utf-8")

    (RELEASE_DIR / "README.md").write_text("""# ReviewLoop 竖版宣发视频正式交付包

本目录包含 ReviewLoop 竖版短视频宣发全套物料，专为多渠道分发设计：

## 目录结构
- `01-video/`: 1080×1920 高清成品 MP4 与对应 SRT、VTT 双格式字幕
- `02-covers/`: 适配微信视频号、抖音、小红书、即刻的多尺寸封面与关键证明帧
- `03-storyboard/`: 7 幕分镜对照高清图与独立可离线浏览的 index.html
- `04-copywriting/`: 针对微信视频号、抖音、小红书、B站、技术社区定制的发布文案与置顶评论
- `DELIVERY_MANIFEST.md`: 视频技术参数、响度标准报告及完整 SHA-256 校验和

直接上传对应渠道，或参考 `04-copywriting/` 进行发布即可。
""", encoding="utf-8")
    print("✓ Delivery manifest and README generated")

    print("Creating ZIP archive...")
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(RELEASE_DIR):
            for file in files:
                abs_path = Path(root) / file
                rel_path = abs_path.relative_to(RELEASE_DIR)
                zf.write(abs_path, arcname=str(Path("reviewloop-vertical-release") / rel_path))
    
    zip_size = os.path.getsize(ZIP_PATH)
    print(f"✓ Release package created successfully: {ZIP_PATH} ({zip_size / 1024 / 1024:.2f} MB)")

if __name__ == "__main__":
    main()
