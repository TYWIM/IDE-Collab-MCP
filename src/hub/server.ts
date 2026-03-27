// ============================================
// Hub Server - 中央通讯服务
// HTTP API + WebSocket 实时推送
// ============================================

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import type {
  Instance,
  Message,
  SharedNote,
  FileLock,
  WSEvent,
  RegisterRequest,
  UpdateStatusRequest,
  SendMessageRequest,
  AddNoteRequest,
  UpdateNoteRequest,
  LockFileRequest,
  ApiResponse,
} from '../types.js';

// ============================================
// 内存存储
// ============================================

const instances = new Map<string, Instance>();
const messages: Message[] = [];
const notes = new Map<string, SharedNote>();
const fileLocks = new Map<string, FileLock>();
const wsClients = new Map<string, WebSocket>(); // instanceId -> ws

// ============================================
// 工具函数
// ============================================

function broadcast(event: WSEvent, excludeId?: string) {
  const payload = JSON.stringify(event);
  for (const [id, ws] of wsClients) {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function cleanupStaleInstances() {
  const now = Date.now();
  const TIMEOUT = 5 * 60 * 1000; // 5分钟无心跳视为离线
  for (const [id, inst] of instances) {
    if (now - new Date(inst.lastHeartbeat).getTime() > TIMEOUT) {
      instances.delete(id);
      wsClients.get(id)?.close();
      wsClients.delete(id);
      // 释放该实例持有的所有文件锁
      for (const [path, lock] of fileLocks) {
        if (lock.lockedBy === id || lock.lockedBy === inst.name) {
          fileLocks.delete(path);
          broadcast({
            type: 'file_unlocked',
            data: { filePath: path },
            timestamp: new Date().toISOString(),
          });
        }
      }
      broadcast({
        type: 'instance_removed',
        data: { id, name: inst.name },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

function cleanupExpiredLocks() {
  const now = Date.now();
  for (const [path, lock] of fileLocks) {
    if (lock.expiresAt && new Date(lock.expiresAt).getTime() <= now) {
      fileLocks.delete(path);
      broadcast({
        type: 'file_unlocked',
        data: { filePath: path },
        timestamp: new Date().toISOString(),
      });
      console.log(`[Hub] 文件锁过期自动释放: ${path}`);
    }
  }
}

// 每60秒清理一次
setInterval(cleanupStaleInstances, 60_000);
setInterval(cleanupExpiredLocks, 30_000);

// ============================================
// Express App
// ============================================

const app = express();
app.use(express.json());

// 限速：每IP每分钟最多120次请求
const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
});
app.use(limiter);

// ---------- 健康检查 ----------
app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
});

// ---------- 实例管理 ----------

// 注册实例
app.post('/api/instances', (req, res) => {
  const body = req.body as RegisterRequest;
  if (!body.name || !body.workingOn) {
    res.json({ success: false, error: '缺少 name 或 workingOn' } satisfies ApiResponse);
    return;
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  const instance: Instance = {
    id,
    name: body.name,
    workingOn: body.workingOn,
    status: 'active',
    registeredAt: now,
    lastHeartbeat: now,
    workspace: body.workspace,
  };
  instances.set(id, instance);
  broadcast({
    type: 'instance_registered',
    data: instance,
    timestamp: now,
  });
  console.log(`[Hub] 实例注册: ${body.name} (${id})`);
  res.json({ success: true, data: instance } satisfies ApiResponse<Instance>);
});

// 获取所有实例
app.get('/api/instances', (_req, res) => {
  res.json({ success: true, data: Array.from(instances.values()) } satisfies ApiResponse<Instance[]>);
});

// 更新实例状态
app.patch('/api/instances/:id', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) {
    res.json({ success: false, error: '实例不存在' } satisfies ApiResponse);
    return;
  }
  const body = req.body as UpdateStatusRequest;
  if (body.status) inst.status = body.status;
  if (body.workingOn) inst.workingOn = body.workingOn;
  inst.lastHeartbeat = new Date().toISOString();
  broadcast({
    type: 'instance_updated',
    data: inst,
    timestamp: inst.lastHeartbeat,
  }, req.params.id);
  res.json({ success: true, data: inst } satisfies ApiResponse<Instance>);
});

// 心跳
app.post('/api/instances/:id/heartbeat', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) {
    res.json({ success: false, error: '实例不存在' } satisfies ApiResponse);
    return;
  }
  inst.lastHeartbeat = new Date().toISOString();
  res.json({ success: true } satisfies ApiResponse);
});

