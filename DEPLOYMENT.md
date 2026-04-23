# 배포 가이드

## 개요
- **인증**: 팀 공용 패스코드 하나 (`APP_PASSCODE` 환경변수). 아는 사람만 들어옴.
  - 한 번 입력하면 쿠키 30일 유지 → 매일 다시 입력할 필요 없음
  - 로그아웃 버튼도 헤더에 있음
- **호스팅**: **Vercel** (Next.js 공식, 가장 간단함)
- **배포**: GitHub push → Vercel 자동 배포 (1–2분)

> 나중에 사용자별 로그인(Google OAuth 등)이 필요해지면 그때 업그레이드. 지금은 오버엔지니어링 안 함.

---

## 1. GitHub 저장소 생성 + 코드 푸시

프로젝트 폴더에서:

```bash
cd "C:\Users\ksy\OneDrive\문서\Amazon-Advertising"
git init
git add .
git commit -m "Initial commit"

# https://github.com/new 에서 빈 private repo 생성 (예: amazon-advertising)
git remote add origin https://github.com/<YOUR_GH_USER>/amazon-advertising.git
git branch -M main
git push -u origin main
```

⚠️ `.env.local` 은 `.gitignore` 에 포함돼 있어서 자동으로 제외됩니다. 절대 커밋되지 않도록 주의.

---

## 2. Vercel 프로젝트 연결

1. https://vercel.com/new 접속 (GitHub 계정으로 로그인)
2. **Import Git Repository** → 방금 만든 repo 선택
3. Framework Preset 은 자동으로 **Next.js** 감지됨
4. **Environment Variables** 섹션에서 다음 4개 추가:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://myelqyvkswcwzlykiyjl.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (로컬 `.env.local` 에서 복사) |
   | `SUPABASE_SERVICE_ROLE_KEY` | (로컬 `.env.local` 에서 복사) |
   | `APP_PASSCODE` | 아무 문자열 — 팀에 공유할 공용 패스코드 |

   💡 `APP_PASSCODE` 는 추측 어려운 문자열로. 예: `kahi-ads-2026-a1b2c3` 같은 식.

5. **Deploy** 클릭 → 1–2분 후 `<프로젝트명>.vercel.app` 도메인 발급
6. 팀원에게 URL + 패스코드 공유 → 끝

---

## 3. 이후 운영

- `main` 에 push 하면 Vercel 이 자동 재배포 (빌드 1–2분)
- PR 올리면 preview URL 자동 생성 (공유용)
- 패스코드 교체하고 싶으면 Vercel Settings → Environment Variables 에서 `APP_PASSCODE` 값 변경 후 Redeploy 트리거 (또는 새 빈 커밋 push)

### 커스텀 도메인 (선택)
- Vercel 프로젝트 → Settings → Domains 에서 `ads.egongegong.com` 같은 도메인 붙일 수 있음

---

## 4. 로컬 개발

```bash
npm install
cp .env.local.example .env.local
# .env.local 편집: SUPABASE URL/키 + APP_PASSCODE (본인만 알면 됨)
npm run dev
```

`http://localhost:3000` → `/login` → 패스코드 입력.

**`APP_PASSCODE` 비워두면 게이트 꺼짐** (로컬 빠른 개발용).

---

## 업그레이드 경로 (필요할 때)

공용 패스코드가 부족해지는 전형적 상황:
- **누가 접근했는지 추적하고 싶다** → 사용자별 로그인 필요
- **퇴사자 접근을 바로 끊고 싶다** → 공용 패스코드 교체하면 모두 재입력 필요함 (불편)
- **권한 분리가 필요** (뷰어 vs 관리자 등)

이럴 때 Google OAuth (+ 도메인 allow-list) 로 바꾸는 게 맞음. 대략 다음이 필요:
- Google Cloud Console 에서 OAuth 클라이언트 생성
- Supabase 대시보드에서 Google provider 활성화
- 콜백 핸들러 + 미들웨어 코드 추가 (과거 commit 참고)
