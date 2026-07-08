const assert = require('node:assert/strict');
const test = require('node:test');

const DataService = require('../data-service.js');
const fs = require('node:fs');
const path = require('node:path');

test('builds a three-day window from today forward', () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  assert.deepEqual(DataService.getVisibleWeekdays(days, 'Mon', '3days'), ['Mon', 'Tue', 'Wed']);
  assert.deepEqual(DataService.getVisibleWeekdays(days, 'Thu', '3days'), ['Thu', 'Fri', 'Sat']);
  assert.deepEqual(DataService.getVisibleWeekdays(days, 'Sun', '3days'), ['Sun']);
  assert.deepEqual(DataService.getVisibleWeekdays(days, 'Thu', '7days'), days);
});

test('upserts and removes machine assignments by ink name', () => {
  const assignments = [
    { ink: 'A', machine: '10' },
    { ink: 'B', machine: '20' },
  ];

  assert.deepEqual(DataService.updateMachineAssignment(assignments, 'A', '11'), [
    { ink: 'A', machine: '11' },
    { ink: 'B', machine: '20' },
  ]);
  assert.deepEqual(DataService.updateMachineAssignment(assignments, 'C', '30'), [
    { ink: 'A', machine: '10' },
    { ink: 'B', machine: '20' },
    { ink: 'C', machine: '30' },
  ]);
  assert.deepEqual(DataService.updateMachineAssignment(assignments, 'A', ''), [
    { ink: 'B', machine: '20' },
  ]);
});

test('generates lot numbers by ink, date, and same-day sequence', () => {
  const lots = [
    { ink: 'SHADOW', lotNo: 'SHAD051301', registeredDate: '2026-05-13' },
    { ink: 'SHADOW', lotNo: 'SHAD051302', registeredDate: '2026-05-13' },
    { ink: 'SHADOW', lotNo: 'SHAD051201', registeredDate: '2026-05-12' },
    { ink: 'SOUL', lotNo: 'SOUL051301', registeredDate: '2026-05-13' },
  ];

  assert.equal(DataService.nextInventoryLotNo('SHADOW', '2026-05-13', lots), 'SHAD051303');
  assert.equal(DataService.nextInventoryLotNo('SHADOW', '2026-05-14', lots), 'SHAD051401');
  assert.equal(DataService.nextInventoryLotNo('SOUL', '2026-05-13', lots), 'SOUL051302');
  assert.equal(DataService.nextInventoryLotNo('SHADOW', '2026-05-13', lots.filter(l => l.lotNo !== 'SHAD051302')), 'SHAD051302');
});

test('removes a lot and all stock entries for that lot', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'A', lotNo: 'A051301', registeredDate: '2026-05-13' },
      { id: 'L2', ink: 'A', lotNo: 'A051302', registeredDate: '2026-05-13' },
    ],
    daily: {
      '2026-05-13': { L1: 3, L2: 4 },
      '2026-05-14': { L1: 2 },
    },
  };

  assert.deepEqual(DataService.removeInventoryLot(inv, 'L1'), {
    lots: [
      { id: 'L2', ink: 'A', lotNo: 'A051302', registeredDate: '2026-05-13' },
    ],
    daily: {
      '2026-05-13': { L2: 4 },
      '2026-05-14': {},
    },
  });
});

test('removes all inventory lots and stock entries for an ink', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'A', lotNo: 'A051001' },
      { id: 'L2', ink: 'A', lotNo: 'A051402' },
      { id: 'L3', ink: 'B', lotNo: 'B051001' },
    ],
    daily: {
      '2026-05-13': { L1: 3, L3: 9 },
      '2026-05-14': { L2: 4, L3: 8 },
    },
  };

  assert.deepEqual(DataService.removeInventoryInk(inv, 'A'), {
    lots: [
      { id: 'L3', ink: 'B', lotNo: 'B051001' },
    ],
    daily: {
      '2026-05-13': { L3: 9 },
      '2026-05-14': { L3: 8 },
    },
  });
});

