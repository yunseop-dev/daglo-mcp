# MCP → CLI 전환 설계

**날짜**: 2026-04-17
**범위**: `daglo-mcp` 저장소 전체

## 목적

현재 `daglo-mcp`는 MCP(Model Context Protocol) 서버로 동작하며 15개 도구를 제공한다.
이 도구들을 사람이 터미널에서 직접 호출할 수 있는 CLI(`daglo`)로 전환한다.
**MCP 서버는 완전히 제거하며, CLI가 단일 인터페이스가 된다.**

## 핵심 결정

| 항목 | 결정 |
|---|---|
| MCP 처리 | 완전 제거 (`@modelcontextprotocol/sdk` 의존성 제거) |
| 명령 구조 | 도메인별 계층 (`daglo <group> <command>`) |
| CLI 프레임워크 | `commander` |
| 출력 포맷 | 사람 친화적 기본 + `--json` 플래그 |
| 표·색상 | `cli-table3` + `chalk` |
| 인증 저장 | `~/.config/daglo/credentials.json` (XDG 표준, `0600`) + 환경변수 fallback |
| 토큰 갱신 | refresh API 미구현, 만료 시 환경변수로 자동 재로그인 fallback만 |
| 배포 | 로컬 `npm link`로 시작 (npm 게시는 추후) |
| 마이그레이션 전략 | 핸들러 추출 → CLI 추가 → MCP 제거 (Extract → Swap) |

## 아키텍처

### 디렉터리 구조 (목표 상태)

```
src/
├── cli.ts                      # 새 entry point (#!/usr/bin/env node, commander 루트)
├── config.ts
├── types.ts
├── logger.ts                   # CLI에선 stderr로만 출력
├── api/
│   └── client.ts               # DagloApiClient (토큰 자동 로딩/저장)
├── auth/
│   └── credentials.ts          # ~/.config/daglo/credentials.json read/write/delete
├── handlers/                   # 순수 비즈니스 로직 (args) => Promise<데이터>
│   ├── boards.ts
│   ├── folders.ts
│   ├── auth.ts
│   ├── file-meta.ts
│   ├── obsidian.ts
│   └── video.ts
├── schemas/                    # zod 스키마 (핸들러 입력 검증 공유)
│   ├── boards.ts
│   ├── folders.ts
│   └── ...
├── cli/                        # commander 명령 트리
│   ├── board.ts
│   ├── folder.ts
│   ├── auth.ts
│   ├── file-meta.ts
│   ├── obsidian.ts
│   ├── video.ts
│   └── render/
│       ├── table.ts            # cli-table3 헬퍼
│       └── format.ts           # JSON/text 분기, color 자동 감지
└── utils/                      # 기존 유지
```

### 삭제될 항목

- `src/index.ts` (MCP entry)
- `src/tools/*.ts` (MCP 등록부 — 핸들러로 흡수)
- `@modelcontextprotocol/sdk` 의존성

### 분리 원칙

- **`handlers/`**: MCP/CLI 어디서 호출하든 동일한 순수 함수. 단위 테스트 대상.
- **`cli/`**: commander 옵션 → 핸들러 호출 → 결과 렌더링. 비즈니스 로직 없음.
- **`schemas/`**: zod 스키마는 한 곳에서 정의하고 핸들러 입력 검증에 사용.

## 명령 구조 (15개 도구 매핑)

```
daglo auth
  login [--email <e>] [--password <p>]
  logout
  status

daglo board
  list   [--page] [--limit] [--sort] [--status] [--starred] [--folder <id>] [--json]
  info   <boardId|--shared <id>>
  detail <boardId> [--no-content] [--no-summary] [--no-keywords] [--no-ai-summary] [--no-segments]
  script [--file-meta <id>] [--shared <id>] [--history <id>] [--original]
         [--limit] [--page] [--no-pages]
  rename <boardId> <name>
  latest [--limit <n>] [--no-decode]
  export <format>                          # punctuation-json | text
         [--board-id <id>] [--file-meta <id>] [--out <path>] [--limit <n>]

daglo folder
  list [--no-root] [--json]
  export <folderId>
         [--out <dir>] [--type original|summary|both] [--limit <n>]

daglo file-meta
  get <fileMetaId> [--json]
  keywords [--file-meta <id>] [--shared <id>] [--json]

daglo obsidian
  export <boardId>
         [--file-meta <id>] [--type original|summary|both]
         [--out <dir>] [--no-content] [--no-summary] [--no-keywords] [--no-ai-summary]

daglo video
  clip <youtubeUrl>
       [--board-id <id>] [--file-meta <id>] [--out <dir>]
       [--length <minutes>] [--max-line <chars>] [--shorts]
       [--keywords <k1,k2,...>]
  subtitle <youtubeUrl>
       [--board-id <id>] [--file-meta <id>] [--out <dir>] [--max-line <chars>]
```

