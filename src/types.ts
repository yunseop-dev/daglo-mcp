export interface DagloBoard {
  id: string;
  name: string;
  status: "COMPLETE" | "PROCESSING" | "FAILED";
  type: "TRANSCRIPTION" | "YOUTUBE" | "PDF" | "CHAT";
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
