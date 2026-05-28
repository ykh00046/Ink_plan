// 미등록 제품 확인 페이지
// OCR 결과 중 마스터에 없는 제품을 바로 등록한다.
// 최신 마스터 기준 운영이므로 유사 제품 매칭/rename 흐름은 쓰지 않는다.
//
// 구조 (위→아래):
//   1) 모듈 스코프 순수 함수 — OCR row 매칭, 그룹화, 사출계획 머지
//   2) sub-component — ReviewEmptyState · ReviewHeader · ReviewTable
//   3) ReviewPage — state · 핸들러 · 위 component 조립
//   4) 셀 component — ReviewRow · NewProductDialog · 인라인 input 3종

// ── 모듈 스코프 순수 함수 ─────────────────────────────────────────────────────

// OCR 한 행을 마스터와 매칭 — { status, matchedName?, candidates?, suggestedBrand? }
function matchOcrRow(r, masterIndex) {
  const isTest = !r.product_name || /^TEST$/i.test(r.product_name.trim());
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
    // 한 그룹 안에 exact 가 하나라도 있으면 그룹 전체를 exact 로 승격
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
  const keyMap = new Map(); // oldKey → newKey
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
// 반환: { nextData, mergedByShift, skippedNoMachine, skippedNoMatch, mergedDays }
function applyOcrToInjection(data, ocrResult, decisions) {
  const DAY_BY_IDX = ['일', '월', '화', '수', '목', '금', '토'];
  const dayFromDate = (iso) => {
    const d = parseDateLocal(iso);
    return d ? DAY_BY_IDX[d.getDay()] : null;
  };

  const requestDate = parseDateLocal(ocrResult.parsed.request_date);
  const requestDay = requestDate ? DAY_BY_IDX[requestDate.getDay()] : null;
  let nextDay = dayFromDate(ocrResult.parsed.next_date);
  // next_date 가 누락되면 request_date+1 — '명일주간' 통째 스킵 함정 방지
  if (!nextDay && requestDate) {
    const t = new Date(requestDate);
    t.setDate(t.getDate() + 1);
    nextDay = DAY_BY_IDX[t.getDay()];
  }
  if (!requestDay) {
    return { error: 'no-request-day' };
  }

  // 깊은 복사 (injection 안의 schedule까지)
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
      // skip 중 TEST 행은 'TEST' 그대로 반영. 사용자가 명시적으로 skip 한 행만 제외.
      if (decision.action === 'skip' && decision.reason !== 'TEST') continue;

      const productName = decision.target || r.product_name;
      if (!productName) continue;

      const targetFloors = floorMap[r.floor]
        ? [floorMap[r.floor]]
        : Object.keys(newData.injection);
      let found = false;
      for (const floor of targetFloors) {
        const list = newData.injection[floor] || [];
        const machine = list.find(m => DataService.machineNoOf(m) === r.machine_no);
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

// ── sub-component: 빈 상태 ───────────────────────────────────────────────────

function ReviewEmptyState({ onGoOcr, onGoInjection }) {
  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">미등록 제품 확인</div>
            <div className="page__meta">OCR 제품명이 등록된 제품에 없을 때만 확인하고 추가합니다</div>
          </div>
        </div>
      </div>
      <div className="page__body">
        <Card>
          <div className="empty-state">
            <div className="empty-state__title">확인할 미등록 제품이 없습니다</div>
            <div className="empty-state__hint">INK 요청서 입력 후 등록된 제품과 모두 일치하면 자동으로 사출계획으로 이동합니다.</div>
            <div className="empty-state__actions">
              <button className="btn btn--primary" onClick={onGoOcr}>
                <Icon name="arrow" size={12} /> INK 요청서 입력으로 이동
              </button>
              <button className="btn" onClick={onGoInjection}>
                <Icon name="arrow" size={12} /> 사출계획으로 이동
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── sub-component: 페이지 헤더 + 진행률 바 ───────────────────────────────────

function ReviewHeader({ ocrResult, shiftRowCount, stats, onApply, onClear }) {
  const allShiftsOk = shiftRowCount['주간'] && shiftRowCount['야간'] && shiftRowCount['명일주간'];
  return (
    <div className="page__head">
      <div className="page__title-row">
        <div>
          <div className="page__title">미등록 제품 확인</div>
          <div className="page__meta-chips">
            <span className="page__meta-chip page__meta-chip--today">{ocrResult.parsed.request_date}</span>
            <span
              className={`page__meta-chip ${allShiftsOk ? '' : 'page__meta-chip--warn'}`}
              title="OCR이 추출한 시프트별 행 수. 0이 있으면 OCR이 시프트 분리에 실패한 것 — 다시 업로드하거나 이미지를 확인하세요."
            >
              OCR: 주간 {shiftRowCount['주간']} · 야간 {shiftRowCount['야간']} · 명일주간 {shiftRowCount['명일주간']}
            </span>
            <span className="page__meta-chip">{ocrResult.sourceFileName}</span>
            <span className="page__meta-chip">{ocrResult.model}</span>
          </div>
        </div>
        <div className="page__actions">
          <button className="btn" onClick={onClear}>
            <Icon name="trash" size={12} /> OCR 결과 비우기
          </button>
          <button
            className="btn btn--primary"
            disabled={stats.pending > 0}
            onClick={onApply}
            title={stats.pending > 0 ? `${stats.pending}건 결정 필요` : '사출계획 그리드에 반영'}
          >
            <Icon name="check" size={12} /> 사출계획 반영
          </button>
        </div>
      </div>
      <div className="review-progress">
        <div className="review-progress__bar">
          <div
            className="review-progress__fill"
            style={{ width: `${stats.total ? Math.round(stats.decided / stats.total * 100) : 0}%` }}
          />
        </div>
        <div className="review-progress__stats">
          <span className="review-progress__stat"><strong>{stats.decided}</strong> / {stats.total} 결정</span>
          <span className="review-progress__stat review-progress__stat--auto">자동 {stats.auto}</span>
          {stats.pending > 0
            ? <span className="review-progress__stat review-progress__stat--pending">대기 {stats.pending}</span>
            : <span className="review-progress__stat review-progress__stat--done">✓ 미등록 없음</span>}
        </div>
      </div>
    </div>
  );
}

// ── sub-component: 그룹 표 (필터 + 행들) ─────────────────────────────────────

function ReviewTable({
  filteredRows, stats, filter, setFilter, groupDecision, allBrands,
  onNew, onUndo, onBrandChange, onMachineChange, onProductChange,
}) {
  return (
    <Card flush>
      <div className="toolbar">
        <Seg value={filter} onChange={setFilter} options={[
          { value: 'pending', label: `대기 ${stats.pending}` },
          { value: 'all', label: `전체 ${stats.total}` },
          { value: 'done', label: `완료 ${stats.decided}` },
        ]} />
        <div className="spacer" />
        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
          {filteredRows.length}건 표시
        </div>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 130 }}>사용 위치</th>
              <th style={{ width: 90 }}>브랜드</th>
              <th>OCR 제품명</th>
              <th style={{ width: 110 }}>상태</th>
              <th>등록 내용</th>
              <th style={{ width: 80, textAlign: 'right' }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => (
              <ReviewRow
                key={row.groupKey || row.rowKey}
                row={row}
                decision={groupDecision(row)}
                onNew={() => onNew(row)}
                onUndo={() => onUndo(row)}
                allBrands={allBrands}
                onBrandChange={(v) => onBrandChange(row, v)}
                onAcceptBrandSuggestion={(v) => onBrandChange(row, v)}
                onMachineChange={(v) => onMachineChange(row, v)}
                onProductChange={(v) => onProductChange(row, v)}
              />
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan="7">
                <div className="empty-state">
                  <div className="empty-state__title">
                    {filter === 'pending' ? '✓ 확인할 미등록 제품이 없습니다' : '표시할 행이 없습니다'}
                  </div>
                  {filter === 'pending' && (
                    <div className="empty-state__hint">우측 상단 [사출계획 반영] 버튼으로 진행하세요.</div>
                  )}
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── ReviewPage ───────────────────────────────────────────────────────────────

function ReviewPage({ ctx }) {
  const { data, setData, notify, ocrResult, setOcrResult, setLastMergeInfo, setView } = ctx;

  // 마스터에 알려진 잉크: machineAssignments(정본) + inkPlan + 제품 inks 합집합.
  const allInks = useMemo(
    () => DataService.buildInkMaster(data),
    [data.products, data.machineAssignments, data.inkPlan]
  );

  const knownInkSet = useMemo(() => {
    const s = new Set();
    for (const v of allInks) s.add(String(v).trim().toLowerCase());
    return s;
  }, [allInks]);
  const findUnknownInks = (inks) => (inks || [])
    .filter(Boolean)
    .filter(ink => !knownInkSet.has(String(ink).trim().toLowerCase()));

  // 마스터의 brand 후보 — 인라인 편집 시 자동완성
  const allBrands = useMemo(() => {
    const s = new Set();
    for (const p of data.products) if (p.brand) s.add(p.brand);
    return Array.from(s).sort();
  }, [data.products]);

  const factoryOptions = useMemo(() => {
    const s = new Set(['C관', 'S관']);
    for (const p of data.products) if (p.factory) s.add(p.factory);
    return Array.from(s).sort();
  }, [data.products]);

  const typeOptions = useMemo(() => {
    const s = new Set(['POWDER', 'LIQUID']);
    for (const p of data.products) if (p.type) s.add(p.type);
    return Array.from(s).sort();
  }, [data.products]);

  // 신구조에서는 1제품=1row라 dedup 불필요. 이름→제품 map만 만들면 끝.
  const masterIndex = useMemo(() => {
    const byName = new Map();
    for (const p of data.products) {
      if (p.name) byName.set(p.name, p);
    }
    return {
      uniqueNames: Array.from(byName.keys()),
      products: data.products,
      get: (name) => byName.get(name),
      getInks: (name) => byName.get(name)?.inks || [],
      getBrand: (name) => byName.get(name)?.brand || '',
    };
  }, [data.products]);

  const rows = useMemo(() => buildReviewRows(ocrResult, masterIndex), [ocrResult, masterIndex]);
  const productGroups = useMemo(() => buildProductGroups(rows), [rows]);

  // 각 행의 사용자 결정: { rowKey: { action: 'match'|'new'|'skip'|'auto', target?: string } }
  // auto = 시스템이 자동 처리 (exact match는 자동 'match')
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter] = useState('pending'); // pending | all | done
  const [newProductDialog, setNewProductDialog] = useState(null); // { row } — 신규 등록 시 잉크 입력 모달
  const autoAppliedRef = useRef(false);

  // 초기화: exact는 auto match로 채움. 기존 사용자 결정은 보존(brand 인라인 편집 시 다른 row의 결정이 날아가지 않도록).
  useEffect(() => {
    if (!rows.length) return;
    setDecisions(prev => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.rowKey]) continue;
        if (r.isTest) next[r.rowKey] = { action: 'skip', reason: 'TEST' };
        else if (r.status === 'exact') next[r.rowKey] = { action: 'auto', target: r.matchedName };
      }
      return next;
    });
  }, [rows]);

  // brand 인라인 편집 — 그룹 전체에 적용. 기존 결정은 무효화해 새 brand 로 재평가.
  const updateGroupBrand = (group, nextBrand) => {
    if (!ocrResult?.parsed) return;
    const rowKeys = group.rowKeys || [group.rowKey];
    setOcrResult(mapOcrRowsInGroup(ocrResult, rowKeys, 'brand', nextBrand));
    setDecisions(d => {
      const next = { ...d };
      for (const rk of rowKeys) delete next[rk];
      return next;
    });
  };

  // 호기 번호 인라인 편집 — rowKey 가 machine_no 를 포함하므로 decisions 키도 마이그레이션.
  const updateGroupMachine = (group, nextMachineNo) => {
    if (!ocrResult?.parsed) return;
    const num = Number(nextMachineNo);
    if (!Number.isInteger(num) || num <= 0) return;
    const rowKeys = group.rowKeys || [group.rowKey];
    const { next, keyMap } = changeMachineInGroup(ocrResult, rowKeys, num);
    setOcrResult(next);
    setDecisions(d => {
      const out = { ...d };
      for (const [oldKey, newKey] of keyMap.entries()) {
        if (out[oldKey] !== undefined) out[newKey] = out[oldKey];
        delete out[oldKey];
      }
      return out;
    });
  };

  // 제품명 인라인 편집 — OCR 오인식 정정. 그룹 결정 무효화.
  const updateGroupProduct = (group, nextName) => {
    if (!ocrResult?.parsed) return;
    const rowKeys = group.rowKeys || [group.rowKey];
    setOcrResult(mapOcrRowsInGroup(ocrResult, rowKeys, 'product_name', nextName));
    setDecisions(d => {
      const next = { ...d };
      for (const rk of rowKeys) delete next[rk];
      return next;
    });
  };

  const groupDecision = (group) => group.rowKeys.map(k => decisions[k]).find(Boolean);

  const stats = useMemo(() => {
    const total = productGroups.length;
    const auto = productGroups.filter(g => groupDecision(g)?.action === 'auto').length;
    const decided = productGroups.filter(g => groupDecision(g)).length;
    const pending = total - decided;
    return { total, auto, decided, pending };
  }, [productGroups, decisions]);

  // OCR이 시프트 분리에 실패하면 '주간'에만 행이 쏠림 — 즉시 보이도록 헤더 칩으로 노출
  const shiftRowCount = useMemo(() => {
    const out = { '주간': 0, '야간': 0, '명일주간': 0 };
    for (const sh of ocrResult?.parsed?.shifts || []) {
      if (out[sh.shift] !== undefined) out[sh.shift] = (sh.rows || []).length;
    }
    return out;
  }, [ocrResult]);

  const addMasterProduct = ({ factory, name, type, brand, inks }) => {
    const cleanInks = padInks3(inks);
    const newProduct = {
      factory: factory || '',
      name,
      type: type || '',
      brand: brand || '',
      customer: brand || '',
      inks: cleanInks,
      createdFromReview: true,
    };

    // 잉크 마스터 정본(machineAssignments) + inkPlan 양쪽 기준으로 중복 검사·보충.
    // (P1-2 가드로 미등록 잉크는 차단되지만, 과거 데이터 마이그레이션 등으로
    //  inkPlan에만 있고 machineAssignments엔 없는 잉크가 들어올 가능성을 방어)
    const norm = (v) => String(v || '').trim().toLowerCase();
    const existingInPlan = new Set((data.inkPlan || []).map(i => norm(i.name)));
    const existingInAssign = new Set((data.machineAssignments || []).map(a => norm(inkOfAssignment(a))));
    const filledInks = cleanInks.filter(Boolean);

    const nextData = { ...data, products: [newProduct, ...data.products] };

    const newInkRows = filledInks
      .filter(ink => !existingInPlan.has(norm(ink)))
      .map(ink => ({
        name: ink,
        days: Object.fromEntries(WEEKDAYS.map(d => [d, {
          '현재고': null,
          '가용일수': null,
          '필요수량': d === '월' ? null : undefined,
          '제조량': null,
        }])),
      }));
    if (newInkRows.length) {
      nextData.inkPlan = [...newInkRows, ...(data.inkPlan || [])];
    }

    // 잉크 마스터 정본 보충 — code 빈 값은 잉크 추가 페이지에서 '미입력' 적색 표시되어 후속 보완 유도
    const newAssignments = filledInks
      .filter(ink => !existingInAssign.has(norm(ink)))
      .map(ink => ({ ink, machine: '', code: '' }));
    if (newAssignments.length) {
      nextData.machineAssignments = [...newAssignments, ...(data.machineAssignments || [])];
    }

    setData(nextData);
  };

  const handleNew = (row) => {
    // 잉크 입력받기 위해 모달 띄움
    setNewProductDialog({ row });
  };

  const confirmNewProduct = ({ factory, name, type, brand, inks }) => {
    const unknown = findUnknownInks(inks);
    if (unknown.length) {
      notify(`마스터에 없는 잉크: ${unknown.join(', ')} — 잉크 추가 및 관리에서 먼저 등록하세요`);
      return;
    }
    addMasterProduct({ factory, name, type, brand, inks });
    setDecisions(d => {
      const next = { ...d };
      for (const rowKey of newProductDialog.row.rowKeys || [newProductDialog.row.rowKey]) {
        next[rowKey] = { action: 'new', target: name };
      }
      return next;
    });
    notify(`마스터에 추가: '${name}'`);
    setNewProductDialog(null);
  };

  // 사출계획 반영 — 머지 결과로 toast 메시지 만들고 setView/setOcrResult 처리
  const handleApplyToInjection = () => {
    const result = applyOcrToInjection(data, ocrResult, decisions);
    if (result.error === 'no-request-day') {
      notify('요청일에서 요일을 계산할 수 없어 (request_date 누락/형식 오류)');
      return;
    }
    setData(result.nextData);

    const total = result.mergedByShift['주간'] + result.mergedByShift['야간'] + result.mergedByShift['명일주간'];
    const parts = [
      `주간 ${result.mergedByShift['주간']}`,
      `야간 ${result.mergedByShift['야간']}`,
      `명일주간 ${result.mergedByShift['명일주간']}`,
    ];
    let msg = `사출계획 반영 ${total}건 (${parts.join(' · ')})`;
    if (result.skippedNoMachine) msg += ` · 호기없음 ${result.skippedNoMachine}`;
    if (result.skippedNoMatch) msg += ` · 미결정 ${result.skippedNoMatch}`;
    notify(msg);

    // 사출계획 페이지가 머지된 요일을 자동으로 시야에 포함하도록 신호 전달
    if (setLastMergeInfo) setLastMergeInfo({ days: result.mergedDays, at: Date.now() });

    // OCR 결과 비우고 사출계획 페이지로 이동
    setOcrResult(null);
    setView('injection');
  };

  const handleUndo = (row) => {
    setDecisions(d => {
      const n = { ...d };
      for (const rowKey of row.rowKeys || [row.rowKey]) delete n[rowKey];
      return n;
    });
  };

  useEffect(() => {
    if (!ocrResult || autoAppliedRef.current) return;
    if (stats.pending !== 0) return;
    autoAppliedRef.current = true;
    handleApplyToInjection();
  }, [ocrResult, stats.pending]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return productGroups;
    if (filter === 'done') return productGroups.filter(g => groupDecision(g));
    // pending: 결정 안 됐고 auto도 아닌 것
    return productGroups.filter(g => !groupDecision(g));
  }, [productGroups, decisions, filter]);

  // OCR 결과 없으면 안내
  if (!ocrResult) {
    return (
      <ReviewEmptyState
        onGoOcr={() => setView('ocr-import')}
        onGoInjection={() => setView('injection')}
      />
    );
  }

  return (
    <div className="page">
      <ReviewHeader
        ocrResult={ocrResult}
        shiftRowCount={shiftRowCount}
        stats={stats}
        onApply={handleApplyToInjection}
        onClear={() => setOcrResult(null)}
      />

      <div className="page__body">
        <ReviewTable
          filteredRows={filteredRows}
          stats={stats}
          filter={filter}
          setFilter={setFilter}
          groupDecision={groupDecision}
          allBrands={allBrands}
          onNew={handleNew}
          onUndo={handleUndo}
          onBrandChange={updateGroupBrand}
          onMachineChange={updateGroupMachine}
          onProductChange={updateGroupProduct}
        />
      </div>

      {newProductDialog && (
        <NewProductDialog
          row={newProductDialog.row}
          allInks={allInks}
          factoryOptions={factoryOptions}
          typeOptions={typeOptions}
          onConfirm={confirmNewProduct}
          onCancel={() => setNewProductDialog(null)}
        />
      )}
    </div>
  );
}

