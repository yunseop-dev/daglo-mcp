/**
 * Daglo API Response Types
 */

export interface DagloUser {
  id: string;
  email: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DagloBoard {
  id: string;
  name: string;
  status: 'COMPLETE' | 'PROCESSING' | 'FAILED';
  type: 'TRANSCRIPTION' | 'YOUTUBE' | 'PDF' | 'CHAT';
  createdAt: string;
  updatedAt: string;
  isStarred: boolean;
  folderId?: string;
  fileMetaId?: string;
  duration?: number;
  thumbnail?: string;
}

export interface DagloBoardDetail extends DagloBoard {
  content?: string;
  summary?: string;
  segments?: Array<{
    startTime: number;
    endTime: number;
    text: string;
    speaker?: string;
  }>;
  keywords?: string[];
  aiSummary?: string;
  processingStatus?: string;
  fileUrl?: string;
}

export interface DagloFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
  isRoot?: boolean;
}

export interface DagloNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
  template?: {
    platform: string;
  };
}

export interface DagloQuota {
  type: string;
  used: number;
  total: number;
  resetAt?: string;
}

export interface DagloPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  duration: 'MONTHLY' | 'YEARLY';
  features: Array<{
    id: string;
    name: string;
    value: number;
    description?: string;
  }>;
}

export interface DagloProduct {
  id: string;
  name: string;
  description: string;
  type: string;
  isActive: boolean;
}

export interface DagloLoginResponse {
  user: DagloUser;
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}

// Bookmarks
export interface DagloBookmark {
  id: string;
  boardId: string;
  title: string;
  description?: string;
  timestamp?: number;
  createdAt: string;
  updatedAt?: string;
}

// User Dictionary
export interface DagloUserDictionary {
  id: string;
  word: string;
  pronunciation?: string;
  definition?: string;
  category?: string;
  createdAt: string;
  updatedAt?: string;
}

