import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

const CONFIG_DIR_NAME = "daglo";
const FILE_NAME = "credentials.json";

const getConfigDir = (): string => {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME);
};

export const getCredentialsPath = (): string =>
  join(getConfigDir(), FILE_NAME);

export const loadCredentials = (): Credentials | null => {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
};

export const saveCredentials = (creds: Credentials): void => {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Tighten dir permissions in case it already existed with wider perms.
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore
  }

  const path = getCredentialsPath();
  const tmpPath = `${path}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(creds, null, 2), {
    mode: 0o600,
    encoding: "utf-8",
  });
  renameSync(tmpPath, path);
};

export const deleteCredentials = (): void => {
  const path = getCredentialsPath();
  if (!existsSync(path)) return;
  rmSync(path, { force: true });
};
