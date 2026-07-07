const assert = require('node:assert/strict');
const test = require('node:test');

const DataService = require('../data-service.js');

// ─────────────────────────────────────────────────────
// localDateISO: 로컬 기준 YYYY-MM-DD 문자열 생성
// ─────────────────────────────────────────────────────

test('localDateISO: 기본 인자(현재 시각)에서 YYYY-MM-DD 형식 반환', () => {
  const iso = DataService.localDateISO();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});

test('localDateISO: 특정 Date 객체를 넘기면 그 날짜의 ISO 문자열 반환', () => {
  const d = new Date(2026, 0, 5); // 2026-01-05
  assert.equal(DataService.localDateISO(d), '2026-01-05');
});

test('localDateISO: 월/일이 한 자리면 앞에 0 패딩', () => {
  const d = new Date(2026, 8, 3); // 2026-09-03
  assert.equal(DataService.localDateISO(d), '2026-09-03');
});

test('localDateISO: 12월 31일 처리', () => {
  const d = new Date(2026, 11, 31); // 2026-12-31
  assert.equal(DataService.localDateISO(d), '2026-12-31');
});

// ─────────────────────────────────────────────────────
// parseDateLocal: YYYY-MM-DD → 로컬 자정 Date
// ─────────────────────────────────────────────────────

test('parseDateLocal: 유효한 ISO 문자열 → 로컬 자정 Date', () => {
  const d = DataService.parseDateLocal('2026-05-13');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4); // 0-indexed
  assert.equal(d.getDate(), 13);
});

test('parseDateLocal: null/빈 문자열 → null', () => {
  assert.equal(DataService.parseDateLocal(null), null);
  assert.equal(DataService.parseDateLocal(''), null);
  assert.equal(DataService.parseDateLocal(undefined), null);
});

test('parseDateLocal: 잘못된 포맷 → null', () => {
  assert.equal(DataService.parseDateLocal('not-a-date'), null);
  assert.equal(DataService.parseDateLocal('2026/05/13'), null);
});

test('parseDateLocal: 범위 초과 롤오버 거부 (2026-13-40)', () => {
  assert.equal(DataService.parseDateLocal('2026-13-40'), null);
});

test('parseDateLocal: 2월 29일 비윤년 → null', () => {
  assert.equal(DataService.parseDateLocal('2025-02-29'), null);
});

test('parseDateLocal: 윤년 2월 29일 → 유효', () => {
  const d = DataService.parseDateLocal('2024-02-29');
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 29);
});

// ─────────────────────────────────────────────────────
// dateFromLotNo: LOT 번호에서 MMDD 추출 → 날짜 복원
// ─────────────────────────────────────────────────────

test('dateFromLotNo: LOT 번호에서 MMDD 추출 → YYYY-MM-DD', () => {
  // SHAD0513xx → 05-13 → 2026-05-13
  const result = DataService.dateFromLotNo('SHAD051301', '2026-05-14');
  assert.equal(result, '2026-05-13');
});

test('dateFromLotNo: 패턴이 없으면 fallback 날짜 반환', () => {
  const result = DataService.dateFromLotNo('INVALID', '2026-05-14');
  assert.equal(result, '2026-05-14');
});

