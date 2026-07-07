// R3-1순위: 페이지에서 data-service.js로 이전된 파생 함수의 단위 테스트.
// ink-plan 엔진(9) · review/OCR(6) · inventory(1) + 공유 normalize 위임 검증.
const assert = require('node:assert/strict');
const test = require('node:test');

const DataService = require('../data-service.js');

// ── ink-plan: buildProductLookup / resolveProductIn ──────────────────────────
test('buildProductLookup: exact·normalized 맵을 모두 구성한다', () => {
  const lookup = DataService.buildProductLookup([
    { name: 'A-100', inks: ['빨강'] },
    { name: 'B 200', inks: ['파랑'] },
  ]);
  assert.equal(lookup.exact.get('A-100').name, 'A-100');
  // 정규화 키는 구분자/공백 제거 + 대문자
  assert.equal(lookup.normalized.get('A100').name, 'A-100');
  assert.equal(lookup.normalized.get('B200').name, 'B 200');
});

test('resolveProductIn: exact 우선, 없으면 normalized, 둘 다 없으면 null', () => {
  const lookup = DataService.buildProductLookup([{ name: 'A-100', inks: ['빨강'] }]);
  assert.equal(DataService.resolveProductIn(lookup, 'A-100').name, 'A-100'); // exact
  assert.equal(DataService.resolveProductIn(lookup, 'a 100').name, 'A-100'); // normalized
  assert.equal(DataService.resolveProductIn(lookup, '없는제품'), null);
  assert.equal(DataService.resolveProductIn(lookup, ''), null);
});

// ── 제품 정체성 id (P0): 동명 제품 구분의 단일 키 ─────────────────────────────
test('productIdNum/allocateProductId: 순번 id 파싱·부여', () => {
  assert.equal(DataService.productIdNum('p_00042'), 42);
  assert.equal(DataService.productIdNum('nope'), 0);
  assert.equal(DataService.productIdNum(undefined), 0);
  assert.equal(DataService.allocateProductId([]), 'p_00001');
  // 최대 id+1 (id 없는 행은 0 취급)
  assert.equal(DataService.allocateProductId([{ id: 'p_00001' }, { id: 'p_00007' }, { name: 'x' }]), 'p_00008');
});

test('사출 참조 cell-tolerant: 동명 object 셀을 id로 정밀 매칭(count/rename/lineup)', () => {
  const injection = { '3층': [{ machine: '10호기', schedule: {
    // 같은 이름 'AFF' 두 제품(p_1·p_2)을 각 셀이 id로 가리킴
    월: { day: { name: 'AFF', id: 'p_2' }, night: { name: 'AFF', id: 'p_1' } },
  } }] };
  // id 주면 그 제품 셀만, 없으면 이름으로 둘 다
  assert.equal(DataService.countInjectionRefs({ injection }, 'AFF', 'p_2'), 1);
  assert.equal(DataService.countInjectionRefs({ injection }, 'AFF'), 2);
  // rename: p_2 셀만 name 교체(id 유지), p_1 셀은 그대로
  const renamed = DataService.renameInjectionRefs(injection, 'AFF', 'NEW', 'p_2');
  assert.deepEqual(renamed['3층'][0].schedule['월'].day, { name: 'NEW', id: 'p_2' });
  assert.deepEqual(renamed['3층'][0].schedule['월'].night, { name: 'AFF', id: 'p_1' });
  // lineup: object 셀도 이름으로 표시([object Object] 방지)
  const lineup = DataService.buildTodayLineup(injection, '월');
  assert.equal(lineup[0].day, 'AFF');
  assert.equal(lineup[0].night, 'AFF');
});

test('resolveProductById / 셀 헬퍼: id 우선, 레거시 문자열 폴백, 동명 정확', () => {
  // 같은 이름 분말/액상을 id로 구분
  const products = [
    { id: 'p_1', name: 'D_Affogato_55% UV', inks: ['AFFO'] },
    { id: 'p_2', name: 'D_Affogato_55% UV', inks: ['CONVEX'] },
  ];
  const lookup = DataService.buildProductLookup(products);
  assert.equal(DataService.resolveProductById(lookup, 'p_2').inks[0], 'CONVEX');
  assert.equal(DataService.resolveProductById(lookup, '없음'), null);
  // 셀 헬퍼: 문자열/객체 양쪽
  assert.equal(DataService.productCellName('이름'), '이름');
  assert.equal(DataService.productCellName({ name: '이름', id: 'p_1' }), '이름');
  assert.equal(DataService.productCellName(null), '');
  assert.equal(DataService.productCellId({ name: '이름', id: 'p_1' }), 'p_1');
  assert.equal(DataService.productCellId('이름'), null);
  // resolveProductCell: 객체 셀 → id로 정확 해소
  assert.equal(DataService.resolveProductCell(lookup, { name: 'D_Affogato_55% UV', id: 'p_2' }).inks[0], 'CONVEX');
  // 레거시 문자열 → 이름 해소(동명은 모호 — 후보 중 하나, 바로 이 모호함을 id가 제거)
  assert.ok(['AFFO', 'CONVEX'].includes(DataService.resolveProductCell(lookup, 'D_Affogato_55% UV').inks[0]));
});

test('buildBrandOptions: 빈값 제외·중복 제거·정렬 (injection/products 공용)', () => {
  const products = [
    { name: 'A', brand: '병' },
    { name: 'B', brand: '갑' },
    { name: 'C', brand: '갑' },   // 중복
    { name: 'D', brand: '' },      // 빈값 제외
    { name: 'E' },                 // brand 없음
  ];
  assert.deepEqual(DataService.buildBrandOptions(products), ['갑', '병']);
  assert.deepEqual(DataService.buildBrandOptions([]), []);
  assert.deepEqual(DataService.buildBrandOptions(null), []);
});

