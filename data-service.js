(function (root, factory) {
  const service = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  if (root) {
    root.DataService = service;
    root.localDateISO = service.localDateISO;
    root.parseDateLocal = service.parseDateLocal;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // ── 도메인 상수 (요일/교대) — 단일 출처 ───────────────────────────────────
  // 흩어져 있던 요일·교대 매직 배열을 여기로 단일화. 모두 read-only 용도이므로 freeze.
  // 변형이 필요한 호출부(예: state seed)는 반드시 spread 복사 후 사용할 것.
  var WEEKDAYS = Object.freeze(['월', '화', '수', '목', '금', '토', '일']);            // 주간 7요일
  var WEEKDAYS_PLUS = Object.freeze(['월', '화', '수', '목', '금', '토', '일', '차주월']); // +차주월(8)
  var DAY_BY_IDX = Object.freeze(['일', '월', '화', '수', '목', '금', '토']);          // Date.getDay() 인덱스순
  var SHIFTS = Object.freeze(['day', 'night']);                                        // 주/야 교대

  function getInjectionColumns(days) {
    return days.flatMap(day => [
      { day, shift: 'day', label: '주' },
      { day, shift: 'night', label: '야' },
    ]);
  }

  function cloneScheduleWithShift(machine, day, shift, value) {
    return {
      ...machine,
      schedule: {
        ...machine.schedule,
        [day]: {
          ...(machine.schedule?.[day] || {}),
          [shift]: value,
        },
      },
    };
  }

  function moveInjectionCell(data, floor, source, target) {
    if (
      source.mi === target.mi &&
      source.day === target.day &&
      source.shift === target.shift
    ) {
      return data;
    }

    const value = data.injection[floor][source.mi].schedule[source.day][source.shift];
    const nextFloor = [...data.injection[floor]];
    nextFloor[source.mi] = cloneScheduleWithShift(nextFloor[source.mi], source.day, source.shift, '');
    const targetMachine = source.mi === target.mi ? nextFloor[source.mi] : nextFloor[target.mi];
    nextFloor[target.mi] = cloneScheduleWithShift(targetMachine, target.day, target.shift, value);

    return {
      ...data,
      injection: {
        ...data.injection,
        [floor]: nextFloor,
      },
    };
  }

  function renameInjectionRefs(injection, oldName, newName) {
    if (!oldName || oldName === newName) return injection;
    const next = {};
    for (const floor of Object.keys(injection || {})) {
      next[floor] = (injection[floor] || []).map(machine => ({
        ...machine,
        schedule: Object.fromEntries(
          Object.entries(machine.schedule || {}).map(([day, shifts]) => [
            day,
            {
              ...shifts,
              day: shifts.day === oldName ? newName : shifts.day,
              night: shifts.night === oldName ? newName : shifts.night,
            },
          ])
        ),
      }));
    }
    return next;
  }

  function countInjectionRefs(data, productName) {
    if (!productName || !data?.injection) return 0;
    let count = 0;
    for (const floor of Object.keys(data.injection)) {
      for (const machine of data.injection[floor] || []) {
        for (const shifts of Object.values(machine.schedule || {})) {
          if (shifts.day === productName) count++;
          if (shifts.night === productName) count++;
        }
      }
    }
    return count;
  }

  // 약품요청서 집계: 사출계획 셀(호기×시프트×제품) → 잉크 → 품목코드/호기 매핑.
  // 순수 함수, 데이터 변경 없음. data-service에 두는 이유는 inkAdd와 동일한 도메인 변환이기 때문.
  // 반환: { rows: [{code, ink, machine, f3, f1, total, hasCode}], unmappedProducts: Set<string> }
  //   - rows는 total desc 정렬
  //   - 잉크에 코드/호기가 없어도 행은 포함됨 (hasCode=false)
  //   - 잉크가 1개도 매핑 안 된 제품은 unmappedProducts 부산물로 알림
  function aggregateChemicalRequest(data, opts) {
    const o = opts || {};
    const days = (o.days && o.days.length) ? o.days : WEEKDAYS_PLUS;
    const shifts = (o.shifts && o.shifts.length) ? o.shifts : SHIFTS;
    const injection = data?.injection || {};
    const floors = (o.floors && o.floors.length) ? o.floors : Object.keys(injection);

    const dayFilter = new Set(days);
    const shiftFilter = new Set(shifts);
    const floorFilter = new Set(floors);

    const productInks = new Map();
    for (const p of (data?.products || [])) {
      productInks.set(p.name, (p.inks || []).filter(Boolean));
    }
    const inkMeta = new Map();
    for (const a of (data?.machineAssignments || [])) {
      const ink = a.ink || a.product || a.name || '';
      if (!ink || inkMeta.has(ink)) continue;
      inkMeta.set(ink, { code: a.code || '', machine: a.machine || '' });
    }

    const rowMap = new Map();
    const unmappedProducts = new Set();

    for (const floor of Object.keys(injection)) {
      if (!floorFilter.has(floor)) continue;
      const isF3 = floor === '3층';
      for (const machine of injection[floor] || []) {
        const schedule = machine.schedule || {};
        for (const day of Object.keys(schedule)) {
          if (!dayFilter.has(day)) continue;
          const cell = schedule[day] || {};
          for (const shift of Object.keys(cell)) {
            if (!shiftFilter.has(shift)) continue;
            const product = cell[shift];
            if (!product) continue;
            const inks = productInks.get(product);
            if (!inks || inks.length === 0) {
              unmappedProducts.add(product);
              continue;
            }
            for (const ink of inks) {
              if (!rowMap.has(ink)) {
                const meta = inkMeta.get(ink) || { code: '', machine: '' };
                rowMap.set(ink, {
                  code: meta.code,
                  ink,
                  machine: meta.machine,
                  f3: 0,
                  f1: 0,
                  total: 0,
                  hasCode: !!meta.code,
                });
              }
              const row = rowMap.get(ink);
              if (isF3) row.f3 += 1;
              else row.f1 += 1;
              row.total += 1;
            }
          }
        }
      }
    }

    const rows = Array.from(rowMap.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.ink.localeCompare(b.ink);
    });
    return { rows, unmappedProducts };
  }

  // 마스터 정합성 검증 — 사출계획·제품·잉크 마스터 간 결함을 카테고리별로 산출.
  // read-only, 부수효과 없음. 데이터 변경 없음.
  // 정규화 함수는 옵션 인자로 주입 (브라우저에서는 ui.jsx의 normalizeProductName, 테스트에서는 생략 가능)
  // 반환 구조는 docs/02-design/마스터-정합성.md 참고.
  function lintMasters(data, opts) {
    const o = opts || {};
    const norm = typeof o.normalize === 'function'
      ? o.normalize
      : (s) => String(s || '').trim().toUpperCase();
    const issues = [];

    const products = (data && data.products) || [];
    const assignments = (data && data.machineAssignments) || [];
    const injection = (data && data.injection) || {};

    // 1) 제품 마스터 인덱스: 원본 이름 → inks, 정규화 → 원본 이름
    const productInks = new Map();          // name → inks[] (Boolean true 인 것만)
    const normProductName = new Map();      // normalized → original name
    for (const p of products) {
      const name = String(p.name || '');
      if (!name) continue;
      const inks = (p.inks || []).filter(Boolean);
      productInks.set(name, inks);
      const n = norm(name);
      if (n && !normProductName.has(n)) normProductName.set(n, name);
      if (inks.length === 0) {
        issues.push({
          category: 'product-no-inks',
          severity: 'error',
          label: '제품에 잉크가 비어 있음',
          target: name,
          detail: p.brand ? `브랜드 ${p.brand}` : '',
          navTo: 'products',
          key: `product-no-inks:${name}`,
        });
      }
    }

    // 2) machineAssignments 인덱스
    const inkAssignCount = new Map();       // ink → count
    const inkAssignFirst = new Map();       // ink → { code, machine }
    for (const a of assignments) {
      const ink = String((a && (a.ink || a.product || a.name)) || '').trim();
      if (!ink) continue;
      inkAssignCount.set(ink, (inkAssignCount.get(ink) || 0) + 1);
      if (!inkAssignFirst.has(ink)) {
        inkAssignFirst.set(ink, { code: String(a.code || '').trim(), machine: String(a.machine || '').trim() });
      }
    }
    for (const [ink, count] of inkAssignCount.entries()) {
      if (count > 1) {
        issues.push({
          category: 'duplicate-ink-assignment',
          severity: 'warn',
          label: '잉크가 여러 호기에 중복 등록',
          target: ink,
          detail: `중복 ${count}건`,
          navTo: 'machines',
          key: `duplicate-ink-assignment:${ink}`,
        });
      }
      const meta = inkAssignFirst.get(ink);
      if (!meta.code) {
        issues.push({
          category: 'ink-no-code',
          severity: 'warn',
          label: '잉크 품목코드 미입력',
          target: ink,
          detail: meta.machine ? `호기 ${meta.machine}` : '',
          navTo: 'machines',
          key: `ink-no-code:${ink}`,
        });
      }
      if (!meta.machine) {
        issues.push({
          category: 'ink-no-machine',
          severity: 'warn',
          label: '잉크 사용 호기 미지정',
          target: ink,
          detail: meta.code ? `코드 ${meta.code}` : '',
          navTo: 'machines',
          key: `ink-no-machine:${ink}`,
        });
      }
    }

    // 3) injection 셀에서 제품 마스터에 없는 항목
    const reportedMissing = new Set();
    for (const floor of Object.keys(injection)) {
      const machines = injection[floor] || [];
      for (const machine of machines) {
        const schedule = machine.schedule || {};
        for (const day of Object.keys(schedule)) {
          const cell = schedule[day] || {};
          for (const shift of Object.keys(cell)) {
            const value = cell[shift];
            if (!value) continue;
            // TEST 런 셀은 제품이 아님 — 정합성 점검 제외 (검수 isTest 판정과 동일 기준)
            const normTest = normalizeProductName(value);
            if (normTest === 'TEST' || normTest === '테스트') continue;
            if (productInks.has(value)) continue;
            const n = norm(value);
            if (n && normProductName.has(n)) continue;
            if (reportedMissing.has(value)) continue;
            reportedMissing.add(value);
            const shiftLabel = shift === 'day' ? '주' : (shift === 'night' ? '야' : shift);
            const mname = String(machine.machine || '');
            issues.push({
              category: 'product-not-in-master',
              severity: 'error',
              label: '사출계획에 있으나 제품 마스터에 없음',
              target: value,
              detail: `${floor} ${mname} ${day}/${shiftLabel}`,
              navTo: 'products',
              key: `product-not-in-master:${value}`,
            });
          }
        }
      }
    }

    // 4) products[].inks 의 잉크 중 machineAssignments에 없는 것
    const inksFromProducts = new Set();
    for (const inks of productInks.values()) {
      for (const ink of inks) inksFromProducts.add(String(ink || '').trim());
    }
    const reportedInk = new Set();
    for (const ink of inksFromProducts) {
      if (!ink) continue;
      if (inkAssignCount.has(ink)) continue;
      if (reportedInk.has(ink)) continue;
      reportedInk.add(ink);
      issues.push({
        category: 'ink-not-in-assignments',
        severity: 'warn',
        label: '잉크가 잉크 마스터에 등록 안 됨',
        target: ink,
        detail: '',
        navTo: 'machines',
        key: `ink-not-in-assignments:${ink}`,
      });
    }

    // 5) machineAssignments에 있지만 어떤 제품도 사용하지 않는 잉크 (info)
    for (const ink of inkAssignCount.keys()) {
      if (inksFromProducts.has(ink)) continue;
      issues.push({
        category: 'orphan-ink-assignment',
        severity: 'info',
        label: '사용되지 않는 잉크 마스터',
        target: ink,
        detail: '제품 마스터에서 사용 안 함',
        navTo: 'machines',
        key: `orphan-ink-assignment:${ink}`,
      });
    }

    const sevWeight = { error: 2, warn: 1, info: 0 };
    issues.sort((a, b) => {
      const ws = sevWeight[b.severity] - sevWeight[a.severity];
      if (ws !== 0) return ws;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.target.localeCompare(b.target);
    });

    const byCategory = {};
    const bySeverity = { error: 0, warn: 0, info: 0 };
    for (const it of issues) {
      byCategory[it.category] = (byCategory[it.category] || 0) + 1;
      bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
    }
    return {
      summary: { total: issues.length, byCategory, bySeverity },
      issues,
    };
  }

  // 마스터 정합성 요약(lintMasters().summary) → 전역 경고 배지 표시 모델.
  // 순수 함수, 부수효과 없음. error 심각도(제품 마스터를 손봐야 발주 누락을 막는 결함)만
  // 배지화한다. warn/info(중복 등록·코드 미입력 등)는 상시 알람에서 제외해 알람 피로 방지.
  function buildMasterHealthBadge(lintSummary) {
    const s = lintSummary || {};
    const bySeverity = s.bySeverity || {};
    const byCategory = s.byCategory || {};
    const errorCount  = bySeverity.error || 0;
    const notInMaster = byCategory['product-not-in-master'] || 0;  // 사출계획에 있으나 마스터에 없는 제품
    const noInks      = byCategory['product-no-inks'] || 0;        // 잉크가 비어 있는 제품
    const show = errorCount > 0;
    const parts = [];
    if (notInMaster > 0) parts.push(`마스터에 없는 제품 ${notInMaster}건`);
    if (noInks > 0)      parts.push(`잉크 미등록 제품 ${noInks}건`);
    const tooltip = show
      ? `데이터 점검 필요 — ${parts.join(' · ')}`
      : '마스터 데이터 정상';
    return { errorCount, notInMaster, noInks, show, tooltip };
  }

  // 잉크 부족 신호 수집(순수 코어): weeklyNeed < 0 = 월요일 현재고로 주간 총소요 불가.
  // 단일 출처 = computeInkMetrics().weeklyNeed → ink-plan 페이지 빨강 표시와 동일 기준.
  // weeklyNeed는 '월'요일에만 산출되며, 현재고 미입력 잉크는 null → 자동 제외(오탐 방지).
  function collectInkShortage(merged, computedByInk) {
    const items = [];
    for (const ink of (merged || [])) {
      const wn = computedByInk.get(ink.name)?.get('월')?.weeklyNeed;
      if (wn != null && Number(wn) < 0) {
        items.push({ ink: ink.name, weeklyNeed: Number(wn) });
      }
    }
    items.sort((a, b) => a.weeklyNeed - b.weeklyNeed); // 가장 부족한 순
    const n = items.length;
    const names = items.slice(0, 3).map(i => i.ink).join(' · ');
    return {
      shortageCount: n,
      items,
      show: n > 0,
      tooltip: n > 0 ? `재고 부족 임박 ${n}건 — ${names}${n > 3 ? ' 외' : ''}` : '재고 정상',
    };
  }

  // 전역 알림용 어댑터: data → 부족 배지 모델. ink-plan 페이지와 동일 함수 합성.
  function buildInkShortageBadge(data, dates) {
    const days = WEEKDAYS;
    const productLookup     = buildProductLookup(data.products);
    const demandByInkDay    = buildDemandByInkDay(data.injection, productLookup);
    const inventoryByInkDay = buildInventoryByInkDay(data.inventory, dates);
    const merged            = mergeInkPlanAndTestInks(data.inkPlan, data.testInks, days);
    const computedByInk     = computeInkMetrics(merged, demandByInkDay, inventoryByInkDay, days);
    return collectInkShortage(merged, computedByInk);
  }

  // 전역 통합 대시보드 요약 모델(순수 합성). 기존 어댑터(lintMasters→buildMasterHealthBadge,
  // buildInkShortageBadge)를 단일 모델로 묶는다. 새 임계값·계산을 발명하지 않으므로 각 페이지·
  // 사이드바 배지·bell과 수치가 항상 일치한다. data===null 안전(모든 카운트 0, tone 'ok').
  function buildDashboardSummary(data, dates, opts) {
    opts = opts || {};
    const countOf = (v) => Array.isArray(v) ? v.length
      : (v && typeof v === 'object' ? Object.keys(v).length : 0);

    // 1) 마스터 정합성 — lintMasters → buildMasterHealthBadge (전역 배지와 동일 경로)
    const lint = lintMasters(data, opts.normalize ? { normalize: opts.normalize } : undefined);
    const mh = buildMasterHealthBadge(lint.summary);
    const master = {
      errorCount:  mh.errorCount || 0,
      notInMaster: mh.notInMaster || 0,
      noInks:      mh.noInks || 0,
      show:        !!mh.show,
      tooltip:     mh.tooltip,
      tone:        (mh.errorCount || 0) > 0 ? 'bad' : 'ok',
    };

    // 2) 재고 부족 임박 — buildInkShortageBadge (ink-plan 빨강 셀·bell과 동일 출처)
    // 진입 화면이라 부분/이상 데이터에도 절대 throw 금지 → 실패 시 '정상'으로 graceful.
    let sb = { shortageCount: 0, items: [], show: false, tooltip: '재고 정상' };
    if (data) {
      try { sb = buildInkShortageBadge(data, dates); } catch (e) { /* keep default */ }
    }
    const shortage = {
      count:   sb.shortageCount || 0,
      items:   (sb.items || []).slice(0, 5), // 가장 부족한 상위 5
      show:    !!sb.show,
      tooltip: sb.tooltip,
      tone:    (sb.shortageCount || 0) > 0 ? 'warn' : 'ok',
    };

    // 3) 마스터 규모(참고용, 비경보) — 배열/객체 모두 안전 카운트
    const d = data || {};
    const masters = {
      products:  countOf(d.products),
      inks:      countOf(d.inkPlan),
      chemicals: countOf(d.chemicals),
    };

    // 4) 이번 주 일정 — dates는 { 요일: 'M/D' } 객체(getWeekInfo) 또는 배열 모두 허용
    let weekDates = [];
    if (Array.isArray(dates)) {
      weekDates = dates;
    } else if (dates && typeof dates === 'object') {
      weekDates = WEEKDAYS.map(d => dates[d]).filter(Boolean);
    }
    const todayDate = (dates && !Array.isArray(dates) && opts.today)
      ? (dates[opts.today] || null) : null;
    const week = { today: opts.today || null, todayDate, dates: weekDates, dayCount: weekDates.length };

    return { master, shortage, masters, week };
  }

  // 약품요청서 인쇄 메타 — 작성자 fallback·문서번호·요약·결재 roster를 한 곳에서 산출.
  // todayISO는 주입(순수 유지). 데이터 변경 없음(read-only 인쇄 메타).
  function buildChemicalRequestMeta(totals, rangeLabel, requester, todayISO) {
    const name = (requester != null && String(requester).trim()) || '생산관리팀';
    const ymd = String(todayISO || '').split('-').join('');   // 2026-06-08 → 20260608
    const docNo = ymd ? `약품-${ymd}` : '약품-미상';
    const t = totals || { kinds: 0, total: 0, f3: 0, f1: 0, noCode: 0 };
    return {
      title: '잉크 발주 요청서',
      docNo,
      requesterName: name,
      rangeLabel: rangeLabel || '없음',
      summary: `총 잉크 ${t.kinds || 0}종 / 총 세트 ${t.total || 0} (3F ${t.f3 || 0} · 1F ${t.f1 || 0})`,
      noCode: t.noCode || 0,            // 인쇄물에도 코드미입력 경고 노출용
      approvals: ['작성', '검토', '승인'],
    };
  }

  function localDateISO(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 'YYYY-MM-DD' 를 로컬 자정 Date 로 파싱.
  // new Date('YYYY-MM-DD') 는 UTC 자정으로 해석되어 음수 타임존에서 요일/일자가
  // 하루 어긋나므로, 연·월·일을 직접 넣어 로컬 기준 Date 를 만든다.
  function parseDateLocal(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    const d = new Date(y, mo - 1, day);
    // 롤오버 거부: '2026-13-40' 같은 범위 초과 입력은 무효 처리
    if (isNaN(d) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  function getVisibleWeekdays(days, today, mode) {
    if (mode !== '3days') return days;
    const idx = days.indexOf(today);
    if (idx < 0) return today ? [today] : [];
    const end = Math.min(days.length - 1, idx + 2);
    return days.slice(idx, end + 1);
  }

  // 사출계획의 machine 객체에서 호기 번호 추출.
  // injection 데이터는 { no: 순번, machine: '10호기', schedule: ... } 형태이므로
  // OCR이 가져오는 r.machine_no(정수)와 매칭하려면 machine 문자열에서 첫 정수를 뽑아야 함.
  function machineNoOf(machine) {
    if (!machine) return null;
    const direct = Number(machine.machineNo);
    if (Number.isInteger(direct) && direct > 0) return direct;
    const s = String(machine.machine || machine.name || '');
    const m = s.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function updateMachineAssignment(assignments, inkName, machine) {
    const ink = String(inkName || '').trim();
    const nextMachine = String(machine || '').trim();
    if (!ink) return assignments || [];

    const source = assignments || [];
    const idx = source.findIndex(a => (a.ink || a.product || a.name || '') === ink);
    if (idx < 0) return nextMachine ? [...source, { ink, machine: nextMachine }] : source;

    if (!nextMachine) return source.filter((_, i) => i !== idx);

    const next = [...source];
    next[idx] = { ink, machine: nextMachine };
    return next;
  }

  function lotPrefix(inkName) {
    return String(inkName || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  }

  function dateMMDD(dateISO) {
    const d = parseDateLocal(dateISO);
    if (!d) return '';
    return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function dateFromLotNo(lotNo, fallbackDateISO) {
    const s = String(lotNo || '').toUpperCase();
    const m = s.match(/[A-Z0-9]*?(\d{2})(\d{2})\d{2}$/);
    if (!m) return fallbackDateISO || localDateISO();
    const base = parseDateLocal(fallbackDateISO) || new Date();
    // 연도는 fallback 기준이되, MM/DD가 fallback과 반년 이상 벌어지면
    // 연말/연초 경계로 보고 인접 연도(±1) 중 base에 가장 가까운 해를 택한다.
    // 예: 1월에 읽은 '1231…' LOT은 작년 12/31로, 12월에 읽은 '0101…'은 내년 1/1로 보정.
    let best = null;
    for (const yyyy of [base.getFullYear() - 1, base.getFullYear(), base.getFullYear() + 1]) {
      const iso = `${yyyy}-${m[1]}-${m[2]}`;
      const cand = parseDateLocal(iso);
      if (!cand) continue;
      const dist = Math.abs(cand.getTime() - base.getTime());
      if (!best || dist < best.dist) best = { iso, dist };
    }
    return best ? best.iso : (fallbackDateISO || localDateISO());
  }

  function lotSequenceForDate(lots, inkName, dateISO) {
    const ink = String(inkName || '');
    const prefix = lotPrefix(inkName);
    const mmdd = dateMMDD(dateISO);
    let maxSeq = 0;
    for (const lot of (lots || [])) {
      if (lot.ink !== ink || lot.registeredDate !== dateISO) continue;
      const lotNo = String(lot.lotNo || '');
      const suffix = lotNo.startsWith(prefix + mmdd) ? Number(lotNo.slice((prefix + mmdd).length)) : Number(lot.order);
      if (!isNaN(suffix)) maxSeq = Math.max(maxSeq, suffix);
    }
    return maxSeq + 1;
  }

  function nextInventoryLotNo(inkName, dateISO, lots) {
    const prefix = lotPrefix(inkName);
    const mmdd = dateMMDD(dateISO);
    const seq = lotSequenceForDate(lots, inkName, dateISO);
    return `${prefix}${mmdd}${String(seq).padStart(2, '0')}`;
  }

  function initialInventoryLot(lots, inkName) {
    const ink = String(inkName || '');
    const inkLots = initialInventoryLots(lots, ink);
    return inkLots.find(l => l.role === 'initial' || l.order === 1) || inkLots[0] || null;
  }

  function initialInventoryLots(lots, inkName) {
    const ink = String(inkName || '');
    return (lots || [])
      .filter(l => l.ink === ink && l.role !== 'relabel' && !l.parentId)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function relabelLotsForInitial(lots, initialLot) {
    if (!initialLot) return [];
    const sameInkInitials = initialInventoryLots(lots, initialLot.ink);
    const canUseLegacy = sameInkInitials.length <= 1;
    return (lots || [])
      .filter(l => l.ink === initialLot.ink && (l.role === 'relabel' || Number(l.order) > 1))
      .filter(l => l.parentId === initialLot.id || (!l.parentId && canUseLegacy))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function relabelLotsForDate(lots, inkName, dateISO) {
    const initial = initialInventoryLot(lots, inkName);
    return relabelLotsForInitial(lots, initial).filter(l => l.registeredDate === dateISO);
  }

  function actualInventoryLotForInitial(lots, initialLot, dateISO) {
    if (!initialLot) return null;
    const relabels = relabelLotsForInitial(lots, initialLot)
      .filter(l => !dateISO || l.registeredDate <= dateISO);
    return relabels[relabels.length - 1] || initialLot;
  }

  function actualInventoryLot(lots, inkName, dateISO) {
    return actualInventoryLotForInitial(lots, initialInventoryLot(lots, inkName), dateISO);
  }

  function relabelInventoryLot(inventory, initialLotId, dateISO, idFactory) {
    const inv = inventory || { lots: [], daily: {} };
    const initial = (inv.lots || []).find(l => l.id === initialLotId && l.role !== 'relabel')
      || initialInventoryLot(inv.lots, initialLotId)
      || null;
    if (!initial) return inv;
    const existing = relabelLotsForInitial(inv.lots, initial);
    const nextOrder = Math.max(1, ...existing.map(l => Number(l.order || 1))) + 1;
    if (nextOrder > 3) return inv;

    const prefix = lotPrefix(initial.ink);
    const mmdd = dateMMDD(dateISO);
    const lot = {
      id: idFactory ? idFactory() : `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ink: String(initial.ink || ''),
      lotNo: `${prefix}${mmdd}${String(nextOrder).padStart(2, '0')}`,
      registeredDate: dateISO,
      role: 'relabel',
      order: nextOrder,
      parentId: initial.id,
    };
    return {
      ...inv,
      lots: [...(inv.lots || []), lot],
      daily: {
        ...(inv.daily || {}),
        [dateISO]: { ...((inv.daily || {})[dateISO] || {}) },
      },
    };
  }

  function removeInventoryLot(inventory, lotId) {
    const inv = inventory || { lots: [], daily: {} };
    const removeIds = new Set([lotId]);
    for (const lot of inv.lots || []) {
      if (lot.parentId === lotId) removeIds.add(lot.id);
    }
    const daily = {};
    for (const [dateISO, valueMap] of Object.entries(inv.daily || {})) {
      const nextMap = { ...(valueMap || {}) };
      for (const id of removeIds) delete nextMap[id];
      daily[dateISO] = nextMap;
    }
    const next = {
      ...inv,
      lots: (inv.lots || []).filter(l => !removeIds.has(l.id)),
      daily,
    };
    if (Array.isArray(inv.order)) next.order = inv.order.filter(id => !removeIds.has(id));
    return next;
  }

  function removeInventoryInk(inventory, inkName) {
    const inv = inventory || { lots: [], daily: {} };
    const ids = new Set((inv.lots || []).filter(l => l.ink === inkName).map(l => l.id));
    const daily = {};
    for (const [dateISO, valueMap] of Object.entries(inv.daily || {})) {
      const nextMap = { ...(valueMap || {}) };
      for (const id of ids) delete nextMap[id];
      daily[dateISO] = nextMap;
    }
    const next = {
      ...inv,
      lots: (inv.lots || []).filter(l => l.ink !== inkName),
      daily,
    };
    if (Array.isArray(inv.order)) next.order = inv.order.filter(id => !ids.has(id));
    return next;
  }

  // 잉크 마스터(정본 목록): machineAssignments + inkPlan + products[].inks 합집합.
  // 정규화(trim+lowercase) 후 dedup, 표시명은 첫 발견 원형 유지, 정렬 반환.
  // ui.jsx의 inkOfAssignment 규칙(a.ink || a.product || a.name)을 내장 — 순수 계층은 ui.jsx 의존 불가.
  // 잉크명 식별 정규화 (마스터 비교·dedup용): null-safe + trim + lowercase.
  // 잉크명 동일성 판정의 단일 출처 — products.jsx·review.jsx·내부 마스터 빌더가 모두 위임.
  function normalizeInkName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function buildInkMaster(data) {
    const map = new Map();
    const add = (raw) => {
      if (!raw) return;
      const norm = normalizeInkName(raw);
      if (norm && !map.has(norm)) map.set(norm, raw);
    };
    const d = data || {};
    for (const a of (d.machineAssignments || [])) add(a && (a.ink || a.product || a.name));
    for (const i of (d.inkPlan || [])) add(i && i.name);
    for (const p of (d.products || [])) for (const ink of ((p && p.inks) || [])) add(ink);
    return Array.from(map.values()).sort();
  }

  // 잉크명이 마스터 목록에 있는지 정규화 비교.
  function isInkInMaster(name, master) {
    const norm = normalizeInkName(name);
    if (!norm) return false;
    return (master || []).some(m => normalizeInkName(m) === norm);
  }

  // ── CascadePicker 파생 순수 함수 (ui.jsx 위임, 동작 보존) ───────────────────
  // 브랜드 컬럼: brand 필드 있는 제품만 Set dedup 후 정렬.
  function buildCascadeBrands(products) {
    const s = new Set();
    for (const p of (products || [])) if (p && p.brand) s.add(p.brand);
    return Array.from(s).sort();
  }

  // 제품 컬럼: brand falsy면 빈 배열, 아니면 해당 brand 제품만.
  function cascadeProductsInBrand(products, brand) {
    if (!brand) return [];
    return (products || []).filter(p => p && p.brand === brand);
  }

  // 잉크 컬럼: name falsy면 빈 배열, 아니면 해당 제품 inks 중 truthy만.
  function cascadeInksInProduct(products, name) {
    if (!name) return [];
    const p = (products || []).find(x => x && x.name === name);
    return ((p && p.inks) || []).filter(Boolean);
  }

  // 검색 필터: query trim/소문자 후 keyFn(item) 부분일치. 빈 query면 원본 그대로.
  function filterByQuery(items, query, keyFn) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return items || [];
    const key = keyFn || (x => x);
    return (items || []).filter(it => String(key(it) == null ? '' : key(it)).toLowerCase().includes(q));
  }

  // ── 공유 normalize 헬퍼 (ui.jsx 에서 위임) ──────────────────────────────────

  // 제품명 정규화 (OCR ↔ master 비교용): NFC + 대문자 + 공백/특수문자 제거
  function normalizeProductName(name) {
    if (!name) return '';
    let s = String(name).normalize('NFC').trim().toUpperCase();
    s = s.replace(/[_\-\s/\\()（）\[\]【】·・.,，]+/g, '');
    s = s.replace(/[^\w가-힣%]/g, '');
    return s;
  }

  // OCR brand "PIA / 액상" → "PIA" (슬래시 앞부분, 대문자)
  function normalizeBrand(brand) {
    if (!brand) return '';
    return String(brand).split('/')[0].trim().toUpperCase();
  }

  // ISO 날짜 → 한국어 요일 ('월'~'일'). 잘못된 입력 시 fallback.
  function dayFromDate(iso, fallback = '월') {
    const d = parseDateLocal(iso);
    if (!d) return fallback;
    return DAY_BY_IDX[d.getDay()];
  }

  // 시스템 날짜에서 "이번 주" 정보 계산 (ui.jsx 에서 이전 — 날짜 로직 단일 출처).
  //   - today: 한국어 요일 ('월'~'일') — 토/일이면 그 자체
  //   - dates: { '월':'M/D', '화':'M/D', ..., '일':'M/D', '차주월':'M/D' }
  //   - isoLabel: 'YYYY-Www' (ISO 8601 주차, 그 주 목요일이 속한 해 기준)
  //   - monthWeekLabel: 'n월 n주차' (그 주 월요일이 그 달의 몇 번째 월요일인지)
  function getWeekInfo(now = new Date()) {
    const days = WEEKDAYS;
    const todayName = DAY_BY_IDX[now.getDay()];
    // 월요일까지 며칠 빼야 하는가 (일=6, 월=0, 화=1, …, 토=5)
    const offsetToMonday = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - offsetToMonday);
    const dates = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates[days[i]] = `${d.getMonth() + 1}/${d.getDate()}`;
    }
    const nextMon = new Date(monday);
    nextMon.setDate(monday.getDate() + 7);
    dates['차주월'] = `${nextMon.getMonth() + 1}/${nextMon.getDate()}`;

    // ISO 8601 주차 (그 주 목요일이 속한 해 기준)
    const thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);
    const isoYear = thursday.getFullYear();
    const yearStart = new Date(isoYear, 0, 1);
    const isoWeek = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const isoLabel = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

    // "n월 n주차" — 그 주 월요일이 그 달의 몇 번째 월요일인지
    const weekOfMonth = Math.floor((monday.getDate() - 1) / 7) + 1;
    const monthWeekLabel = `${monday.getMonth() + 1}월 ${weekOfMonth}주차`;

    return { today: todayName, dates, isoLabel, monthWeekLabel };
  }

  // machineAssignments record에서 잉크명 추출 (구버전 호환)
  function inkOfAssignment(a) {
    return (a && (a.ink || a.product || a.name)) || '';
  }

  // ── ink-plan 파생 엔진 (pages/ink-plan.jsx 에서 이전) ───────────────────────

  function buildProductLookup(products) {
    const exact = new Map();
    const normalized = new Map();
    for (const p of products || []) {
      if (p.name) exact.set(p.name, p);
      const key = normalizeProductName(p.name);
      if (key && !normalized.has(key)) normalized.set(key, p);
    }
    return { exact, normalized };
  }

  function resolveProductIn(lookup, name) {
    if (!name) return null;
    return lookup.exact.get(name)
      || lookup.normalized.get(normalizeProductName(name))
      || null;
  }

  // 제품 마스터에서 브랜드 옵션(빈값 제외·중복 제거·정렬) — injection/products 공용
  function buildBrandOptions(products) {
    const s = new Set();
    for (const p of products || []) if (p.brand) s.add(p.brand);
    return Array.from(s).sort();
  }

  // 잉크 → 사출계획에서 이 잉크를 쓰는 제품 이름 목록
  function buildProductsUsingInk(injection, productLookup) {
    const map = new Map();
    for (const floor of Object.keys(injection || {})) {
      for (const m of injection[floor]) {
        for (const sh of Object.values(m.schedule || {})) {
          for (const productName of [sh.day, sh.night]) {
            const product = resolveProductIn(productLookup, productName);
            if (!product) continue;
            for (const ink of (product.inks || [])) {
              if (!ink) continue;
              if (!map.has(ink)) map.set(ink, []);
              if (!map.get(ink).includes(product.name)) map.get(ink).push(product.name);
            }
          }
        }
      }
    }
    return map;
  }

  // 잉크 × 요일 → 필요 세트 수 (사출계획 셀이 채워진 만큼)
  function buildDemandByInkDay(injection, productLookup) {
    const map = new Map();
    for (const floor of Object.keys(injection || {})) {
      for (const m of injection[floor] || []) {
        for (const [day, shifts] of Object.entries(m.schedule || {})) {
          for (const productName of [shifts.day, shifts.night]) {
            const product = resolveProductIn(productLookup, productName);
            if (!product) continue;
            for (const ink of (product.inks || [])) {
              if (!ink) continue;
              if (!map.has(ink)) map.set(ink, new Map());
              const byDay = map.get(ink);
              byDay.set(day, (byDay.get(day) || 0) + 1);
            }
          }
        }
      }
    }
    return map;
  }

  // 잉크 → 호기 매핑 (read-only)
  function buildInkToMachine(machineAssignments) {
    const m = new Map();
    for (const a of (machineAssignments || [])) {
      const ink = inkOfAssignment(a);
      if (ink && !m.has(ink)) m.set(ink, a.machine || '');
    }
    return m;
  }

  // 재고 조사 연동: 잉크명 × 요일 → lot 합산 재고 (Map<ink, Map<dayKor, sum>>)
  function buildInventoryByInkDay(inventory, dates) {
    const result = new Map();
    if (!inventory || !inventory.lots || !inventory.daily) return result;

    const lotsByInk = new Map();
    for (const lot of inventory.lots) {
      if (!lotsByInk.has(lot.ink)) lotsByInk.set(lot.ink, []);
      lotsByInk.get(lot.ink).push(lot);
    }
    const mdToDay = {};
    for (const [day, md] of Object.entries(dates)) mdToDay[md] = day;

    for (const [dateIso, valueMap] of Object.entries(inventory.daily)) {
      const dt = new Date(dateIso);
      if (isNaN(dt)) continue;
      const md = `${dt.getMonth() + 1}/${dt.getDate()}`;
      const dayKor = mdToDay[md];
      if (!dayKor) continue;
      for (const [inkName, lots] of lotsByInk.entries()) {
        let sum = 0, any = false;
        for (const lot of lots) {
          const v = valueMap[lot.id];
          if (v !== undefined && v !== null && !isNaN(Number(v))) {
            sum += Number(v); any = true;
          }
        }
        if (any) {
          if (!result.has(inkName)) result.set(inkName, new Map());
          result.get(inkName).set(dayKor, sum);
        }
      }
    }
    return result;
  }

  // 정식 inkPlan + testInks 머지 — 같은 이름이면 정식 유지 + testStatus 칩만
  function mergeInkPlanAndTestInks(inkPlan, testInks, days) {
    const list = inkPlan || [];
    const testMap = new Map((testInks || []).map(t => [t.name, t]));
    const formalNames = new Set(list.map(i => i.name));

    const formal = list.map(i => {
      const t = testMap.get(i.name);
      return {
        ...i,
        isTest: false,
        testStatus: t?.status || null,
        testNote: t?.note || '',
        startDay: t ? dayFromDate(t.addedDate) : '월',
      };
    });
    const testOnly = (testInks || [])
      .filter(t => !formalNames.has(t.name))
      .map(t => ({
        name: t.name,
        isTest: true,
        testStatus: t.status,
        testNote: t.note,
        startDay: dayFromDate(t.addedDate),
        days: Object.fromEntries(days.map(d => [d, {}])),
      }));
    return [...formal, ...testOnly];
  }

  // 잉크 × 요일 → { stock, required, manufacture, availableDays, weeklyNeed, stockFromInv }
  // stock 우선순위: 수동값 > inventory 연동 > 전날 endStock carry
  function computeInkMetrics(merged, demandByInkDay, inventoryByInkDay, days) {
    const result = new Map();
    const toNum = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };
    const round1 = (v) => Math.round(v * 10) / 10;

    for (const ink of merged) {
      const byDay = new Map();
      const demand = demandByInkDay.get(ink.name) || new Map();
      const totalRequired = [...days, '차주월'].reduce((sum, d) => sum + (demand.get(d) || 0), 0);
      let carry = null;

      for (const d of days) {
        const dd = ink.days?.[d] || {};
        const invStock = inventoryByInkDay.get(ink.name)?.get(d);
        const manualStock = toNum(dd['현재고']);
        const stock = manualStock !== null
          ? manualStock
          : (invStock !== undefined ? Number(invStock) : carry);
        const required = demand.get(d) || 0;
        const manufacture = toNum(dd['제조량']) || 0;
        const availableDays = stock !== null && required > 0 ? round1(stock / required) : null;
        const weeklyNeed = d === '월' && stock !== null && totalRequired > 0 ? stock - totalRequired : null;
        const endStock = stock !== null ? stock + manufacture - required : null;

        byDay.set(d, {
          stock,
          required,
          manufacture,
          availableDays,
          weeklyNeed,
          stockFromInv: invStock !== undefined,
        });
        carry = endStock;
      }
      result.set(ink.name, byDay);
    }
    return result;
  }

  // 자동 배정 후보: 당일 제조량 비고, 월요일 필요수량 음수(부족)인 정식 잉크. 잠긴 셀 제외.
  function buildAutoAssignCandidates(inkPlan, testInks, today, days, computedByInk) {
    const out = [];
    const testMap = new Map((testInks || []).map(t => [t.name, t]));
    const todayIdx = days.indexOf(today);

    for (const ink of (inkPlan || [])) {
      const todayCell = ink.days?.[today] || {};
      const cur = todayCell['제조량'];
      if (cur != null && cur !== '') continue;

      const need = computedByInk.get(ink.name)?.get('월')?.weeklyNeed;
      if (need == null || need === '') continue;
      const needNum = Number(need);
      if (isNaN(needNum) || needNum >= 0) continue;

      const t = testMap.get(ink.name);
      if (t) {
        const startIdx = days.indexOf(dayFromDate(t.addedDate));
        if (todayIdx >= startIdx) continue;
      }
      out.push({ name: ink.name, need: needNum, suggested: Math.abs(needNum) });
    }
    return out;
  }

  // ── review / OCR 매칭 (pages/review.jsx 에서 이전) ──────────────────────────

  // OCR 한 행을 마스터와 매칭 — { status, matchedName?, candidates?, suggestedBrand? }
  function matchOcrRow(r, masterIndex) {
    // TEST 행 판정 — 미등록 목록에서 제외(등록 불필요, 단 사출계획에는 그대로 반영):
    //  · 제품명 비어있음
    //  · 제품명이 TEST/테스트 (구분자·공백·괄호 변형 포함: "(TEST)", "T.E.S.T" 등 정규화 후 비교)
    //  · 구분(brand)란이 TEST — 테스트 런은 제품명이 있어도 구분란에 TEST로 표기됨
    const nameNorm = normalizeProductName(r.product_name);
    const brandNorm = normalizeProductName(r.brand);
    const isTest = !String(r.product_name || '').trim()
      || nameNorm === 'TEST'
      || nameNorm === '테스트'
      || brandNorm === 'TEST';
    if (isTest) {
      return { isTest: true, status: 'skip', matchedName: null, confidence: 0, candidates: [] };
    }

    const normName = normalizeProductName(r.product_name);
    const normCustomer = normalizeBrand(r.brand);
    const sameName = masterIndex.products.filter(p => normalizeProductName(p.name) === normName);
    const exactProduct = (normName && normCustomer)
      ? sameName.find(p => normalizeBrand(p.customer || p.brand) === normCustomer)
      : null;

    if (exactProduct) {
      return { isTest: false, status: 'exact', matchedName: exactProduct.name, confidence: 1, candidates: [] };
    }
    if (sameName.length === 1) {
      return {
        isTest: false,
        status: 'brand-mismatch',
        matchedName: sameName[0].name,
        confidence: 0.8,
        candidates: sameName,
        suggestedBrand: sameName[0].customer || sameName[0].brand || '',
      };
    }
    return { isTest: false, status: 'none', matchedName: null, confidence: 0, candidates: sameName };
  }

  // OCR parsed → 행 flat 리스트
  function buildReviewRows(ocrResult, masterIndex) {
    if (!ocrResult?.parsed) return [];
    const out = [];
    for (const sh of ocrResult.parsed.shifts || []) {
      for (let i = 0; i < (sh.rows || []).length; i++) {
        const r = sh.rows[i];
        const match = matchOcrRow(r, masterIndex);
        out.push({
          rowKey: `${sh.shift}-${r.machine_no}-${i}`,
          shift: sh.shift,
          machine_no: r.machine_no,
          floor: r.floor,
          brand: r.brand,
          variant: r.variant,
          ocrName: r.product_name,
          ...match,
        });
      }
    }
    return out;
  }

  // 같은 제품(이름+브랜드)을 한 그룹으로 묶음 — TEST는 행마다 별도 그룹
  function buildProductGroups(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.isTest
        ? `TEST:${row.rowKey}`
        : `${normalizeProductName(row.ocrName)}|${normalizeBrand(row.brand)}`;
      if (!map.has(key)) {
        map.set(key, { ...row, groupKey: key, rowKeys: [], occurs: [] });
      }
      const group = map.get(key);
      group.rowKeys.push(row.rowKey);
      group.occurs.push({ machine_no: row.machine_no, shift: row.shift, floor: row.floor });
      if (row.status === 'exact' && group.status !== 'exact') {
        group.status = row.status;
        group.matchedName = row.matchedName;
      } else if (row.status === 'brand-mismatch' && group.status === 'none') {
        group.status = row.status;
        group.matchedName = row.matchedName;
        group.suggestedBrand = row.suggestedBrand;
      }
    }
    return Array.from(map.values());
  }

  // 그룹 단위로 OCR row 의 한 필드를 변경한 새 ocrResult 반환
  function mapOcrRowsInGroup(ocrResult, rowKeys, field, value) {
    const rowKeySet = new Set(rowKeys);
    return {
      ...ocrResult,
      parsed: {
        ...ocrResult.parsed,
        shifts: (ocrResult.parsed.shifts || []).map(sh => ({
          ...sh,
          rows: (sh.rows || []).map((r, i) => {
            const rk = `${sh.shift}-${r.machine_no}-${i}`;
            return rowKeySet.has(rk) ? { ...r, [field]: value } : r;
          }),
        })),
      },
    };
  }

  // 호기 번호 변경은 rowKey 자체가 바뀌므로 keyMap을 함께 반환
  function changeMachineInGroup(ocrResult, rowKeys, nextMachineNo) {
    const rowKeySet = new Set(rowKeys);
    const keyMap = new Map();
    const next = {
      ...ocrResult,
      parsed: {
        ...ocrResult.parsed,
        shifts: (ocrResult.parsed.shifts || []).map(sh => ({
          ...sh,
          rows: (sh.rows || []).map((r, i) => {
            const oldKey = `${sh.shift}-${r.machine_no}-${i}`;
            if (!rowKeySet.has(oldKey)) return r;
            keyMap.set(oldKey, `${sh.shift}-${nextMachineNo}-${i}`);
            return { ...r, machine_no: nextMachineNo };
          }),
        })),
      },
    };
    return { next, keyMap };
  }

  // 사출계획 그리드에 OCR 결과 머지 — 같은 요일·시프트 셀이면 덮어씀(현장이 최신)
  function applyOcrToInjection(data, ocrResult, decisions) {
    const dayOf = (iso) => {
      const d = parseDateLocal(iso);
      return d ? DAY_BY_IDX[d.getDay()] : null;
    };

    const requestDate = parseDateLocal(ocrResult.parsed.request_date);
    const requestDay = requestDate ? DAY_BY_IDX[requestDate.getDay()] : null;
    let nextDay = dayOf(ocrResult.parsed.next_date);
    if (!nextDay && requestDate) {
      const t = new Date(requestDate);
      t.setDate(t.getDate() + 1);
      nextDay = DAY_BY_IDX[t.getDay()];
    }
    if (!requestDay) {
      return { error: 'no-request-day' };
    }

    const newData = { ...data };
    newData.injection = {};
    for (const floor of Object.keys(data.injection || {})) {
      newData.injection[floor] = data.injection[floor].map(m => ({
        ...m,
        schedule: Object.fromEntries(
          Object.entries(m.schedule || {}).map(([d, s]) => [d, { ...s }])
        ),
      }));
    }

    const mergedByShift = { '주간': 0, '야간': 0, '명일주간': 0 };
    let skippedNoMachine = 0;
    let skippedNoMatch = 0;
    const floorMap = { '3F': '3층', '1F': '1층' };

    for (const sheet of ocrResult.parsed.shifts || []) {
      const targetDay = sheet.shift === '명일주간' ? nextDay : requestDay;
      const shiftKey = sheet.shift === '야간' ? 'night' : 'day';
      if (!targetDay) continue;

      for (let i = 0; i < (sheet.rows || []).length; i++) {
        const r = sheet.rows[i];
        const rowKey = `${sheet.shift}-${r.machine_no}-${i}`;
        const decision = decisions[rowKey];
        if (!decision) { skippedNoMatch++; continue; }
        if (decision.action === 'skip' && decision.reason !== 'TEST') continue;

        const productName = decision.target || r.product_name;
        if (!productName) continue;

        const targetFloors = floorMap[r.floor]
          ? [floorMap[r.floor]]
          : Object.keys(newData.injection);
        let found = false;
        for (const floor of targetFloors) {
          const list = newData.injection[floor] || [];
          const machine = list.find(m => machineNoOf(m) === r.machine_no);
          if (!machine) continue;
          if (!machine.schedule[targetDay]) machine.schedule[targetDay] = { day: '', night: '' };
          machine.schedule[targetDay][shiftKey] = productName;
          mergedByShift[sheet.shift] = (mergedByShift[sheet.shift] || 0) + 1;
          found = true;
          break;
        }
        if (!found) skippedNoMachine++;
      }
    }

    const mergedDays = [...new Set([requestDay, nextDay].filter(Boolean))];
    return { nextData: newData, mergedByShift, skippedNoMachine, skippedNoMatch, mergedDays };
  }

  // ── 엑셀 재고 조사표 가져오기 (pages/inventory.jsx 에서 사용) ──────────────────

  // 시트 rows(array-of-arrays)에서 재고 조사표 구조 해석.
  // 헤더 행('잉크명' 셀) 탐색 → Lot 컬럼 + 요일 컬럼(월~일, 부헤더의 M/D를 라벨로) 수집.
  // 반환: { dateCols: [{col, day, label}], rows: [{ink, lotNo, values: {label: raw}}] }
  function parseInventorySheetRows(rows) {
    const list = rows || [];
    let h = -1, inkCol = -1;
    for (let i = 0; i < list.length; i++) {
      const r = list[i] || [];
      const j = r.findIndex(c => String(c == null ? '' : c).trim() === '잉크명');
      if (j >= 0) { h = i; inkCol = j; break; }
    }
    if (h < 0) return { dateCols: [], rows: [], error: 'no-header' };
    const hdr = list[h] || [];
    const sub = list[h + 1] || [];
    let lotCol = -1;
    for (let j = 0; j < hdr.length; j++) {
      if (j !== inkCol && lotCol < 0 && /lot/i.test(String(hdr[j] || ''))) lotCol = j;
    }
    const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
    const dateCols = [];
    for (let j = 0; j < hdr.length; j++) {
      const day = String(hdr[j] == null ? '' : hdr[j]).trim();
      if (!DAYS.includes(day)) continue;
      const label = String(sub[j] == null ? '' : sub[j]).trim();
      dateCols.push({ col: j, day, label: label || day });
    }
    const out = [];
    for (let i = h + 2; i < list.length; i++) {
      const r = list[i] || [];
      const ink = String(r[inkCol] == null ? '' : r[inkCol]).trim();
      if (!ink) continue;
      const lotNo = lotCol >= 0 ? String(r[lotCol] == null ? '' : r[lotCol]).trim() : '';
      const values = {};
      for (const dc of dateCols) {
        const v = r[dc.col];
        if (v != null && String(v).trim() !== '') values[dc.label] = v;
      }
      out.push({ ink, lotNo, values });
    }
    return { dateCols, rows: out };
  }

  // 선택한 날짜 라벨의 값을 '오늘 재고'로 넣는 실행 계획 (적용은 페이지에서).
  //  · 기존 lot 보유 잉크 → sets (오늘 기준 actual lot 에 값)
  //  · 잉크 마스터엔 있으나 lot 없음 → creates (lot 신규 등록 + 값)
  //  · 마스터에도 없음 → unknowns (제외 — 미리보기 표시용)
  // 같은 잉크가 여러 행이면 첫 행만 사용. 숫자 아닌 값은 건너뜀.
  function buildInventoryImportPlan(parsed, label, data, todayISO) {
    const lots = (data && data.inventory && data.inventory.lots) || [];
    // buildInkMaster 는 원본 이름 배열 반환 → 정규화 lookup 으로 변환
    const master = new Map();
    for (const name of buildInkMaster(data || {})) {
      const n = normalizeInkName(name);
      if (n && !master.has(n)) master.set(n, name);
    }
    const lotInkByNorm = new Map();
    for (const l of lots) {
      const n = normalizeInkName(l.ink);
      if (n && !lotInkByNorm.has(n)) lotInkByNorm.set(n, l.ink);
    }
    const sets = [], creates = [], unknowns = [];
    const seen = new Set();
    for (const row of (parsed && parsed.rows) || []) {
      const raw = row.values ? row.values[label] : undefined;
      if (raw == null || String(raw).trim() === '') continue;
      const num = Number(String(raw).replace(/,/g, ''));
      if (isNaN(num)) continue;
      const norm = normalizeInkName(row.ink);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      if (lotInkByNorm.has(norm)) {
        const inkName = lotInkByNorm.get(norm);
        const actual = actualInventoryLot(lots, inkName, todayISO);
        if (actual) {
          sets.push({ ink: inkName, lotId: actual.id, lotNo: actual.lotNo, value: num });
          continue;
        }
      }
      if (master.has(norm)) {
        creates.push({ ink: master.get(norm), lotNo: row.lotNo || '', value: num });
      } else {
        unknowns.push({ ink: row.ink, value: num });
      }
    }
    return { sets, creates, unknowns };
  }

  // 오늘 사출 라인업 — 오늘 요일에 주/야간 제품이 잡힌 호기만 추림 (대시보드 read-only 패널)
  function buildTodayLineup(injection, todayKor) {
    const rows = [];
    if (!todayKor) return rows;
    for (const floor of Object.keys(injection || {})) {
      for (const m of injection[floor] || []) {
        const cell = (m.schedule || {})[todayKor] || {};
        const day = String(cell.day || '').trim();
        const night = String(cell.night || '').trim();
        if (!day && !night) continue;
        const no = machineNoOf(m);
        rows.push({
          floor,
          machineNo: no,
          machine: String(m.machine || (no != null ? `${no}호기` : '')),
          day,
          night,
        });
      }
    }
    rows.sort((a, b) => a.floor === b.floor
      ? (a.machineNo ?? 999) - (b.machineNo ?? 999)
      : (a.floor < b.floor ? -1 : 1));
    return rows;
  }

  // ── OCR 결과 검증·grounding (검수 페이지·ocr-import 에서 사용) ─────────────────

  // OCR 파싱 결과를 마스터·사출계획과 대조해 구조적 이상을 찾는다 (결정적 검증).
  // 반환: [{ level:'error'|'warn', type, message }] — 검수 페이지 경고 패널용.
  function lintOcrResult(parsed, data) {
    if (!parsed) return [{ level: 'error', type: 'no-parsed', message: 'OCR 결과가 비어 있습니다' }];
    const issues = [];

    // 1) 날짜 정합: request_date 필수, next_date 는 보통 요청일+1
    const req = parseDateLocal(parsed.request_date);
    if (!req) {
      issues.push({ level: 'error', type: 'bad-request-date', message: `요청일을 해석할 수 없음: "${parsed.request_date || ''}"` });
    }
    const next = parseDateLocal(parsed.next_date);
    if (!next) {
      issues.push({ level: 'warn', type: 'bad-next-date', message: '명일 날짜 누락/해석 불가 — 요청일+1로 추론됨' });
    } else if (req) {
      const expected = new Date(req);
      expected.setDate(expected.getDate() + 1);
      if (localDateISO(expected) !== localDateISO(next)) {
        issues.push({ level: 'warn', type: 'next-date-gap', message: `명일(${parsed.next_date})이 요청일+1(${localDateISO(expected)})과 다름 — 헤더 날짜 오독 가능성` });
      }
    }

    // 2) 알려진 호기 집합 (사출계획 기준)
    const knownMachines = new Set();
    for (const floor of Object.keys(data?.injection || {})) {
      for (const m of data.injection[floor] || []) {
        const no = machineNoOf(m);
        if (no != null) knownMachines.add(no);
      }
    }

    // 3) 시프트별: 미지 호기 / 같은 시프트 내 중복 / 시프트 간 호기 집합 불일치
    const shiftSets = new Map();
    for (const sh of parsed.shifts || []) {
      const seen = new Map();
      for (const r of sh.rows || []) {
        seen.set(r.machine_no, (seen.get(r.machine_no) || 0) + 1);
        if (knownMachines.size && !knownMachines.has(Number(r.machine_no))) {
          issues.push({ level: 'warn', type: 'unknown-machine', message: `${sh.shift} ${r.machine_no}호기: 사출계획에 없는 호기 — 번호 오독 가능성` });
        }
      }
      for (const [no, cnt] of seen) {
        if (cnt > 1) issues.push({ level: 'warn', type: 'dup-machine', message: `${sh.shift} ${no}호기: 같은 시프트에 ${cnt}회 중복 추출` });
      }
      shiftSets.set(sh.shift, new Set(seen.keys()));
    }
    const allNos = new Set();
    for (const s of shiftSets.values()) for (const no of s) allNos.add(no);
    for (const [shift, s] of shiftSets) {
      const missing = [...allNos].filter(no => !s.has(no)).sort((a, b) => a - b);
      if (missing.length) {
        issues.push({ level: 'warn', type: 'shift-set-mismatch', message: `${shift}에 누락된 호기: ${missing.join(', ')} — 시프트 분리 오류 가능성` });
      }
    }

    // 4) 미지 브랜드 (마스터 brand 어휘 기준 — TEST·빈값 제외, 대소문자 무시)
    const knownBrands = new Set(buildBrandOptions(data?.products).map(b => b.toLowerCase()));
    const unknownBrands = new Map();
    for (const sh of parsed.shifts || []) {
      for (const r of sh.rows || []) {
        const b = String(r.brand || '').trim();
        if (!b || normalizeProductName(b) === 'TEST') continue; // TEST 변형 표기 포함 제외
        if (knownBrands.size && !knownBrands.has(b.toLowerCase())) {
          if (!unknownBrands.has(b)) unknownBrands.set(b, []);
          unknownBrands.get(b).push(`${sh.shift} ${r.machine_no}호기`);
        }
      }
    }
    for (const [b, locs] of unknownBrands) {
      const tail = locs.length > 4 ? ` 외 ${locs.length - 4}곳` : '';
      issues.push({ level: 'warn', type: 'unknown-brand', message: `미지 브랜드 "${b}" (${locs.slice(0, 4).join(', ')}${tail}) — 마스터에 없는 표기, 오인식 또는 신규` });
    }

    return issues;
  }

  // OCR 프롬프트에 주입할 작업장 어휘(grounding) — 브랜드·호기·호기별 최근 배정 제품.
  // 같은 호기는 제품이 반복되는 도메인 특성으로 철자 수렴을 돕는다 (순수 함수).
  function buildOcrGroundingHints(data) {
    const brands = buildBrandOptions(data?.products);
    const machines = [];
    for (const floor of Object.keys(data?.injection || {})) {
      for (const m of data.injection[floor] || []) {
        const no = machineNoOf(m);
        if (no == null) continue;
        const products = new Set();
        for (const day of Object.keys(m.schedule || {})) {
          const cell = m.schedule[day] || {};
          for (const k of ['day', 'night']) {
            const v = String(cell[k] || '').trim();
            if (v) products.add(v);
          }
        }
        machines.push({ no, floor, products: [...products] });
      }
    }
    machines.sort((a, b) => a.no - b.no);
    return { brands, machines };
  }

  // ── inventory LOT 유효기간 (pages/inventory.jsx 에서 이전) ───────────────────

  // LOT 잔여 유효기간(4일) 계산 — 셀 텍스트·tone·툴팁
  function inkLifeInfo(lot, baseDate) {
    const fmtMd = (iso) => {
      const d = parseDateLocal(iso);
      return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
    };
    const daysBetween = (fromISO, toISO) => {
      const from = parseDateLocal(fromISO);
      const to = parseDateLocal(toISO);
      if (!from || !to) return null;
      return Math.round((to - from) / 86400000);
    };
    if (!lot || !baseDate) return { text: '-', tone: 'empty', title: '' };
    const age = daysBetween(lot.registeredDate, baseDate);
    if (age === null) return { text: '-', tone: 'empty', title: '' };
    const remaining = 4 - age;
    if (remaining >= 0) {
      return {
        text: `${remaining}일 남음`,
        tone: remaining <= 1 ? 'warn' : 'ok',
        title: `LOT 날짜 ${fmtMd(lot.registeredDate)} 기준 · 유효기간 4일`,
      };
    }
    const overdue = Math.abs(remaining);
    return {
      text: `${overdue}일 지남`,
      tone: overdue <= 2 ? 'relabel' : 'expired',
      title: overdue <= 2
        ? `LOT 날짜 ${fmtMd(lot.registeredDate)} 기준 · 재라벨 검토 가능`
        : `LOT 날짜 ${fmtMd(lot.registeredDate)} 기준 · 유효기간 초과`,
    };
  }

  // ── 다중 탭 동시편집 3-way 병합 (concurrent-edit-guard) ──────────────────────
  // 전체 스냅샷 저장 모델에서 top-level 섹션(products/inkPlan/injection/…) 단위로
  // base(마지막 동기화본)·local(내 편집)·server(최신본)를 비교한다. 키 순서 무관
  // 정규화 비교(stableEqual)는 서버 compute_rev(sort_keys)의 "내용 동일" 개념과 일치.
  // History snapshot row diff
  // Design Ref: history-snapshot-diff section 3 - stable composite-key row comparison.
  function compareHistoryRows(baseRows, currentRows, keyFields, valueFields) {
    baseRows = Array.isArray(baseRows) ? baseRows : [];
    currentRows = Array.isArray(currentRows) ? currentRows : [];
    keyFields = Array.isArray(keyFields) ? keyFields : [];
    valueFields = Array.isArray(valueFields) ? valueFields : [];

    var keyOf = function (row) {
      return keyFields.map(function (field) {
        return String(row && row[field] != null ? row[field] : '');
      }).join('\u001f');
    };
    var baseByKey = new Map(baseRows.map(function (row) { return [keyOf(row), row]; }));
    var currentByKey = new Map(currentRows.map(function (row) { return [keyOf(row), row]; }));
    var keys = Array.from(new Set(
      Array.from(baseByKey.keys()).concat(Array.from(currentByKey.keys()))
    )).sort();
    var summary = { added: 0, changed: 0, removed: 0, unchanged: 0, totalChanges: 0 };

    var rows = keys.map(function (key) {
      var before = baseByKey.get(key) || null;
      var after = currentByKey.get(key) || null;
      var change = 'unchanged';
      if (!before) change = 'added';
      else if (!after) change = 'removed';
      else if (!stableEqual(
        valueFields.map(function (field) { return before[field]; }),
        valueFields.map(function (field) { return after[field]; })
      )) change = 'changed';

      summary[change]++;
      if (change !== 'unchanged') summary.totalChanges++;

      var detail = '';
      if (change === 'changed') {
        detail = valueFields
          .filter(function (field) { return !stableEqual(before[field], after[field]); })
          .map(function (field) {
            var oldValue = before[field] == null || before[field] === '' ? '-' : before[field];
            var newValue = after[field] == null || after[field] === '' ? '-' : after[field];
            return String(oldValue) + ' -> ' + String(newValue);
          })
          .join(' / ');
      } else if (change === 'added') {
        detail = '현재 데이터에 추가';
      } else if (change === 'removed') {
        detail = '현재 데이터에서 삭제';
      }

      return Object.assign({}, after || before || {}, {
        _change: change,
        _before: before,
        _after: after,
        _changeDetail: detail,
      });
    });

    return { rows: rows, summary: summary };
  }

  // Concurrent edit comparison helpers continue below.
  function stableStringify(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(v[k]);
    }).join(',') + '}';
  }

  function stableEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  // base 대비 local·server 의 섹션 변경을 합친다.
  //  · local==server            → status:'identical' (rev 만 동기화하면 됨)
  //  · 한쪽만 바뀐 섹션뿐         → status:'merged'  (data = 무손실 자동 병합)
  //  · 양쪽이 다르게 바뀐 섹션 존재 → status:'conflict' (conflictKeys, 사용자 선택)
  // data 는 비충돌 섹션을 합치고 충돌 섹션은 잠정적으로 local 값을 담는다.
  function resolveConcurrentEdit(base, local, server) {
    base = base || {}; local = local || {}; server = server || {};
    if (stableEqual(local, server)) {
      return { status: 'identical', data: server, conflictKeys: [] };
    }
    var keys = Object.keys(base)
      .concat(Object.keys(local), Object.keys(server))
      .filter(function (k, i, a) { return a.indexOf(k) === i; });
    var data = {}, conflictKeys = [];
    keys.forEach(function (k) {
      var b = base[k], l = local[k], s = server[k];
      var localChanged = !stableEqual(l, b);
      var serverChanged = !stableEqual(s, b);
      if (localChanged && serverChanged && !stableEqual(l, s)) {
        conflictKeys.push(k);
        data[k] = l;            // 잠정 local — 진짜 해소는 모달 선택(full server/full local)
      } else if (localChanged) {
        data[k] = l;
      } else {
        data[k] = s;
      }
    });
    return {
      status: conflictKeys.length ? 'conflict' : 'merged',
      data: data,
      conflictKeys: conflictKeys,
    };
  }

  // ── 변경 감사 로그(audit-trail) 표시용 순수 헬퍼 ─────────────────────────────
  // 서버(storage.diff_audit)가 만든 field 경로 규약과 일치해야 한다.

  var AUDIT_KIND_LABEL = Object.freeze({
    injection: '사출계획',
    products: '제품 마스터',
    machineAssignments: '잉크 배정',
  });

  // "injection·3층·10호기·월·day" → { kind, kindLabel, target, detail }
  function parseAuditField(field) {
    var parts = String(field == null ? '' : field).split('·');
    var kind = parts[0] || '';
    var kindLabel = AUDIT_KIND_LABEL[kind] || kind;
    if (kind === 'injection') {
      var floor = parts[1] || '', machine = parts[2] || '', day = parts[3] || '', shift = parts[4] || '';
      var shiftLabel = shift === 'day' ? '주간' : (shift === 'night' ? '야간' : shift);
      return {
        kind: kind,
        kindLabel: kindLabel,
        target: [floor, machine].filter(Boolean).join(' '),
        detail: [day, shiftLabel].filter(Boolean).join('/'),
      };
    }
    return { kind: kind, kindLabel: kindLabel, target: parts.slice(1).join('·'), detail: '' };
  }

  // before/after 로 변경 유형 판정. 빈 값 = null|undefined|''.
  function auditChangeKind(before, after) {
    var emptyB = before === null || before === undefined || before === '';
    var emptyA = after === null || after === undefined || after === '';
    if (emptyB && !emptyA) return 'added';
    if (!emptyB && emptyA) return 'removed';
    return 'changed';
  }

  // 엔트리 배열 → { total, byKind, bySource } 집계 (헤더 요약용)
  function summarizeAuditEntries(entries) {
    var byKind = {};
    var bySource = {};
    var list = entries || [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i] || {};
      var kind = parseAuditField(e.field).kind || 'unknown';
      byKind[kind] = (byKind[kind] || 0) + 1;
      var src = e.source || 'web';
      bySource[src] = (bySource[src] || 0) + 1;
    }
    return { total: list.length, byKind: byKind, bySource: bySource };
  }

  return {
    getInjectionColumns,
    moveInjectionCell,
    renameInjectionRefs,
    countInjectionRefs,
    localDateISO,
    parseDateLocal,
    getVisibleWeekdays,
    updateMachineAssignment,
    machineNoOf,
    aggregateChemicalRequest,
    buildChemicalRequestMeta,
    lintMasters,
    buildMasterHealthBadge,
    collectInkShortage,
    buildInkShortageBadge,
    buildDashboardSummary,
    lotSequenceForDate,
    nextInventoryLotNo,
    dateFromLotNo,
    initialInventoryLots,
    initialInventoryLot,
    actualInventoryLot,
    actualInventoryLotForInitial,
    relabelLotsForDate,
    relabelLotsForInitial,
    relabelInventoryLot,
    removeInventoryLot,
    removeInventoryInk,
    buildInkMaster,
    isInkInMaster,
    normalizeInkName,
    buildCascadeBrands,
    cascadeProductsInBrand,
    cascadeInksInProduct,
    filterByQuery,
    // 다중 탭 동시편집 가드 (순수 함수)
    stableEqual,
    compareHistoryRows,
    resolveConcurrentEdit,
    // 변경 감사 로그(audit-trail) 표시 헬퍼
    parseAuditField,
    auditChangeKind,
    summarizeAuditEntries,
    // 공유 normalize 헬퍼
    normalizeProductName,
    normalizeBrand,
    dayFromDate,
    getWeekInfo,
    inkOfAssignment,
    // ink-plan 파생 엔진
    buildProductLookup,
    resolveProductIn,
    buildBrandOptions,
    buildProductsUsingInk,
    buildDemandByInkDay,
    buildInkToMachine,
    buildInventoryByInkDay,
    mergeInkPlanAndTestInks,
    computeInkMetrics,
    buildAutoAssignCandidates,
    // review / OCR
    matchOcrRow,
    buildReviewRows,
    buildProductGroups,
    mapOcrRowsInGroup,
    changeMachineInGroup,
    applyOcrToInjection,
    lintOcrResult,
    buildOcrGroundingHints,
    buildTodayLineup,
    parseInventorySheetRows,
    buildInventoryImportPlan,
    // inventory
    inkLifeInfo,
    // 도메인 상수 (요일/교대) — 단일 출처
    WEEKDAYS,
    WEEKDAYS_PLUS,
    DAY_BY_IDX,
    SHIFTS,
  };
});
