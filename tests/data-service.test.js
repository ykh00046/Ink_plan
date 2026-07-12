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

test('aggregateChemicalRequest: {name,id} 객체 셀도 집계 — id-셀 도입 회귀', () => {
  // 수동 셀 편집·OCR 머지가 {name,id} 객체를 저장하므로 문자열 셀과 동일하게 집계돼야 함.
  // (이전엔 name 키 Map 미스로 수요가 통째로 누락 → 약품요청서 발주 부족)
  const data = {
    products: [{ id: 'p_00001', name: 'P1', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '14호기', code: 'C1' }],
    injection: {
      '3층': [{ schedule: { 월: { day: { name: 'P1', id: 'p_00001' }, night: 'P1' } } }],
    },
  };
  const { rows, unmappedProducts } = DataService.aggregateChemicalRequest(data, { days: ['월'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ink, 'INK1');
  assert.equal(rows[0].total, 2);   // 객체 셀 1 + 레거시 문자열 셀 1
  assert.equal(unmappedProducts.size, 0);
});

test('aggregateChemicalRequest: 동명 제품은 셀 id로 정확한 잉크 참조 (동명 구분)', () => {
  const data = {
    products: [
      { id: 'p_00001', name: 'DUP', type: 'POWDER', inks: ['INK-P'] },
      { id: 'p_00002', name: 'DUP', type: 'LIQUID', inks: ['INK-L'] },
    ],
    machineAssignments: [],
    injection: {
      '3층': [{ schedule: { 월: {
        day: { name: 'DUP', id: 'p_00001' },
        night: { name: 'DUP', id: 'p_00002' },
      } } }],
    },
  };
  const { rows } = DataService.aggregateChemicalRequest(data, { days: ['월'] });
  const byInk = new Map(rows.map(r => [r.ink, r.total]));
  assert.equal(byInk.get('INK-P'), 1);
  assert.equal(byInk.get('INK-L'), 1);
});

test('aggregateChemicalRequest: 미해소 객체 셀은 unmappedProducts에 이름 문자열로 담김', () => {
  const data = {
    products: [],
    machineAssignments: [],
    injection: { '3층': [{ schedule: { 월: { day: { name: 'GHOST', id: 'p_09999' } } } }] },
  };
  const { rows, unmappedProducts } = DataService.aggregateChemicalRequest(data, { days: ['월'] });
  assert.equal(rows.length, 0);
  assert.deepEqual(Array.from(unmappedProducts), ['GHOST']);  // "[object Object]" 금지
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

test('lintMasters: {name,id} 객체 셀 — 등록 제품은 이슈 0건, 크래시 없음 (id-셀 회귀)', () => {
  // 수동 셀 편집·OCR 머지가 저장하는 {name,id} 객체 셀. 이전엔 객체가 그대로 비교돼
  // 전부 product-not-in-master 오탐 + 정렬에서 target.localeCompare TypeError(앱 백지).
  const data = {
    products: [{ id: 'p_00001', name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [{ machine: '10호기', schedule: {
        월: { day: { name: 'KNOWN', id: 'p_00001' }, night: { name: 'KNOWN', id: 'p_00001' } },
        // id가 유효하면 표시 이름이 어긋나 있어도(개명 직후 등) 존재로 인정
        화: { day: { name: 'KNOWN-구명', id: 'p_00001' } },
      } }],
    },
  };
  const r = DataService.lintMasters(data);
  assert.equal(r.issues.filter(i => i.category === 'product-not-in-master').length, 0);
});

test('lintMasters: 미등록 {name,id} 셀은 이름 문자열 target으로 dedup 보고', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [{ machine: '10호기', schedule: {
        월: { day: { name: 'GHOST', id: 'p_09999' }, night: { name: 'GHOST', id: 'p_09999' } },
        화: { day: 'GHOST2', night: { name: 'GHOST2', id: 'p_09998' } },  // 문자열·객체 혼재
      } }],
    },
  };
  const r = DataService.lintMasters(data);   // 이슈 2건 이상이어도 정렬 크래시 없어야 함
  const missing = r.issues.filter(i => i.category === 'product-not-in-master');
  assert.deepEqual(missing.map(i => i.target).sort(), ['GHOST', 'GHOST2']);
  for (const i of missing) assert.equal(typeof i.target, 'string');
});

test('lintMasters: 사출계획 TEST 런 셀은 정합성 점검 제외 (제품 아님)', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [
        // TEST 변형 표기 포함 — 검수 isTest 판정과 동일 기준으로 전부 제외
        { machine: '10호기', schedule: { 월: { day: 'TEST', night: '(TEST)' }, 화: { day: '테스트', night: 'test' } } },
      ],
    },
  };
  const r = DataService.lintMasters(data);
  const missing = r.issues.filter(i => i.category === 'product-not-in-master');
  assert.equal(missing.length, 0);
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

// ── buildMasterHealthBadge (전역 경고 배지 표시 모델) ───────────────────────

test('buildMasterHealthBadge: 결함 없음 → show=false, 정상 tooltip', () => {
  const b = DataService.buildMasterHealthBadge({ bySeverity: { error: 0, warn: 0, info: 0 }, byCategory: {} });
  assert.equal(b.show, false);
  assert.equal(b.errorCount, 0);
  assert.equal(b.tooltip, '마스터 데이터 정상');
});

test('buildMasterHealthBadge: 마스터 누락만 → show=true, tooltip에 건수', () => {
  const b = DataService.buildMasterHealthBadge({
    bySeverity: { error: 2 },
    byCategory: { 'product-not-in-master': 2 },
  });
  assert.equal(b.show, true);
  assert.equal(b.errorCount, 2);
  assert.equal(b.notInMaster, 2);
  assert.equal(b.noInks, 0);
  assert.ok(b.tooltip.includes('마스터에 없는 제품 2건'));
});

test('buildMasterHealthBadge: 누락+잉크빔 복합 → 두 항목 분해 tooltip', () => {
  const b = DataService.buildMasterHealthBadge({
    bySeverity: { error: 3 },
    byCategory: { 'product-not-in-master': 1, 'product-no-inks': 2 },
  });
  assert.equal(b.errorCount, 3);
  assert.equal(b.notInMaster, 1);
  assert.equal(b.noInks, 2);
  assert.equal(b.tooltip, '데이터 점검 필요 — 마스터에 없는 제품 1건 · 잉크 미등록 제품 2건');
});

test('buildMasterHealthBadge: null/undefined 방어 — 예외 없이 show=false', () => {
  const b = DataService.buildMasterHealthBadge(undefined);
  assert.equal(b.show, false);
  assert.equal(b.errorCount, 0);
});

test('buildMasterHealthBadge: lintMasters 결과와 연동되면 errorCount 일치', () => {
  const data = {
    products: [{ name: 'P_empty', inks: [] }],
    machineAssignments: [],
    injection: { '3층': [{ machine: '10호기', schedule: { 월: { day: 'UNK' } } }] },
  };
  const summary = DataService.lintMasters(data).summary;
  const b = DataService.buildMasterHealthBadge(summary);
  assert.equal(b.errorCount, summary.bySeverity.error);  // P_empty + UNK = 2
  assert.equal(b.show, summary.bySeverity.error > 0);
  assert.equal(b.notInMaster, 1);  // UNK
  assert.equal(b.noInks, 1);       // P_empty
});

test('isWeekArchived: 스냅샷 목록에서 해당 주차 존재 여부', () => {
  const snaps = [{ week: '2026-W28' }, { week: '2026-W27' }];
  assert.equal(DataService.isWeekArchived(snaps, '2026-W28'), true);
  assert.equal(DataService.isWeekArchived(snaps, '2026-W26'), false);
  assert.equal(DataService.isWeekArchived(null, '2026-W28'), false);
  assert.equal(DataService.isWeekArchived(snaps, ''), false);
});

// ── buildWeeklyInkSummary / buildInkConsumptionTrend (소비 추세) ─────────────

test('buildWeeklyInkSummary: 잉크별 주간 총소요 압축', () => {
  const data = {
    products: [{ id: 'p_1', name: 'PROD', inks: ['INK1', 'INK2'] }],
    injection: {
      '3층': [{ machine: '10호기', schedule: {
        월: { day: { name: 'PROD', id: 'p_1' }, night: 'PROD' },   // 수요 2
        화: { day: 'PROD' },                                        // 수요 1
      } }],
    },
  };
  const s = DataService.buildWeeklyInkSummary(data);
  assert.deepEqual(s.byInk, { INK1: 3, INK2: 3 });   // 3셀 × 각 잉크
});

test('buildWeeklyInkSummary: 빈/수요없음은 빈 byInk', () => {
  assert.deepEqual(DataService.buildWeeklyInkSummary(null).byInk, {});
  assert.deepEqual(DataService.buildWeeklyInkSummary({ products: [], injection: {} }).byInk, {});
});

test('buildInkConsumptionTrend: 주차 정렬 + 잉크 시계열(합계 desc)', () => {
  const summaries = {
    '2026-W27': { byInk: { INK1: 5, INK2: 2 } },
    '2026-W28': { byInk: { INK1: 3, INK3: 9 } },
    'garbage':  { byInk: { X: 1 } },   // 주차 형식 아님 → 무시
  };
  const t = DataService.buildInkConsumptionTrend(summaries);
  assert.deepEqual(t.weeks, ['2026-W27', '2026-W28']);
  const byInk = new Map(t.inks.map(i => [i.ink, i]));
  assert.deepEqual(byInk.get('INK1').points, [5, 3]);   // 주차순 정렬
  assert.equal(byInk.get('INK1').sum, 8);
  assert.deepEqual(byInk.get('INK3').points, [0, 9]);   // W27엔 없음 → 0
  assert.equal(byInk.get('INK3').activeWeeks, 1);
  assert.deepEqual(t.inks.map(i => i.ink), ['INK3', 'INK1', 'INK2']);  // sum 9,8,2
});

test('buildInkConsumptionTrend: 빈 입력은 빈 결과', () => {
  const t = DataService.buildInkConsumptionTrend({});
  assert.deepEqual(t.weeks, []);
  assert.deepEqual(t.inks, []);
});

// ── buildMasterStats (마스터 현황 인사이트, 경보 아님) ──────────────────────

test('buildMasterStats: null/빈 데이터는 전부 0 (안전)', () => {
  assert.deepEqual(DataService.buildMasterStats(null), {
    products: 0, sameNameGroups: 0, inks: 0, inksUsedInInjection: 0, inksWithoutMachine: 0,
  });
});

test('buildMasterStats: 동명 그룹·실사용·호기 미배정 집계', () => {
  const data = {
    products: [
      { id: 'p_1', name: 'DUP', inks: ['INK-A'] },
      { id: 'p_2', name: 'DUP', inks: ['INK-B'] },   // 동명 그룹 1
      { id: 'p_3', name: 'SOLO', inks: ['INK-A', 'INK-C'] },
    ],
    machineAssignments: [
      { ink: 'INK-A', machine: '10호기' },            // 배정됨
      { ink: 'INK-B', machine: '' },                  // 호기 공란 → 미배정 취급
    ],
    injection: {
      '3층': [{ machine: '10호기', schedule: { 월: { day: { name: 'DUP', id: 'p_1' } } } }],
    },
    inkPlan: [],
  };
  const s = DataService.buildMasterStats(data);
  assert.equal(s.products, 3);
  assert.equal(s.sameNameGroups, 1);                  // 'DUP' 2개
  assert.equal(s.inks, 3);                            // INK-A/B/C
  assert.equal(s.inksUsedInInjection, 1);             // p_1(DUP) → INK-A만 수요
  assert.equal(s.inksWithoutMachine, 2);              // INK-B(공란)·INK-C(무배정), INK-A만 배정
});

// ── buildDashboardSummary (통합 대시보드 요약 모델) ─────────────────────────

test('buildDashboardSummary: data=null 안전 — 카운트 0, tone ok, 예외 없음', () => {
  const s = DataService.buildDashboardSummary(null, []);
  assert.equal(s.master.errorCount, 0);
  assert.equal(s.master.tone, 'ok');
  assert.equal(s.shortage.count, 0);
  assert.equal(s.shortage.tone, 'ok');
  assert.deepEqual(s.shortage.items, []);
  assert.equal(s.masters.products, 0);
  assert.equal(s.masters.inks, 0);
  assert.equal(s.masters.chemicals, 0);
  assert.equal(s.week.dayCount, 0);
});

test('buildDashboardSummary: 마스터 error → tone=bad, errorCount는 buildMasterHealthBadge와 일치(단일 출처)', () => {
  const data = {
    products: [{ name: 'P_empty', inks: [] }],                                        // product-no-inks (error)
    machineAssignments: [],
    injection: { '3층': [{ machine: '10호기', schedule: { 월: { day: 'UNK' } } }] },   // not-in-master (error)
    inkPlan: [], testInks: [], inventory: [],
  };
  const s = DataService.buildDashboardSummary(data, []);
  const mh = DataService.buildMasterHealthBadge(DataService.lintMasters(data).summary);
  assert.equal(s.master.errorCount, mh.errorCount);  // 교차검증: 전역 배지와 동일 값
  assert.equal(s.master.show, mh.show);
  assert.ok(s.master.errorCount > 0);
  assert.equal(s.master.tone, 'bad');
});

test('buildDashboardSummary: 깨끗한 마스터 → tone=ok, show=false', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {}, inkPlan: [], testInks: [], inventory: [],
  };
  const s = DataService.buildDashboardSummary(data, []);
  assert.equal(s.master.tone, 'ok');
  assert.equal(s.master.show, false);
});

