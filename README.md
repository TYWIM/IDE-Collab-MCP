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

- **Hub Server**: 常驻后台的中央通讯服务，管理所有状态
- **MCP Server**: 每个IDE窗口各启动一个（stdio模式），连接Hub

## 功能

| 功能 | 说明 |
|------|------|
| 🔗 实例注册 | 每个AI注册身份和工作内容，互相感知 |
| 💬 消息通讯 | 给特定AI发消息、提问、广播通知 |
| 📝 共享笔记 | 记录架构决策、API约定等共享知识 |
| 🔒 文件锁定 | 防止多个AI同时修改同一文件 |
| 📊 状态总览 | 一览所有AI的在线状态和工作内容 |

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
- **`register`** — 注册当前AI实例（名称 + 工作内容）
- **`list_instances`** — 查看所有在线AI实例
- **`update_status`** — 更新工作状态
- **`unregister`** — 注销实例

### 消息通讯
- **`send_message`** — 发消息给特定AI或广播
- **`get_messages`** — 获取收到的消息
- **`mark_messages_read`** — 标记消息已读

### 共享知识
- **`add_note`** — 添加共享笔记
- **`get_notes`** — 获取共享笔记

### 文件协调
- **`lock_file`** — 锁定文件防止冲突
- **`unlock_file`** — 解锁文件
- **`get_file_locks`** — 查看锁定状态

### 总览
- **`collab_status`** — 协作网络总览

## 使用示例

### 场景：三个窗口协作开发一个全栈应用

**窗口1（前端）的AI：**
```
→ register(name="前端开发", working_on="开发React登录页面")
→ get_notes(tag="API") // 查看后端定义的API接口
→ lock_file(file_path="src/pages/Login.tsx", reason="正在开发登录页面")
→ send_message(to="后端API", content="登录接口需要返回refresh_token", type="request")
```

**窗口2（后端）的AI：**
```
→ register(name="后端API", working_on="开发Express后端API")
→ get_messages() // 收到前端的请求
→ add_note(title="登录API规范", content="POST /api/login 返回 {token, refreshToken}", tags=["API", "认证"])
→ send_message(to="前端开发", content="已添加refreshToken，请查看共享笔记", type="response")
```

**窗口3（数据库）的AI：**
```
→ register(name="数据库设计", working_on="设计MongoDB Schema")
→ collab_status() // 查看整体协作状态
→ add_note(title="用户表Schema", content="users: {email, passwordHash, refreshTokens[]}", tags=["数据库", "Schema"])
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HUB_PORT` | `9800` | Hub Server 监听端口 |
| `HUB_URL` | `http://localhost:9800` | MCP Server 连接的 Hub 地址 |

## 开发

```bash
# 开发模式启动 Hub（自动重载）
npm run dev:hub

# 开发模式启动 MCP（用于调试）
npm run dev:mcp
```

## License

MIT
