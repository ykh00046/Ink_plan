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

// ── lintMasters ────────────────────────────────────────────────────────────

test('lintMasters: 빈 데이터는 이슈 0건, 충돌 없이 통과', () => {
  const empty = DataService.lintMasters({});
  assert.equal(empty.summary.total, 0);
  assert.deepEqual(empty.issues, []);
  const empty2 = DataService.lintMasters({ products: [], machineAssignments: [], injection: {} });
  assert.equal(empty2.summary.total, 0);
});

test('lintMasters: 잉크 비어있는 제품은 product-no-inks (error)', () => {
  const data = {
    products: [
      { name: 'P1', brand: 'B1', inks: ['INK1'] },
      { name: 'P2', brand: 'B2', inks: [null, null, null] },
      { name: 'P3', brand: 'B3', inks: [] },
    ],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {},
  };
  const r = DataService.lintMasters(data);
  const ids = r.issues.filter(i => i.category === 'product-no-inks').map(i => i.target).sort();
  assert.deepEqual(ids, ['P2', 'P3']);
  for (const i of r.issues.filter(i => i.category === 'product-no-inks')) {
    assert.equal(i.severity, 'error');
    assert.equal(i.navTo, 'products');
  }
});

test('lintMasters: 사출계획에 있으나 제품 마스터에 없으면 product-not-in-master', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [
        { machine: '10호기', schedule: { 월: { day: 'KNOWN', night: 'UNKNOWN' }, 화: { day: '' } } },
      ],
    },
  };
  const r = DataService.lintMasters(data);
  const missing = r.issues.filter(i => i.category === 'product-not-in-master');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].target, 'UNKNOWN');
  assert.equal(missing[0].severity, 'error');
  assert.match(missing[0].detail, /3층.*10호기.*월.*야/);
});

test('lintMasters: 정규화 함수 주입 시 표기 차이는 무시', () => {
  const data = {
    products: [{ name: 'BELLA D_Cedar', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [{ machine: '10호기', schedule: { 월: { day: 'bella d cedar' } } }],
    },
  };
  const upper = (s) => String(s || '').trim().toUpperCase().replace(/[\s_]/g, '');
  const r = DataService.lintMasters(data, { normalize: upper });
  const missing = r.issues.filter(i => i.category === 'product-not-in-master');
  assert.equal(missing.length, 0);
});

test('lintMasters: 잉크 코드/호기 미입력은 warn', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1', 'INK2', 'INK3'] }],
    machineAssignments: [
      { ink: 'INK1', machine: '10호기', code: 'C1' },
      { ink: 'INK2', machine: '11호기', code: '' },
      { ink: 'INK3', machine: '', code: 'C3' },
    ],
    injection: {},
  };
  const r = DataService.lintMasters(data);
  const noCode = r.issues.filter(i => i.category === 'ink-no-code').map(i => i.target);
  const noMach = r.issues.filter(i => i.category === 'ink-no-machine').map(i => i.target);
  assert.deepEqual(noCode, ['INK2']);
  assert.deepEqual(noMach, ['INK3']);
  for (const i of r.issues.filter(i => i.category === 'ink-no-code' || i.category === 'ink-no-machine')) {
    assert.equal(i.severity, 'warn');
  }
});

test('lintMasters: products[].inks에 있지만 assignment 없으면 ink-not-in-assignments', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1', 'GHOST'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {},
  };
  const r = DataService.lintMasters(data);
  const ghosts = r.issues.filter(i => i.category === 'ink-not-in-assignments').map(i => i.target);
  assert.deepEqual(ghosts, ['GHOST']);
});

test('lintMasters: 사용되지 않는 잉크 마스터는 orphan (info)', () => {
  const data = {
    products: [{ name: 'P1', inks: ['INK1'] }],
    machineAssignments: [
      { ink: 'INK1', machine: '10호기', code: 'C1' },
      { ink: 'UNUSED', machine: '11호기', code: 'C2' },
    ],
    injection: {},
  };
  const r = DataService.lintMasters(data);
  const orphans = r.issues.filter(i => i.category === 'orphan-ink-assignment');
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].target, 'UNUSED');
  assert.equal(orphans[0].severity, 'info');
});

test('lintMasters: 같은 잉크 이름이 여러 행이면 duplicate-ink-assignment', () => {
  const data = {
    products: [{ name: 'P1', inks: ['DUP'] }],
    machineAssignments: [
      { ink: 'DUP', machine: '10호기', code: 'C1' },
      { ink: 'DUP', machine: '11호기', code: 'C1' },
      { ink: 'DUP', machine: '12호기', code: 'C1' },
    ],
    injection: {},
  };
  const r = DataService.lintMasters(data);
  const dup = r.issues.filter(i => i.category === 'duplicate-ink-assignment');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].target, 'DUP');
  assert.equal(dup[0].detail, '중복 3건');
});

test('lintMasters: 정렬 순서 — severity desc → category → target asc', () => {
  const data = {
    products: [
      { name: 'PB_empty', inks: [] },
      { name: 'PA_empty', inks: [] },
      { name: 'PC_ok', inks: ['INK1'] },
    ],
    machineAssignments: [
      { ink: 'INK1', machine: '10호기', code: '' },
      { ink: 'UNUSED', machine: '11호기', code: 'C2' },
    ],
    injection: {
      '3층': [{ machine: '10호기', schedule: { 월: { day: 'UNK_PRODUCT' } } }],
    },
  };
  const r = DataService.lintMasters(data);
  // 첫 이슈는 error 그룹이어야 함
  assert.equal(r.issues[0].severity, 'error');
  // error 안에서 product-no-inks 가 alphabetic 정렬되어야 함
  const errors = r.issues.filter(i => i.severity === 'error');
  const empties = errors.filter(i => i.category === 'product-no-inks').map(i => i.target);
  assert.deepEqual(empties, ['PA_empty', 'PB_empty']);
  // 마지막은 info(orphan)
  assert.equal(r.issues[r.issues.length - 1].category, 'orphan-ink-assignment');
});

test('lintMasters: byCategory / bySeverity 집계 정확', () => {
  const data = {
    products: [
      { name: 'P_empty', inks: [] },
      { name: 'P_ok', inks: ['INK_KNOWN'] },
    ],
    machineAssignments: [
      { ink: 'INK_KNOWN', machine: '', code: '' },
      { ink: 'INK_ORPHAN', machine: '12호기', code: 'C3' },
    ],
    injection: {
      '3층': [{ machine: '10호기', schedule: { 월: { day: 'UNK' } } }],
    },
  };
  const r = DataService.lintMasters(data);
  assert.equal(r.summary.bySeverity.error, 2);  // P_empty + UNK
  assert.ok(r.summary.bySeverity.warn >= 2);    // INK_KNOWN no-code + no-machine
  assert.equal(r.summary.bySeverity.info, 1);   // INK_ORPHAN
  assert.equal(r.summary.total, r.issues.length);
});
