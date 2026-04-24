// KST (한국 표준시, UTC+9) 유틸리티
// 서버가 어떤 타임존에서 돌아도 항상 KST 기준으로 동작

function getKSTNow() {
  const now = new Date();
  const kstOffset = 9 * 60;
  const kst = new Date(now.getTime() + (kstOffset + now.getTimezoneOffset()) * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  const h = String(kst.getHours()).padStart(2, '0');
  const min = String(kst.getMinutes()).padStart(2, '0');
  const s = String(kst.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function getKSTDate() {
  return getKSTNow().split(' ')[0];
}

function getKSTYear() {
  return parseInt(getKSTDate().split('-')[0]);
}

function getKSTMonth() {
  return parseInt(getKSTDate().split('-')[1]);
}

module.exports = { getKSTNow, getKSTDate, getKSTYear, getKSTMonth };