// ── ink-plan: buildProductsUsingInk / buildDemandByInkDay ────────────────────
const SAMPLE_INJECTION = {
  '3층': [
    { machine: '1호', schedule: { 월: { day: 'A-100', night: 'B-200' }, 화: { day: 'A-100', night: '' } } },
  ],
};

test('buildProductsUsingInk: 잉크 → 사용 제품명 목록(중복 제거)', () => {
  const lookup = DataService.buildProductLookup([
    { name: 'A-100', inks: ['빨강', '공통'] },
    { name: 'B-200', inks: ['파랑', '공통'] },
  ]);
  const map = DataService.buildProductsUsingInk(SAMPLE_INJECTION, lookup);
  assert.deepEqual(map.get('빨강'), ['A-100']);
  assert.deepEqual(map.get('파랑'), ['B-200']);
  assert.deepEqual(map.get('공통').sort(), ['A-100', 'B-200']);
});

test('buildDemandByInkDay: 잉크 × 요일 → 채워진 셀 수 집계', () => {
  const lookup = DataService.buildProductLookup([
    { name: 'A-100', inks: ['빨강'] },
    { name: 'B-200', inks: ['파랑'] },
  ]);
  const demand = DataService.buildDemandByInkDay(SAMPLE_INJECTION, lookup);
  // 빨강: 월 day + 화 day = 월1, 화1
  assert.equal(demand.get('빨강').get('월'), 1);
  assert.equal(demand.get('빨강').get('화'), 1);
  // 파랑: 월 night 1회만
  assert.equal(demand.get('파랑').get('월'), 1);
  assert.equal(demand.get('파랑').get('화'), undefined);
});

test('buildProductsUsingInk: 빈 injection은 빈 맵', () => {
  const lookup = DataService.buildProductLookup([]);
  assert.equal(DataService.buildProductsUsingInk({}, lookup).size, 0);
  assert.equal(DataService.buildProductsUsingInk(null, lookup).size, 0);
});

// ── ink-plan: buildInkToMachine ──────────────────────────────────────────────
test('buildInkToMachine: 잉크 → 호기 (첫 매핑 유지, 구버전 키 호환)', () => {
  const m = DataService.buildInkToMachine([
    { ink: '빨강', machine: '1호' },
    { ink: '빨강', machine: '2호' }, // 첫 매핑 유지
    { product: '파랑', machine: '3호' }, // 구버전 product 키
    { name: '노랑', machine: '4호' },    // 구버전 name 키
  ]);
  assert.equal(m.get('빨강'), '1호');
  assert.equal(m.get('파랑'), '3호');
  assert.equal(m.get('노랑'), '4호');
});

// ── ink-plan: buildInventoryByInkDay ─────────────────────────────────────────
test('buildInventoryByInkDay: 일자별 lot 재고를 요일 키로 합산', () => {
  const inventory = {
    lots: [
      { id: 'L1', ink: '빨강' },
      { id: 'L2', ink: '빨강' },
    ],
    daily: {
      '2026-06-01': { L1: 10, L2: 5 },
      '2026-06-02': { L1: 3 },
    },
  };
  // 2026-06-01 = 월(6/1), 2026-06-02 = 화(6/2)
  const dates = { 월: '6/1', 화: '6/2' };
  const res = DataService.buildInventoryByInkDay(inventory, dates);
  assert.equal(res.get('빨강').get('월'), 15);
  assert.equal(res.get('빨강').get('화'), 3);
});

test('buildInventoryByInkDay: lots/daily 없으면 빈 맵', () => {
  assert.equal(DataService.buildInventoryByInkDay(null, {}).size, 0);
  assert.equal(DataService.buildInventoryByInkDay({ lots: [] }, {}).size, 0);
});

test('buildInventoryByInkDay: 같은 M/D 다른 연도면 최신 조사만 채택(연도 모호성 제거)', () => {
  const inventory = {
    lots: [{ id: 'L1', ink: '빨강' }],
    daily: {
      '2025-06-01': { L1: 99 },   // 작년 6/1 — 삽입 순서상 먼저지만 무시돼야 함
      '2026-06-01': { L1: 12 },   // 올해 6/1 — 최신
    },
  };
  const res = DataService.buildInventoryByInkDay(inventory, { 월: '6/1' });
  assert.equal(res.get('빨강').get('월'), 12);
});

// ── ink-plan: mergeInkPlanAndTestInks ────────────────────────────────────────
test('mergeInkPlanAndTestInks: 정식 유지 + testStatus 칩, 미등록 testInk는 추가', () => {
  const days = ['월', '화'];
  const merged = DataService.mergeInkPlanAndTestInks(
    [{ name: '빨강', days: {} }],
    [
      { name: '빨강', status: '테스트중', note: '메모', addedDate: '2026-06-01' },
      { name: '신규', status: '대기', note: '', addedDate: '2026-06-01' },
    ],
    days,
  );
  const red = merged.find(m => m.name === '빨강');
  assert.equal(red.isTest, false);
  assert.equal(red.testStatus, '테스트중');
  assert.equal(red.testNote, '메모');
  const neo = merged.find(m => m.name === '신규');
  assert.equal(neo.isTest, true);
  assert.deepEqual(Object.keys(neo.days), ['월', '화']);
});

