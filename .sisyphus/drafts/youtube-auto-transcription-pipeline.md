# Draft: YouTube 구독 채널 자동 받아쓰기 파이프라인

## Requirements (confirmed)
- YouTube 구독 채널 동영상 업데이트 감지 → yt-dlp 다운로드 → ffmpeg mp3 변환
- Daglo MCP를 이용한 받아쓰기
- mp3 + 받아쓰기 텍스트 요약본을 NAS 특정 경로에 업로드
- 정기적 자동 실행

## Technical Discoveries
- daglo-mcp: Node.js MCP 서버, 이미 yt-dlp + ffmpeg 패턴 존재 (src/tools/video.ts)
- Daglo API: 현재 읽기 전용 (boards 조회, scripts 조회). **파일 업로드 API 없음**
- DagloBoard.type에 "YOUTUBE" 타입 존재 → Daglo 웹에서 YouTube URL 입력 시 받아쓰기 가능한 것으로 추정
- 기존 인프라: MCP SDK, Pino 로깅, Zod 스키마, vitest 테스트

## Technical Decisions
- [PENDING] daglo-mcp 확장 vs 별도 프로젝트
- [PENDING] Daglo 음성 업로드 방식
- [PENDING] YouTube 채널 피드 모니터링 방식
- [PENDING] NAS 환경 및 접근 방식
- [PENDING] 자동화 방식 (cron, Docker, systemd 등)

## Research Findings
- video.ts: yt-dlp로 YouTube 다운로드, ffmpeg로 자막 합성 패턴 존재
- API 엔드포인트: POST /user/login, GET /v2/boards, GET /boards/{id}, GET /file-meta/{id}/script
- **업로드 관련 엔드포인트 미발견** → 사용자 확인 필요

## Open Questions
1. NAS 서버 환경 (OS, Synology/QNAP/DIY 등)?
2. Daglo에 음성 파일을 업로드하는 API가 있는지? 또는 YouTube URL을 제출하는 API?
3. YouTube 채널 목록 관리 방식?
4. 요약본 형식?
5. 자동 실행 주기?

## Scope Boundaries
- INCLUDE: 다운로드, 변환, 받아쓰기, 요약, NAS 저장, 자동화
- EXCLUDE: [TBD]
