# IDE Collab MCP — 多IDE窗口AI协作系统

让多个 AI IDE 窗口（Windsurf / Cursor / Claude Desktop 等）中的 AI 助手实时协作，避免冲突。

## 架构

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  IDE 窗口 1   │    │  IDE 窗口 2   │    │  IDE 窗口 3   │
│  (Windsurf)  │    │  (Cursor)    │    │  (Windsurf)  │
│              │    │              │    │              │
│  MCP Server  │    │  MCP Server  │    │  MCP Server  │
│  (stdio)     │    │  (stdio)     │    │  (stdio)     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       │         HTTP      │         HTTP      │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼───────┐
                    │  Hub Server  │
                    │  (常驻后台)    │
                    │  :9800       │
                    └──────────────┘
```

- **Hub Server**: 常驻后台的中央通讯服务，管理所有状态，提供 HTTP API + WebSocket 实时推送
- **MCP Server**: 每个IDE窗口各启动一个（stdio模式），通过 HTTP 连接 Hub

## 功能

| 功能 | 说明 |
|------|------|
| 🔗 实例注册 | 每个AI注册唯一身份和工作内容，互相感知 |
| 💬 消息通讯 | 给特定AI发消息、提问、广播通知，支持按类型过滤 |
| 📝 共享笔记 | 记录架构决策、API约定等共享知识，支持增删改查 |
| 🔒 文件锁定 | 防止多个AI同时修改同一文件，支持TTL自动过期和强制解锁 |
| 📊 状态总览 | 一览所有AI的在线状态和工作内容 |
| 📡 实时推送 | WebSocket 实时通知所有实例的状态变化 |

## 快速开始

### 1. 安装依赖

```bash
cd IDE多页面通讯
npm install
```

### 2. 编译

```bash
npm run build
```

### 3. 启动 Hub Server（只需启动一次）

```bash
npm run start:hub
# 或开发模式
npm run dev:hub
```

Hub 默认监听 `http://localhost:9800`，可通过环境变量 `HUB_PORT` 修改。

### 4. 在每个IDE中配置 MCP Server

#### Windsurf

在 `~/.codeium/windsurf/mcp_config.json` 中添加：

```json
{
  "mcpServers": {
    "ide-collab": {
      "command": "node",
      "args": ["D:/Github/IDE多页面通讯/dist/mcp/server.js"],
      "env": {
        "HUB_URL": "http://localhost:9800"
      }
    }
  }
}
```

#### Cursor

在 `~/.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "ide-collab": {
      "command": "node",
      "args": ["D:/Github/IDE多页面通讯/dist/mcp/server.js"],
      "env": {
        "HUB_URL": "http://localhost:9800"
      }
    }
  }
}
```