test('mergeInkPlanAndTestInks: inkPlan이 null/undefined여도 throw하지 않는다', () => {
  // 대시보드 never-throw 보장 경로: 부분/레거시 데이터 방어
  assert.deepEqual(DataService.mergeInkPlanAndTestInks(null, [], ['월']), []);
  assert.deepEqual(DataService.mergeInkPlanAndTestInks(undefined, null, ['월']), []);
  // testInk만 있고 inkPlan이 없으면 testOnly 행만 생성
  const merged = DataService.mergeInkPlanAndTestInks(
    null,
    [{ name: '신규', status: '대기', note: '', addedDate: '2026-06-01' }],
    ['월'],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '신규');
  assert.equal(merged[0].isTest, true);
});

test('mergeInkPlanAndTestInks: startDay는 매칭 testInk의 addedDate 요일에서 파생', () => {
  // 2026-06-03은 수요일 → startDay '수'
  const merged = DataService.mergeInkPlanAndTestInks(
    [{ name: '빨강', days: {} }],
    [{ name: '빨강', status: '테스트중', note: '', addedDate: '2026-06-03' }],
    ['월', '화'],
  );
  assert.equal(merged.find(m => m.name === '빨강').startDay, '수');
});

// ── ink-plan: computeInkMetrics ──────────────────────────────────────────────
test('computeInkMetrics: 수동 현재고 우선 + endStock carry 전파', () => {
  const days = ['월', '화'];
  const merged = [{ name: '빨강', days: { 월: { 현재고: '10', 제조량: '5' }, 화: {} } }];
  const demand = new Map([['빨강', new Map([['월', 2], ['화', 3]])]]);
  const inv = new Map();
  const res = DataService.computeInkMetrics(merged, demand, inv, days);
  const mon = res.get('빨강').get('월');
  assert.equal(mon.stock, 10);       // 수동값
  assert.equal(mon.required, 2);
  assert.equal(mon.manufacture, 5);
  // endStock = 10 + 5 - 2 = 13 → 화 stock으로 carry
  const tue = res.get('빨강').get('화');
  assert.equal(tue.stock, 13);
  assert.equal(tue.required, 3);
});

test('computeInkMetrics: availableDays(round1)·weeklyNeed(월·차주월 포함) 파생', () => {
  // weeklyNeed/availableDays 는 부족 알림(collectInkShortage/auto-assign)의 단일 소스 — 부호·반올림 고정
  const days = ['월', '화'];
  const merged = [{ name: '빨강', days: { 월: { 현재고: '10' }, 화: {} } }];
  const demand = new Map([['빨강', new Map([['월', 2], ['화', 3], ['차주월', 4]])]]);
  const res = DataService.computeInkMetrics(merged, demand, new Map(), days);
  const mon = res.get('빨강').get('월');
  assert.equal(mon.availableDays, 5);   // round1(10/2)
  assert.equal(mon.weeklyNeed, 1);      // 10 - (2+3+4=9), 차주월 포함
  const tue = res.get('빨강').get('화');
  assert.equal(tue.stock, 8);           // carry 10+0-2
  assert.equal(tue.availableDays, 2.7); // round1(8/3)
  assert.equal(tue.weeklyNeed, null);   // 월이 아니면 null
});

test('computeInkMetrics: stock null이면 availableDays/weeklyNeed/carry 모두 null 전파', () => {
  const days = ['월', '화'];
  const merged = [{ name: '파랑', days: { 월: {}, 화: {} } }]; // 수동·재고 없음
  const demand = new Map([['파랑', new Map([['월', 2], ['차주월', 1]])]]);
  const res = DataService.computeInkMetrics(merged, demand, new Map(), days);
  const mon = res.get('파랑').get('월');
  assert.equal(mon.stock, null);
  assert.equal(mon.availableDays, null);
  assert.equal(mon.weeklyNeed, null);                  // totalRequired>0여도 stock null이면 null
  assert.equal(res.get('파랑').get('화').stock, null);  // carry null 전파
});

test('computeInkMetrics: required=0이면 availableDays=null (0 나눗셈 회피)', () => {
  const days = ['월'];
  const merged = [{ name: '빨강', days: { 월: { 현재고: '5' } } }];
  const res = DataService.computeInkMetrics(merged, new Map(), new Map(), days);
  const mon = res.get('빨강').get('월');
  assert.equal(mon.required, 0);
  assert.equal(mon.availableDays, null);
  assert.equal(mon.weeklyNeed, null);  // totalRequired 0
});

test('computeInkMetrics: inventory 연동값은 stockFromInv=true', () => {
  const days = ['월'];
  const merged = [{ name: '빨강', days: { 월: {} } }];
  const demand = new Map();
  const inv = new Map([['빨강', new Map([['월', 7]])]]);
  const res = DataService.computeInkMetrics(merged, demand, inv, days);
  const mon = res.get('빨강').get('월');
  assert.equal(mon.stock, 7);
  assert.equal(mon.stockFromInv, true);
});

// ── ink-plan: buildAutoAssignCandidates ──────────────────────────────────────
test('buildAutoAssignCandidates: 제조량 비어있고 월 weeklyNeed 음수면 후보', () => {
  const days = ['월', '화'];
  const inkPlan = [
    { name: '부족', days: { 월: {} } },
    { name: '충분', days: { 월: {} } },
    { name: '이미입력', days: { 월: { 제조량: '5' } } },
  ];
  const computed = new Map([
    ['부족', new Map([['월', { weeklyNeed: -8 }]])],
    ['충분', new Map([['월', { weeklyNeed: 3 }]])],
    ['이미입력', new Map([['월', { weeklyNeed: -2 }]])],
  ]);
  const out = DataService.buildAutoAssignCandidates(inkPlan, [], '월', days, computed);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { name: '부족', need: -8, suggested: 8 });
});

