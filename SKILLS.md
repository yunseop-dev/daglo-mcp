# Daglo MCP Skills Guide

이 문서는 `daglo-mcp` 프로젝트에서 실제로 제공하는 MCP 도구(=실무 스킬)를 빠르게 파악하고 사용할 수 있도록 정리한 가이드다.

## 1) 스킬 맵 (카테고리별)

### 인증
- `login`

### 보드 조회/관리
- `get-boards`
- `get-board-info`
- `get-board-detail`
- `get-board-script`
- `update-board-name`
- `get-latest-board-content`
- `export-board-content`

### 파일 메타/키워드
- `get-file-meta`
- `get-keywords`

### 폴더
- `get-folders`

### Obsidian 내보내기
- `export-to-obsidian`
- `batch-export-folder`

### 영상 생성
- `create-youtube-highlight-clip`
- `create-youtube-full-subtitled-video`

총 15개 도구.

## 2) 구현 위치

등록 엔트리:
- `src/index.ts`

도구 구현:
- `src/tools/auth.ts` (`login`)
- `src/tools/boards.ts` (보드 관련 7개)
- `src/tools/file-meta.ts` (`get-file-meta`, `get-keywords`)
- `src/tools/folders.ts` (`get-folders`)
- `src/tools/obsidian.ts` (`export-to-obsidian`, `batch-export-folder`)
- `src/tools/video.ts` (영상 관련 2개)

문서/사용 예시:
- `README.md`
- `scripts/README.md`
- `ENHANCEMENT_SUMMARY.md`

## 3) 사용 순서 (실전 패턴)

### A. 기본 인증 + 조회
1. `login`
2. `get-boards`
3. 필요한 경우 `get-board-info` / `get-board-detail` / `get-board-script`

### B. 최신 보드 텍스트 추출
1. `login`
2. `get-latest-board-content` 또는 `export-board-content`

### C. Obsidian 문서화
1. `login`
2. `export-to-obsidian` (단건)
3. `batch-export-folder` (폴더 단위)

### D. 영상 생성
1. `login`
2. `create-youtube-highlight-clip` 또는 `create-youtube-full-subtitled-video`

## 4) 입력 규칙 핵심

- `boardId`와 `fileMetaId`가 동시에 가능한 도구는 대체로 `fileMetaId`가 더 직접적이다.
- 공개 보드는 `sharedBoardId` 기반 경로를 지원하는 도구를 사용한다.
- 파일 내보내기 도구는 `outputDir`/`outputPath`를 지정하지 않으면 기본 경로를 사용한다.
- 영상 도구는 `youtubeUrl` + (`boardId` 또는 `fileMetaId`) 조합이 필요하다.

## 5) 운영 노트 (session-ses_384f 반영)

세션 `session-ses_384f.md`에서 확인된 운영 이슈:

- 영상 도구 내부 다운로드 명령이 `python -m yt_dlp`를 사용한다.
- 환경에 `python`이 없고 `python3`만 있으면 다운로드 단계가 실패할 수 있다.
- 같은 환경에서 `yt-dlp` CLI와 `ffmpeg`는 정상 동작할 수 있다.

실무 체크리스트:

1. `python` 명령 존재 여부 확인
2. `yt-dlp --version` 확인
3. `ffmpeg -version` 확인
4. 실패 시 `python3 -m yt_dlp` 또는 `yt-dlp` 직접 호출로 우회

## 6) 빠른 호출 예시

### 로그인
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### 보드 목록
```json
{
  "page": 1,
  "limit": 20,
  "sort": "createTime.desc"
}
```

### 전체 자막 영상 생성
```json
{
  "youtubeUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "boardId": "BOARD_ID",
  "outputDir": "./docs/full-subtitles"
}
```

## 7) 유지보수 포인트

- 새 도구를 추가하면 `src/tools/*.ts` 구현 + `src/index.ts` 등록 + `README.md` 문서화를 함께 갱신한다.
- 이 문서(`SKILLS.md`)는 운영 관점 요약 문서이므로, 파라미터 상세는 `README.md`를 단일 진실 소스로 유지한다.
