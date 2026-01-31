export type KaraokeToken = {
  text: string;
  startTime: number;
  endTime: number;
};

export const collectKaraokeTokens = (node: unknown, tokens: KaraokeToken[]) => {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((child) => collectKaraokeTokens(child, tokens));
    return;
  }

  if (typeof node !== "object") return;

  const typedNode = node as Record<string, unknown>;
  if (
    typedNode.type === "karaoke" &&
    typeof typedNode.text === "string" &&
    typeof typedNode.s === "number" &&
    typeof typedNode.e === "number"
  ) {
    tokens.push({
      text: typedNode.text,
      startTime: typedNode.s,
      endTime: typedNode.e,
    });
  }

  if (typedNode.children) {
    collectKaraokeTokens(typedNode.children, tokens);
  }
};

export const extractKaraokeTokens = (content: string): KaraokeToken[] => {
  const tokens: KaraokeToken[] = [];
  if (!content) return tokens;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.text === "string") {
        return extractKaraokeTokens(parsed.text);
      }
      if (parsed.item && typeof parsed.item === "string") {
        return extractKaraokeTokens(parsed.item);
      }
      if (parsed.content && typeof parsed.content === "string") {
        return extractKaraokeTokens(parsed.content);
      }
    }
    if (parsed?.editorState) {
      const editorState = parsed.editorState as Record<string, unknown>;
      if (editorState?.root) {
        collectKaraokeTokens(editorState.root, tokens);
      } else {
        collectKaraokeTokens(editorState, tokens);
      }
    } else {
      collectKaraokeTokens(parsed, tokens);
    }
  } catch {
    return tokens;
  }

  return tokens;
};

export const splitTokensByPunctuation = (tokens: KaraokeToken[]) => {
  const segments: Array<{ text: string; startTime: number; endTime: number }> = [];
  let currentText = "";
  let startTime: number | null = null;
  let endTime: number | null = null;

  tokens.forEach((token) => {
    if (startTime === null) {
      startTime = token.startTime;
    }
    endTime = token.endTime;
    currentText += token.text;

    if (/[?.!]/.test(token.text)) {
      segments.push({
        text: currentText.trim(),
        startTime,
        endTime: endTime ?? token.endTime,
      });
      currentText = "";
      startTime = null;
      endTime = null;
    }
  });

  if (currentText.trim().length > 0 && startTime !== null && endTime !== null) {
    segments.push({
      text: currentText.trim(),
      startTime,
      endTime,
    });
  }

  return segments;
};

export const buildPlainTextFromTokens = (tokens: KaraokeToken[]) => {
  return tokens.map((token) => token.text).join("").trim();
};
