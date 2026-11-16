# Azure Isle · 折纸群岛

一个使用 Three.js 与 Vite 制作的手绘 3D 海岛探索游戏。玩家从桌面地图进入折纸群岛，寻找十个建筑图钉，完成探索委托，在建筑特写中旋转观察模型，并收集照片、拍立得视频和探索印章。

<p align="center">
  <img src="docs/screenshots/world-map.png" alt="折纸群岛地图" width="78%" />
</p>

| 建筑特写 | 照片墙 |
| --- | --- |
| ![建筑特写](docs/screenshots/building-focus.png) | ![照片墙](docs/screenshots/photo-wall.png) |

## 功能

- 开场页、加载过场和镜头推进动画
- 可拖拽、滚轮缩放的三维海岛地图
- 十个探索点与建筑专属任务
- 建筑特写中拖拽环绕、滚轮缩放观察
- 明信片、拍立得封面、视频和播放结束画面
- 旅行日志、探索进度和印章提示
- 十张照片的照片墙及添加照片视图
- 桌面与手机响应式布局
- 单个经典脚本构建，目标语法为 Chrome 61 / ES2017

## 技术栈

- Three.js `0.124.0`
- Vite `5.4.11`
- 原生 JavaScript、HTML、CSS
- GLB 建筑模型与本地图片、视频素材
- Git LFS 管理大型二进制文件

## 本地运行

要求：

- Node.js 18 或更高版本
- pnpm 11
- Git LFS

```bash
git lfs install
pnpm install
pnpm dev
```

打开终端中显示的本地地址，默认使用 `127.0.0.1`。

生产构建：

```bash
pnpm build
pnpm preview
```

构建结果位于 `html/`。入口使用单个内联经典脚本和样式，可直接通过静态文件服务器部署。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 生成生产版本 |
| `pnpm preview` | 预览生产版本 |
| `pnpm test` | 重新构建并校验脚本、模型和媒体清单 |
| `pnpm qa` | 完整浏览器验收 |
| `pnpm qa:photo-wall` | 照片墙桌面与手机验收 |
| `pnpm qa:focus-controls` | 建筑特写拖拽与滚轮验收 |

QA 脚本需要本机安装 Chrome，默认读取 Windows 的 Chrome 安装路径。其他系统需要指定：

```bash
CHROME_PATH=/path/to/chrome pnpm qa
```

截屏与临时验收文件写入 `qa/output/`，不会提交到 Git。详细说明见 [qa/README.md](qa/README.md)。

## 操作

| 场景 | 操作 |
| --- | --- |
| 海岛地图 | 按住鼠标拖动画面，滚轮缩放 |
| 建筑特写 | 按住鼠标环绕观察，滚轮拉近或拉远 |
| 建筑特写 | `+`、`−` 按钮缩放，`MAP` 返回地图 |
| 任意界面 | `Esc` 返回上一层 |

## 目录结构

```text
.
├─ docs/screenshots/       # README 使用的界面截图
├─ html/                   # 可部署的完整静态站点（构建生成）
├─ public/
│  ├─ media/               # 图片、视频与照片墙素材
│  └─ models/              # 本地 GLB 建筑模型
├─ qa/                     # QA 说明；本地输出与历史文件已被忽略
├─ scripts/                # 构建校验、浏览器 QA、素材处理工具
├─ src/
│  ├─ assets/              # 字体
│  ├─ main.js              # UI、状态与交互
│  ├─ world.js             # 三维场景、相机与探索点
│  ├─ styles.css           # 界面样式
│  └─ lighthouse-island-model.js
├─ tools/model-review/     # 模型预览与坐标轴审查页面
├─ index.html
├─ package.json
├─ pnpm-lock.yaml
└─ vite.config.js
```

## GitHub 上传说明

项目包含约 `615 MB` GLB 模型和约 `171 MB` 媒体文件，因此 `.gitattributes` 已配置 Git LFS。首次使用仓库时执行：

```bash
git lfs install
git add .gitattributes
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

如果克隆方没有安装 Git LFS，只会取得 LFS 指针文件，游戏模型将无法加载。

GitHub Pages、Netlify、Vercel 或任意静态文件服务器均可部署 `html/`。仓库使用相对资源基址，适用于项目子路径部署。

## 素材说明

`public/`、`src/assets/` 和 `docs/screenshots/` 包含本地模型、视频、图片与字体。将仓库公开或商用前，请自行确认全部素材的授权、字体许可和肖像使用权。仓库目前未附带开源许可证；如需公开授权他人复用，请补充合适的 `LICENSE`。
