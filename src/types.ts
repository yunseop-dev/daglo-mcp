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

// User Profile & Settings
export interface DagloUserProfile {
  id: string;
  name: string;
  email: string;
  status: 'normal' | 'notAgree' | 'notLink' | 'delete' | 'dormant' | 'block';
  marketingAgreement: boolean;
  dataAgreement: boolean;
  personalDataAgreement: boolean;
  lastLoginTime: string;
  createTime: string;
  updateTime: string;
  profileBackground: 'SECONDARY_ROSE' | 'WARNING' | 'SUCCESS' | 'PRIMARY' | 'SECONDARY_VIOLET';
  providers: Array<'email' | 'google' | 'apple' | 'facebook' | 'kakao' | 'naver'>;
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
}

export interface DagloNotificationOption {
  type: 'EMAIL' | 'MOBILE';
  category: 'MARKETING' | 'TRANSCRIPT' | 'LONG_SUMMARY';
  value: boolean;
}

export interface DagloSummaryLanguageOption {
  transcriptionLanguage: 'ko-KR' | 'en-US';
  summaryLanguage: 'ko-KR' | 'en-US';
}

// Board Sharing
export interface DagloShareUrl {
  id: string;
  permission: string;
  updateTime: string;
  expiredAt: string;
  url: string;
  isBookmarkSharable: boolean;
}

export interface DagloSharedBoardInfo {
  id: string;
  name: string;
  isShared: boolean;
  isStarred: boolean;
  createTime: string;
  updateTime: string;
  deleteTime: string | null;
  shareUrl: DagloShareUrl;
  bookmarks?: DagloBookmark[];
  status: 'COMPLETE' | 'PROCESSING' | 'FAILED';
}

// AI Chat
export interface DagloChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  boardId?: string;
  fileId?: string;
}

export interface DagloChatConversation {
  id: string;
  boardId?: string;
  fileId?: string;
  messages: DagloChatMessage[];
  createdAt: string;
  updatedAt: string;
}

