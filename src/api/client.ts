import { DAGLO_API_BASE } from "../config.js";
import { loadCredentials, saveCredentials } from "../auth/credentials.js";

export class DagloApiClient {
  private accessToken?: string;
  private refreshToken?: string;
  private email?: string;
  private expiresAt?: string;

  constructor() {
    const creds = loadCredentials();
    if (creds) {
      this.accessToken = creds.accessToken;
      this.refreshToken = creds.refreshToken;
      this.email = creds.email;
      this.expiresAt = creds.expiresAt;
    }
  }

  setTokens(access: string, refresh?: string, email?: string, expiresAt?: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    if (email) this.email = email;
    if (expiresAt) this.expiresAt = expiresAt;

    if (this.email) {
      saveCredentials({
        email: this.email,
        accessToken: access,
        refreshToken: refresh,
        expiresAt: this.expiresAt,
      });
    }
  }

  getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getEmail(): string | undefined {
    return this.email;
  }

  getExpiresAt(): string | undefined {
    return this.expiresAt;
  }

  get baseUrl(): string {
    return DAGLO_API_BASE;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const merged: RequestInit = {
      ...init,
      headers: {
        ...this.getAuthHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    };

    const response = await fetch(url, merged);
    if (response.status !== 401) return response;

    // Try re-login via env vars.
    const email = process.env.DAGLO_EMAIL;
    const password = process.env.DAGLO_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "Not authenticated. Run 'daglo auth login' or set DAGLO_EMAIL and DAGLO_PASSWORD."
      );
    }

    // Lazy import to avoid circular module load at startup.
    const { loginUser } = await import("../handlers/auth.js");
    await loginUser(this, { email, password });

    // Retry once with the new token.
    const retryHeaders: HeadersInit = {
      ...this.getAuthHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    };
    return await fetch(url, { ...init, headers: retryHeaders });
  }
}
