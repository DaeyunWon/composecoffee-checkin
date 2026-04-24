// ComposeCoffee 출퇴근 관리 시스템 설정
module.exports = {
  // 서버 설정
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',

  // JWT 비밀 키 (운영 시 반드시 환경변수로 변경)
  JWT_SECRET: process.env.JWT_SECRET || 'composecoffee-secret-key-change-in-production',
  JWT_EXPIRES_IN: '12h',

  // 위치 검증 설정
  DEFAULT_RADIUS_METERS: parseInt(process.env.DEFAULT_RADIUS || '50'), // 기본 50m 반경

  // 데이터베이스 경로
  DB_PATH: process.env.DB_PATH || './data/checkin.db',
};
