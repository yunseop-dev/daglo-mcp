# YouTube Auto Pipeline

자동 파이프라인 흐름:

1. YouTube 채널 RSS를 읽고 신규 영상 탐지
2. `yt-dlp`로 오디오 다운로드
3. `ffmpeg`로 mp3 변환
4. Daglo API에 YouTube URL 제출 (`/transcript-request/online-media`)
5. 받아쓰기 완료까지 폴링
6. 요약 + 받아쓰기 텍스트 + mp3를 NAS 경로에 저장

Daglo YouTube 처리 시 실제 호출되는 API:

- `GET /file/online-media/metadata?url=...`
- `PATCH /user-option/transcription`
- `POST /transcript-request/online-media`

## 1) 준비

- `DAGLO_EMAIL`, `DAGLO_PASSWORD` 환경 변수 설정
- `yt-dlp`, `ffmpeg` 설치
- NAS 공유 폴더를 macOS에 마운트 (예: `/Volumes/iptime-nas`)

## 2) 설정 파일

```bash
cp scripts/youtube-pipeline.config.example.json scripts/youtube-pipeline.config.json
```

`scripts/youtube-pipeline.config.json`에서:

- `nasOutputDir`: NAS 마운트 경로
- `channels`: 구독 채널 RSS URL 목록
- `maxNewPerRun`: 1회 실행당 최대 처리 개수

## 3) 수동 실행

```bash
node scripts/youtube-auto-pipeline.mjs scripts/youtube-pipeline.config.json
```

## 4) launchd 자동 실행 (하루 2회)

빠른 설치 (템플릿 복사):

```bash
./scripts/install-youtube-pipeline-launchd.sh
```

수동 설치:

```bash
cp scripts/com.daglo.youtube-pipeline.plist.example ~/Library/LaunchAgents/com.daglo.youtube-pipeline.plist
launchctl load ~/Library/LaunchAgents/com.daglo.youtube-pipeline.plist
launchctl start com.daglo.youtube-pipeline
```

중지:

```bash
launchctl unload ~/Library/LaunchAgents/com.daglo.youtube-pipeline.plist
```
