import chalk from "chalk";

const useColor = (): boolean => {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
};

if (!useColor()) {
  chalk.level = 0;
}

export const writeJson = (data: unknown): void => {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

export const writeKeyValue = (rows: Array<[string, string]>): void => {
  const labelWidth = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    const padded = k.padEnd(labelWidth);
    process.stdout.write(`${chalk.bold(padded)}  ${v}\n`);
  }
};

export const writeFilesWritten = (paths: string[]): void => {
  for (const p of paths) {
    process.stderr.write(`${chalk.green("✓")} Wrote: ${p}\n`);
  }
};

export const writeSuccess = (msg: string): void => {
  process.stderr.write(`${chalk.green("✓")} ${msg}\n`);
};

export const writeError = (msg: string): void => {
  process.stderr.write(`${chalk.red("✗")} ${msg}\n`);
};