// ── 셀 component: 한 행 ──────────────────────────────────────────────────────

function ReviewRow({ row, decision, onNew, onUndo, allBrands = [], onBrandChange, onAcceptBrandSuggestion, onMachineChange, onProductChange }) {
  const renderStatus = () => {
    if (row.isTest) return <Pill tone="default">TEST</Pill>;
    if (decision?.action === 'auto') return <Pill tone="ok">자동 일치</Pill>;
    if (decision?.action === 'new') return <Pill tone="info">✓ 신규 등록</Pill>;
    if (decision?.action === 'skip') return <Pill tone="default">건너뜀</Pill>;
    if (row.status === 'brand-mismatch') return <Pill tone="warn">brand 다름</Pill>;
    if (row.status !== 'exact') return <Pill tone="bad">등록 필요</Pill>;
    return <Pill tone="default">{row.status}</Pill>;
  };

  const done = !!decision && decision.action !== 'auto';
  const autoDone = decision?.action === 'auto';

  return (
    <tr style={done || autoDone ? { background: 'var(--ok-50, #ecfdf5)', opacity: autoDone ? 0.7 : 1 } : null}>
      <td>
        {(() => {
          const occurs = row.occurs || [{ machine_no: row.machine_no, shift: row.shift }];
          const distinct = [...new Set(occurs.map(o => o.machine_no))];
          const canEditMachine = distinct.length === 1 && !!onMachineChange;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {canEditMachine ? (
                <MachineInlineInput value={distinct[0]} onCommit={onMachineChange} />
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {occurs.slice(0, 4).map((o, i) => (
                  <Pill key={`${o.machine_no}-${o.shift}-${i}`} tone={o.shift === '주간' ? 'info' : o.shift === '야간' ? 'default' : 'warn'}>
                    {canEditMachine ? o.shift : `${o.machine_no} ${o.shift}`}
                  </Pill>
                ))}
                {occurs.length > 4 && (
                  <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>+{occurs.length - 4}</span>
                )}
              </div>
            </div>
          );
        })()}
      </td>
      <td style={{ fontSize: 11 }}>
        <BrandInlineInput value={row.brand} suggestions={allBrands} onCommit={onBrandChange} />
        {row.variant ? <span style={{ color: 'var(--ink-500)' }}> / {row.variant}</span> : null}
      </td>
      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
        <ProductInlineInput value={row.ocrName} onCommit={onProductChange} />
      </td>
      <td>{renderStatus()}</td>
      <td>
        {row.isTest && <span style={{ color: 'var(--ink-500)', fontSize: 11 }}>TEST 행 — 등록 불필요</span>}
        {!row.isTest && decision && decision.action !== 'auto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
              등록됨 → {decision.target || row.ocrName}
            </span>
          </div>
        )}
        {!row.isTest && decision?.action === 'auto' && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
            → {decision.target}
          </span>
        )}
        {!row.isTest && !decision && row.status === 'brand-mismatch' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--warn-700)', fontSize: 12 }}>
              마스터에 같은 이름 제품이 있는데 brand가 달라요.
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-700)', fontFamily: 'JetBrains Mono, monospace' }}>
              → <strong>{row.matchedName}</strong> (brand: <strong>{row.suggestedBrand}</strong>)
            </span>
          </div>
        )}
        {!row.isTest && !decision && row.status !== 'brand-mismatch' && (
          <span style={{ color: 'var(--bad-600)', fontSize: 12, fontWeight: 600 }}>
            마스터에 없는 제품입니다. 제품 정보를 등록하세요.
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {!row.isTest && !decision && row.status === 'brand-mismatch' && (
          <button
            className="btn btn--sm btn--primary"
            onClick={() => onAcceptBrandSuggestion && onAcceptBrandSuggestion(row.suggestedBrand)}
            title={`brand를 '${row.suggestedBrand}' 로 정정해 자동 매칭`}
            style={{ marginRight: 4 }}
          >
            <Icon name="check" size={11} /> {row.suggestedBrand}
          </button>
        )}
        {!row.isTest && !decision && (
          <button className="btn btn--sm" onClick={onNew} title="제품 및 잉크 등록">
            등록
          </button>
        )}
        {decision && decision.action !== 'auto' && (
          <button className="btn btn--sm btn--ghost" onClick={onUndo} title="결정 취소">
            <Icon name="refresh" size={11} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ── 셀 component: 신규 제품 등록 모달 ────────────────────────────────────────
// OCR row 정보(이름·브랜드)를 자동 채우고 1·2·3도 잉크 입력
function NewProductDialog({ row, allInks, factoryOptions, typeOptions, onConfirm, onCancel }) {
  const [factory, setFactory] = useState('');
  const [name, setName] = useState(row.ocrName || '');
  const [type, setType] = useState('');
  const [brand, setBrand] = useState(row.brand || '');
  const [inks, setInks] = useState([null, null, null]);
  const filledCount = inks.filter(Boolean).length;

  const setInk = (idx, v) => {
    const next = [...inks];
    next[idx] = v;
    setInks(next);
  };

  return (
    <Modal
      title="마스터에 신규 제품 등록"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>취소</button>
          <button
            className="btn btn--primary"
            disabled={!factory.trim() || !name.trim() || !type.trim() || !brand.trim() || filledCount === 0}
            onClick={() => onConfirm({ factory: factory.trim(), name: name.trim(), type: type.trim(), brand: brand.trim(), inks })}
          >
            <Icon name="check" size={12} /> 등록
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 12, padding: 10, background: 'var(--brand-50)', borderRadius: 8, fontSize: 11, color: 'var(--ink-700)' }}>
        <Icon name="sparkle" size={11} /> OCR에서 추출한 정보를 기본값으로 채웠어. 1도 잉크는 최소 입력.
      </div>

      <div className="row-2">
        <div className="field">
          <label className="field__label">공장<span className="req">*</span></label>
          <select className="input select" value={factory} onChange={e => setFactory(e.target.value)} style={{ width: '100%' }}>
            <option value="">공장 선택</option>
            {factoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">제품명<span className="req">*</span></label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ width: '100%' }} />
        </div>
      </div>
      <div className="row-2">
        <div className="field">
          <label className="field__label">TYPE<span className="req">*</span></label>
          <select className="input select" value={type} onChange={e => setType(e.target.value)} style={{ width: '100%' }}>
            <option value="">TYPE 선택</option>
            {typeOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">고객사<span className="req">*</span></label>
          <input className="input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="고객사" style={{ width: '100%' }} />
          <div className="field__hint">OCR 원본: <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{row.brand}{row.variant ? ` / ${row.variant}` : ''}</span></div>
        </div>
      </div>

      <div className="field">
        <label className="field__label">잉크 (1도 / 2도 / 3도) — 최소 1도<span className="req">*</span></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i}>
              <div style={{ fontSize: 10, color: 'var(--ink-500)', marginBottom: 4, fontWeight: 600 }}>{i + 1}도</div>
              <InkSlotInput
                value={inks[i]}
                suggestions={allInks}
                onChange={(v) => setInk(i, v)}
                placeholder={`${i + 1}도 잉크명`}
              />
            </div>
          ))}
        </div>
        <div className="field__hint">자동완성은 기존 잉크 목록. 새 잉크는 직접 입력 가능.</div>
      </div>
    </Modal>
  );
}

