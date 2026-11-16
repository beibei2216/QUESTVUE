# Model Review

用于检查灯塔程序化模型和 GLB 建筑模型的开发页面。

```bash
pnpm dev
```

- 程序化灯塔预览：`/tools/model-review/model-preview.html`
- 风车模型坐标轴检查：`/tools/model-review/glb-axis-review.html`

坐标轴自动截图的开发服务器需要使用端口 `4188`：

```bash
pnpm dev --port 4188
node tools/model-review/axis-review.mjs
```

模型审查截图写入 `qa/output/`。
