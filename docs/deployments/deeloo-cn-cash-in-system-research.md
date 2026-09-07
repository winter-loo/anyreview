# deeloo.cn ReviewLoop 部署信息：收银系统调研文档

更新时间：2026-06-18 07:17:46 UTC

来源同步：`/home/ldd/cash-in-system-research` commit `a2651c8`（`Document ReviewLoop deployment`）。

本文档记录“收银系统与博卡第八代收银系统调研”文档对应的 ReviewLoop 线上部署、文档 Review URL、服务位置和常用运维命令。

## 文档 Review URL

- 线上 Review URL：https://deeloo.cn/document-reviews/CR-20260618-6470
- Review ID：`CR-20260618-6470`
- 文档标题：`收银系统与博卡第八代收银系统调研`
- 文档行数：`521 lines`
- 当前版本：`v1`
- 当前 open comments：`0`

## 服务器

- 域名：`deeloo.cn`
- SSH：`ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn`
- 部署用户：`ubuntu`

## ReviewLoop 服务

- 应用目录：`/opt/reviewloop`
- 数据目录：`/var/lib/reviewloop`
- 上传到服务器的本文档源文件：`/opt/reviewloop/documents/cash-in-system-research.md`
- Node 版本：Node 24（使用 `node:sqlite`）
- systemd 服务：`reviewloop.service`
- 本地监听：`127.0.0.1:5173`
- 公开域名：`https://deeloo.cn`

### systemd 配置摘要

`reviewloop.service` 运行如下核心配置：

```ini
WorkingDirectory=/opt/reviewloop
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=5173
Environment=ORIGIN=https://deeloo.cn
Environment=REVIEW_PLATFORM_HOME=/var/lib/reviewloop
Environment=REVIEW_PLATFORM_BASE_URL=http://127.0.0.1:5173
Environment=REVIEW_PLATFORM_PUBLIC_URL=https://deeloo.cn
ExecStart=/usr/local/bin/node /opt/reviewloop/build/index.js
```

## nginx 配置

nginx 站点配置文件：

```text
/etc/nginx/sites-available/anki-service
```

已在 `deeloo.cn` 的 HTTP/HTTPS server block 中加入 ReviewLoop 托管块，将以下路径反代到 `http://127.0.0.1:5173`：

- `/reviews`
- `/document-reviews`
- `/_app/`
- `/api/reviews`

`/reviewloop` 会重定向到 `/reviews`。

配置变更前备份：

```text
/etc/nginx/sites-available/anki-service.bak.reviewloop.20260618
```

## 常用命令

### 查看服务状态

```bash
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
systemctl status reviewloop.service --no-pager -l
```

### 重启服务

```bash
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
sudo systemctl restart reviewloop.service
```

### 查看日志

```bash
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
journalctl -u reviewloop.service -n 100 --no-pager
```

### 验证 nginx 配置

```bash
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
sudo nginx -t
sudo systemctl reload nginx
```

### 验证页面可访问

```bash
curl -L -I https://deeloo.cn/reviews
curl -L -I https://deeloo.cn/document-reviews/CR-20260618-6470
```

### 读取 Review 评论

```bash
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
cd /opt/reviewloop
REVIEW_PLATFORM_HOME=/var/lib/reviewloop \
  REVIEW_PLATFORM_PUBLIC_URL=https://deeloo.cn \
  node dist-cli/reviewctl.js comments --review CR-20260618-6470 --json
```

### 重新发布本文档

如果本地 `README.md` 更新后需要重新发布到 deeloo.cn：

```bash
# 本地执行：同步文档到服务器
rsync -az -e "ssh -i $HOME/pems/deeloo.cn.pem" \
  /home/ldd/cash-in-system-research/README.md \
  ubuntu@deeloo.cn:/opt/reviewloop/documents/cash-in-system-research.md

# 服务器执行：重新发布为新的 document review
ssh -i ~/pems/deeloo.cn.pem ubuntu@deeloo.cn
cd /opt/reviewloop
REVIEW_PLATFORM_HOME=/var/lib/reviewloop \
  REVIEW_PLATFORM_PUBLIC_URL=https://deeloo.cn \
  REVIEW_PLATFORM_BASE_URL=http://127.0.0.1:5173 \
  node dist-cli/reviewctl.js publish-doc \
    --file /opt/reviewloop/documents/cash-in-system-research.md \
    --title "收银系统与博卡第八代收银系统调研"
```

注意：重新 `publish-doc` 会生成新的 Review ID；如果要保留当前 URL，需要继续使用当前 artifact，不要重新发布。

## 部署验证记录

部署时已验证：

- `reviewloop.service` 为 `active`
- `nginx -t` 通过
- `https://deeloo.cn/reviews` 返回 `HTTP/2 200`
- `https://deeloo.cn/document-reviews/CR-20260618-6470` 返回 `HTTP/2 200`
- 浏览器打开页面正常，标题为 `CR-20260618-6470 · Document Review`