test('keeps initial lot and resolves actual lot from relabel priority', () => {
  const lots = [
    { id: 'L1', ink: 'A', lotNo: 'A051001', role: 'initial', order: 1 },
    { id: 'L2', ink: 'A', lotNo: 'A051402', role: 'relabel', registeredDate: '2026-05-14', order: 2 },
    { id: 'L3', ink: 'A', lotNo: 'A051403', role: 'relabel', registeredDate: '2026-05-14', order: 3 },
    { id: 'L4', ink: 'B', lotNo: 'B051001', registeredDate: '2026-05-10', order: 1 },
  ];

  assert.equal(DataService.initialInventoryLot(lots, 'A').lotNo, 'A051001');
  assert.equal(DataService.actualInventoryLot(lots, 'A', '2026-05-14').lotNo, 'A051403');
  assert.equal(DataService.actualInventoryLot(lots, 'B', '2026-05-14').lotNo, 'B051001');
});

test('relabels using next available second or third lot without replacing initial lot', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'SHADOW', lotNo: 'SHAD051001', role: 'initial', order: 1 },
    ],
    daily: {},
  };

  const once = DataService.relabelInventoryLot(inv, 'SHADOW', '2026-05-14', () => 'R1');
  assert.deepEqual(once.lots.map(l => ({ id: l.id, lotNo: l.lotNo, role: l.role, order: l.order })), [
    { id: 'L1', lotNo: 'SHAD051001', role: 'initial', order: 1 },
    { id: 'R1', lotNo: 'SHAD051402', role: 'relabel', order: 2 },
  ]);
  assert.deepEqual(once.daily, { '2026-05-14': {} });

  const twice = DataService.relabelInventoryLot(once, 'SHADOW', '2026-05-14', () => 'R2');
  assert.equal(DataService.actualInventoryLot(twice.lots, 'SHADOW', '2026-05-14').lotNo, 'SHAD051403');
  assert.equal(DataService.initialInventoryLot(twice.lots, 'SHADOW').lotNo, 'SHAD051001');
});

test('keeps separate production lots for the same ink as separate initial rows', () => {
  const lots = [
    { id: 'L1', ink: 'SOUL', lotNo: 'SOUL051501', registeredDate: '2026-05-15', role: 'initial', order: 1 },
    { id: 'L2', ink: 'SOUL', lotNo: 'SOUL051701', registeredDate: '2026-05-17', role: 'initial', order: 1 },
  ];

  assert.deepEqual(DataService.initialInventoryLots(lots, 'SOUL').map(l => l.lotNo), [
    'SOUL051501',
    'SOUL051701',
  ]);
  assert.deepEqual(DataService.relabelLotsForInitial(lots, lots[0]), []);
});

test('weekly snapshot: history page is wired to close + list + read APIs', () => {
  const history = fs.readFileSync(path.join(__dirname, '..', 'pages', 'history.jsx'), 'utf8');
  // 생산(마감) + 소비(목록·읽기) 경로가 모두 배선됐는지
  assert.match(history, /closeWeek/);
  assert.match(history, /'\/api\/snapshot'|"\/api\/snapshot"/);      // POST 적재
  assert.match(history, /\/api\/snapshots/);                          // 목록
  assert.match(history, /\/api\/snapshot\?week=/);                    // 주차 읽기
  assert.match(history, /isWeekLabel/);                               // 주차 라벨 분기
  assert.match(history, /getWeekInfo\(\)\.isoLabel/);                 // 현재 주차 라벨
  assert.match(history, /isWeekArchived/);                            // 이번 주 마감 상태 표시
  assert.match(history, /buildWeeklyInkSummary/);                      // 마감 시 소비 요약 적재
  assert.match(history, /\/api\/snapshot-summaries/);                 // 추세 로드
  assert.match(history, /buildInkConsumptionTrend/);                   // 추세 계산
});

test('review page shows source request image for verification', () => {
  const review = fs.readFileSync(path.join(__dirname, '..', 'pages', 'review.jsx'), 'utf8');
  assert.match(review, /ReviewSourceImage/);              // 원본 이미지 패널 컴포넌트
  assert.match(review, /ocrResult\.sourceImageUrl/);      // data URL 소스 배선
  assert.match(review, /showImage/);                       // 표시 토글
});

test('depletion alert is wired to global navigation and dashboard', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.jsx'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard.jsx'), 'utf8');
  assert.match(app, /buildInkPlanningAlerts/);
  // bell/사이드바는 부족+소진 union 카운트(같은 잉크 이중 카운트 방지)로 배선됨
  assert.match(app, /riskInkCount/);
  assert.match(app, /inkDepletion\.items/);
  assert.match(dashboard, /title="잉크 소진 임박"/);
  assert.match(dashboard, /availableDays/);
});

