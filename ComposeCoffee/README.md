# ComposeCoffee 출퇴근 관리 시스템

스마트폰 QR코드를 이용한 매장 직원 출퇴근 관리 웹 애플리케이션입니다.

## 주요 기능

- **QR코드 출퇴근**: 지점별 QR코드 스캔으로 출퇴근 페이지 접속
- **GPS 위치 검증**: Geolocation API로 실제 매장 위치에서 출퇴근하는지 확인 (기본 50m 반경)
- **보안**: UUID 기반 사용자 식별, bcrypt 비밀번호 암호화, JWT 인증
- **관리자 대시보드**: 일별/월별 근무현황 조회, CSV 내보내기, 직원/지점 관리

## 빠른 시작

```bash
npm install
npm run seed    # 샘플 데이터 생성
npm start       # 서버 시작 (http://localhost:3000)
```

## 기본 계정

| 구분 | ID | 비밀번호 | 비고 |
|------|-----|---------|------|
| 관리자 | admin | admin123 | 강남점 소속 |
| 직원 | staff01 | pass1234 | 강남점 - 김민준 |
| 직원 | staff02 | pass1234 | 강남점 - 이서연 |
| 직원 | staff03 | pass1234 | 홍대점 - 박지훈 |
| 직원 | staff04 | pass1234 | 홍대점 - 최수빈 |

## 페이지 안내

- `http://localhost:3000/` — 직원 출퇴근 페이지 (모바일 최적화)
- `http://localhost:3000/admin.html` — 관리자 대시보드

## 기술 스택

- Backend: Node.js + Express
- Database: SQLite (sql.js)
- Frontend: Vanilla HTML/CSS/JS (모바일 반응형)
- 인증: JWT + bcryptjs
- QR코드: qrcode 라이브러리

## 설정 변경

`config.js` 파일에서 포트, JWT 비밀키, 위치 검증 반경 등을 수정할 수 있습니다.
운영 환경에서는 반드시 `JWT_SECRET` 환경변수를 설정하세요.