#### Claude Desktop

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "ide-collab": {
      "command": "node",
      "args": ["D:/Github/IDE多页面通讯/dist/mcp/server.js"],
      "env": {
        "HUB_URL": "http://localhost:9800"
      }
    }
  }
}
```

## MCP 工具列表

### 实例管理
- **`register`** — 注册当前AI实例（名称全局唯一 + 工作内容），已注册时自动先注销旧实例
- **`list_instances`** — 查看所有在线AI实例及其状态
- **`update_status`** — 更新工作状态（active / idle / busy）和当前工作内容
- **`unregister`** — 注销实例，自动释放持有的文件锁

### 消息通讯
- **`send_message`** — 发消息给特定AI或广播（类型：info / question / warning / request / response）
- **`get_messages`** — 获取收到的消息，支持按未读状态、消息类型过滤
- **`mark_messages_read`** — 批量标记当前实例的消息为已读

### 共享知识
- **`add_note`** — 添加共享笔记（支持标签）
- **`get_notes`** — 获取共享笔记，支持按标签过滤
- **`update_note`** — 更新笔记内容或标签
- **`delete_note`** — 删除共享笔记

### 文件协调
- **`lock_file`** — 锁定文件防止冲突，支持 TTL 自动过期（秒）
- **`unlock_file`** — 解锁自己持有的文件
- **`force_unlock_file`** — 强制解锁任意文件（用于锁持有者已离线的紧急情况）
- **`get_file_locks`** — 查看所有锁定状态，包括过期时间

### 总览
- **`collab_status`** — 协作网络总览（在线实例、消息数、笔记数、文件锁、Hub运行时间）

## 使用示例

### 场景：三个窗口协作开发一个全栈应用

**窗口1（前端）的AI：**
```
→ register(name="前端开发", working_on="开发React登录页面")
→ get_notes(tag="API")                    // 查看后端定义的API接口
→ lock_file(file_path="src/pages/Login.tsx", reason="正在开发登录页面", ttl=3600)
→ send_message(to="后端API", content="登录接口需要返回refresh_token", type="request")
```

**窗口2（后端）的AI：**
```
→ register(name="后端API", working_on="开发Express后端API")
→ get_messages(type="request")            // 只看请求类消息
→ add_note(title="登录API规范", content="POST /api/login 返回 {token, refreshToken}", tags=["API", "认证"])
→ send_message(to="前端开发", content="已添加refreshToken，请查看共享笔记", type="response")
```

**窗口3（数据库）的AI：**
```
→ register(name="数据库设计", working_on="设计MongoDB Schema")
→ collab_status()                         // 查看整体协作状态
→ add_note(title="用户表Schema", content="users: {email, passwordHash, refreshTokens[]}", tags=["数据库", "Schema"])
```

## AI 提示词配置

AI 不会自动使用协作工具，需要通过系统提示词告知。将以下内容写入各 IDE 的 Rules / System Prompt 文件即可一劳永逸。

**Cursor**：项目根目录 `.cursor/rules` 文件，或 Settings → Rules for AI

**Windsurf**：项目根目录 `.windsurfrules` 文件

```
你有 ide-collab MCP 工具，用于与其他 IDE 窗口的 AI 实时协作。

【首次使用】
询问用户："请告诉我你在这个窗口的角色名称（如：前端开发、后端API、数据库设计）和当前任务，我来注册到协作网络。"
收到回答后执行 register(name="...", working_on="...")。
也可以让用户直接调用内置 Prompt：collab-init。

【每次新对话开始时，若已知角色名则自动执行】
1. register(name="[上次使用的角色名]", working_on="[当前任务描述]")
2. get_messages(unread_only=true) — 查看其他AI发来的未读消息
3. get_file_locks() — 查看哪些文件已被锁定，避免冲突
4. get_notes() — 查看共享笔记中的架构决策和约定

【修改文件前】
- 用 lock_file(file_path="...", reason="...", ttl=3600) 锁定文件
- 完成后用 unlock_file 解锁（重要！不要忘记）

【需要协调时】
- 用 send_message 通知其他AI（type="request" 表示请求，type="info" 表示通知）
- 用 get_messages(type="question") 查看未回答的提问

【记录重要信息时】
- 用 add_note 记录架构决策、API约定、注意事项等共享知识

【结束工作前】
- 用 unregister 注销实例，释放持有的文件锁
```

> **提示**：每个 IDE 窗口的角色名必须唯一，重复名称会被 Hub 拒绝（409）。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HUB_PORT` | `9800` | Hub Server 监听端口 |
| `HUB_URL` | `http://localhost:9800` | MCP Server 连接的 Hub 地址 |

## 技术细节

| 特性 | 说明 |
|------|------|
| 请求限速 | 每IP每分钟最多 120 次请求 |
| 请求体限制 | 最大 64kb，防止恶意大 payload |
| 心跳超时 | 实例 5 分钟无心跳自动清理并释放文件锁 |
| 锁 TTL | 文件锁支持设置超时时间（秒），到期自动释放 |
| 消息上限 | 保留最近 1000 条消息 |
| Hub 超时 | MCP 工具调用 Hub 最长等待 10 秒 |
| 名称唯一 | 实例名称全局唯一，防止消息路由冲突 |
| WS 验证 | WebSocket 连接需提供有效的已注册 instanceId |
| 已读状态 | 每实例独立追踪，互不影响 |
| 解锁校验 | 只有锁持有者可正常解锁，其他人需用 force_unlock_file |

## 开发

```bash
# 开发模式启动 Hub
npm run dev:hub

# 开发模式启动 MCP（用于调试）
npm run dev:mcp

# 编译
npm run build
```

## License

MIT