test('dashboard nudges to close the week when this week is not archived', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard.jsx'), 'utf8');
  assert.match(dashboard, /\/api\/snapshots/);          // 마감 여부 조회
  assert.match(dashboard, /isWeekArchived/);            // 판정
  assert.match(dashboard, /weekClosed/);                // 미마감 시에만 넛지
  assert.match(dashboard, /setView\('history'\)/);      // 마감하러 이동
});

test('relabel belongs only to its original lot row', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'SOUL', lotNo: 'SOUL051501', registeredDate: '2026-05-15', role: 'initial', order: 1 },
      { id: 'L2', ink: 'SOUL', lotNo: 'SOUL051701', registeredDate: '2026-05-17', role: 'initial', order: 1 },
    ],
    daily: {},
  };

  const next = DataService.relabelInventoryLot(inv, 'L1', '2026-05-17', () => 'R1');
  assert.equal(DataService.actualInventoryLotForInitial(next.lots, next.lots[0], '2026-05-16').lotNo, 'SOUL051501');
  assert.equal(DataService.actualInventoryLotForInitial(next.lots, next.lots[0], '2026-05-17').lotNo, 'SOUL051702');
  assert.equal(DataService.actualInventoryLotForInitial(next.lots, next.lots[1], '2026-05-17').lotNo, 'SOUL051701');
});

// ── 재고 lot 변형 엣지케이스 (happy-path 보완) ─────────────────────────────

test('removeInventoryLot: 부모 lot 삭제 시 relabel 자식 lot까지 cascade 제거', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'A', lotNo: 'A051301', role: 'initial', order: 1 },
      { id: 'R1', ink: 'A', lotNo: 'A051402', role: 'relabel', order: 2, parentId: 'L1' },
      { id: 'L2', ink: 'B', lotNo: 'B051301', role: 'initial', order: 1 },
    ],
    daily: {
      '2026-05-14': { L1: 3, R1: 5, L2: 9 },
    },
  };

  const next = DataService.removeInventoryLot(inv, 'L1');
  assert.deepEqual(next.lots.map(l => l.id), ['L2']);
  assert.deepEqual(next.daily, { '2026-05-14': { L2: 9 } });
});

test('removeInventoryLot: order 배열에서도 제거 id를 정리해 보존', () => {
  const inv = {
    lots: [
      { id: 'L1', ink: 'A', lotNo: 'A051301' },
      { id: 'R1', ink: 'A', lotNo: 'A051402', parentId: 'L1' },
      { id: 'L2', ink: 'B', lotNo: 'B051301' },
    ],
    daily: {},
    order: ['L2', 'L1', 'R1'],
  };

  assert.deepEqual(DataService.removeInventoryLot(inv, 'L1').order, ['L2']);
});

test('removeInventoryLot: 미존재 lotId는 변동 없음(idempotent)', () => {
  const inv = {
    lots: [{ id: 'L1', ink: 'A', lotNo: 'A051301' }],
    daily: { '2026-05-13': { L1: 2 } },
  };

  const next = DataService.removeInventoryLot(inv, 'NOPE');
  assert.deepEqual(next.lots, inv.lots);
  assert.deepEqual(next.daily, { '2026-05-13': { L1: 2 } });
});

test('removeInventoryLot / removeInventoryInk: null inventory도 안전하게 빈 구조 반환', () => {
  assert.deepEqual(DataService.removeInventoryLot(null, 'X'), { lots: [], daily: {} });
  assert.deepEqual(DataService.removeInventoryInk(undefined, 'A'), { lots: [], daily: {} });
});

test('relabelInventoryLot: order>3 상한 — 3번째 이후 relabel은 무변동', () => {
  const inv = { lots: [{ id: 'L1', ink: 'SHADOW', lotNo: 'SHAD051001', role: 'initial', order: 1 }], daily: {} };

  let cur = DataService.relabelInventoryLot(inv, 'SHADOW', '2026-05-14', () => 'R1'); // order 2
  cur = DataService.relabelInventoryLot(cur, 'SHADOW', '2026-05-14', () => 'R2');     // order 3
  assert.equal(cur.lots.length, 3);

  const capped = DataService.relabelInventoryLot(cur, 'SHADOW', '2026-05-14', () => 'R3'); // order 4 → 거부
  assert.equal(capped.lots.length, 3);
  assert.deepEqual(capped.lots.map(l => l.id), ['L1', 'R1', 'R2']);
});
