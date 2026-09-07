# ReviewLoop 测试样例

用于手动验证文档预览、移动端画笔、批注和提交给 AI 的完整流程。

| 目录 | 内容 |
| --- | --- |
| `documents/` | 原 `~/reviewloop-samples/` 的 6 个文件：PDF、Word、PowerPoint、CSV，以及普通和带缓存公式的 Excel 工作簿 |
| `images/` | 之前图片预览测试使用的两张 SVG，适合验证多图切换和画笔标注 |

在项目根目录运行（需先配置 `review` 的服务地址和密钥）：

```sh
# 发布一个文档
review samples/documents/reviewloop-architecture.pdf

# 发布两张图片，测试多图切换
review samples/images

# 为每个文档分别生成预览链接
for sample in samples/documents/*; do
  review "$sample"
done
```

原始样例目录和 `output/image-ui-fixtures/` 保留，已有链接仍可使用原路径。
新测试请使用本目录中的样例，避免依赖用户主目录或临时输出目录。

Legacy Word sample: `documents/reviewloop-prd.doc` is a binary Word 97–2003 copy
of `reviewloop-prd.docx`, generated with LibreOffice. Preview it with
`node bin/review.js samples/documents/reviewloop-prd.doc`; the server must have
LibreOffice Writer installed to convert it for the Word viewer.

Legacy PowerPoint sample: `documents/reviewloop-quarterly.ppt` is a binary
PowerPoint 97–2003 copy of `reviewloop-quarterly.pptx`, generated with LibreOffice.
Preview it with `node bin/review.js samples/documents/reviewloop-quarterly.ppt`;
the server must have LibreOffice Impress installed to convert it for the slide viewer.