// ── review/OCR: matchOcrRow ──────────────────────────────────────────────────
const MASTER = {
  products: [
    { name: 'A-100', customer: '고객사' },
    { name: 'B-200', customer: '갑' },
    { name: 'B-200', customer: '을' },
  ],
};

test('matchOcrRow: 이름+브랜드 일치 → exact', () => {
  const r = DataService.matchOcrRow({ product_name: 'A-100', brand: '고객사' }, MASTER);
  assert.equal(r.status, 'exact');
  assert.equal(r.matchedName, 'A-100');
});

test('matchOcrRow: 이름 1건이지만 브랜드 불일치 → brand-mismatch', () => {
  const r = DataService.matchOcrRow({ product_name: 'A-100', brand: '딴고객' }, MASTER);
  assert.equal(r.status, 'brand-mismatch');
  assert.equal(r.suggestedBrand, '고객사');
});

test('matchOcrRow: 동명 제품 여러 건(브랜드·제형으로 못 좁힘) → ambiguous(candidates)', () => {
  const r = DataService.matchOcrRow({ product_name: 'B-200', brand: '병' }, MASTER);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 2);
});

// 제형(variant '액상')으로 동명 분말/액상 자동 좁히기 + matchedId
test('matchOcrRow: variant 액상 → 동명 분말/액상 중 LIQUID로 자동 해소(matchedId)', () => {
  const M = { products: [
    { id: 'p_1', name: 'AFF', customer: 'PIA', type: 'POWDER', inks: ['A'] },
    { id: 'p_2', name: 'AFF', customer: 'PIA', type: 'LIQUID', inks: ['B'] },
  ] };
  const liquid = DataService.matchOcrRow({ product_name: 'AFF', brand: 'PIA', variant: '액상' }, M);
  assert.equal(liquid.status, 'exact');
  assert.equal(liquid.matchedId, 'p_2');
  const powder = DataService.matchOcrRow({ product_name: 'AFF', brand: 'PIA', variant: '' }, M);
  assert.equal(powder.matchedId, 'p_1');
});

// 이름·제형까지 같고 잉크만 다른 경우(U-buding류) → ambiguous, 잉크로 구분
test('matchOcrRow: 동명·동제형·다른잉크 → ambiguous(candidates에 inks)', () => {
  const M = { products: [
    { id: 'p_1', name: 'UB', customer: 'X', type: 'POWDER', inks: ['TICO'] },
    { id: 'p_2', name: 'UB', customer: 'X', type: 'POWDER', inks: ['GRAMPUS'] },
  ] };
  const r = DataService.matchOcrRow({ product_name: 'UB', brand: 'X' }, M);
  assert.equal(r.status, 'ambiguous');
  assert.deepEqual(r.candidates.map(c => c.id).sort(), ['p_1', 'p_2']);
  assert.deepEqual(r.candidates.map(c => c.inks[0]).sort(), ['GRAMPUS', 'TICO']);
});

test('applyOcrToInjection: 확정 셀에 {name,id} 저장 (동명=targetId, 단일=자동 id)', () => {
  const data = {
    products: [
      { id: 'p_1', name: 'AFF', type: 'POWDER', inks: ['A'] },
      { id: 'p_2', name: 'AFF', type: 'LIQUID', inks: ['B'] },
      { id: 'p_9', name: 'SOLO', type: 'POWDER', inks: ['C'] },
    ],
    injection: { '3층': [{ machine: '10호기', schedule: {} }, { machine: '11호기', schedule: {} }] },
  };
  const ocrResult = { parsed: {
    request_date: '2026-06-15', next_date: '2026-06-16', // 월
    shifts: [{ shift: '주간', rows: [
      { machine_no: 10, floor: '3F', brand: 'PIA', variant: '액상', product_name: 'AFF' },
      { machine_no: 11, floor: '3F', brand: '', variant: '', product_name: 'SOLO' },
    ] }],
  } };
  const decisions = {
    '주간-10-0': { action: 'match', target: 'AFF', targetId: 'p_2' }, // 동명 → 선택 id
    '주간-11-1': { action: 'auto', target: 'SOLO' },                  // 단일 → 자동 id
  };
  const res = DataService.applyOcrToInjection(data, ocrResult, decisions);
  assert.deepEqual(res.nextData.injection['3층'][0].schedule['월'].day, { name: 'AFF', id: 'p_2' });
  assert.deepEqual(res.nextData.injection['3층'][1].schedule['월'].day, { name: 'SOLO', id: 'p_9' });
});

test('matchOcrRow: 빈 이름 또는 TEST → skip', () => {
  assert.equal(DataService.matchOcrRow({ product_name: '' }, MASTER).status, 'skip');
  assert.equal(DataService.matchOcrRow({ product_name: 'TEST' }, MASTER).status, 'skip');
});

test('matchOcrRow: TEST 변형 표기·구분란 TEST도 isTest (미등록 목록 제외)', () => {
  // 표기 변형: 괄호/구분자/소문자/한글
  for (const name of ['(TEST)', 'T.E.S.T', 'test', '테스트']) {
    const r = DataService.matchOcrRow({ product_name: name }, MASTER);
    assert.equal(r.isTest, true, `${name} → isTest여야 함`);
    assert.equal(r.status, 'skip');
  }
  // 구분(brand)란이 TEST면 제품명이 실명이어도 테스트 행
  const byBrand = DataService.matchOcrRow({ product_name: '신제품X', brand: 'TEST' }, MASTER);
  assert.equal(byBrand.isTest, true);
  assert.equal(byBrand.status, 'skip');
  // 반례: TEST가 부분 문자열인 실제품명은 그대로 매칭 흐름 (skip 아님)
  const tester = DataService.matchOcrRow({ product_name: 'TESTER BROWN', brand: '갑' }, MASTER);
  assert.equal(tester.isTest, false);
});