### MCP 도구 → CLI 명령 매핑 표

| MCP 도구 | CLI 명령 |
|---|---|
| `login` | `daglo auth login` |
| `get-boards` | `daglo board list` |
| `get-board-info` | `daglo board info` |
| `get-board-detail` | `daglo board detail` |
| `get-board-script` | `daglo board script` |
| `update-board-name` | `daglo board rename` |
| `get-latest-board-content` | `daglo board latest` |
| `export-board-content` | `daglo board export` |
| `get-folders` | `daglo folder list` |
| `batch-export-folder` | `daglo folder export` |
| `get-file-meta` | `daglo file-meta get` |
| `get-keywords` | `daglo file-meta keywords` |
| `export-to-obsidian` | `daglo obsidian export` |
| `create-youtube-highlight-clip` | `daglo video clip` |
| `create-youtube-full-subtitled-video` | `daglo video subtitle` |

## 출력 형식

### 전역 옵션

- `--json` — raw JSON 출력 (파이프·자동화용)
- `--no-color` — chalk 비활성화 (TTY 아니면 자동 비활성화)
- `-v, --verbose` — pino log level을 `debug`로
- `--quiet` — info 로그 억제, 결과만 출력

### 명령별 기본 출력

| 명령 | 기본 | `--json` |
|---|---|---|
| `board list`, `folder list` | `cli-table3` 표 | JSON 배열 |
| `board info`, `board detail`, `file-meta get` | key-value 요약 (chalk 라벨) | JSON 객체 |
| `board script`, `board latest` | 텍스트 본문 + 메타 헤더 | JSON |
| `board rename`, `auth login/logout` | `✓ Renamed board to "..."` 한 줄 | JSON |
| `auth status` | `Logged in as user@example.com (expires in 23h)` | JSON |
| 파일 생성 (`board export`, `obsidian export`, `folder export`, `video clip`, `video subtitle`) | `✓ Wrote: <path>` (여러 파일이면 모두 나열) | `{ files: [...] }` |

### stdout vs stderr

- **stdout**: 결과 데이터 (표/JSON/파일 경로)
- **stderr**: 진행 로그·체크마크·에러

이 구분으로 `daglo board list --json | jq` 같은 파이프가 깔끔히 동작한다.

### 색상 자동 처리

stdout이 TTY가 아니면 `chalk.level = 0`으로 자동 비활성화.

## 인증 / 자격증명

### 저장 위치와 권한

- 경로: `~/.config/daglo/credentials.json` (XDG 표준, `XDG_CONFIG_HOME` 존중)
- 권한: 파일 `0600`, 디렉터리 `0700`

### 파일 형식

```json
{
  "email": "user@example.com",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-04-18T03:00:00.000Z"
}
```

### `DagloApiClient` 동작

1. 생성 시 자격증명 파일을 자동으로 로드해 토큰을 메모리에 세팅
2. 매 요청 직전 `expiresAt` 체크. 5분 이내 만료면 갱신 시도
3. 갱신 = `DAGLO_EMAIL`/`DAGLO_PASSWORD` 환경변수로 재로그인 (refresh API는 구현하지 않음). 성공 시 토큰 파일 다시 저장.
4. 환경변수도 없거나 재로그인 실패 → `Error: Not authenticated. Run 'daglo auth login'.` 던지고 exit code 1

### 명령별 동작

