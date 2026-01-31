export const formatDateForFilename = (dateStr: string) => {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const generateFrontmatter = (options: {
  title: string;
  date: string;
  tags: string[];
  keywords: string[];
  boardId: string;
  created: string;
}) => {
  return `---
title: "${options.title}"
date: ${formatDateForFilename(options.date)}
tags: [${options.tags.join(", ")}]
keywords: [${options.keywords.join(", ")}]
source: daglo
board_id: ${options.boardId}
created: ${options.created}
---`;
};

export const formatOriginalContent = (content: string) => {
  if (!content) return "";
  return content
    .split(/(?<=[.?!])\s+/)
    .filter((sentence) => sentence.trim())
    .reduce((acc, sentence, i, arr) => {
      acc += sentence;
      if ((i + 1) % 4 === 0 && i < arr.length - 1) {
        acc += "\n\n";
      } else if (i < arr.length - 1) {
        acc += " ";
      }
      return acc;
    }, "");
};

export const formatSummaryContent = (options: {
  title: string;
  originalFilename: string;
  summary?: string;
  aiSummary?: string;
  keywords?: string[];
  segments?: Array<{ startTime: number; endTime: number; text: string; speaker?: string }>;
}) => {
  let content = `# ${options.title}\n\n`;

  content += `> [!info] 원본 노트\n> [[original/${options.originalFilename}]]\n\n`;

  if (options.aiSummary) {
    content += `> [!summary] AI 요약\n> ${options.aiSummary.split("\n").join("\n> ")}\n\n`;
  }

  if (options.summary) {
    content += `## 요약\n${options.summary}\n\n`;
  }

  if (options.keywords?.length) {
    content += `## 키워드\n${options.keywords.map((keyword) => `#${keyword.replace(/\s+/g, "_")}`).join(" ")}\n\n`;
  }

  if (options.segments?.length) {
    content += "## 타임스탬프\n";
    options.segments.forEach((segment) => {
      const mins = Math.floor(segment.startTime / 60);
      const secs = Math.floor(segment.startTime % 60);
      content += `- **${mins}:${String(secs).padStart(2, "0")}** ${segment.text}\n`;
    });
  }

  return content;
};