// ── review/OCR: buildReviewRows / buildProductGroups ─────────────────────────
const OCR_RESULT = {
  parsed: {
    shifts: [
      { shift: '주', rows: [
        { machine_no: '1', product_name: 'A-100', brand: '고객사', floor: '3층' },
        { machine_no: '2', product_name: 'A-100', brand: '고객사', floor: '3층' },
      ] },
    ],
  },
};

test('buildReviewRows: shifts → flat rows with rowKey + match', () => {
  const rows = DataService.buildReviewRows(OCR_RESULT, MASTER);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowKey, '주-1-0');
  assert.equal(rows[0].status, 'exact');
});

test('buildReviewRows: parsed 없으면 빈 배열', () => {
  assert.deepEqual(DataService.buildReviewRows({}, MASTER), []);
});

test('buildProductGroups: 동일 제품+브랜드는 한 그룹으로 묶임', () => {
  const rows = DataService.buildReviewRows(OCR_RESULT, MASTER);
  const groups = DataService.buildProductGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rowKeys.length, 2);
  assert.equal(groups[0].occurs.length, 2);
});

test('buildProductGroups: 액상/분말은 별도 그룹 — id 오적용 방지', () => {
  // normalizeBrand("PIA / 액상")==normalizeBrand("PIA / 분말")=="PIA" 라 이전엔 병합됐다.
  const rows = [
    { rowKey: '주-1-0', isTest: false, ocrName: 'PIA', brand: 'PIA / 액상', variant: '액상',
      status: 'exact', matchedName: 'PIA', matchedId: 'p_00001', machine_no: '1', shift: '주', floor: '3층' },
    { rowKey: '주-2-1', isTest: false, ocrName: 'PIA', brand: 'PIA / 분말', variant: '분말',
      status: 'exact', matchedName: 'PIA', matchedId: 'p_00002', machine_no: '2', shift: '주', floor: '3층' },
  ];
  const groups = DataService.buildProductGroups(rows);
  assert.equal(groups.length, 2);
  const byId = new Map(groups.map(g => [g.matchedId, g.rowKeys]));
  assert.deepEqual(byId.get('p_00001'), ['주-1-0']);
  assert.deepEqual(byId.get('p_00002'), ['주-2-1']);
});

// ── review/OCR: mapOcrRowsInGroup / changeMachineInGroup ─────────────────────
test('mapOcrRowsInGroup: 지정 rowKey의 필드만 변경(불변성 유지)', () => {
  const next = DataService.mapOcrRowsInGroup(OCR_RESULT, ['주-1-0'], 'brand', '새브랜드');
  assert.equal(next.parsed.shifts[0].rows[0].brand, '새브랜드');
  assert.equal(next.parsed.shifts[0].rows[1].brand, '고객사'); // 미지정 행 불변
  assert.notEqual(next, OCR_RESULT); // 새 객체
});

test('changeMachineInGroup: 호기 변경 + keyMap(old→new) 반환', () => {
  const { next, keyMap } = DataService.changeMachineInGroup(OCR_RESULT, ['주-1-0'], '9');
  assert.equal(next.parsed.shifts[0].rows[0].machine_no, '9');
  assert.equal(keyMap.get('주-1-0'), '주-9-0');
});

// ── inventory: inkLifeInfo ───────────────────────────────────────────────────
test('inkLifeInfo: 유효기간 4일 내 → 남음, tone ok/warn', () => {
  const r = DataService.inkLifeInfo({ registeredDate: '2026-06-01' }, '2026-06-02');
  assert.equal(r.text, '3일 남음'); // 4 - 1
  assert.equal(r.tone, 'ok');
  const warn = DataService.inkLifeInfo({ registeredDate: '2026-06-01' }, '2026-06-04');
  assert.equal(warn.text, '1일 남음'); // 4 - 3
  assert.equal(warn.tone, 'warn');     // remaining <= 1
});

test('inkLifeInfo: 초과 → 지남, 2일 이내는 relabel, 그 이상 expired', () => {
  const relabel = DataService.inkLifeInfo({ registeredDate: '2026-06-01' }, '2026-06-06');
  assert.equal(relabel.text, '1일 지남'); // age 5, remaining -1
  assert.equal(relabel.tone, 'relabel');
  const expired = DataService.inkLifeInfo({ registeredDate: '2026-06-01' }, '2026-06-09');
  assert.equal(expired.text, '4일 지남'); // age 8, remaining -4
  assert.equal(expired.tone, 'expired');
});

test('inkLifeInfo: 입력 없으면 empty', () => {
  assert.equal(DataService.inkLifeInfo(null, '2026-06-01').tone, 'empty');
  assert.equal(DataService.inkLifeInfo({}, null).tone, 'empty');
});

// ── 공유 normalize 위임 (ui.jsx → data-service) ──────────────────────────────
test('normalize 헬퍼: 단일화된 동작 검증', () => {
  assert.equal(DataService.normalizeProductName(' a-100 '), 'A100');
  assert.equal(DataService.normalizeBrand('갑/을'), '갑'); // 슬래시 앞부분
  assert.equal(DataService.inkOfAssignment({ ink: '빨강' }), '빨강');
  assert.equal(DataService.inkOfAssignment({ product: '파랑' }), '파랑');
});

