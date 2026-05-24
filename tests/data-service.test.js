const assert = require('node:assert/strict');
const test = require('node:test');

const DataService = require('../data-service.js');

test('builds two injection columns per day in day then night order', () => {
  assert.deepEqual(DataService.getInjectionColumns(['월', '화']), [
    { day: '월', shift: 'day', label: '주' },
    { day: '월', shift: 'night', label: '야' },
    { day: '화', shift: 'day', label: '주' },
    { day: '화', shift: 'night', label: '야' },
  ]);
});

test('moves an injection cell without restoring the source cell', () => {
  const data = {
    injection: {
      '3층': [
        { machine: 'A', schedule: { 월: { day: 'P1', night: '' }, 화: { day: '', night: '' } } },
        { machine: 'B', schedule: { 월: { day: '', night: '' }, 화: { day: '', night: '' } } },
      ],
    },
  };

  const next = DataService.moveInjectionCell(data, '3층', { mi: 0, day: '월', shift: 'day' }, { mi: 1, day: '화', shift: 'night' });

  assert.equal(next.injection['3층'][0].schedule.월.day, '');
  assert.equal(next.injection['3층'][1].schedule.화.night, 'P1');
  assert.equal(data.injection['3층'][0].schedule.월.day, 'P1');
});

test('renames product references inside injection schedules', () => {
  const injection = {
    '3층': [
      { machine: 'A', schedule: { 월: { day: 'OLD', night: 'KEEP' } } },
    ],
  };

  const next = DataService.renameInjectionRefs(injection, 'OLD', 'NEW');

  assert.equal(next['3층'][0].schedule.월.day, 'NEW');
  assert.equal(next['3층'][0].schedule.월.night, 'KEEP');
  assert.equal(injection['3층'][0].schedule.월.day, 'OLD');
});

test('counts product references inside injection schedules', () => {
  const data = {
    injection: {
      '3층': [
        { schedule: { 월: { day: 'P1', night: 'P2' }, 화: { day: 'P1', night: '' } } },
      ],
      '1층': [
        { schedule: { 월: { day: '', night: 'P1' } } },
      ],
    },
  };

  assert.equal(DataService.countInjectionRefs(data, 'P1'), 3);
  assert.equal(DataService.countInjectionRefs(data, 'P3'), 0);
});

test('shows today and the next two days for three-day injection view', () => {
  assert.deepEqual(
    DataService.getVisibleWeekdays(['월', '화', '수', '목', '금'], '수', '3days'),
    ['수', '목', '금']
  );
  assert.deepEqual(
    DataService.getVisibleWeekdays(['월', '화', '수', '목', '금', '차주월'], '목', '3days'),
    ['목', '금', '차주월']
  );
  assert.deepEqual(DataService.getVisibleWeekdays(['월', '화'], '월', 'all'), ['월', '화']);
});

test('extracts real 호기 number from machine.machine string, not the row index', () => {
  // 사출계획 데이터는 { no: 순번, machine: '10호기' } 형태이므로
  // OCR의 machine_no(=10)와 매칭하려면 machine 문자열을 봐야 한다.
  assert.equal(DataService.machineNoOf({ no: 1, machine: '10호기' }), 10);
  assert.equal(DataService.machineNoOf({ no: 19, machine: '40호기' }), 40);
  assert.equal(DataService.machineNoOf({ no: 23, machine: '44호기' }), 44);
  // 야간 prefix 가 붙어도 첫 정수를 추출
  assert.equal(DataService.machineNoOf({ machine: '야간4호기' }), 4);
  // 명시적 machineNo 필드를 우선
  assert.equal(DataService.machineNoOf({ machineNo: 27, machine: '아무거나' }), 27);
  assert.equal(DataService.machineNoOf({ machine: '' }), null);
  assert.equal(DataService.machineNoOf(null), null);
});

// ─────────────────────────────────────────────────────
// aggregateChemicalRequest: 약품요청서 자동 집계
// ─────────────────────────────────────────────────────

test('aggregateChemicalRequest: 빈 데이터 → 빈 결과', () => {
  const result = DataService.aggregateChemicalRequest({ injection: {}, products: [], machineAssignments: [] }, {});
  assert.deepEqual(result.rows, []);
  assert.equal(result.unmappedProducts.size, 0);
});

