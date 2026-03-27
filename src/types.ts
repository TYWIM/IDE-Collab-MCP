// ============================================
// IDE Collab MCP - 共享类型定义
// ============================================

/** AI实例信息 */
export interface Instance {
  id: string;
  name: string;
  workingOn: string;
  status: 'active' | 'idle' | 'busy';
  registeredAt: string;
  lastHeartbeat: string;
  workspace?: string;
}

/** 消息类型 */
export type MessageType = 'info' | 'question' | 'warning' | 'request' | 'response';

/** 消息 */
export interface Message {
  id: string;
  from: string;
  to: string | 'all';
  content: string;
  type: MessageType;
  timestamp: string;
  read: boolean;
  replyTo?: string;
}

/** 共享笔记 */
export interface SharedNote {
  id: string;
  author: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 文件锁 */
export interface FileLock {
  filePath: string;
  lockedBy: string;
  reason: string;
  lockedAt: string;
  expiresAt?: string; // 可选的自动过期时间
}

/** WebSocket 事件类型 */
export type WSEventType =
  | 'instance_registered'
  | 'instance_updated'
  | 'instance_removed'
  | 'new_message'
  | 'note_added'
  | 'note_updated'
  | 'file_locked'
  | 'file_unlocked';

/** WebSocket 事件 */
export interface WSEvent {
  type: WSEventType;
  data: unknown;
  timestamp: string;
}

// ============================================
// Hub API 请求/响应类型
// ============================================

export interface RegisterRequest {
  name: string;
  workingOn: string;
  workspace?: string;
}

export interface UpdateStatusRequest {
  status: 'active' | 'idle' | 'busy';
  workingOn?: string;
}

export interface SendMessageRequest {
  from: string;
  to: string | 'all';
  content: string;
  type: MessageType;
  replyTo?: string;
}

export interface AddNoteRequest {
  author: string;
  title: string;
  content: string;
  tags: string[];
}

export interface UpdateNoteRequest {
  content: string;
  tags?: string[];
}

export interface LockFileRequest {
  lockedBy: string;
  reason: string;
  ttl?: number; // 锁定超时时间（秒），0 或不填表示永不自动过期
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
