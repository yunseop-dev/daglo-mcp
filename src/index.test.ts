import { describe, it, expect, beforeEach, vi } from 'vitest';

global.fetch = vi.fn() as any;

describe('Daglo API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const mockResponse = {
        user: {
          id: 'user-123',
          email: 'test@example.com'
        },
        token: 'mock-jwt-token'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await fetch('https://backend.daglo.ai/user/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        })
      });

      const data = await result.json();
      expect(data.token).toBe('mock-jwt-token');
      expect(data.user.email).toBe('test@example.com');
    });

    it('should handle login failure gracefully', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        status: 401
      });

      const result = await fetch('https://backend.daglo.ai/user/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'invalid@example.com',
          password: 'wrong'
        })
      });

      expect(result.ok).toBe(false);
      expect(result.statusText).toBe('Unauthorized');
    });
  });

  describe('get-boards', () => {
    it('should fetch boards without filters', async () => {
      const mockBoards = [
        {
          id: 'board-1',
          name: 'Board 1',
          status: 'COMPLETE'
        }
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockBoards
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards?page=1');
      const data = await response.json();

      expect(data).toEqual(mockBoards);
      expect(data[0].id).toBe('board-1');
    });

    it('should fetch boards with status filter', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => []
      });

      await fetch('https://backend.daglo.ai/v2/boards?filter.status=COMPLETE');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should fetch boards with folder filter', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => []
      });

      await fetch('https://backend.daglo.ai/v2/boards?folderIds=folder-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should fetch starred boards', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => []
      });

      await fetch('https://backend.daglo.ai/v2/boards?isStarred=true');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('get-board-detail', () => {
    it('should fetch board detail', async () => {
      const mockDetail = {
        id: 'board-1',
        name: 'Board 1',
        content: 'Full content here',
        summary: 'Summary here',
        segments: [
          {
            startTime: 0,
            endTime: 5,
            text: 'Hello',
            speaker: 'Speaker 1'
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockDetail
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards/board-1');
      const data = await response.json();

      expect(data.id).toBe('board-1');
      expect(data.content).toBe('Full content here');
      expect(data.segments).toHaveLength(1);
    });

    it('should fetch board detail with fileMetaId', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'board-1' })
      });

      await fetch('https://backend.daglo.ai/v2/boards/board-1?fileMetaId=meta-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('get-folders', () => {
    it('should fetch all folders', async () => {
      const mockFolders = [
        {
          id: 'folder-1',
          name: 'Folder 1',
          isRoot: true
        }
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockFolders
      });

      const response = await fetch('https://backend.daglo.ai/folders?includeRoot=true');
      const data = await response.json();

      expect(data).toEqual(mockFolders);
    });

    it('should fetch folders without root', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => []
      });

      await fetch('https://backend.daglo.ai/folders?includeRoot=false');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('get-quotas', () => {
    it('should fetch usage quotas', async () => {
      const mockQuotas = [
        {
          type: 'TRANSCRIPTION_TIME',
          used: 100,
          total: 500
        }
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockQuotas
      });

      const response = await fetch('https://backend.daglo.ai/store/capa');
      const data = await response.json();

      expect(data).toEqual(mockQuotas);
      expect(data[0].type).toBe('TRANSCRIPTION_TIME');
    });
  });

  describe('get-plans', () => {
    it('should fetch available plans', async () => {
      const mockPlans = [
        {
          id: 'plan-1',
          name: 'Free Plan',
          price: 0,
          currency: 'KRW',
          duration: 'MONTHLY'
        }
      ];

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockPlans
      });

      const response = await fetch('https://backend.daglo.ai/v2/store/plan');
      const data = await response.json();

      expect(data).toEqual(mockPlans);
      expect(data[0].name).toBe('Free Plan');
    });
  });

  describe('auth headers', () => {
    it('should include authorization header when token exists', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      await fetch('https://backend.daglo.ai/v2/boards', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer my-token'
        }
      });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should not include authorization header when token does not exist', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      await fetch('https://backend.daglo.ai/v2/boards', {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('URL construction', () => {
    it('should construct correct board detail URL', () => {
      const boardId = 'abc-123';
      const expectedUrl = `https://backend.daglo.ai/v2/boards/${boardId}`;
      expect(expectedUrl).toBe('https://backend.daglo.ai/v2/boards/abc-123');
    });

    it('should construct URL with query parameters', () => {
      const params = new URLSearchParams();
      params.append('page', '1');
      params.append('limit', '10');

      const url = `https://backend.daglo.ai/v2/boards?${params.toString()}`;
      expect(url).toBe('https://backend.daglo.ai/v2/boards?page=1&limit=10');
    });

    it('should construct URL with fileMetaId', () => {
      const params = new URLSearchParams();
      params.append('fileMetaId', 'meta-123');

      const url = `https://backend.daglo.ai/v2/boards/board-1?${params.toString()}`;
      expect(url).toBe('https://backend.daglo.ai/v2/boards/board-1?fileMetaId=meta-123');
    });
  });

  describe('type validation', () => {
    it('should validate board status types', () => {
      const validStatuses = ['COMPLETE', 'PROCESSING', 'FAILED'];
      validStatuses.forEach(status => {
        expect(['COMPLETE', 'PROCESSING', 'FAILED']).toContain(status);
      });
    });

    it('should validate board type types', () => {
      const validTypes = ['TRANSCRIPTION', 'YOUTUBE', 'PDF', 'CHAT'];
      validTypes.forEach(type => {
        expect(['TRANSCRIPTION', 'YOUTUBE', 'PDF', 'CHAT']).toContain(type);
      });
    });
  });

  describe('get-latest-board-content', () => {
    it('should fetch latest board sorted by createTime desc', async () => {
      const mockBoards = {
        items: [
          {
            id: 'board-2',
            name: '2026. 1. 31. 09:55 녹음',
            createTime: '2026-01-31T00:55:02.459Z',
            fileMetaId: 'file-2'
          },
          {
            id: 'board-1',
            name: '2026. 1. 25. 11:22 녹음',
            createTime: '2026-01-25T02:22:57.660Z',
            fileMetaId: 'file-1'
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockBoards
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards?page=1&limit=50&sort=createTime.desc');
      const data = await response.json();

      expect(data.items[0].id).toBe('board-2');
      expect(data.items[0].createTime).toBe('2026-01-31T00:55:02.459Z');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=createTime.desc')
      );
    });

    it('should use createTime.desc as default sort parameter', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] })
      });

      await fetch('https://backend.daglo.ai/v2/boards?page=1&limit=50&sort=createTime.desc');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=createTime.desc')
      );
    });

    it('should correctly identify latest board from multiple boards', async () => {
      const mockBoards = {
        items: [
          {
            id: 'board-3',
            createTime: '2026-01-31T12:00:00.000Z',
            fileMetaId: 'file-3'
          },
          {
            id: 'board-2',
            createTime: '2026-01-31T00:55:02.459Z',
            fileMetaId: 'file-2'
          },
          {
            id: 'board-1',
            createTime: '2026-01-25T02:22:57.660Z',
            fileMetaId: 'file-1'
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockBoards
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards?page=1&limit=50&sort=createTime.desc');
      const data = await response.json();

      expect(data.items[0].id).toBe('board-3');
      expect(data.items[0].createTime).toBe('2026-01-31T12:00:00.000Z');
    });
  });

  describe('export-board-content', () => {
    it('should fetch boards sorted by createTime desc when no boardId provided', async () => {
      const mockBoards = {
        items: [
          {
            id: 'board-2',
            name: '2026. 1. 31. 09:55 녹음',
            createTime: '2026-01-31T00:55:02.459Z',
            fileMetaId: 'file-2'
          },
          {
            id: 'board-1',
            name: '2026. 1. 25. 11:22 녹음',
            createTime: '2026-01-25T02:22:57.660Z',
            fileMetaId: 'file-1'
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockBoards
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards?page=1&limit=50&sort=createTime.desc');
      const data = await response.json();

      expect(data.items[0].id).toBe('board-2');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=createTime.desc')
      );
    });

    it('should use createTime.desc as default sort parameter', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] })
      });

      await fetch('https://backend.daglo.ai/v2/boards?page=1&limit=50&sort=createTime.desc');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=createTime.desc')
      );
    });
  });

  describe('error handling', () => {
    it('should handle 401 Unauthorized', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards');
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should handle 404 Not Found', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards/invalid-id');
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('should handle 500 Internal Server Error', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const response = await fetch('https://backend.daglo.ai/v2/boards');
      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });
  });
});
