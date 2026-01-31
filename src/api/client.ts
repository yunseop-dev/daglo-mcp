import { DAGLO_API_BASE } from "../config.js";

export class DagloApiClient {
  private accessToken?: string;
  private refreshToken?: string;

  setTokens(access: string, refresh?: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
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

  get baseUrl(): string {
    return DAGLO_API_BASE;
  }
}