// 注销实例
app.delete('/api/instances/:id', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) {
    res.json({ success: false, error: '实例不存在' } satisfies ApiResponse);
    return;
  }
  instances.delete(req.params.id);
  wsClients.get(req.params.id)?.close();
  wsClients.delete(req.params.id);
  // 释放文件锁并广播解锁事件
  const unlockTs = new Date().toISOString();
  for (const [path, lock] of fileLocks) {
    if (lock.lockedBy === req.params.id || lock.lockedBy === inst.name) {
      fileLocks.delete(path);
      broadcast({
        type: 'file_unlocked',
        data: { filePath: path },
        timestamp: unlockTs,
      });
    }
  }
  broadcast({
    type: 'instance_removed',
    data: { id: req.params.id, name: inst.name },
    timestamp: new Date().toISOString(),
  });
  console.log(`[Hub] 实例注销: ${inst.name} (${req.params.id})`);
  res.json({ success: true } satisfies ApiResponse);
});

// ---------- 消息系统 ----------

// 发送消息
app.post('/api/messages', (req, res) => {
  const body = req.body as SendMessageRequest;
  if (!body.from || !body.to || !body.content) {
    res.json({ success: false, error: '缺少 from, to 或 content' } satisfies ApiResponse);
    return;
  }
  const msg: Message = {
    id: uuidv4(),
    from: body.from,
    to: body.to,
    content: body.content,
    type: body.type || 'info',
    timestamp: new Date().toISOString(),
    readBy: [],
    replyTo: body.replyTo,
  };
  messages.push(msg);

  // 限制消息数量，保留最近1000条
  if (messages.length > 1000) {
    messages.splice(0, messages.length - 1000);
  }

  broadcast({
    type: 'new_message',
    data: msg,
    timestamp: msg.timestamp,
  });
  console.log(`[Hub] 消息: ${body.from} -> ${body.to}: ${body.content.substring(0, 50)}...`);
  res.json({ success: true, data: msg } satisfies ApiResponse<Message>);
});

// 获取消息（支持过滤）
app.get('/api/messages', (req, res) => {
  const { to, from, unread, limit } = req.query;
  const toStr = to as string | undefined;
  const fromStr = from as string | undefined;
  const limitNum = limit ? parseInt(limit as string, 10) : undefined;
  if (limitNum !== undefined && isNaN(limitNum)) {
    res.status(400).json({ success: false, error: 'limit 必须是数字' } satisfies ApiResponse);
    return;
  }

  let result = messages.filter(m => {
    if (toStr && !(m.to === toStr || m.to === 'all')) return false;
    if (fromStr && m.from !== fromStr) return false;
    if (unread === 'true' && toStr && m.readBy.includes(toStr)) return false;
    return true;
  });

  if (limitNum) {
    result = result.slice(-limitNum);
  }

  res.json({ success: true, data: result } satisfies ApiResponse<Message[]>);
});

// 标记消息已读
app.patch('/api/messages/:id/read', (req, res) => {
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) {
    res.json({ success: false, error: '消息不存在' } satisfies ApiResponse);
    return;
  }
  const { readerName } = req.body as { readerName?: string };
  if (!readerName) {
    res.json({ success: false, error: '缺少 readerName' } satisfies ApiResponse);
    return;
  }
  if (!msg.readBy.includes(readerName)) msg.readBy.push(readerName);
  res.json({ success: true, data: msg } satisfies ApiResponse<Message>);
});

// 批量标记已读
app.post('/api/messages/mark-read', (req, res) => {
  const { instanceId } = req.body as { instanceId: string };
  const inst = instances.get(instanceId);
  if (!inst) {
    res.json({ success: false, error: '实例不存在' } satisfies ApiResponse);
    return;
  }
  let count = 0;
  for (const msg of messages) {
    if ((msg.to === inst.name || msg.to === instanceId || msg.to === 'all') && !msg.readBy.includes(inst.name)) {
      msg.readBy.push(inst.name);
      count++;
    }
  }
  res.json({ success: true, data: { markedRead: count } } satisfies ApiResponse);
});

// ---------- 共享笔记 ----------

// 添加笔记
app.post('/api/notes', (req, res) => {
  const body = req.body as AddNoteRequest;
  if (!body.title || !body.content) {
    res.json({ success: false, error: '缺少 title 或 content' } satisfies ApiResponse);
    return;
  }
  const now = new Date().toISOString();
  const note: SharedNote = {
    id: uuidv4(),
    author: body.author,
    title: body.title,
    content: body.content,
    tags: body.tags || [],
    createdAt: now,
    updatedAt: now,
  };
  notes.set(note.id, note);
  broadcast({
    type: 'note_added',
    data: note,
    timestamp: now,
  });
  console.log(`[Hub] 笔记添加: ${body.title} by ${body.author}`);
  res.json({ success: true, data: note } satisfies ApiResponse<SharedNote>);
});