test('aggregateChemicalRequest: 사출계획 셀을 잉크별로 층 분리해 집계', () => {
  const data = {
    products: [
      { name: 'RHAPSODY', inks: ['DARK', 'LUXE', null] },
      { name: 'ALORA',    inks: ['DARK'] },
    ],
    machineAssignments: [
      { ink: 'DARK', machine: '14호기', code: 'BC1499' },
      { ink: 'LUXE', machine: '47호기', code: 'BC2001' },
    ],
    injection: {
      '3층': [
        { schedule: { 월: { day: 'RHAPSODY', night: 'ALORA' } } },
      ],
      '1층': [
        { schedule: { 월: { day: 'RHAPSODY', night: '' } } },
      ],
    },
  };

  const { rows } = DataService.aggregateChemicalRequest(data, {
    days: ['월'], shifts: ['day', 'night'], floors: ['3층', '1층'],
  });

  // DARK: 3층(주 RHAPSODY=1, 야 ALORA=1) + 1층(주 RHAPSODY=1) = f3:2, f1:1, total:3
  // LUXE: 3층(주 RHAPSODY=1) + 1층(주 RHAPSODY=1) = f3:1, f1:1, total:2
  const dark = rows.find(r => r.ink === 'DARK');
  const luxe = rows.find(r => r.ink === 'LUXE');
  assert.deepEqual({ f3: dark.f3, f1: dark.f1, total: dark.total }, { f3: 2, f1: 1, total: 3 });
  assert.equal(dark.code, 'BC1499');
  assert.equal(dark.machine, '14호기');
  assert.deepEqual({ f3: luxe.f3, f1: luxe.f1, total: luxe.total }, { f3: 1, f1: 1, total: 2 });
  // 정렬: total desc
  assert.equal(rows[0].ink, 'DARK');
  assert.equal(rows[1].ink, 'LUXE');
});

test('aggregateChemicalRequest: 잉크 미등록 제품은 unmappedProducts 부산물에 담김', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['DARK'] }],
    machineAssignments: [{ ink: 'DARK', machine: '14호기', code: 'BC1499' }],
    injection: {
      '3층': [
        { schedule: { 월: { day: 'KNOWN', night: 'GHOST_PRODUCT' } } },
      ],
    },
  };
  const { rows, unmappedProducts } = DataService.aggregateChemicalRequest(data, { days: ['월'], floors: ['3층'] });
  assert.equal(rows.length, 1);
  assert.equal(unmappedProducts.has('GHOST_PRODUCT'), true);
  assert.equal(unmappedProducts.has('KNOWN'), false);
});

test('aggregateChemicalRequest: machineAssignments에 없는 잉크도 hasCode=false로 포함', () => {
  const data = {
    products: [{ name: 'P1', inks: ['ORPHAN_INK'] }],
    machineAssignments: [],
    injection: { '3층': [{ schedule: { 월: { day: 'P1' } } }] },
  };
  const { rows } = DataService.aggregateChemicalRequest(data, { days: ['월'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ink, 'ORPHAN_INK');
  assert.equal(rows[0].code, '');
  assert.equal(rows[0].hasCode, false);
  assert.equal(rows[0].total, 1);
});

test('aggregateChemicalRequest: floors 필터 — 3층만 보면 1층 셀은 무시', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '14호기', code: 'C1' }],
    injection: {
      '3층': [{ schedule: { 월: { day: 'P1' } } }],
      '1층': [{ schedule: { 월: { day: 'P1', night: 'P1' } } }],
    },
  };
  const { rows } = DataService.aggregateChemicalRequest(data, { days: ['월'], floors: ['3층'] });
  assert.equal(rows[0].f3, 1);
  assert.equal(rows[0].f1, 0);
  assert.equal(rows[0].total, 1);
});

test('aggregateChemicalRequest: shifts 필터 — 주간만 보면 야간 셀은 무시', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '14호기', code: 'C1' }],
    injection: {
      '3층': [{ schedule: { 월: { day: 'P1', night: 'P1' } } }],
    },
  };
  const { rows } = DataService.aggregateChemicalRequest(data, { days: ['월'], shifts: ['day'] });
  assert.equal(rows[0].total, 1);
});

test('aggregateChemicalRequest: 차주월 키도 days에 넣으면 집계됨', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '14호기', code: 'C1' }],
    injection: {
      '3층': [{ schedule: { 월: { day: 'P1' }, 차주월: { day: 'P1', night: 'P1' } } }],
    },
  };
  const onlyWeek = DataService.aggregateChemicalRequest(data, { days: ['월','화','수','목','금','토','일'] });
  assert.equal(onlyWeek.rows[0].total, 1);
  const withNext = DataService.aggregateChemicalRequest(data, { days: ['월','화','수','목','금','토','일','차주월'] });
  assert.equal(withNext.rows[0].total, 3);
});