- `daglo auth login` — 인자 우선 → 환경변수 → 인터랙티브 프롬프트(`process.stdin` raw로 password 가림). 성공 시 파일 저장 + `✓ Logged in as ...`
- `daglo auth logout` — 자격증명 파일 삭제. `✓ Logged out`
- `daglo auth status` — 파일 읽어 로그인 여부·이메일·만료 시각 출력. 없으면 `Not logged in` (exit code 1)
- 인증 필요한 다른 모든 명령 — 위의 `DagloApiClient` 동작에 위임. 명령 코드는 인증을 신경 쓰지 않음

### 저장 안전성

자격증명 파일 쓰기는 항상 임시 파일 작성 → `rename`으로 atomic 교체. 부분 쓰기 방지.

## 마이그레이션 단계

### Phase 1: 핸들러 추출 (MCP 계속 동작)

- `src/handlers/`, `src/schemas/` 디렉터리 생성
- 15개 도구를 한 파일씩 옮김: `(args) => Promise<데이터>` 순수 함수로
- 큰 파일 처리: `boards.ts` (27KB), `video.ts` (29.7KB), `obsidian.ts` (16.5KB)에서 중간 헬퍼들은 `src/utils/`로 이동
- `src/tools/*.ts`는 핸들러를 호출하고 `{ content: [{ type: "text", text: JSON.stringify(...) }] }`로 감싸기만 함
- zod 스키마는 `schemas/`로 이동, 핸들러와 (이후의) CLI에서 import
- ✅ 검증: `npm start`로 MCP 동작 확인, 기존 vitest 통과

### Phase 2: 인증 레이어 교체

- `src/auth/credentials.ts` 추가 (read/write/delete, 0600, atomic rename)
- `DagloApiClient` 생성자에서 자동 로드
- 만료 체크 + 환경변수 재로그인 fallback 구현
- ✅ 검증: 새 단위 테스트 (자격증명 read/write, 만료 처리, 재로그인 fallback)

### Phase 3: CLI 골격

- 의존성 추가: `commander`, `cli-table3`, `chalk`
- `src/cli.ts` entry + `src/cli/` 명령 파일들
- `src/cli/render/` 헬퍼 (table, format, color 자동 감지)
- `package.json`에 `bin: { "daglo": "dist/cli.js" }` 추가
- 한 그룹씩 구현: `auth` → `folder` → `file-meta` → `board` → `obsidian` → `video`
- ✅ 검증: 그룹마다 수동 smoke test, 핵심 명령 골든 출력 스냅샷

### Phase 4: MCP 제거 + 정리

- `src/index.ts`, `src/tools/` 삭제
- `@modelcontextprotocol/sdk` 의존성 제거
- `package.json` `start`/`dev` 스크립트를 CLI 기준으로 변경, `bin` 확인
- README 다시 씀 (CLI 사용법으로)
- `npm link`로 `daglo` 명령 등록 확인
- ✅ 최종 검증: 15개 명령 전부 한 번씩 실행

## 테스트 전략

- **핸들러 단위 테스트**: `fetch` mock으로 입력→출력 검증 (기존 vitest 유지)
- **자격증명 단위 테스트**: 임시 디렉터리에서 read/write/권한 확인
- **CLI 통합 테스트**: `execa`로 자식 프로세스 실행, stdout/stderr/exit code 확인. 외부 API 호출은 mock으로 격리. 핵심 명령(`auth status`, `board list`, `--json` 플래그) 위주.

## 위험 지점

- **큰 도구 파일**: `boards.ts`, `video.ts`, `obsidian.ts` 분해 시 중간 헬퍼 추출이 필요 → Phase 1에서 함께 정리
- **외부 바이너리 의존**: `video` 명령은 `yt-dlp`, `ffmpeg`이 PATH에 있어야 동작 → 새 README의 사전 요구사항에 명시
- **인터랙티브 프롬프트**: TTY 없는 환경(CI 등)에서 `auth login`을 인자 없이 호출하면 즉시 실패 처리하고 명확한 에러 메시지 출력

## 비-목표

- npm 게시 / 글로벌 설치 패키지화 (Phase 4 이후 필요 시 별도 작업)
- refresh token API 호출 구현
- 단일 바이너리 패키징 (`pkg`, `bun --compile` 등)
- MCP 서버 유지 또는 듀얼 인터페이스
