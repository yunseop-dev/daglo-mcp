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

## 1-1) Plan Mode 체크리스트 (NAS 업로드 포함)

- [ ] NAS 공유 폴더를 macOS에 마운트했는지 확인
- [ ] `nasOutputDir`가 실제 마운트 경로를 가리키는지 확인
- [ ] 해당 경로에 쓰기 권한이 있는지 확인
- [ ] `DAGLO_EMAIL`, `DAGLO_PASSWORD`가 실행 환경에서 읽히는지 확인
- [ ] 채널 RSS URL이 유효한지 확인
- [ ] 1회 수동 실행으로 결과(mp3/md/json)가 NAS에 생성되는지 확인

추천 사전 점검:

```bash
npm run pipeline:youtube:preflight
```

## 2) 설정 파일

```bash
cp scripts/youtube-pipeline.config.example.json scripts/youtube-pipeline.config.json
```

`scripts/youtube-pipeline.config.json`에서:

- `nasOutputDir`: NAS 마운트 경로
- `channels`: 구독 채널 RSS URL 목록
- `maxNewPerRun`: 1회 실행당 최대 처리 개수

iptime NAS 예시 경로:

- Finder로 접속: `smb://<NAS_IP>/<SHARE_NAME>`
- 마운트 이후 경로 예시: `/Volumes/<SHARE_NAME>/daglo-youtube`

터미널 마운트 예시:

```bash
mkdir -p /Volumes/iptime-nas
mount_smbfs "//<USER>:<PASSWORD>@<NAS_IP>/<SHARE_NAME>" /Volumes/iptime-nas
```

주의: launchd에서 비밀번호를 직접 넣기보다, 가능하면 Keychain/환경 파일 주입 방식을 권장합니다.

## 3) 수동 실행

```bash
node scripts/youtube-auto-pipeline.mjs scripts/youtube-pipeline.config.json
```

디버깅 포인트:

- `No new videos. Done.`: 신규 영상 없음(정상)
- `Timed out waiting transcript completion`: Daglo 처리 지연, `pollTimeoutMin` 상향
- NAS 경로 복사 실패: 마운트 해제/권한 문제 가능성 큼

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

상태 점검:

```bash
launchctl list | grep com.daglo.youtube-pipeline
tail -n 200 .work/youtube-pipeline/launchd.out.log
tail -n 200 .work/youtube-pipeline/launchd.err.log
```

## 5) NAS 업로드 절차(운영 기준)

1. Mac 부팅 후 NAS 자동 마운트 확인 (`/Volumes/...` 경로 존재)
2. `nas-preflight-check` 실행으로 쓰기 권한/경로 정상 여부 확인
3. 파이프라인 실행 (`npm run pipeline:youtube`)
4. NAS 경로에 `videoId-title/` 디렉터리 생성 확인
5. 해당 디렉터리에 아래 파일 존재 확인
   - `<videoId>.mp3`
   - `<videoId>.md`
   - `<videoId>.script.json`
6. 실패 시 `launchd.err.log` 및 파이프라인 stdout 로그 확인 후 재실행
