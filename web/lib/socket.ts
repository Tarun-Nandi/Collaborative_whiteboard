import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';

class SocketManager {
  private socket: Socket | null = null;
  private currentPageId: string | null = null;

  connect(token?: string, shareToken?: string, boardId?: string, pageId?: string, name?: string, color?: string): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io(WS_URL, {
      path: '/ws',
      transports: ['websocket'],
      auth: {
        token,
        shareToken,
        boardId,
        pageId,
        name,
        color
      },
      autoConnect: true
    });

    this.currentPageId = pageId || null;
    return this.socket;
  }

  switchPage(boardId: string, pageId: string) {
    if (this.socket && this.currentPageId !== pageId) {
      this.socket.emit('page:switch', { boardId, pageId });
      this.currentPageId = pageId;
    }
  }

  getCurrentPageId(): string | null {
    return this.currentPageId;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentPageId = null;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event: string, callback?: (...args: any[]) => void) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  emit(event: string, ...args: any[]) {
    if (this.socket) {
      this.socket.emit(event, ...args);
    }
  }
}

export const socketManager = new SocketManager();