// ── 셀 component: 인라인 input 3종 ───────────────────────────────────────────

// 호기 번호 인라인 편집 input — OCR이 행 경계를 한 칸 위/아래로 오인했을 때 정정
function MachineInlineInput({ value, onCommit }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => { setV(String(value ?? '')); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num <= 0) { setV(String(value ?? '')); return; }
    if (num !== Number(value)) onCommit(num);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className="input"
      value={v}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '' || /^\d+$/.test(raw)) setV(raw);
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setV(String(value ?? '')); e.currentTarget.blur(); }
      }}
      style={{ width: 44, fontSize: 12, padding: '2px 6px', height: 22, fontWeight: 600 }}
      title="호기 번호. OCR이 잘못 가져온 경우 직접 수정하세요."
    />
  );
}

// 제품명 인라인 편집 input — OCR 오인식 시 정정
function ProductInlineInput({ value, onCommit }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    if (trimmed !== (value || '').trim()) onCommit(trimmed);
  };

  return (
    <input
      type="text"
      className="input"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setV(value || ''); e.currentTarget.blur(); }
      }}
      style={{ width: '100%', minWidth: 200, fontSize: 11, padding: '2px 6px', height: 22, fontFamily: 'JetBrains Mono, monospace' }}
      title="OCR이 가져온 제품명. 잘못 읽었으면 여기서 정정하세요."
    />
  );
}

// Brand 인라인 편집 input — OCR이 통합셀 brand를 시프트 경계 너머로 누설했을 때 사용자가 직접 정정
function BrandInlineInput({ value, suggestions = [], onCommit }) {
  const datalistId = useMemo(() => `brand-dl-${Math.random().toString(36).slice(2, 8)}`, []);
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    if (trimmed !== (value || '').trim()) onCommit(trimmed);
  };

  return (
    <>
      <input
        className="input"
        list={datalistId}
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setV(value || ''); e.currentTarget.blur(); }
        }}
        style={{ width: 90, fontSize: 11, padding: '2px 6px', height: 22 }}
        placeholder="brand"
        title="OCR이 brand를 잘못 가져왔으면 여기서 수정하세요. 그룹 전체에 적용됩니다."
      />
      <datalist id={datalistId}>
        {suggestions.map(b => <option key={b} value={b} />)}
      </datalist>
    </>
  );
}

window.ReviewPage = ReviewPage;