test('dateFromLotNo: 패턴이 없고 fallback도 없으면 오늘 날짜 반환', () => {
  const result = DataService.dateFromLotNo('INVALID', null);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('dateFromLotNo: 유효하지 않은 MMDD면 fallback 반환', () => {
  // SHAD136601 → 13-66 → 무효
  const result = DataService.dateFromLotNo('SHAD136601', '2026-05-14');
  assert.equal(result, '2026-05-14');
});

test('dateFromLotNo: 1월에 읽은 12월 LOT은 작년으로 보정', () => {
  // 1월 5일에 '1231…' LOT을 읽으면 올해 12/31(미래)이 아니라 작년 12/31이어야 함
  const result = DataService.dateFromLotNo('SHAD123101', '2026-01-05');
  assert.equal(result, '2025-12-31');
});

test('dateFromLotNo: 12월에 읽은 1월 LOT은 내년으로 보정', () => {
  // 12월 30일에 '0101…' LOT을 읽으면 내년 1/1이 가장 가까움
  const result = DataService.dateFromLotNo('SHAD010101', '2026-12-30');
  assert.equal(result, '2027-01-01');
});

test('dateFromLotNo: 연중에는 fallback 연도를 그대로 사용', () => {
  // 5월 14일 기준 05-13 LOT → 보정 없이 같은 해
  const result = DataService.dateFromLotNo('SHAD051301', '2026-05-14');
  assert.equal(result, '2026-05-13');
});

// ─────────────────────────────────────────────────────
// lotSequenceForDate: 같은 잉크/날짜의 기존 LOT에서 다음 시퀀스 계산
// ─────────────────────────────────────────────────────

test('lotSequenceForDate: 해당 잉크/날짜의 LOT이 없으면 1', () => {
  assert.equal(DataService.lotSequenceForDate([], 'SHADOW', '2026-05-13'), 1);
});

test('lotSequenceForDate: 같은 잉크/날짜의 LOT이 2개면 3', () => {
  const lots = [
    { ink: 'SHADOW', lotNo: 'SHAD051301', registeredDate: '2026-05-13' },
    { ink: 'SHADOW', lotNo: 'SHAD051302', registeredDate: '2026-05-13' },
  ];
  assert.equal(DataService.lotSequenceForDate(lots, 'SHADOW', '2026-05-13'), 3);
});

test('lotSequenceForDate: 다른 잉크나 다른 날짜는 무시', () => {
  const lots = [
    { ink: 'SHADOW', lotNo: 'SHAD051301', registeredDate: '2026-05-13' },
    { ink: 'SOUL', lotNo: 'SOUL051301', registeredDate: '2026-05-13' },
    { ink: 'SHADOW', lotNo: 'SHAD051201', registeredDate: '2026-05-12' },
  ];
  assert.equal(DataService.lotSequenceForDate(lots, 'SHADOW', '2026-05-13'), 2);
});

test('lotSequenceForDate: order 필드 기반 fallback', () => {
  const lots = [
    { ink: 'SHADOW', lotNo: 'X999', registeredDate: '2026-05-13', order: 5 },
  ];
  // prefix+mmdd 매칭 안 되면 order 값 사용
  assert.equal(DataService.lotSequenceForDate(lots, 'SHADOW', '2026-05-13'), 6);
});

// ─────────────────────────────────────────────────────
// relabelLotsForDate: 특정 날짜의 relabel LOT만 필터
// ─────────────────────────────────────────────────────

test('relabelLotsForDate: 해당 날짜의 relabel만 반환', () => {
  const lots = [
    { id: 'L1', ink: 'A', lotNo: 'A051001', role: 'initial', order: 1 },
    { id: 'L2', ink: 'A', lotNo: 'A051302', role: 'relabel', registeredDate: '2026-05-13', order: 2, parentId: 'L1' },
    { id: 'L3', ink: 'A', lotNo: 'A051403', role: 'relabel', registeredDate: '2026-05-14', order: 3, parentId: 'L1' },
  ];
  const result = DataService.relabelLotsForDate(lots, 'A', '2026-05-13');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'L2');
});

test('relabelLotsForDate: 해당 날짜의 relabel이 없으면 빈 배열', () => {
  const lots = [
    { id: 'L1', ink: 'A', lotNo: 'A051001', role: 'initial', order: 1 },
    { id: 'L2', ink: 'A', lotNo: 'A051302', role: 'relabel', registeredDate: '2026-05-13', order: 2, parentId: 'L1' },
  ];
  const result = DataService.relabelLotsForDate(lots, 'A', '2026-05-14');
  assert.equal(result.length, 0);
});

test('relabelLotsForDate: 잉크가 없으면 빈 배열', () => {
  const result = DataService.relabelLotsForDate([], 'NONEXIST', '2026-05-13');
  assert.equal(result.length, 0);
});

// ── getWeekInfo (ui.jsx 에서 data-service.js 로 통합 — 골든값으로 동작 고정) ──────
// 로컬 자정 기준 결정론적 테스트 (정오 주입으로 DST/타임존 경계 회피).
function atNoon(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

test('getWeekInfo: 주중(수) 기준 — 그 주 월요일/일요일/차주월 dates', () => {
  const w = DataService.getWeekInfo(atNoon('2026-05-13'));
  assert.equal(w.dates['월'], '5/11');
  assert.equal(w.dates['일'], '5/17');
  assert.equal(w.dates['차주월'], '5/18');
});

test('getWeekInfo: today 는 한국어 요일명', () => {
  assert.equal(DataService.getWeekInfo(atNoon('2026-05-13')).today, '수');
  assert.equal(DataService.getWeekInfo(atNoon('2026-06-01')).today, '월');
});

test('getWeekInfo: 일요일도 그 주에 귀속 (offsetToMonday=6)', () => {
  const w = DataService.getWeekInfo(atNoon('2026-05-17'));
  assert.equal(w.today, '일');
  assert.equal(w.dates['월'], '5/11'); // 수요일 케이스와 동일 주
});

test('getWeekInfo: isoLabel 형식 YYYY-Www', () => {
  assert.match(DataService.getWeekInfo(atNoon('2026-05-13')).isoLabel, /^\d{4}-W\d{2}$/);
  assert.equal(DataService.getWeekInfo(atNoon('2026-05-13')).isoLabel, '2026-W20');
});

test('getWeekInfo: 연말 ISO 주차 경계 — 2026-12-31(목)은 2026-W53', () => {
  const w = DataService.getWeekInfo(atNoon('2026-12-31'));
  assert.equal(w.isoLabel, '2026-W53');
  assert.equal(w.dates['금'], '1/1'); // 주가 연도를 넘어감
  assert.equal(w.dates['차주월'], '1/4');
});

test('getWeekInfo: n월 n주차 라벨 — 5/11은 5월 2주차', () => {
  assert.equal(DataService.getWeekInfo(atNoon('2026-05-13')).monthWeekLabel, '5월 2주차');
});

test('getWeekInfo: 월 경계 — 6/1(월) 시작 주는 6월 1주차', () => {
  const w = DataService.getWeekInfo(atNoon('2026-06-01'));
  assert.equal(w.monthWeekLabel, '6월 1주차');
  assert.equal(w.dates['월'], '6/1');
  assert.equal(w.isoLabel, '2026-W23');
});
