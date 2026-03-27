// ============================================
// MCP Server - 每个IDE窗口的AI协作接口
// 通过 stdio 与 IDE 通讯，通过 HTTP 连接 Hub
// ============================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type {
  Instance,
  Message,
  SharedNote,
  FileLock,
  ApiResponse,
} from '../types.js';

// ============================================
// Hub 客户端
// ============================================

const HUB_URL = process.env.HUB_URL || 'http://localhost:9800';

let currentInstanceId: string | null = null;
let currentInstanceName: string | null = null;

async function hubFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return (await res.json()) as ApiResponse<T>;
  } catch (err) {
    return {
      success: false,
      error: `无法连接到 Hub Server (${HUB_URL}): ${(err as Error).message}。请确保 Hub Server 已启动。`,
    };
  }
}

// 心跳定时器
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    if (currentInstanceId) {
      await hubFetch(`/api/instances/${currentInstanceId}/heartbeat`, {
        method: 'POST',
      });
    }
  }, 30_000); // 每30秒发送一次心跳
}

// ============================================
// MCP Server 定义
// ============================================

const server = new McpServer({
  name: 'ide-collab',
  version: '1.0.0',
});

// ---------- Tool: register (注册当前AI实例) ----------
server.tool(
  'register',
  '注册当前AI实例到协作网络。这是使用其他协作功能的前提。每个IDE窗口应该用不同的名字注册。',
  {
    name: z.string().describe('此AI实例的名称，如 "前端开发-窗口1"、"后端API"、"数据库设计" 等'),
    working_on: z.string().describe('当前正在做的工作描述'),
    workspace: z.string().optional().describe('当前工作区路径（可选）'),
  },
  async ({ name, working_on, workspace }) => {
    // 如果已注册，先注销
    if (currentInstanceId) {
      await hubFetch(`/api/instances/${currentInstanceId}`, { method: 'DELETE' });
    }

    const result = await hubFetch<Instance>('/api/instances', {
      method: 'POST',
      body: JSON.stringify({ name, workingOn: working_on, workspace }),
    });

    if (result.success && result.data) {
      currentInstanceId = result.data.id;
      currentInstanceName = result.data.name;
      startHeartbeat();
      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ 注册成功！\n\n实例ID: ${result.data.id}\n名称: ${result.data.name}\n工作内容: ${result.data.workingOn}\n\n你现在可以与其他AI实例协作了。使用 list_instances 查看在线的其他AI。`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 注册失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: list_instances (查看所有在线AI实例) ----------
server.tool(
  'list_instances',
  '查看所有当前在线的AI实例，了解有谁在协作网络中以及他们在做什么。',
  {},
  async () => {
    const result = await hubFetch<Instance[]>('/api/instances');

    if (result.success && result.data) {
      if (result.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '当前没有任何AI实例在线。请先使用 register 注册。' }],
        };
      }

      const list = result.data
        .map((inst) => {
          const isMe = inst.id === currentInstanceId ? ' 👈 (当前实例)' : '';
          return `- **${inst.name}**${isMe}\n  状态: ${inst.status} | 工作内容: ${inst.workingOn}\n  ID: ${inst.id}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `📋 在线AI实例 (${result.data.length}个):\n\n${list}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 获取失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: send_message (发送消息给其他AI) ----------
server.tool(
  'send_message',
  '向其他AI实例发送消息。可以发给特定实例（通过名称）或广播给所有实例。支持不同消息类型：info(通知)、question(提问)、warning(警告)、request(请求)。',
  {
    to: z.string().describe('目标实例名称，或 "all" 表示广播给所有实例'),
    content: z.string().describe('消息内容'),
    type: z
      .enum(['info', 'question', 'warning', 'request', 'response'])
      .default('info')
      .describe('消息类型: info=通知, question=提问, warning=警告, request=请求, response=回复'),
    reply_to: z.string().optional().describe('如果是回复某条消息，填写原消息ID'),
  },
  async ({ to, content, type, reply_to }) => {
    if (!currentInstanceName) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const result = await hubFetch<Message>('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        from: currentInstanceName,
        to,
        content,
        type,
        replyTo: reply_to,
      }),
    });

    if (result.success && result.data) {
      const typeEmoji = { info: 'ℹ️', question: '❓', warning: '⚠️', request: '📨', response: '💬' };
      return {
        content: [
          {
            type: 'text' as const,
            text: `${typeEmoji[type]} 消息已发送！\n\n发送给: ${to}\n类型: ${type}\n消息ID: ${result.data.id}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 发送失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: get_messages (获取收到的消息) ----------
server.tool(
  'get_messages',
  '获取发送给当前实例的消息。可以只看未读消息，或查看所有历史消息。',
  {
    unread_only: z.boolean().default(true).describe('是否只获取未读消息'),
    limit: z.number().default(20).describe('最多返回多少条消息'),
  },
  async ({ unread_only, limit }) => {
    if (!currentInstanceName) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const params = new URLSearchParams({
      to: currentInstanceName,
      limit: limit.toString(),
    });
    if (unread_only) params.set('unread', 'true');

    const result = await hubFetch<Message[]>(`/api/messages?${params}`);

    if (result.success && result.data) {
      if (result.data.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: unread_only ? '📭 没有未读消息。' : '📭 没有任何消息。',
            },
          ],
        };
      }

      const typeEmoji: Record<string, string> = {
        info: 'ℹ️',
        question: '❓',
        warning: '⚠️',
        request: '📨',
        response: '💬',
      };

      const list = result.data
        .map((msg) => {
          const emoji = typeEmoji[msg.type] || '📩';
          const readMark = msg.read ? '' : ' 🆕';
          const replyInfo = msg.replyTo ? ` (回复消息 ${msg.replyTo.substring(0, 8)}...)` : '';
          return `${emoji}${readMark} [${msg.timestamp}] **${msg.from}** -> ${msg.to}${replyInfo}\n   ${msg.content}\n   消息ID: ${msg.id}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `📬 消息列表 (${result.data.length}条):\n\n${list}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 获取失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: mark_messages_read (标记消息已读) ----------
server.tool(
  'mark_messages_read',
  '将当前实例的所有未读消息标记为已读。',
  {},
  async () => {
    if (!currentInstanceId) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const result = await hubFetch<{ markedRead: number }>('/api/messages/mark-read', {
      method: 'POST',
      body: JSON.stringify({ instanceId: currentInstanceId }),
    });

    if (result.success && result.data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ 已将 ${result.data.markedRead} 条消息标记为已读。`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 操作失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: update_status (更新工作状态) ----------
server.tool(
  'update_status',
  '更新当前实例的工作状态和正在做的事情，让其他AI知道你在忙什么。',
  {
    status: z.enum(['active', 'idle', 'busy']).describe('状态: active=活跃, idle=空闲, busy=忙碌'),
    working_on: z.string().optional().describe('当前正在做的工作描述'),
  },
  async ({ status, working_on }) => {
    if (!currentInstanceId) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const result = await hubFetch<Instance>(`/api/instances/${currentInstanceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, workingOn: working_on }),
    });

    if (result.success && result.data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ 状态已更新！\n\n状态: ${result.data.status}\n工作内容: ${result.data.workingOn}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 更新失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: add_note (添加共享笔记) ----------
server.tool(
  'add_note',
  '添加一条共享笔记到协作空间，所有AI实例都能看到。用于记录架构决策、API约定、注意事项等。',
  {
    title: z.string().describe('笔记标题'),
    content: z.string().describe('笔记内容'),
    tags: z
      .array(z.string())
      .default([])
      .describe('标签列表，如 ["架构", "API", "前端"]'),
  },
  async ({ title, content, tags }) => {
    if (!currentInstanceName) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const result = await hubFetch<SharedNote>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        author: currentInstanceName,
        title,
        content,
        tags,
      }),
    });

    if (result.success && result.data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `📝 笔记已添加！\n\n标题: ${result.data.title}\n标签: ${result.data.tags.join(', ') || '无'}\nID: ${result.data.id}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 添加失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: get_notes (获取共享笔记) ----------
server.tool(
  'get_notes',
  '获取协作空间中的所有共享笔记。可以按标签过滤。',
  {
    tag: z.string().optional().describe('按标签过滤（可选）'),
  },
  async ({ tag }) => {
    const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
    const result = await hubFetch<SharedNote[]>(`/api/notes${params}`);

    if (result.success && result.data) {
      if (result.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '📓 没有共享笔记。' }],
        };
      }

      const list = result.data
        .map(
          (note) =>
            `📝 **${note.title}** (by ${note.author})\n   标签: ${note.tags.join(', ') || '无'}\n   更新时间: ${note.updatedAt}\n   内容: ${note.content}\n   ID: ${note.id}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `📓 共享笔记 (${result.data.length}条):\n\n${list}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 获取失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: update_note (更新共享笔记) ----------
server.tool(
  'update_note',
  '更新已有的共享笔记内容或标签。需要提供笔记ID（可从 get_notes 获取）。',
  {
    note_id: z.string().describe('笔记ID'),
    content: z.string().describe('新的笔记内容'),
    tags: z.array(z.string()).optional().describe('新的标签列表（可选，不填则保留原标签）'),
  },
  async ({ note_id, content, tags }) => {
    const body: Record<string, unknown> = { content };
    if (tags !== undefined) body.tags = tags;

    const result = await hubFetch<import('../types.js').SharedNote>(`/api/notes/${note_id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    if (result.success && result.data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `📝 笔记已更新！\n\n标题: ${result.data.title}\n标签: ${result.data.tags.join(', ') || '无'}\n更新时间: ${result.data.updatedAt}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 更新失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: lock_file (锁定文件) ----------
server.tool(
  'lock_file',
  '锁定一个文件，防止其他AI实例同时修改导致冲突。修改完成后请记得解锁。',
  {
    file_path: z.string().describe('要锁定的文件路径'),
    reason: z.string().describe('锁定原因，如 "正在重构组件"'),
    ttl: z.number().optional().describe('锁定超时时间（秒），超时后自动释放，不填则永不自动过期'),
  },
  async ({ file_path, reason, ttl }) => {
    if (!currentInstanceName) {
      return {
        content: [{ type: 'text' as const, text: '❌ 请先使用 register 注册当前实例。' }],
        isError: true,
      };
    }

    const result = await hubFetch<FileLock>(`/api/locks/${encodeURIComponent(file_path)}`, {
      method: 'POST',
      body: JSON.stringify({ lockedBy: currentInstanceName, reason, ttl }),
    });

    if (result.success && result.data) {
      const expiryInfo = result.data.expiresAt ? `\n自动过期: ${result.data.expiresAt}` : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: `🔒 文件已锁定！\n\n文件: ${file_path}\n原因: ${reason}${expiryInfo}\n\n⚠️ 修改完成后请使用 unlock_file 解锁。`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `❌ 锁定失败: ${result.error}`,
        },
      ],
      isError: true,
    };
  }
);

// ---------- Tool: unlock_file (解锁文件) ----------
server.tool(
  'unlock_file',
  '解锁之前锁定的文件，让其他AI实例可以修改它。',
  {
    file_path: z.string().describe('要解锁的文件路径'),
  },
  async ({ file_path }) => {
    const result = await hubFetch(`/api/locks/${encodeURIComponent(file_path)}`, {
      method: 'DELETE',
    });

    if (result.success) {
      return {
        content: [{ type: 'text' as const, text: `🔓 文件已解锁: ${file_path}` }],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 解锁失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: get_file_locks (查看文件锁状态) ----------
server.tool(
  'get_file_locks',
  '查看当前所有被锁定的文件，避免修改他人正在编辑的文件。',
  {},
  async () => {
    const result = await hubFetch<FileLock[]>('/api/locks');

    if (result.success && result.data) {
      if (result.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '🔓 当前没有被锁定的文件。' }],
        };
      }

      const list = result.data
        .map(
          (lock) =>
            `🔒 **${lock.filePath}**\n   锁定者: ${lock.lockedBy}\n   原因: ${lock.reason}\n   锁定时间: ${lock.lockedAt}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `🔒 已锁定文件 (${result.data.length}个):\n\n${list}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 获取失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: collab_status (协作总览) ----------
server.tool(
  'collab_status',
  '获取整个协作网络的总览状态，包括在线实例、消息数、笔记数、文件锁等。',
  {},
  async () => {
    const result = await hubFetch<{
      instances: Instance[];
      messageCount: number;
      noteCount: number;
      fileLocks: FileLock[];
      uptime: number;
    }>('/api/status');

    if (result.success && result.data) {
      const d = result.data;
      const instanceList =
        d.instances.length > 0
          ? d.instances
              .map((i) => {
                const isMe = i.id === currentInstanceId ? ' 👈' : '';
                return `  - ${i.name} (${i.status})${isMe}: ${i.workingOn}`;
              })
              .join('\n')
          : '  (无)';

      const lockList =
        d.fileLocks.length > 0
          ? d.fileLocks.map((l) => `  - ${l.filePath} (by ${l.lockedBy})`).join('\n')
          : '  (无)';

      return {
        content: [
          {
            type: 'text' as const,
            text: `📊 协作网络状态\n\n🟢 在线实例 (${d.instances.length}):\n${instanceList}\n\n📨 消息总数: ${d.messageCount}\n📝 共享笔记: ${d.noteCount}\n🔒 文件锁:\n${lockList}\n\n⏱️ Hub 运行时间: ${Math.round(d.uptime)}秒`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 获取失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ---------- Tool: unregister (注销当前实例) ----------
server.tool(
  'unregister',
  '从协作网络注销当前AI实例。通常在关闭IDE窗口前使用。',
  {},
  async () => {
    if (!currentInstanceId) {
      return {
        content: [{ type: 'text' as const, text: '当前没有注册的实例。' }],
      };
    }

    const result = await hubFetch(`/api/instances/${currentInstanceId}`, {
      method: 'DELETE',
    });

    if (result.success) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      const name = currentInstanceName;
      currentInstanceId = null;
      currentInstanceName = null;
      return {
        content: [
          { type: 'text' as const, text: `✅ 实例 "${name}" 已从协作网络注销。` },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: `❌ 注销失败: ${result.error}` }],
      isError: true,
    };
  }
);

// ============================================
// MCP Resources（资源）
// ============================================

server.resource(
  'collab-instances',
  'collab://instances',
  { description: '当前在线的所有AI实例列表', mimeType: 'application/json' },
  async () => {
    const result = await hubFetch<Instance[]>('/api/instances');
    return {
      contents: [
        {
          uri: 'collab://instances',
          text: JSON.stringify(result.data || [], null, 2),
          mimeType: 'application/json',
        },
      ],
    };
  }
);

server.resource(
  'collab-notes',
  'collab://notes',
  { description: '所有共享笔记', mimeType: 'application/json' },
  async () => {
    const result = await hubFetch<SharedNote[]>('/api/notes');
    return {
      contents: [
        {
          uri: 'collab://notes',
          text: JSON.stringify(result.data || [], null, 2),
          mimeType: 'application/json',
        },
      ],
    };
  }
);

server.resource(
  'collab-locks',
  'collab://locks',
  { description: '当前所有文件锁状态', mimeType: 'application/json' },
  async () => {
    const result = await hubFetch<FileLock[]>('/api/locks');
    return {
      contents: [
        {
          uri: 'collab://locks',
          text: JSON.stringify(result.data || [], null, 2),
          mimeType: 'application/json',
        },
      ],
    };
  }
);

// ============================================
// MCP Prompts（提示模板）
// ============================================

server.prompt(
  'collab-init',
  '初始化协作会话的提示模板，帮助AI快速加入协作网络',
  { name: z.string().describe('实例名称'), task: z.string().describe('工作任务') },
  ({ name, task }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `请帮我加入AI协作网络。我的身份是 "${name}"，我正在做的工作是: "${task}"。

请执行以下步骤：
1. 使用 register 工具注册我的实例
2. 使用 list_instances 查看当前在线的其他AI
3. 使用 get_messages 查看是否有发给我的消息
4. 使用 get_notes 查看共享笔记中是否有与我工作相关的信息
5. 使用 get_file_locks 查看是否有文件被锁定

然后给我一个当前协作状态的简要报告。`,
        },
      },
    ],
  })
);

server.prompt(
  'collab-handoff',
  '工作交接提示模板，在切换任务或关闭窗口前使用',
  {
    summary: z.string().describe('工作总结'),
    next_steps: z.string().describe('后续步骤'),
  },
  ({ summary, next_steps }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `我准备交接当前工作。请帮我：

1. 添加一条共享笔记，记录我的工作总结:
   "${summary}"
   
   以及后续步骤:
   "${next_steps}"

2. 广播一条消息给所有在线AI，通知我即将离开
3. 解锁我持有的所有文件锁
4. 注销我的实例`,
        },
      },
    ],
  })
);

// ============================================
// 启动 MCP Server
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] IDE Collab MCP Server 已启动 (stdio模式)');
  console.error(`[MCP] Hub URL: ${HUB_URL}`);
}

main().catch((err) => {
  console.error('[MCP] 启动失败:', err);
  process.exit(1);
});
