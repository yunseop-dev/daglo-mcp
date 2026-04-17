import { createInterface } from "node:readline/promises";

export const promptCredentials = async (defaults: {
  email?: string;
}): Promise<{ email: string; password: string }> => {
  if (!process.stdin.isTTY) {
    throw new Error(
      "No TTY available; supply --email and --password or set DAGLO_EMAIL/DAGLO_PASSWORD."
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const email =
    defaults.email ?? (await rl.question("Daglo email: ")).trim();

  // Hide password input.
  process.stderr.write("Daglo password: ");
  const password = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(buf);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });

  rl.close();
  return { email, password };
};