// ── inventory: 엑셀 재고 조사표 가져오기 ─────────────────────────────────────────
// 실파일(잉크 재고 조사표_5월.xlsx) 구조 본뜬 합성 rows: 헤더 행8, 부헤더(M/D) 행9
const XLSX_ROWS = [
  [], [null, '-9월 Ink 제조량'], [], [], [], [], [], [],
  [null, '잉크명', 'Lot No.', '월', '화', '수', '목', '금', '토', '일', 'Lot No. 변경'],
  [null, null, '제조 시', '5/11', '5/12', '5/13', '5/14', '5/15', null, null, '2차'],
  [null, 'DARK', '051001', '3', '3', '3', null, null, null, null, null],
  [null, 'SOUL', '051001', '9', '9', '9', null, null, null, null, null],
  [null, 'NEWINK', '051099', null, null, '5', null, null, null, null, null],
  [null, 'GHOST?', '051001', '1', null, '2,000', null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null], // 빈 행
];

test('parseInventorySheetRows: 헤더 탐색 + 요일 컬럼(M/D 라벨) + 데이터 행', () => {
  const p = DataService.parseInventorySheetRows(XLSX_ROWS);
  assert.equal(p.error, undefined);
  assert.deepEqual(p.dateCols.map(d => d.label), ['5/11', '5/12', '5/13', '5/14', '5/15', '토', '일']);
  assert.equal(p.dateCols[0].day, '월');
  assert.equal(p.rows.length, 4); // 빈 행 제외
  assert.equal(p.rows[0].ink, 'DARK');
  assert.equal(p.rows[0].lotNo, '051001');
  assert.equal(p.rows[0].values['5/13'], '3');
  assert.equal(p.rows[2].values['5/11'], undefined); // NEWINK 는 수요일만
});

test('parseInventorySheetRows: 헤더 없으면 error', () => {
  assert.equal(DataService.parseInventorySheetRows([[1, 2], [3]]).error, 'no-header');
  assert.equal(DataService.parseInventorySheetRows(null).error, 'no-header');
});

test('buildInventoryImportPlan: 기존 lot→sets, 마스터만 있음→creates, 둘 다 없음→unknowns', () => {
  const p = DataService.parseInventorySheetRows(XLSX_ROWS);
  const data = {
    machineAssignments: [
      { ink: 'DARK', machine: '10호기', code: 'C1' },
      { ink: 'SOUL', machine: '11호기', code: 'C2' },
      { ink: 'NEWINK', machine: '12호기', code: 'C3' }, // 마스터엔 있으나 lot 없음
    ],
    inventory: {
      lots: [
        { id: 'L1', ink: 'DARK', lotNo: 'DA051101', registeredDate: '2026-05-11', order: 1, role: 'initial' },
        { id: 'L2', ink: 'SOUL', lotNo: 'SO051101', registeredDate: '2026-05-11', order: 1, role: 'initial' },
      ],
      daily: {},
    },
  };
  const plan = DataService.buildInventoryImportPlan(p, '5/13', data, '2026-05-13');
  assert.deepEqual(plan.sets.map(s => [s.ink, s.lotId, s.value]), [['DARK', 'L1', 3], ['SOUL', 'L2', 9]]);
  assert.deepEqual(plan.creates.map(c => [c.ink, c.lotNo, c.value]), [['NEWINK', '051099', 5]]);
  assert.equal(plan.unknowns.length, 1);            // GHOST? — 마스터에 없음
  assert.equal(plan.unknowns[0].value, 2000);        // 천단위 콤마 파싱
});

test('buildInventoryImportPlan: 값 없는 라벨·중복 잉크·비숫자 처리', () => {
  const p = DataService.parseInventorySheetRows([
    [null, '잉크명', 'Lot No.', '월'],
    [null, null, '제조 시', '5/11'],
    [null, 'DARK', 'A', '3'],
    [null, 'DARK', 'B', '7'],     // 같은 잉크 중복 → 첫 행만
    [null, 'SOUL', 'C', 'abc'],   // 비숫자 → 건너뜀
  ]);
  const data = {
    machineAssignments: [{ ink: 'DARK', machine: '1', code: 'C' }],
    inventory: { lots: [{ id: 'L1', ink: 'DARK', lotNo: 'X', registeredDate: '2026-05-11', order: 1, role: 'initial' }], daily: {} },
  };
  const plan = DataService.buildInventoryImportPlan(p, '5/11', data, '2026-05-13');
  assert.equal(plan.sets.length, 1);
  assert.equal(plan.sets[0].value, 3);
  assert.equal(plan.unknowns.length, 0);
});

// ── dashboard: buildTodayLineup ──────────────────────────────────────────────
test('buildTodayLineup: 오늘 요일에 값 있는 호기만, 층→호기번호 정렬', () => {
  const injection = {
    '3층': [
      { machineNo: 14, schedule: { 수: { day: 'P1', night: '' } } },
      { machineNo: 2, schedule: { 수: { day: '', night: 'P2' } } },
      { machineNo: 5, schedule: { 수: { day: '', night: '' }, 목: { day: 'X' } } }, // 오늘 빈 호기 제외
    ],
    '1층': [{ machineNo: 50, schedule: { 수: { day: 'P3', night: 'P3' } } }],
  };
  const rows = DataService.buildTodayLineup(injection, '수');
  assert.deepEqual(rows.map(r => `${r.floor}/${r.machineNo}`), ['1층/50', '3층/2', '3층/14']);
  assert.equal(rows[2].day, 'P1');
  assert.equal(rows[1].night, 'P2');
  assert.equal(rows[2].machine, '14호기'); // machine 라벨 없으면 번호로 생성
});

test('buildTodayLineup: null/빈 입력 안전', () => {
  assert.deepEqual(DataService.buildTodayLineup(null, '수'), []);
  assert.deepEqual(DataService.buildTodayLineup({}, '수'), []);
  assert.deepEqual(DataService.buildTodayLineup({ '3층': [] }, null), []);
});

