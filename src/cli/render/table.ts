import Table from "cli-table3";

export interface Column<T> {
  header: string;
  get: (row: T) => string;
}

export const writeTable = <T>(
  rows: T[],
  columns: Column<T>[]
): void => {
  const table = new Table({
    head: columns.map((c) => c.header),
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push(columns.map((c) => c.get(row)));
  }
  process.stdout.write(`${table.toString()}\n`);
};
