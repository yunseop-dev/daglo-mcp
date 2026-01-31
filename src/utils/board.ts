export const normalizeBoardList = (data: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(data)) {
    return data as Array<Record<string, unknown>>;
  }

  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items as Array<Record<string, unknown>>;
    }
  }

  return [];
};

export const pickLatestBoard = (boards: Array<Record<string, unknown>>) => {
  if (!boards.length) return null;

  return boards.reduce((latest, current) => {
    const latestTime = Date.parse(
      (latest.createdAt as string | undefined) ??
        (latest.updatedAt as string | undefined) ??
        (latest.createTime as string | undefined) ??
        (latest.updateTime as string | undefined) ??
        ""
    );
    const currentTime = Date.parse(
      (current.createdAt as string | undefined) ??
        (current.updatedAt as string | undefined) ??
        (current.createTime as string | undefined) ??
        (current.updateTime as string | undefined) ??
        ""
    );

    if (Number.isNaN(latestTime)) return current;
    if (Number.isNaN(currentTime)) return latest;

    return currentTime > latestTime ? current : latest;
  }, boards[0]);
};