// ── review/OCR: applyOcrToInjection (사출계획 기록 경로) ────────────────────────
// 2026-06-03(수) 기준: requestDay='수', next_date 2026-06-04(목) → nextDay='목'
function makeInjData() {
  return {
    injection: {
      '3층': [{ machineNo: 1, schedule: {} }, { machineNo: 2, schedule: {} }],
      '1층': [{ machineNo: 5, schedule: {} }],
    },
  };
}
const OCR_INJ = {
  parsed: {
    request_date: '2026-06-03',
    next_date: '2026-06-04',
    shifts: [
      { shift: '주간', rows: [{ machine_no: 1, floor: '3F', product_name: 'P1' }] },
      { shift: '야간', rows: [{ machine_no: 2, floor: '3F', product_name: 'P2' }] },
      { shift: '명일주간', rows: [{ machine_no: 5, floor: '1F', product_name: 'P3' }] },
    ],
  },
};

test('applyOcrToInjection: 주간/야간/명일주간을 올바른 요일·시프트·호기에 기록', () => {
  const data = makeInjData();
  const decisions = {
    '주간-1-0': { action: 'map' },          // target 없음 → r.product_name 사용
    '야간-2-0': { action: 'map', target: 'P2X' },
    '명일주간-5-0': { action: 'map' },
  };
  const res = DataService.applyOcrToInjection(data, OCR_INJ, decisions);
  const inj = res.nextData.injection;
  assert.equal(inj['3층'][0].schedule['수'].day, 'P1');    // 주간 → day
  assert.equal(inj['3층'][1].schedule['수'].night, 'P2X'); // 야간 → night, target 우선
  assert.equal(inj['1층'][0].schedule['목'].day, 'P3');    // 명일주간 → 익일(목) day
  assert.deepEqual(res.mergedByShift, { 주간: 1, 야간: 1, 명일주간: 1 });
  assert.equal(res.skippedNoMachine, 0);
  assert.equal(res.skippedNoMatch, 0);
  assert.deepEqual(res.mergedDays, ['수', '목']);
});

test('applyOcrToInjection: 원본 data.injection을 변형하지 않는다(깊은 복제)', () => {
  const data = makeInjData();
  const decisions = { '주간-1-0': { action: 'map' } };
  DataService.applyOcrToInjection(data, OCR_INJ, decisions);
  assert.deepEqual(data.injection['3층'][0].schedule, {}); // 원본 그대로
});

test('applyOcrToInjection: decision 없으면 skippedNoMatch 증가, 미기록', () => {
  const data = makeInjData();
  const res = DataService.applyOcrToInjection(data, OCR_INJ, {}); // 모든 행 decision 없음
  assert.equal(res.skippedNoMatch, 3);
  assert.deepEqual(res.mergedByShift, { 주간: 0, 야간: 0, 명일주간: 0 });
});

test('applyOcrToInjection: skip 결정은 미기록, 단 reason=TEST는 기록', () => {
  const data = makeInjData();
  const decisions = {
    '주간-1-0': { action: 'skip', reason: 'NO_MATCH' },  // 미기록
    '야간-2-0': { action: 'skip', reason: 'TEST' },       // 기록됨
    '명일주간-5-0': { action: 'skip' },                   // 미기록
  };
  const res = DataService.applyOcrToInjection(data, OCR_INJ, decisions);
  assert.equal(res.nextData.injection['3층'][0].schedule['수'], undefined); // skip
  assert.equal(res.nextData.injection['3층'][1].schedule['수'].night, 'P2'); // TEST는 기록
  assert.equal(res.mergedByShift['야간'], 1);
});

test('applyOcrToInjection: 매칭 호기 없으면 skippedNoMachine 증가', () => {
  const data = makeInjData();
  const ocr = {
    parsed: {
      request_date: '2026-06-03',
      next_date: '2026-06-04',
      shifts: [{ shift: '주간', rows: [{ machine_no: 99, floor: '3F', product_name: 'P1' }] }],
    },
  };
  const res = DataService.applyOcrToInjection(data, ocr, { '주간-99-0': { action: 'map' } });
  assert.equal(res.skippedNoMachine, 1);
  assert.equal(res.mergedByShift['주간'], 0);
});

test('applyOcrToInjection: next_date 없으면 request_date+1로 익일 추론', () => {
  const data = makeInjData();
  const ocr = {
    parsed: {
      request_date: '2026-06-03', // 수 → 익일 목
      shifts: [{ shift: '명일주간', rows: [{ machine_no: 5, floor: '1F', product_name: 'P3' }] }],
    },
  };
  const res = DataService.applyOcrToInjection(data, ocr, { '명일주간-5-0': { action: 'map' } });
  assert.equal(res.nextData.injection['1층'][0].schedule['목'].day, 'P3');
  assert.deepEqual(res.mergedDays, ['수', '목']);
});

test('applyOcrToInjection: request_date 파싱 불가면 {error:no-request-day}', () => {
  const data = makeInjData();
  const ocr = { parsed: { request_date: 'INVALID', shifts: [] } };
  const res = DataService.applyOcrToInjection(data, ocr, {});
  assert.deepEqual(res, { error: 'no-request-day' });
});

// ── review/OCR: lintOcrResult (결정적 검증 레이어) ───────────────────────────
const LINT_DATA = {
  products: [{ name: 'P1', brand: 'IRIS' }, { name: 'P2', brand: 'BELLA' }],
  injection: {
    '3층': [
      { machineNo: 1, schedule: { 월: { day: 'P1', night: '' } } },
      { machineNo: 2, schedule: {} },
    ],
  },
};