// 获取所有笔记
app.get('/api/notes', (req, res) => {
  let result = Array.from(notes.values());
  const { tag } = req.query;
  if (tag) {
    result = result.filter(n => n.tags.includes(tag as string));
  }
  res.json({ success: true, data: result } satisfies ApiResponse<SharedNote[]>);
});

// 更新笔记
app.patch('/api/notes/:id', (req, res) => {
  const note = notes.get(req.params.id);
  if (!note) {
    res.json({ success: false, error: '笔记不存在' } satisfies ApiResponse);
    return;
  }
  const body = req.body as UpdateNoteRequest;
  if (body.content) note.content = body.content;
  if (body.tags) note.tags = body.tags;
  note.updatedAt = new Date().toISOString();
  broadcast({
    type: 'note_updated',
    data: note,
    timestamp: note.updatedAt,
  });
  res.json({ success: true, data: note } satisfies ApiResponse<SharedNote>);
});

// 删除笔记
app.delete('/api/notes/:id', (req, res) => {
  if (!notes.has(req.params.id)) {
    res.json({ success: false, error: '笔记不存在' } satisfies ApiResponse);
    return;
  }
  notes.delete(req.params.id);
  res.json({ success: true } satisfies ApiResponse);
});

// ---------- 文件锁 ----------

// 锁定文件
app.post('/api/locks/:filePath(*)', (req, res) => {
  const filePath = req.params.filePath;
  const existing = fileLocks.get(filePath);
  if (existing) {
    res.json({
      success: false,
      error: `文件已被 ${existing.lockedBy} 锁定 (原因: ${existing.reason})`,
      data: existing,
    } satisfies ApiResponse<FileLock>);
    return;
  }
  const body = req.body as LockFileRequest;
  if (!body.lockedBy) {
    res.json({ success: false, error: '缺少 lockedBy' } satisfies ApiResponse);
    return;
  }
  const now = new Date();
  const lock: FileLock = {
    filePath,
    lockedBy: body.lockedBy,
    reason: body.reason || '',
    lockedAt: now.toISOString(),
    expiresAt: body.ttl && body.ttl > 0
      ? new Date(now.getTime() + body.ttl * 1000).toISOString()
      : undefined,
  };
  fileLocks.set(filePath, lock);
  broadcast({
    type: 'file_locked',
    data: lock,
    timestamp: lock.lockedAt,
  });
  console.log(`[Hub] 文件锁定: ${filePath} by ${body.lockedBy}`);
  res.json({ success: true, data: lock } satisfies ApiResponse<FileLock>);
});

// 解锁文件
app.delete('/api/locks/:filePath(*)', (req, res) => {
  const filePath = req.params.filePath;
  if (!fileLocks.has(filePath)) {
    res.json({ success: false, error: '该文件未被锁定' } satisfies ApiResponse);
    return;
  }
  fileLocks.delete(filePath);
  broadcast({
    type: 'file_unlocked',
    data: { filePath },
    timestamp: new Date().toISOString(),
  });
  console.log(`[Hub] 文件解锁: ${filePath}`);
  res.json({ success: true } satisfies ApiResponse);
});

// 获取所有文件锁
app.get('/api/locks', (_req, res) => {
  res.json({
    success: true,
    data: Array.from(fileLocks.values()),
  } satisfies ApiResponse<FileLock[]>);
});

// ---------- 状态总览 ----------
app.get('/api/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      instances: Array.from(instances.values()),
      messageCount: messages.length,
      noteCount: notes.size,
      fileLocks: Array.from(fileLocks.values()),
      uptime: process.uptime(),
    },
  } satisfies ApiResponse);
});

// ============================================
// 启动服务
// ============================================

const PORT = parseInt(process.env.HUB_PORT || '9800', 10);
const server = createServer(app);

// WebSocket 服务
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const instanceId = url.searchParams.get('instanceId');

  if (!instanceId || !instances.has(instanceId)) {
    ws.close(4001, '实例不存在或未注册');
    return;
  }

  wsClients.set(instanceId, ws);
  console.log(`[Hub] WebSocket 连接: ${instanceId}`);

  ws.on('close', () => {
    wsClients.delete(instanceId);
    console.log(`[Hub] WebSocket 断开: ${instanceId}`);
  });

  ws.on('error', (err) => {
    console.error('[Hub] WebSocket 错误:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     IDE Collab Hub Server                    ║
║     中央通讯服务已启动                         ║
║                                              ║
║     HTTP API:  http://localhost:${PORT}        ║
║     WebSocket: ws://localhost:${PORT}/ws       ║
║                                              ║
║     等待 AI 实例连接...                        ║
╚══════════════════════════════════════════════╝
  `);
});

export { app, server };
