// 잉크 생산계획 v3 — 엑셀식 셀 입력 (항상 input, Enter→아래 셀), 양산 이력 보존, 폭 조정

// 같은 컬럼의 다음 row input으로 focus 이동
function focusNextCellInColumn(currentInput) {
  const cell = currentInput.closest('td');
  if (!cell) return;
  const row = cell.parentElement;
  const cellIdx = Array.from(row.children).indexOf(cell);
  let next = row.nextElementSibling;
  while (next) {
    const inp = next.children[cellIdx]?.querySelector('input');
    if (inp && !inp.disabled) { inp.focus(); inp.select(); return; }
    next = next.nextElementSibling;
  }
  currentInput.blur();
}

function InkPlanPage({ ctx }) {
  const { data, setData, notify, today, dates } = ctx;
  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState('3days'); // all | today | 3days
  const [showTestOnly, setShowTestOnly] = useState(false);

  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const threeDays = useMemo(() => DataService.getVisibleWeekdays(days, today, '3days'), [today]);

  const visibleDays = useMemo(() => {
    if (dayFilter === 'today') return [today];
    if (dayFilter === '3days') return threeDays;
    return days;
  }, [dayFilter, today, threeDays]);

  const productLookup = useMemo(() => {
    const exact = new Map();
    const normalized = new Map();
    for (const p of data.products || []) {
      if (p.name) exact.set(p.name, p);
      const key = normalizeProductName(p.name);
      if (key && !normalized.has(key)) normalized.set(key, p);
    }
    return { exact, normalized };
  }, [data.products]);

  const resolveProduct = (name) => {
    if (!name) return null;
    return productLookup.exact.get(name) || productLookup.normalized.get(normalizeProductName(name)) || null;
  };

  // 잉크 → "사출계획에서 이 잉크를 쓰는 제품 목록"
  const productsUsingInk = useMemo(() => {
    const map = new Map();
    for (const floor of Object.keys(data.injection || {})) {
      for (const m of data.injection[floor]) {
        for (const sh of Object.values(m.schedule || {})) {
          for (const productName of [sh.day, sh.night]) {
            const product = resolveProduct(productName);
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
  }, [data.injection, productLookup]);

  const demandByInkDay = useMemo(() => {
    const map = new Map();
    for (const floor of Object.keys(data.injection || {})) {
      for (const m of data.injection[floor] || []) {
        for (const [day, shifts] of Object.entries(m.schedule || {})) {
          for (const productName of [shifts.day, shifts.night]) {
            const product = resolveProduct(productName);
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
  }, [data.injection, productLookup]);

  // 잉크 → 호기 매핑 (read-only, 잉크 추가 페이지에서만 편집)
  const inkToMachine = useMemo(() => {
    const m = new Map();
    for (const a of (data.machineAssignments || [])) {
      const ink = inkOfAssignment(a);
      if (ink && !m.has(ink)) m.set(ink, a.machine || '');
    }
    return m;
  }, [data.machineAssignments]);

  // 재고 조사 연동: 잉크명 × 요일 → lot 합산 재고 (Map<ink, Map<dayKor, sum>>)
  // dates 매핑('수' → '5/13')과 inv 일자(YYYY-MM-DD)의 M/D 부분을 비교해서 매칭
  // 정책: 잉크 생산계획에서 수동 수정 가능. 단 재고 조사가 바뀌면 그 값으로 덮어씀(useEffect)
  const inventoryByInkDay = useMemo(() => {
    const result = new Map();
    const inv = data.inventory;
    if (!inv || !inv.lots || !inv.daily) return result;

    const lotsByInk = new Map();
    for (const lot of inv.lots) {
      if (!lotsByInk.has(lot.ink)) lotsByInk.set(lot.ink, []);
      lotsByInk.get(lot.ink).push(lot);
    }
    // '5/13' → '수' 역매핑
    const mdToDay = {};
    for (const [day, md] of Object.entries(dates)) mdToDay[md] = day;

    for (const [dateIso, valueMap] of Object.entries(inv.daily)) {
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
  }, [data.inventory]);

  // 재고 조사 변경 시 잉크 생산계획의 수동값 덮어쓰기
  // inv 데이터가 바뀐 잉크/요일은 dd['현재고']를 clear → inv 가 자연스럽게 우선 표시됨
  useEffect(() => {
    if (!data.inventory) return;
    const newInkPlan = data.inkPlan.map(ink => {
      const invMap = inventoryByInkDay.get(ink.name);
      if (!invMap) return ink;
      let inkChanged = false;
      const newDays = { ...ink.days };
      for (const [d, invVal] of invMap.entries()) {
        const dd = ink.days[d];
        if (dd && dd['현재고'] != null && dd['현재고'] !== invVal) {
          newDays[d] = { ...dd, '현재고': null };
          inkChanged = true;
        }
      }
      return inkChanged ? { ...ink, days: newDays } : ink;
    });
    if (newInkPlan.some((ink, i) => ink !== data.inkPlan[i])) {
      setData({ ...data, inkPlan: newInkPlan });
    }
  }, [data.inventory]); // inventory 변경 시만 실행

  // 정식 잉크 + 테스트 잉크 머지
  // 같은 이름이 양쪽에 있으면 정식 inkPlan 데이터를 유지하고 testStatus 칩만 표시 (양산 이력 보존)
  const merged = useMemo(() => {
    const testMap = new Map((data.testInks || []).map(t => [t.name, t]));
    const formalNames = new Set(data.inkPlan.map(i => i.name));

    const formal = data.inkPlan.map(i => {
      const t = testMap.get(i.name);
      return {
        ...i,
        isTest: false,
        testStatus: t?.status || null,
        testNote: t?.note || '',
        startDay: t ? dayFromDate(t.addedDate) : '월',
      };
    });
    const testOnly = (data.testInks || [])
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
  }, [data.inkPlan, data.testInks]);

  const computedByInk = useMemo(() => {
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
        const stock = manualStock !== null ? manualStock : (invStock !== undefined ? Number(invStock) : carry);
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
  }, [merged, demandByInkDay, inventoryByInkDay]);

  const hasDayData = (ink, dList) => {
    const computed = computedByInk.get(ink.name);
    for (const d of dList) {
      const dd = ink.days[d];
      const metrics = computed?.get(d);
      if (metrics && (
        metrics.stock !== null ||
        metrics.required ||
        metrics.availableDays !== null ||
        metrics.weeklyNeed !== null
      )) return true;
      if (!dd) continue;
      for (const k of ['현재고', '제조량']) {
        const v = dd[k];
        if (v !== null && v !== undefined && v !== '' && v !== 0) return true;
      }
    }
    return false;
  };

  const filtered = useMemo(() => {
    let list = merged;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (showTestOnly) {
      list = list.filter(i => i.isTest);
    } else if (dayFilter !== 'all') {
      list = list.filter(ink => ink.isTest || hasDayData(ink, visibleDays));
    }
    return [...list].sort((a, b) => {
      if (a.isTest !== b.isTest) return a.isTest ? 1 : -1;
      const minAvail = (ink) => {
        let m = 999;
        const computed = computedByInk.get(ink.name);
        for (const d of visibleDays) {
          const v = computed?.get(d)?.availableDays;
          if (v != null && !isNaN(Number(v))) m = Math.min(m, Number(v));
        }
        return m;
      };
      return minAvail(a) - minAvail(b);
    });
  }, [merged, search, showTestOnly, dayFilter, visibleDays, computedByInk]);

  const updateCell = (inkName, day, key, raw) => {
    const newData = { ...data };
    let idx = newData.inkPlan.findIndex(i => i.name === inkName);
    // 정식 inkPlan에 없으면(testInks-only 등) 자동으로 빈 row 추가
    if (idx < 0) {
      const blank = Object.fromEntries(days.map(d => [d, {
        '현재고': null, '가용일수': null, '필요수량': d === '월' ? null : undefined, '제조량': null,
      }]));
      newData.inkPlan = [{ name: inkName, days: blank }, ...newData.inkPlan];
      idx = 0;
    }
    const value = raw === '' || raw == null ? null : (isNaN(Number(raw)) ? raw : Number(raw));
    newData.inkPlan = [...newData.inkPlan];
    newData.inkPlan[idx] = { ...newData.inkPlan[idx] };
    newData.inkPlan[idx].days = { ...newData.inkPlan[idx].days };
    newData.inkPlan[idx].days[day] = { ...(newData.inkPlan[idx].days[day] || {}), [key]: value };
    setData(newData);
  };

  const updateInkMachine = (inkName, machine) => {
    setData({
      ...data,
      machineAssignments: DataService.updateMachineAssignment(data.machineAssignments || [], inkName, machine),
    });
  };

  const testCount = (data.testInks || []).length;

  // 자동 배정 대상 미리보기:
  //  - 정식 잉크 중 당일(today) 제조량이 비어있고
  //  - 월요일 필요수량이 음수(=부족분)인 행
  //  - 양산대응으로 잠긴 셀 제외
  const autoAssignCandidates = useMemo(() => {
    const out = [];
    const testMap = new Map((data.testInks || []).map(t => [t.name, t]));
    const todayIdx = days.indexOf(today);

    for (const ink of (data.inkPlan || [])) {
      const todayCell = ink.days?.[today] || {};
      const cur = todayCell['제조량'];
      if (cur != null && cur !== '') continue;  // 이미 값 있으면 skip

      const need = computedByInk.get(ink.name)?.get('월')?.weeklyNeed;
      if (need == null || need === '') continue;
      const needNum = Number(need);
      if (isNaN(needNum) || needNum >= 0) continue;  // 부족(음수)인 경우만

      // 양산대응 잠금 여부
      const t = testMap.get(ink.name);
      if (t) {
        const startIdx = days.indexOf(dayFromDate(t.addedDate));
        if (todayIdx >= startIdx) continue;  // 잠긴 셀
      }

      out.push({
        name: ink.name,
        need: needNum,
        suggested: Math.abs(needNum),
      });
    }
    return out;
  }, [data.inkPlan, data.testInks, today, days, computedByInk]);

  const [showAutoAssign, setShowAutoAssign] = useState(false);

  const applyAutoAssign = () => {
    if (autoAssignCandidates.length === 0) {
      notify('자동 배정 대상 없음');
      setShowAutoAssign(false);
      return;
    }
    const newData = { ...data };
    newData.inkPlan = [...data.inkPlan];
    let count = 0;
    for (const cand of autoAssignCandidates) {
      const idx = newData.inkPlan.findIndex(i => i.name === cand.name);
      if (idx < 0) continue;
      newData.inkPlan[idx] = { ...newData.inkPlan[idx] };
      newData.inkPlan[idx].days = { ...newData.inkPlan[idx].days };
      newData.inkPlan[idx].days[today] = {
        ...(newData.inkPlan[idx].days[today] || {}),
        '제조량': cand.suggested,
      };
      count++;
    }
    setData(newData);
    notify(`${count}개 잉크 제조량 자동 배정 완료 (${today})`);
    setShowAutoAssign(false);
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">잉크 생산계획</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">정식 <strong>{data.inkPlan.length}</strong>종</span>
              {testCount > 0 && (
                <span className="page__meta-chip page__meta-chip--warn">양산대응 <strong>{testCount}</strong>종</span>
              )}
              <span className="page__meta-chip page__meta-chip--today">오늘 {dates[today]} ({today})</span>
            </div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 내보내기</button>
            <button
              className={`btn ${autoAssignCandidates.length > 0 ? 'btn--emphasis-brand' : ''}`}
              onClick={() => setShowAutoAssign(true)}
              disabled={autoAssignCandidates.length === 0}
              title={autoAssignCandidates.length === 0
                ? `당일(${today}) 자동 배정 대상이 없어 (제조량 비어있고 필요수량 음수인 정식 잉크)`
                : `당일(${today}) ${autoAssignCandidates.length}개 잉크 자동 배정 가능`}
            >
              <Icon name="sparkle" size={12} /> 자동 배정
              {autoAssignCandidates.length > 0 && (
                <span className="btn--count-badge">({autoAssignCandidates.length})</span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="잉크명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
            <Seg
              value={dayFilter}
              onChange={setDayFilter}
              options={[
                { value: 'all', label: '전체 (월~일)' },
                { value: 'today', label: `당일 (${today})` },
                { value: '3days', label: `3일 (${threeDays.join('·')})` },
              ]}
            />
            <button
              className={`btn btn--sm ${showTestOnly ? 'btn--primary' : ''}`}
              onClick={() => setShowTestOnly(v => !v)}
              title="테스트 잉크만 보기"
              style={{ marginLeft: 4 }}
            >
              <Icon name="flask" size={11} /> 테스트만 ({testCount})
            </button>
            <div className="spacer" />
            <span className="inkplan-legend" title="재고 조사 페이지에서 자동으로 채워진 재고 (Lot 합산)">
              <span className="inkplan-legend__swatch" /> 재고 조사 연동
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}건</span>
          </div>

          <div className={`tbl-wrap inkplan-tbl-wrap ${visibleDays.length === 1 ? 'inkplan-tbl-wrap--narrow' : ''}`} style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="tbl inkplan-tbl">
              <thead>
                <tr>
                  <th className="sticky-col" rowSpan={2} style={{ width: 170, verticalAlign: 'middle' }}>잉크</th>
                  <th className="sticky-col-2 inkplan-machine-head" rowSpan={2} style={{ width: 100, verticalAlign: 'middle' }}>호기</th>
                  {visibleDays.map(d => {
                    const colspan = d === '월' ? 4 : 3;
                    return (
                      <th
                        key={d}
                        colSpan={colspan}
                        className="inkplan-day-head"
                        style={{ background: d === today ? 'oklch(0.96 0.06 245)' : undefined }}
                      >
                        <div>{d} {d === today && <span style={{ fontSize: 10, color: 'var(--brand-700)', fontWeight: 700 }}>오늘</span>}</div>
                        <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-500)', marginTop: 2 }}>{dates[d]}</div>
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {visibleDays.map(d => (
                    <React.Fragment key={d}>
                      <th className="num inkplan-sub" style={{ background: d === today ? 'oklch(0.97 0.04 245)' : undefined }}>재고</th>
                      <th className="num inkplan-sub" style={{ background: d === today ? 'oklch(0.97 0.04 245)' : undefined }}>가용</th>
                      {d === '월' && (
                        <th className="num inkplan-sub" style={{ background: d === today ? 'oklch(0.97 0.04 245)' : undefined }}>필요</th>
                      )}
                      <th className="num inkplan-sub" style={{ background: d === today ? 'oklch(0.97 0.04 245)' : undefined }}>제조</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((ink, i) => {
                  const statusTone = ink.testStatus === '양산대응' ? 'ok' : ink.testStatus === '시양산' ? 'warn' : 'info';

                  // testInks-only도 정상 row 처리 (셀 단위 분기 동일하게 적용)
                  const usedBy = productsUsingInk.get(ink.name) || [];
                  return (
                    <tr key={ink.name + i} className="inkplan-row">
                      <td className="sticky-col inkplan-namecell">
                        <InkNameCell
                          name={ink.name}
                          usedBy={usedBy}
                          testStatus={ink.testStatus}
                          statusTone={statusTone}
                        />
                      </td>
                      <td className="sticky-col-2 inkplan-machine-cell">
                        <CellTextInput
                          value={inkToMachine.get(ink.name) || ''}
                          listId="ink-machine-list"
                          onCommit={v => updateInkMachine(ink.name, v)}
                        />
                      </td>
                      {visibleDays.map(d => {
                        const dd = ink.days[d] || {};
                        const metrics = computedByInk.get(ink.name)?.get(d) || {};
                        const av = metrics.availableDays;
                        const avColor = av != null && Number(av) < 0 ? 'var(--bad-600)' : Number(av) <= 1 ? 'var(--bad-600)' : Number(av) <= 3 ? 'var(--warn-600)' : 'inherit';
                        const isToday = d === today;
                        const cellBg = isToday ? 'oklch(0.985 0.012 245)' : undefined;
                        // 양산대응 시작 요일부터는 잠금
                        const locked = ink.testStatus && days.indexOf(d) >= days.indexOf(ink.startDay || '월');
                        const colspan = d === '월' ? 4 : 3;
                        if (locked) {
                          return (
                            <td key={d} colSpan={colspan} className="inkplan-cell inkplan-cell--locked" style={{ background: cellBg }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--warn-700)' }}>
                                <Icon name="flask" size={11} /> 양산대응
                              </span>
                            </td>
                          );
                        }
                        // 재고 조사 연동: inv 우선 표시. 수동 수정 가능. inv 변경 시 위 useEffect가 덮어씀
                        const stockFromInv = metrics.stockFromInv;
                        const displayStock = (dd['현재고'] != null) ? dd['현재고'] : metrics.stock;
                        const weeklyNeed = d === '월' ? metrics.weeklyNeed : null;
                        return (
                          <React.Fragment key={d}>
                            {/* 재고 - 항상 입력 가능. inv 데이터 있으면 청록 배경으로 구분 */}
                            <td
                              className="num inkplan-cell"
                              style={{
                                background: stockFromInv
                                  ? (isToday ? 'oklch(0.93 0.05 200)' : 'oklch(0.96 0.03 200)')
                                  : cellBg,
                              }}
                              title={stockFromInv
                                ? '재고 조사에서 자동 입력 (Lot 합산). 수동 수정 가능 — 단 재고 조사 변경 시 그 값으로 덮어씌워짐'
                                : ''}
                            >
                              <CellNumInput
                                value={displayStock}
                                onCommit={v => updateCell(ink.name, d, '현재고', v)}
                              />
                            </td>
                            {/* 가용 - 표시만 */}
                            <td className="num inkplan-cell inkplan-cell--readonly" style={{
                              color: avColor,
                              fontWeight: av != null && Number(av) <= 3 ? 600 : 400,
                              background: cellBg,
                            }}>
                              {fmtNum(av)}
                            </td>
                            {/* 필요 (월요일만) - 표시만 */}
                            {d === '월' && (
                              <td
                                className="num inkplan-cell inkplan-cell--readonly"
                                style={{
                                  background: cellBg,
                                  color: weeklyNeed != null && Number(weeklyNeed) < 0 ? 'var(--bad-600)' : 'inherit',
                                  fontWeight: weeklyNeed != null && Number(weeklyNeed) < 0 ? 600 : 400,
                                }}
                                title="월요일 재고 - 이번 주 사출계획 잉크 필요량 합계"
                              >
                                {fmtNum(weeklyNeed)}
                              </td>
                            )}
                            {/* 제조량 - 항상 input */}
                            <td className="num inkplan-cell inkplan-cell--manu" style={{
                              background: dd['제조량'] ? 'var(--brand-50)' : cellBg,
                              color: dd['제조량'] ? 'var(--brand-700)' : 'inherit',
                              fontWeight: dd['제조량'] ? 600 : 400,
                            }}>
                              <CellNumInput
                                value={dd['제조량']}
                                onCommit={v => updateCell(ink.name, d, '제조량', v)}
                              />
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>조건에 맞는 잉크가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {showAutoAssign && (
          <Modal
            title={`자동 배정 미리보기 — 당일 (${today}, ${dates[today]})`}
            onClose={() => setShowAutoAssign(false)}
            footer={
              <>
                <button className="btn" onClick={() => setShowAutoAssign(false)}>취소</button>
                <button
                  className="btn btn--primary"
                  onClick={applyAutoAssign}
                  disabled={autoAssignCandidates.length === 0}
                >
                  <Icon name="check" size={12} /> {autoAssignCandidates.length}개 적용
                </button>
              </>
            }
          >
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ink-700)', padding: 10, background: 'var(--brand-50)', borderRadius: 8 }}>
              <Icon name="sparkle" size={12} /> 당일 제조량이 비어있고, <strong>월요일 필요수량이 음수(부족)</strong>인 정식 잉크의 빈 제조량 셀에 <strong>|필요수량|</strong> 을 채웁니다. 양산대응 잠금 셀은 제외.
            </div>
            {autoAssignCandidates.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-500)' }}>
                자동 배정 대상이 없습니다.
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>잉크</th>
                    <th style={{ width: 100, textAlign: 'right' }}>필요수량 (월)</th>
                    <th style={{ width: 110, textAlign: 'right' }}>제조량 (예정)</th>
                  </tr>
                </thead>
                <tbody>
                  {autoAssignCandidates.map(c => (
                    <tr key={c.name}>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td style={{ textAlign: 'right', color: 'var(--bad-600)', fontFamily: 'JetBrains Mono, monospace' }}>{c.need}</td>
                      <td style={{ textAlign: 'right', color: 'var(--brand-700)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{c.suggested}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}

// 잉크명 셀 — 커스텀 hover popover (body로 portal해서 sticky/overflow 클리핑 회피)
function InkNameCell({ name, usedBy, testStatus, statusTone }) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const onEnter = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
    setHover(true);
  };

  return (
    <>
      <div
        onMouseEnter={onEnter}
        onMouseLeave={() => setHover(false)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default' }}
      >
        <span style={{ fontWeight: 600 }}>{name}</span>
        {usedBy.length > 0 && (
          <span className="inkplan-usedby-badge">{usedBy.length}</span>
        )}
        {testStatus && <Pill tone={statusTone}>{testStatus}</Pill>}
      </div>
      {hover && ReactDOM.createPortal(
        <div className="inkplan-popover" style={{ top: pos.top, left: pos.left }}>
          <div className="inkplan-popover__title">
            사용 제품 <span style={{ opacity: 0.6 }}>({usedBy.length})</span>
          </div>
          {usedBy.length === 0 ? (
            <div className="inkplan-popover__empty">사출계획에 등장하는 제품 중 이 잉크를 쓰는 제품 없음</div>
          ) : (
            <ul className="inkplan-popover__list">
              {usedBy.map(p => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// 엑셀식 항상 input 셀 — 숫자
// - type="text" + inputMode="decimal" 으로 spinner(화살표) 없음, 숫자만 허용
// - Enter → 같은 컬럼의 다음 row input으로 focus 이동 (blur 자동 트리거 → commit)
// - 값이 외부에서 바뀌면 자동 동기화
function CellNumInput({ value, onCommit }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    const result = isNaN(num) ? null : num;
    // 값이 그대로면 setData 안 부르도록 onCommit에서 처리하거나 여기서 비교
    if (result !== value) onCommit(result);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="inkplan-cellinp inkplan-cellinp--num"
      value={v}
      placeholder="·"
      onChange={e => {
        const raw = e.target.value;
        // 숫자/소수점/마이너스만 허용 (빈 문자열도 허용)
        if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) setV(raw);
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusNextCellInColumn(e.currentTarget);
        } else if (e.key === 'Escape') {
          setV(value == null ? '' : String(value));
          e.currentTarget.blur();
        }
      }}
      onFocus={e => e.currentTarget.select()}
    />
  );
}

// 엑셀식 항상 input 셀 — 텍스트 (호기)
function CellTextInput({ value, onCommit, listId }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    if (trimmed !== (value || '')) onCommit(trimmed === '' ? null : trimmed);
  };

  return (
    <input
      type="text"
      list={listId}
      className="inkplan-cellinp inkplan-cellinp--text"
      value={v}
      placeholder="·"
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusNextCellInColumn(e.currentTarget);
        } else if (e.key === 'Escape') {
          setV(value || '');
          e.currentTarget.blur();
        }
      }}
      onFocus={e => e.currentTarget.select()}
    />
  );
}

window.InkPlanPage = InkPlanPage;
