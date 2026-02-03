# 반듯한시공 결산 대시보드

정적 HTML/CSS/JS + **Supabase + Vercel**로 구성된 경영 실적 대시보드입니다.  
데이터는 Supabase에 저장되고, PIN 입력한 사람만 수정할 수 있습니다 (별도 로그인 없음).

## 프로젝트 구조
- `index.html` : 화면 구조
- `styles.css` : 디자인(Apple 스타일)
- `script.js` : 로직/차트/데이터 편집 + Supabase 읽기·쓰기
- `api/sync.js` : Vercel 서버리스 (PIN 검증 후 Supabase 쓰기)
- `supabase/schema.sql` : Supabase 테이블 생성 스크립트
- `config.example.js` : 설정 예시 (복사 후 `config.js`로 사용)

## 1. Supabase 설정
1. [Supabase](https://supabase.com)에서 프로젝트 생성
2. **SQL Editor**에서 `supabase/schema.sql` 내용 실행 (테이블·RLS 생성)
3. **기존 프로젝트**: `supabase/migrations/20260203_unpaid_items_table.sql` 실행 (unpaid_items 테이블 생성, dashboard_rows 정리)
4. **Settings → API**에서 확인 (Project URL, anon key, service_role key):
   - Project URL → `SUPABASE_URL`
   - anon public key → `SUPABASE_ANON_KEY` (프론트 읽기용)
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (API 쓰기용, **절대 노출 금지**)

## 2. 로컬에서 쓰기 (Supabase 연동)
1. `config.example.js`를 복사해 `config.js` 생성
2. `config.js`에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 입력
3. `npm install` 후 `npx vercel dev` 로 실행 (API `/api/sync` 사용)
4. 또는 `index.html`을 Live Server로 열기 → **읽기만** Supabase, **쓰기는** localStorage

## 3. Vercel 배포
1. 이 저장소를 **GitHub**에 올린 뒤 Vercel에서 **Import**
2. Framework: **Other**, Root: 이 폴더
3. **Build and Output**:
   - Build Command: `node scripts/inject-config.js`
   - Output Directory: 비워 두기 (기본)
4. **Environment Variables** 추가:
   - `EDITOR_PIN` : 데이터 수정용 PIN (예: 1234)
   - `SUPABASE_URL` : Supabase Project URL
   - `SUPABASE_ANON_KEY` : Supabase anon public key (빌드 시 config.js에 주입됨)
   - `SUPABASE_SERVICE_ROLE_KEY` : Supabase service_role key (API 전용, **노출 금지**)
5. 배포하면 빌드 시 `config.js`가 생성되어 Supabase 읽기·쓰기가 동작합니다.

## 4. CSV 업로드
엑셀에서 **CSV로 저장** 후 업로드하세요. 첫 줄에 헤더가 있어야 합니다.

권장 헤더: `month,cat1,cat2,cat3,count,rev,purchase,labor,sga`  
미수금 기능용: `건물명`, `매출 발행일`, `진행상태`, `수금상태`, `수금액`, `공급가액`

## 5. 동작 요약
- **읽기**: Supabase `dashboard_rows` 테이블 (anon 키로 조회). `config.js` 없으면 localStorage 사용
- **쓰기**: PIN 입력 후 데이터 관리에서 수정 → `POST /api/sync` (PIN + 데이터) → Vercel API가 PIN 검증 후 Supabase에 반영
- **GitHub**: 코드 저장·버전 관리. Push 시 Vercel이 자동 배포할 수 있음