test('lintOcrResult: 정상 결과는 이슈 0', () => {
  const parsed = {
    request_date: '2026-06-03',
    next_date: '2026-06-04',
    shifts: [
      { shift: '주간', rows: [{ machine_no: 1, brand: 'IRIS', product_name: 'P1' }] },
      { shift: '야간', rows: [{ machine_no: 1, brand: 'TEST', product_name: 'TEST' }] },
      { shift: '명일주간', rows: [{ machine_no: 1, brand: '', product_name: 'P2' }] },
    ],
  };
  assert.deepEqual(DataService.lintOcrResult(parsed, LINT_DATA), []);
});

test('lintOcrResult: 요청일 해석 불가 → error, 명일≠요청일+1 → warn', () => {
  const bad = DataService.lintOcrResult({ request_date: 'INVALID', shifts: [] }, LINT_DATA);
  assert.ok(bad.some(i => i.level === 'error' && i.type === 'bad-request-date'));
  assert.ok(bad.some(i => i.level === 'warn' && i.type === 'bad-next-date'));
  const gap = DataService.lintOcrResult(
    { request_date: '2026-06-03', next_date: '2026-06-10', shifts: [] }, LINT_DATA);
  assert.ok(gap.some(i => i.type === 'next-date-gap'));
});

test('lintOcrResult: 미지 호기·시프트 내 중복·시프트 집합 불일치 탐지', () => {
  const parsed = {
    request_date: '2026-06-03',
    next_date: '2026-06-04',
    shifts: [
      { shift: '주간', rows: [
        { machine_no: 1, brand: 'IRIS', product_name: 'P1' },
        { machine_no: 1, brand: 'IRIS', product_name: 'P1' },   // 중복
        { machine_no: 99, brand: 'IRIS', product_name: 'P1' },  // 미지 호기
      ] },
      { shift: '야간', rows: [{ machine_no: 1, brand: 'IRIS', product_name: 'P1' }] }, // 99 누락
      { shift: '명일주간', rows: [] },
    ],
  };
  const issues = DataService.lintOcrResult(parsed, LINT_DATA);
  assert.ok(issues.some(i => i.type === 'unknown-machine' && i.message.includes('99')));
  assert.ok(issues.some(i => i.type === 'dup-machine' && i.message.includes('주간')));
  assert.ok(issues.some(i => i.type === 'shift-set-mismatch' && i.message.includes('야간')));
});

test('lintOcrResult: 마스터에 없는 브랜드 → warn (TEST·빈값은 제외)', () => {
  const parsed = {
    request_date: '2026-06-03',
    next_date: '2026-06-04',
    shifts: [
      { shift: '주간', rows: [
        { machine_no: 1, brand: 'IRIS', product_name: 'P1' },   // 알려진 브랜드
        { machine_no: 2, brand: 'IRSI', product_name: 'P1' },   // 오타(미지)
      ] },
      { shift: '야간', rows: [
        { machine_no: 1, brand: 'TEST', product_name: 'TEST' }, // 제외
        { machine_no: 2, brand: '', product_name: 'P2' },        // 제외
      ] },
      { shift: '명일주간', rows: [
        { machine_no: 1, brand: 'iris', product_name: 'P1' },   // 대소문자 무시 → 알려짐
        { machine_no: 2, brand: 'IRIS', product_name: 'P1' },
      ] },
    ],
  };
  const issues = DataService.lintOcrResult(parsed, LINT_DATA);
  const brandIssues = issues.filter(i => i.type === 'unknown-brand');
  assert.equal(brandIssues.length, 1);
  assert.ok(brandIssues[0].message.includes('IRSI'));
});

test('lintOcrResult: parsed 없으면 error 1건', () => {
  const issues = DataService.lintOcrResult(null, LINT_DATA);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'error');
});

// ── ocr-import: buildOcrGroundingHints (프롬프트 grounding 어휘) ──────────────
test('buildOcrGroundingHints: 브랜드 + 호기별 최근 제품(중복 제거·정렬)', () => {
  const data = {
    products: [{ name: 'P1', brand: '병' }, { name: 'P2', brand: '갑' }],
    injection: {
      '3층': [
        { machineNo: 2, schedule: { 월: { day: 'A', night: 'B' }, 화: { day: 'A', night: '' } } },
        { machineNo: 1, schedule: { 월: { day: '', night: '' } } },
      ],
    },
  };
  const hints = DataService.buildOcrGroundingHints(data);
  assert.deepEqual(hints.brands, ['갑', '병']);          // buildBrandOptions 위임
  assert.equal(hints.machines.length, 2);
  assert.equal(hints.machines[0].no, 1);                  // 호기번호 정렬
  assert.deepEqual(hints.machines[0].products, []);       // 빈 스케줄
  assert.deepEqual(hints.machines[1].products, ['A', 'B']); // unique·빈값 제외
});

test('buildOcrGroundingHints: null/빈 data 안전', () => {
  assert.deepEqual(DataService.buildOcrGroundingHints(null), { brands: [], machines: [] });
  assert.deepEqual(DataService.buildOcrGroundingHints({}), { brands: [], machines: [] });
});

test('applyOcrToInjection: floor 미지정이면 전체 층에서 호기 탐색', () => {
  const data = makeInjData();
  const ocr = {
    parsed: {
      request_date: '2026-06-03',
      next_date: '2026-06-04',
      shifts: [{ shift: '주간', rows: [{ machine_no: 5, product_name: 'P9' }] }], // floor 없음
    },
  };
  const res = DataService.applyOcrToInjection(data, ocr, { '주간-5-0': { action: 'map' } });
  assert.equal(res.nextData.injection['1층'][0].schedule['수'].day, 'P9');
  assert.equal(res.skippedNoMachine, 0);
});