test('buildDashboardSummary: shortage는 buildInkShortageBadge와 동일 값(단일 출처 교차검증)', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {}, inkPlan: [], testInks: [], inventory: [],
  };
  const s = DataService.buildDashboardSummary(data, []);
  const sb = DataService.buildInkShortageBadge(data, []);
  assert.equal(s.shortage.count, sb.shortageCount);
  assert.equal(s.shortage.show, sb.show);
  assert.ok(s.shortage.items.length <= 5);  // 상위 5 제한
});

test('buildDashboardSummary: depletion은 buildInkDepletionBadge와 동일 값(단일 출처 교차검증)', () => {
  const data = {
    products: [{ name: 'KNOWN', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {}, inkPlan: [], testInks: [], inventory: [],
  };
  const s = DataService.buildDashboardSummary(data, [], { today: '월' });
  const db = DataService.buildInkDepletionBadge(data, [], '월');
  assert.equal(s.depletion.count, db.depletionCount);
  assert.equal(s.depletion.show, db.show);
  assert.ok(s.depletion.items.length <= 5);
});

test('buildDashboardSummary: masters 규모는 data 필드 length와 일치', () => {
  const data = {
    products: [{ name: 'A' }, { name: 'B' }],
    inkPlan: [{ name: 'I1' }],
    chemicals: [{ code: 'C1' }, { code: 'C2' }, { code: 'C3' }],
    machineAssignments: [], injection: {}, testInks: [], inventory: [],
  };
  const s = DataService.buildDashboardSummary(data, []);
  assert.equal(s.masters.products, 2);
  assert.equal(s.masters.inks, 1);
  assert.equal(s.masters.chemicals, 3);
});

test('buildDashboardSummary: week는 dates/today 반영', () => {
  const dates = ['2026-06-08', '2026-06-09', '2026-06-10'];
  const s = DataService.buildDashboardSummary({}, dates, { today: '월' });
  assert.deepEqual(s.week.dates, dates);
  assert.equal(s.week.dayCount, 3);
  assert.equal(s.week.today, '월');
});

// ── buildInkMaster / isInkInMaster (잉크 cascade 선택) ──────────────────────

test('buildInkMaster: 빈/누락 데이터는 빈 배열', () => {
  assert.deepEqual(DataService.buildInkMaster({}), []);
  assert.deepEqual(DataService.buildInkMaster(undefined), []);
  assert.deepEqual(DataService.buildInkMaster({ products: [], machineAssignments: [], inkPlan: [] }), []);
});

test('buildInkMaster: machineAssignments+inkPlan+products.inks 합집합 dedup', () => {
  const data = {
    machineAssignments: [{ ink: 'A_INK' }, { ink: 'B_INK' }],
    inkPlan: [{ name: 'B_INK' }, { name: 'C_INK' }],
    products: [{ inks: ['C_INK', 'D_INK', null] }],
  };
  assert.deepEqual(DataService.buildInkMaster(data), ['A_INK', 'B_INK', 'C_INK', 'D_INK']);
});

test('buildInkMaster: 정규화(대소문자/공백) dedup — 첫 발견 원형 유지', () => {
  const data = {
    machineAssignments: [{ ink: 'Red Ink' }],
    inkPlan: [{ name: ' red ink ' }, { name: 'RED INK' }],
    products: [{ inks: ['red ink'] }],
  };
  assert.deepEqual(DataService.buildInkMaster(data), ['Red Ink']);
});

test('buildInkMaster: 정렬된 결과 반환', () => {
  const data = { inkPlan: [{ name: 'Z' }, { name: 'A' }, { name: 'M' }] };
  assert.deepEqual(DataService.buildInkMaster(data), ['A', 'M', 'Z']);
});

test('buildInkMaster: assignment ink 추출 우선순위 (ink > product > name)', () => {
  const data = {
    machineAssignments: [
      { ink: 'BY_INK', product: 'X', name: 'Y' },
      { product: 'BY_PRODUCT', name: 'Y' },
      { name: 'BY_NAME' },
    ],
  };
  assert.deepEqual(DataService.buildInkMaster(data), ['BY_INK', 'BY_NAME', 'BY_PRODUCT']);
});

test('buildInkMaster: null/빈 잉크 슬롯 무시', () => {
  const data = { products: [{ inks: [null, '', '  ', 'OK'] }] };
  assert.deepEqual(DataService.buildInkMaster(data), ['OK']);
});

test('isInkInMaster: 정규화 매칭 / 미존재 / 빈 입력', () => {
  const master = ['Red Ink', 'Blue'];
  assert.equal(DataService.isInkInMaster('red ink', master), true);
  assert.equal(DataService.isInkInMaster('  RED INK ', master), true);
  assert.equal(DataService.isInkInMaster('Green', master), false);
  assert.equal(DataService.isInkInMaster('', master), false);
  assert.equal(DataService.isInkInMaster(null, master), false);
  assert.equal(DataService.isInkInMaster('Blue', []), false);
});

// ── CascadePicker 파생 순수 함수 (ui.jsx 위임 로직) ─────────────────────────

test('buildCascadeBrands: brand 있는 제품만 dedup + 정렬', () => {
  const products = [
    { name: 'p1', brand: 'PIA' },
    { name: 'p2', brand: 'AQUA' },
    { name: 'p3', brand: 'PIA' },   // 중복 브랜드
    { name: 'p4' },                  // brand 없음 → 제외
    { name: 'p5', brand: '' },       // 빈 brand → 제외
  ];
  assert.deepEqual(DataService.buildCascadeBrands(products), ['AQUA', 'PIA']);
});

test('buildCascadeBrands: 빈/누락 입력은 빈 배열', () => {
  assert.deepEqual(DataService.buildCascadeBrands([]), []);
  assert.deepEqual(DataService.buildCascadeBrands(undefined), []);
  assert.deepEqual(DataService.buildCascadeBrands([null, { name: 'x' }]), []);
});

test('cascadeProductsInBrand: brand 매칭 / 빈·미존재 brand는 빈 배열', () => {
  const products = [
    { name: 'p1', brand: 'PIA' },
    { name: 'p2', brand: 'AQUA' },
    { name: 'p3', brand: 'PIA' },
  ];
  assert.deepEqual(DataService.cascadeProductsInBrand(products, 'PIA').map(p => p.name), ['p1', 'p3']);
  assert.deepEqual(DataService.cascadeProductsInBrand(products, ''), []);
  assert.deepEqual(DataService.cascadeProductsInBrand(products, 'NONE'), []);
  assert.deepEqual(DataService.cascadeProductsInBrand(undefined, 'PIA'), []);
});

test('cascadeInksInProduct: 제품 잉크 truthy 필터 / 빈·미존재 name은 빈 배열', () => {
  const products = [
    { name: 'p1', inks: ['1도', null, '2도', '', '3도'] },
    { name: 'p2', inks: [] },
    { name: 'p3' },
  ];
  assert.deepEqual(DataService.cascadeInksInProduct(products, 'p1'), ['1도', '2도', '3도']);
  assert.deepEqual(DataService.cascadeInksInProduct(products, 'p2'), []);
  assert.deepEqual(DataService.cascadeInksInProduct(products, 'p3'), []);
  assert.deepEqual(DataService.cascadeInksInProduct(products, ''), []);
  assert.deepEqual(DataService.cascadeInksInProduct(products, 'NONE'), []);
});

test('filterByQuery: 대소문자/공백 무시 부분일치, 빈 query는 원본', () => {
  const items = [{ name: 'Red Ink' }, { name: 'Blue' }, { name: 'redder' }];
  assert.deepEqual(DataService.filterByQuery(items, '  RED ', p => p.name).map(p => p.name), ['Red Ink', 'redder']);
  assert.deepEqual(DataService.filterByQuery(items, '', p => p.name), items);
  assert.deepEqual(DataService.filterByQuery(['A', 'b', 'C'], 'c', x => x), ['C']);
  assert.deepEqual(DataService.filterByQuery(undefined, 'x', x => x), []);
});

// ── R3-2 도메인 상수 단일화 (요일/교대) ─────────────────────────────────────
test('도메인 상수: 값·순서·동결(Object.freeze) 정합성', () => {
  assert.deepEqual(DataService.WEEKDAYS, ['월', '화', '수', '목', '금', '토', '일']);
  assert.deepEqual(DataService.WEEKDAYS_PLUS, ['월', '화', '수', '목', '금', '토', '일', '차주월']);
  // WEEKDAYS_PLUS = WEEKDAYS + 차주월
  assert.deepEqual(DataService.WEEKDAYS_PLUS, [...DataService.WEEKDAYS, '차주월']);
  // DAY_BY_IDX 는 Date.getDay() 인덱스순(0=일)
  assert.deepEqual(DataService.DAY_BY_IDX, ['일', '월', '화', '수', '목', '금', '토']);
  assert.deepEqual(DataService.SHIFTS, ['day', 'night']);
  // 단일 출처 보장 — 모두 동결(공유 변형 사고 방지)
  assert.equal(Object.isFrozen(DataService.WEEKDAYS), true);
  assert.equal(Object.isFrozen(DataService.WEEKDAYS_PLUS), true);
  assert.equal(Object.isFrozen(DataService.DAY_BY_IDX), true);
  assert.equal(Object.isFrozen(DataService.SHIFTS), true);
});

test('dayFromDate 가 DAY_BY_IDX 상수와 일관 (요일 단일 출처 사용)', () => {
  // 2026-06-01 = 월요일
  assert.equal(DataService.dayFromDate('2026-06-01'), '월');
  // 2026-06-07 = 일요일
  assert.equal(DataService.dayFromDate('2026-06-07'), '일');
  assert.equal(DataService.dayFromDate('bad-input', '화'), '화');
});

// ── R3-3 normalizeInkName 단일화 ────────────────────────────────────────────
test('normalizeInkName: trim + lowercase + null-safe', () => {
  assert.equal(DataService.normalizeInkName('Red Ink'), 'red ink');
  assert.equal(DataService.normalizeInkName('  BLUE  '), 'blue');
  assert.equal(DataService.normalizeInkName(null), '');
  assert.equal(DataService.normalizeInkName(undefined), '');
  assert.equal(DataService.normalizeInkName(''), '');
  assert.equal(DataService.normalizeInkName(123), '123');
});

test('isInkInMaster 가 normalizeInkName 기준으로 일관 매칭', () => {
  const master = ['Red Ink', '파랑'];
  // 두 입력의 정규화가 같으면 동일 판정
  assert.equal(DataService.isInkInMaster('  red INK ', master), DataService.isInkInMaster('red ink', master));
  assert.equal(DataService.isInkInMaster('red ink', master), true);
  assert.equal(DataService.isInkInMaster('없는잉크', master), false);
});

// ── 재고 부족 예상 전역 알림 (inventory-shortage-alert) ──────────────────────
const mkCb = (entries) => new Map(entries.map(([name, wn]) => [name, new Map([['월', { weeklyNeed: wn, stockReal: true }]])]));

test('collectInkShortage: 부족 없음(weeklyNeed>=0/null만) → show:false', () => {
  const merged = [{ name: 'A' }, { name: 'B' }];
  const cb = mkCb([['A', 3], ['B', null]]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.equal(r.show, false);
  assert.equal(r.shortageCount, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.tooltip, '재고 정상');
});

test('collectInkShortage: 부족 1건 → 해당 잉크 수집', () => {
  const merged = [{ name: 'A' }, { name: 'B' }];
  const cb = mkCb([['A', -2], ['B', 5]]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.equal(r.show, true);
  assert.equal(r.shortageCount, 1);
  assert.equal(r.items[0].ink, 'A');
  assert.equal(r.items[0].weeklyNeed, -2);
});

test('collectInkShortage: 다건은 가장 부족한 순(weeklyNeed 오름차순) 정렬', () => {
  const merged = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const cb = mkCb([['A', -1], ['B', -9], ['C', -4]]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.deepEqual(r.items.map(i => i.ink), ['B', 'C', 'A']);
});

test('collectInkShortage: weeklyNeed null(현재고 미입력)은 제외', () => {
  const merged = [{ name: 'A' }, { name: 'B' }];
  const cb = mkCb([['A', null], ['B', -1]]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.equal(r.shortageCount, 1);
  assert.equal(r.items[0].ink, 'B');
});

test('collectInkShortage: 3건 초과 tooltip 상위 3개 + "외" 접미사', () => {
  const merged = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
  const cb = mkCb([['A', -5], ['B', -4], ['C', -3], ['D', -2]]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.equal(r.shortageCount, 4);
  assert.match(r.tooltip, /재고 부족 임박 4건/);
  assert.match(r.tooltip, /A · B · C 외$/);
});

test('collectInkShortage: 재고 미조사(stockReal=false)는 제외 — 0가정 오탐 방지', () => {
  const merged = [{ name: 'A' }, { name: 'B' }];
  const cb = new Map([
    ['A', new Map([['월', { weeklyNeed: -6, stockReal: false }]])], // 미조사(0가정) → 제외
    ['B', new Map([['월', { weeklyNeed: -2, stockReal: true }]])],  // 실재고 부족 → 포함
  ]);
  const r = DataService.collectInkShortage(merged, cb);
  assert.equal(r.shortageCount, 1);
  assert.equal(r.items[0].ink, 'B');
});

test('collectInkDepletionRisks: 재고 미조사(stockReal=false)는 제외', () => {
  const merged = [{ name: 'A' }, { name: 'B' }];
  const metrics = new Map([
    ['A', new Map([['월', { availableDays: 0, stock: 0, required: 2, stockReal: false }]])],
    ['B', new Map([['월', { availableDays: 1, stock: 2, required: 2, stockReal: true }]])],
  ]);
  const r = DataService.collectInkDepletionRisks(merged, metrics, ['월'], '월', 3);
  assert.equal(r.depletionCount, 1);
  assert.equal(r.items[0].ink, 'B');
});

// ── availableDays 기반 잉크 소진 임박 알림 ─────────────────────────────────
const mkDepletionMetrics = (entries) => new Map(entries.map(([name, values]) => [
  name,
  new Map(Object.entries(values).map(([day, availableDays]) => [
    day,
    { availableDays, stock: availableDays == null ? null : availableDays * 2, required: 2, stockReal: true },
  ])),
]));

test('collectInkDepletionRisks: 3일 경계 포함, 초과/null 제외', () => {
  const merged = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const metrics = mkDepletionMetrics([
    ['A', { 월: 3 }],
    ['B', { 월: 3.1 }],
    ['C', { 월: null }],
  ]);
  const result = DataService.collectInkDepletionRisks(merged, metrics, ['월', '화'], '월', 3);
  assert.deepEqual(result.items.map(item => item.ink), ['A']);
  assert.equal(result.items[0].availableDays, 3);
});

test('collectInkDepletionRisks: 오늘 이전 제외, 잉크별 첫 위험 요일만 수집', () => {
  const merged = [{ name: 'A' }];
  const metrics = mkDepletionMetrics([['A', { 월: 0.5, 화: 2, 수: 1 }]]);
  const result = DataService.collectInkDepletionRisks(merged, metrics, ['월', '화', '수'], '화');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].day, '화');
  assert.equal(result.items[0].availableDays, 2);
});

test('collectInkDepletionRisks: 잔여일, 요일, 잉크명 순으로 안정 정렬', () => {
  const merged = [{ name: 'C' }, { name: 'B' }, { name: 'A' }];
  const metrics = mkDepletionMetrics([
    ['A', { 월: 2 }],
    ['B', { 화: 1 }],
    ['C', { 월: 1 }],
  ]);
  const result = DataService.collectInkDepletionRisks(merged, metrics, ['월', '화'], '월');
  assert.deepEqual(result.items.map(item => item.ink), ['C', 'B', 'A']);
  assert.equal(result.urgentCount, 2);
  assert.equal(result.show, true);
});

test('collectInkDepletionRisks: 위험 없음은 빈 정상 모델', () => {
  const metrics = mkDepletionMetrics([['A', { 월: 4 }]]);
  const result = DataService.collectInkDepletionRisks([{ name: 'A' }], metrics, ['월'], '월');
  assert.equal(result.show, false);
  assert.equal(result.depletionCount, 0);
  assert.equal(result.tooltip, '소진 임박 없음');
});

test('collectInkDepletionRisks: threshold null/빈문자열은 기본 3일 (0으로 오인 금지)', () => {
  // Number(null)===0 이라 finite 검사만으로는 null이 임계 0으로 강등돼 warn 경고가 전멸.
  const merged = [{ name: 'A' }];
  const metrics = mkDepletionMetrics([['A', { 월: 2 }]]);
  assert.equal(DataService.collectInkDepletionRisks(merged, metrics, ['월'], '월', null).depletionCount, 1);
  assert.equal(DataService.collectInkDepletionRisks(merged, metrics, ['월'], '월', '').depletionCount, 1);
  // 명시적 0은 존중 (가용 2 > 0 → 제외)
  assert.equal(DataService.collectInkDepletionRisks(merged, metrics, ['월'], '월', 0).depletionCount, 0);
});

// ── buildInkPlanningAlerts (파이프라인 합성 — 실데이터) ─────────────────────

test('buildInkPlanningAlerts: 실데이터 합성 — 사출 수요+수동 재고로 부족·소진 동시 산출', () => {
  const data = {
    products: [{ id: 'p_00001', name: 'PROD', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [{ machine: '10호기', schedule: {
        월: { day: { name: 'PROD', id: 'p_00001' }, night: 'PROD' },  // 수요 2 (id 셀·레거시 혼재)
        화: { day: 'PROD' },
        수: { day: 'PROD' },
        목: { day: 'PROD' },
      } }],
    },
    inkPlan: [{ name: 'INK1', days: { 월: { 현재고: 4 } } }],
    testInks: [],
    inventory: null,
  };
  const alerts = DataService.buildInkPlanningAlerts(data, {}, '월');
  // 주간 부족: 월 현재고 4 − 총소요 5(월2+화1+수1+목1) = −1
  assert.equal(alerts.shortage.shortageCount, 1);
  assert.equal(alerts.shortage.items[0].ink, 'INK1');
  assert.equal(alerts.shortage.items[0].weeklyNeed, -1);
  // 소진 임박: 월 가용일 = 4/2 = 2.0 ≤ 3 → warn
  assert.equal(alerts.depletion.depletionCount, 1);
  assert.deepEqual(alerts.depletion.items[0], {
    ink: 'INK1', day: '월', availableDays: 2, stock: 4, required: 2, tone: 'warn',
  });
});

test('buildInkPlanningAlerts: 제조 후 회복 — 오늘 이후 잔여일이 회복되면 소진 경고 없음', () => {
  const mkData = (manufacture) => ({
    products: [{ id: 'p_00001', name: 'PROD', inks: ['INK1'] }],
    machineAssignments: [{ ink: 'INK1', machine: '10호기', code: 'C1' }],
    injection: {
      '3층': [{ machine: '10호기', schedule: {
        월: { day: 'PROD' }, 화: { day: 'PROD' }, 수: { day: 'PROD' },
      } }],
    },
    inkPlan: [{ name: 'INK1', days: { 월: { 현재고: 1, 제조량: manufacture } } }],
    testInks: [],
  });
  // 월 제조 5 → 화 carry 5·수 carry 4 — 오늘(화) 이후 가용일 회복, 경고 없음
  const recovered = DataService.buildInkPlanningAlerts(mkData(5), {}, '화');
  assert.equal(recovered.depletion.depletionCount, 0);
  // 제조 없으면 화 carry 0 → 가용 0일 — bad 경고
  const depleted = DataService.buildInkPlanningAlerts(mkData(null), {}, '화');
  assert.equal(depleted.depletion.depletionCount, 1);
  assert.equal(depleted.depletion.items[0].day, '화');
  assert.equal(depleted.depletion.items[0].tone, 'bad');
});

// ── buildChemicalRequestMeta (약품요청서 인쇄 메타) ───────────────────────────
const CR_TOTALS = { kinds: 3, total: 42, f3: 30, f1: 12, noCode: 1 };

test('buildChemicalRequestMeta: 정상 작성자·문서번호·요약', () => {
  const m = DataService.buildChemicalRequestMeta(CR_TOTALS, '이번주(월~일) · 주/야 · 3F+1F', '홍길동 (구매팀)', '2026-06-08');
  assert.equal(m.title, '잉크 발주 요청서');
  assert.equal(m.requesterName, '홍길동 (구매팀)');
  assert.equal(m.docNo, '약품-20260608');
  assert.equal(m.summary, '총 잉크 3종 / 총 세트 42 (3F 30 · 1F 12)');
  assert.equal(m.noCode, 1);
  assert.deepEqual(m.approvals, ['작성', '검토', '승인']);
});

test('buildChemicalRequestMeta: 빈/공백/누락 작성자 → 생산관리팀 fallback', () => {
  for (const v of ['', '   ', undefined, null]) {
    assert.equal(DataService.buildChemicalRequestMeta(CR_TOTALS, 'x', v, '2026-06-08').requesterName, '생산관리팀');
  }
});

test('buildChemicalRequestMeta: todayISO 누락 → 약품-미상', () => {
  assert.equal(DataService.buildChemicalRequestMeta(CR_TOTALS, 'x', '김선명', '').docNo, '약품-미상');
  assert.equal(DataService.buildChemicalRequestMeta(CR_TOTALS, 'x', '김선명', undefined).docNo, '약품-미상');
});

test('buildChemicalRequestMeta: totals=null → 0 안전 처리', () => {
  const m = DataService.buildChemicalRequestMeta(null, null, '김선명', '2026-06-08');
  assert.equal(m.summary, '총 잉크 0종 / 총 세트 0 (3F 0 · 1F 0)');
  assert.equal(m.noCode, 0);
  assert.equal(m.rangeLabel, '없음');
});

test('buildChemicalRequestMeta: rangeLabel 그대로 전달', () => {
  const m = DataService.buildChemicalRequestMeta(CR_TOTALS, '오늘(화요일) · 야간 · 3F만', '김선명', '2026-06-08');
  assert.equal(m.rangeLabel, '오늘(화요일) · 야간 · 3F만');
});

// ── 다중 탭 동시편집 가드 (concurrent-edit-guard) ──────────────────────────────
test('stableEqual: 키 순서 무관 동일, 내용 변경 감지', () => {
  assert.equal(DataService.stableEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }), true);
  assert.equal(DataService.stableEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(DataService.stableEqual([1, 2], [1, 2]), true);
  assert.equal(DataService.stableEqual(null, null), true);
});

test('resolveConcurrentEdit: local==server → identical', () => {
  const r = DataService.resolveConcurrentEdit({ products: [1] }, { products: [2] }, { products: [2] });
  assert.equal(r.status, 'identical');
  assert.deepEqual(r.conflictKeys, []);
});

test('resolveConcurrentEdit: 서로 다른 섹션 편집 → merged(무손실 자동 병합)', () => {
  const base = { products: [1], inkPlan: ['a'] };
  const local = { products: [1, 2], inkPlan: ['a'] };      // 내가 products 변경
  const server = { products: [1], inkPlan: ['a', 'b'] };   // 다른 탭이 inkPlan 변경
  const r = DataService.resolveConcurrentEdit(base, local, server);
  assert.equal(r.status, 'merged');
  assert.deepEqual(r.conflictKeys, []);
  assert.deepEqual(r.data.products, [1, 2]);     // 내 변경 유지
  assert.deepEqual(r.data.inkPlan, ['a', 'b']);  // 서버 변경 흡수
});

test('resolveConcurrentEdit: 같은 섹션 양쪽 변경 → conflict', () => {
  const base = { products: [1] };
  const local = { products: [1, 2] };
  const server = { products: [1, 3] };
  const r = DataService.resolveConcurrentEdit(base, local, server);
  assert.equal(r.status, 'conflict');
  assert.deepEqual(r.conflictKeys, ['products']);
});

test('resolveConcurrentEdit: base/local/server null-safe', () => {
  const r = DataService.resolveConcurrentEdit(null, { products: [1] }, {});
  assert.equal(r.status, 'merged');
  assert.deepEqual(r.data.products, [1]);
});

// History snapshot diff
const compareHistory = (base, current) => DataService.compareHistoryRows(
  base,
  current,
  ['floor', 'machine', 'day', 'shift'],
  ['value'],
);

test('compareHistoryRows: identical rows are unchanged', () => {
  const row = { floor: '3F', machine: '1', day: 'Mon', shift: 'day', value: 'P1' };
  const result = compareHistory([row], [{ ...row }]);
  assert.equal(result.rows[0]._change, 'unchanged');
  assert.deepEqual(result.summary, { added: 0, changed: 0, removed: 0, unchanged: 1, totalChanges: 0 });
});

test('compareHistoryRows: current-only rows are added', () => {
  const row = { floor: '3F', machine: '1', day: 'Mon', shift: 'day', value: 'P1' };
  const result = compareHistory([], [row]);
  assert.equal(result.rows[0]._change, 'added');
  assert.equal(result.summary.added, 1);
  assert.equal(result.rows[0]._changeDetail, '현재 데이터에 추가');
});

test('compareHistoryRows: backup-only rows are removed', () => {
  const row = { floor: '3F', machine: '1', day: 'Mon', shift: 'day', value: 'P1' };
  const result = compareHistory([row], []);
  assert.equal(result.rows[0]._change, 'removed');
  assert.equal(result.summary.removed, 1);
  assert.deepEqual(result.rows[0]._before, row);
});

test('compareHistoryRows: changed values preserve before and after', () => {
  const before = { floor: '3F', machine: '1', day: 'Mon', shift: 'day', value: 'P1' };
  const after = { ...before, value: 'P2' };
  const result = compareHistory([before], [after]);
  assert.equal(result.rows[0]._change, 'changed');
  assert.equal(result.rows[0]._changeDetail, 'P1 -> P2');
  assert.equal(result.rows[0]._before.value, 'P1');
  assert.equal(result.rows[0]._after.value, 'P2');
});

test('compareHistoryRows: input order and null inputs are safe', () => {
  const a = { floor: '3F', machine: '1', day: 'Mon', shift: 'day', value: 'P1' };
  const b = { floor: '1F', machine: '2', day: 'Tue', shift: 'night', value: 'P2' };
  const result = compareHistory([a, b], [b, a]);
  assert.equal(result.summary.unchanged, 2);
  assert.deepEqual(DataService.compareHistoryRows(null, undefined, ['id'], ['value']), {
    rows: [],
    summary: { added: 0, changed: 0, removed: 0, unchanged: 0, totalChanges: 0 },
  });
});

// ── 변경 감사 로그(audit-trail) 표시 헬퍼 ───────────────────────────────────

test('parseAuditField parses injection field into floor/machine + day/shift', () => {
  assert.deepEqual(DataService.parseAuditField('injection·3층·10호기·월·day'), {
    kind: 'injection',
    kindLabel: '사출계획',
    target: '3층 10호기',
    detail: '월/주간',
  });
});

test('parseAuditField labels products and machineAssignments', () => {
  assert.equal(DataService.parseAuditField('products·PIA블루').kindLabel, '제품 마스터');
  assert.equal(DataService.parseAuditField('products·PIA블루').target, 'PIA블루');
  assert.equal(DataService.parseAuditField('machineAssignments·i1').kindLabel, '잉크 배정');
});

test('auditChangeKind distinguishes added / removed / changed', () => {
  assert.equal(DataService.auditChangeKind('', 'X'), 'added');
  assert.equal(DataService.auditChangeKind(null, 'X'), 'added');
  assert.equal(DataService.auditChangeKind('X', ''), 'removed');
  assert.equal(DataService.auditChangeKind('X', null), 'removed');
  assert.equal(DataService.auditChangeKind('X', 'Y'), 'changed');
});

test('summarizeAuditEntries counts by kind and source', () => {
  const entries = [
    { field: 'injection·3층·10호기·월·day', source: 'injection' },
    { field: 'injection·3층·11호기·월·day', source: 'injection' },
    { field: 'products·A', source: 'products' },
    { field: 'machineAssignments·i1', source: 'machines' },
  ];
  const s = DataService.summarizeAuditEntries(entries);
  assert.equal(s.total, 4);
  assert.equal(s.byKind.injection, 2);
  assert.equal(s.byKind.products, 1);
  assert.equal(s.byKind.machineAssignments, 1);
  assert.equal(s.bySource.injection, 2);
});

test('summarizeAuditEntries is null-safe', () => {
  assert.deepEqual(DataService.summarizeAuditEntries(null), { total: 0, byKind: {}, bySource: {} });
});
