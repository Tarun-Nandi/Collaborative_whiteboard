const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    return headers;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_URL}${endpoint}`;
    const config: RequestInit = {
      headers: this.getHeaders(),
      ...options,
    };

    const response = await fetch(url, config);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Auth methods
  async register(data: { email: string; password: string; name?: string }) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Board methods
  async getBoards() {
    return this.request('/api/boards');
  }

  async createBoard(data: { title: string }) {
    return this.request('/api/boards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getBoard(id: string, shareToken?: string): Promise<{ board: any; permission: { canEdit: boolean } }> {
    const params = shareToken ? `?t=${encodeURIComponent(shareToken)}` : '';
    return this.request(`/api/boards/${id}${params}`);
  }

  async createShareLink(boardId: string, canEdit: boolean) {
    return this.request(`/api/boards/${boardId}/share`, {
      method: 'POST',
      body: JSON.stringify({ canEdit }),
    });
  }

  async storeEvents(boardId: string, events: any[]) {
    return this.request(`/api/boards/${boardId}/events`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  }

  // Page methods
  async getPages(boardId: string, shareToken?: string) {
    const params = shareToken ? `?t=${encodeURIComponent(shareToken)}` : '';
    return this.request(`/api/boards/${boardId}/pages${params}`);
  }

  async createPage(boardId: string, data: any) {
    return this.request(`/api/boards/${boardId}/pages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePage(boardId: string, pageId: string, data: any) {
    return this.request(`/api/boards/${boardId}/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePage(boardId: string, pageId: string) {
    return this.request(`/api/boards/${boardId}/pages/${pageId}`, {
      method: 'DELETE',
    });
  }

  async reorderPages(boardId: string, order: string[]) {
    return this.request(`/api/boards/${boardId}/pages/reorder`, {
      method: 'POST',
      body: JSON.stringify({ order }),
    });
  }

  // Asset methods
  async createAsset(data: { kind: string; url: string; pageCount?: number }) {
    return this.request('/api/assets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const apiClient = new ApiClient();
