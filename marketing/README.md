# 产品宣传

[宣传视频工程](product-video/README.md)：横版（1920×1080）与竖版（1080×1920）宣发视频场景配置、真实页面素材、旁白和可重复构建流程。

```sh
# 横版桌面宣发视频
pnpm --dir marketing/product-video run build
pnpm --dir marketing/product-video run release

# 竖版短视频
pnpm --dir marketing/product-video run build:vertical
pnpm --dir marketing/product-video run release:vertical
```

源码与正式素材进入 Git；成片和其他构建产物不提交。
