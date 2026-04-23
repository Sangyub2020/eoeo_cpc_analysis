# Amazon Advertising Dashboard

혼자 쓰는 툴. Amazon 광고 레포트(CSV/xlsx)를 올리면 Supabase에 저장하고 표/차트로 자유롭게 보는 앱.

## 핵심 동작
- 파일 드롭 → 레포트 타입 선택(또는 새로 만들기) → 헤더 자동 인식
- DB에 없는 열은 **추가 여부를 묻고**, 확인 시 해당 타입 테이블에 열을 실제로 추가
- 복합키로 **UPSERT** (중복 업로드 안전)
- 피벗형 차트: X축/Y축/그룹·집계(sum/avg)를 UI에서 자유롭게 선택

## 개발

```bash
cp .env.local.example .env.local   # 채우기
npm install
npm run dev                        # http://localhost:3000
```

### 필수 env
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — 서버 라우트 전용 (DDL + 쓰기 모두 이 키로 Supabase JS 호출)
- `APP_PASSCODE` — 간단 게이트. 비우면 무인증.

### 초기 마이그레이션
`supabase/migrations/0001_init.sql` 내용을 Supabase 프로젝트의 SQL Editor 에서 한 번 실행하세요. (또는 Supabase CLI로 `supabase db push`)

## 배포 (Railway)
- `main` 브랜치 push 시 자동 배포
- 환경변수는 Railway 프로젝트 Variables 에 동일하게 등록
- `railway.toml`, `nixpacks.toml` 이 빌드/기동을 담당

## OneDrive 주의
이 폴더가 OneDrive 하위면 `node_modules` 동기화 제외를 꼭 설정하세요. (파일 탐색기에서 `node_modules` 우클릭 > "OneDrive" > "이 장치에서만 유지" / "항상 이 장치에 유지" 해제)
