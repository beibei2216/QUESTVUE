# Browser QA

这些脚本通过 Chrome DevTools Protocol 启动无头 Chrome，对构建后的游戏执行桌面和手机端验收。

## 前置条件

1. 安装依赖并完成构建：

   ```bash
   pnpm install
   pnpm build
   ```

2. 启动静态预览服务器：

   ```bash
   pnpm preview --port 4187 --strictPort
   ```

3. 安装 Chrome。Windows 默认路径为：

   ```text
   C:\Program Files\Google\Chrome\Application\chrome.exe
   ```

   其他路径或系统通过环境变量指定：

   ```bash
   CHROME_PATH=/path/to/chrome pnpm qa
   ```

## 脚本

```bash
pnpm qa
pnpm qa:photo-wall
pnpm qa:focus-controls
```

如果脚本接受 URL 参数，可覆盖默认地址：

```bash
node scripts/qa.mjs http://127.0.0.1:4187/
```

## 输出

- 截图写入 `qa/output/`
- 历史验收文件保存在本地 `qa/archive/`

两个目录都由 `.gitignore` 排除，避免把大量临时图片提交到仓库。
