// 잉크 생산계획 v3 — 엑셀식 셀 입력 (항상 input, Enter→아래 셀), 양산 이력 보존, 폭 조정
//
// 구조 (위→아래):
//   1) 모듈 스코프 — focus 헬퍼, 순수 파생 함수 (productLookup, demand, inventory, metrics)
//   2) sub-component — InkPlanToolbar · InkPlanRow · AutoAssignModal
//   3) InkPlanPage — state · useMemo 체인 · 사출계획·재고와의 양방향 sync · 표 조립
//   4) 셀 component — InkNameCell · CellNumInput · CellTextInput · InkMachineReadonly

const INKPLAN_DAYS = DataService.WEEKDAYS; // 요일 단일 출처(data-service.js)

// 같은 컬럼의 다음 row input으로 focus 이동 — ui.jsx 공용 focusNextInColumn 사용
// (data-focuscol 명시 키 기반: td 위치 인덱스 순회의 colSpan/마크업 취약성 제거)

// ── 모듈 스코프 순수 파생 함수 ───────────────────────────────────────────────
// 모두 입력만 받아 새 자료구조를 반환 — 컴포넌트 안 useMemo 에서 호출.

// ── 순수 파생 엔진은 data-service.js로 이전됨 (R3-1순위) — DataService 위임 alias ──
const buildProductLookup       = DataService.buildProductLookup;
const resolveProductIn         = DataService.resolveProductIn;
const buildProductsUsingInk    = DataService.buildProductsUsingInk;
const buildDemandByInkDay      = DataService.buildDemandByInkDay;
const buildInkToMachine        = DataService.buildInkToMachine;
const buildInventoryByInkDay   = DataService.buildInventoryByInkDay;
const mergeInkPlanAndTestInks  = DataService.mergeInkPlanAndTestInks;
const computeInkMetrics        = DataService.computeInkMetrics;
const buildAutoAssignCandidates= DataService.buildAutoAssignCandidates;

// ── sub-component: 상단 toolbar ─────────────────────────────────────────────

function InkPlanToolbar({
  search, setSearch, dayFilter, setDayFilter, today, threeDays,
  showTestOnly, setShowTestOnly, testCount, filteredCount,
}) {
  return (
    <div className="toolbar">
      <input
        className="input input--search"
        placeholder="잉크명 검색"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ minWidth: 200 }}
      />
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
      <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filteredCount}건</span>
    </div>
  );
}

// ── sub-component: 한 잉크의 행 ──────────────────────────────────────────────

function InkPlanRow({ ink, visibleDays, today, days, computedByInk, productsUsingInk, inkToMachine, onUpdateCell }) {
  const statusTone = ink.testStatus === '양산대응' ? 'ok'
    : ink.testStatus === '시양산' ? 'warn' : 'info';
  const usedBy = productsUsingInk.get(ink.name) || [];

  return (
    <tr className="inkplan-row">
      <td className="sticky-col inkplan-namecell">
        <InkNameCell
          name={ink.name}
          usedBy={usedBy}
          testStatus={ink.testStatus}
          statusTone={statusTone}
        />
      </td>
      <td className="sticky-col-2 inkplan-machine-cell">
        <InkMachineReadonly machine={inkToMachine.get(ink.name)} />
      </td>
      {visibleDays.map(d => {
        const dd = ink.days[d] || {};
        const metrics = computedByInk.get(ink.name)?.get(d) || {};
        const av = metrics.availableDays;
        const avColor = av != null && Number(av) < 0 ? 'var(--bad-600)'
          : Number(av) <= 1 ? 'var(--bad-600)'
          : Number(av) <= 3 ? 'var(--warn-600)' : 'inherit';
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

        const stockFromInv = metrics.stockFromInv;
        const displayStock = (dd['현재고'] != null) ? dd['현재고'] : metrics.stock;
        const weeklyNeed = d === '월' ? metrics.weeklyNeed : null;

        return (
          <React.Fragment key={d}>
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
                focusCol={`${d}:현재고`}
                onCommit={v => onUpdateCell(ink.name, d, '현재고', v)}
              />
            </td>
            <td className="num inkplan-cell inkplan-cell--readonly" style={{
              color: avColor,
              fontWeight: av != null && Number(av) <= 3 ? 600 : 400,
              background: cellBg,
            }}>
              {fmtNum(av)}
            </td>
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
            <td className="num inkplan-cell inkplan-cell--manu" style={{
              background: dd['제조량'] ? 'var(--brand-50)' : cellBg,
              color: dd['제조량'] ? 'var(--brand-700)' : 'inherit',
              fontWeight: dd['제조량'] ? 600 : 400,
            }}>
              <CellNumInput
                value={dd['제조량']}
                focusCol={`${d}:제조량`}
                onCommit={v => onUpdateCell(ink.name, d, '제조량', v)}
              />
            </td>
          </React.Fragment>
        );
      })}
    </tr>
  );
}

// ── sub-component: 자동 배정 미리보기 모달 ───────────────────────────────────

function AutoAssignModal({ today, dates, candidates, onApply, onClose }) {
  return (
    <Modal
      title={`자동 배정 미리보기 — 당일 (${today}, ${dates[today]})`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>취소</button>
          <button
            className="btn btn--primary"
            onClick={onApply}
            disabled={candidates.length === 0}
          >
            <Icon name="check" size={12} /> {candidates.length}개 적용
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ink-700)', padding: 10, background: 'var(--brand-50)', borderRadius: 8 }}>
        <Icon name="sparkle" size={12} /> 당일 제조량이 비어있고, <strong>월요일 필요수량이 음수(부족)</strong>인 정식 잉크의 빈 제조량 셀에 <strong>|필요수량|</strong> 을 채웁니다. 양산대응 잠금 셀은 제외.
      </div>
      {candidates.length === 0 ? (
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
            {candidates.map(c => (
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
  );
}

// ── InkPlanPage ──────────────────────────────────────────────────────────────

function InkPlanPage({ ctx }) {
  const { data, setData, notify, today, dates } = ctx;
  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState('3days'); // all | today | 3days
  const [showTestOnly, setShowTestOnly] = useState(false);
  const [showAutoAssign, setShowAutoAssign] = useState(false);

  const days = INKPLAN_DAYS;
  const threeDays = useMemo(() => DataService.getVisibleWeekdays(days, today, '3days'), [today]);

  const visibleDays = useMemo(() => {
    if (dayFilter === 'today') return [today];
    if (dayFilter === '3days') return threeDays;
    return days;
  }, [dayFilter, today, threeDays]);

  const productLookup = useMemo(() => buildProductLookup(data.products), [data.products]);
  const productsUsingInk = useMemo(
    () => buildProductsUsingInk(data.injection, productLookup),
    [data.injection, productLookup],
  );
  const demandByInkDay = useMemo(
    () => buildDemandByInkDay(data.injection, productLookup),
    [data.injection, productLookup],
  );
  const inkToMachine = useMemo(
    () => buildInkToMachine(data.machineAssignments),
    [data.machineAssignments],
  );
  const inventoryByInkDay = useMemo(
    () => buildInventoryByInkDay(data.inventory, dates),
    [data.inventory, dates],
  );

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

  const merged = useMemo(
    () => mergeInkPlanAndTestInks(data.inkPlan, data.testInks, days),
    [data.inkPlan, data.testInks],
  );

  const computedByInk = useMemo(
    () => computeInkMetrics(merged, demandByInkDay, inventoryByInkDay, days),
    [merged, demandByInkDay, inventoryByInkDay],
  );

  // 엄격 기준(2026-07): 사출계획 소요량이 있는 잉크만 목록에 넣는다.
  // 재고조사·전날 carry 로 채워진 stock 이나 수동 현재고/제조량만으로는 표시하지 않는다
  // — 재고조사엔 있으나 사출계획엔 없는(소요량 0) 잉크가 생산계획에 섞이던 문제 해결.
  // (availableDays/weeklyNeed 는 required>0(또는 주간 총소요>0)일 때만 non-null 이라 소요량 신호와 동치)
  const hasDayData = (ink, dList) => {
    const computed = computedByInk.get(ink.name);
    for (const d of dList) {
      const metrics = computed?.get(d);
      if (metrics && (
        metrics.required > 0 ||
        metrics.availableDays !== null ||
        metrics.weeklyNeed !== null
      )) return true;
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

  const testCount = (data.testInks || []).length;

  const autoAssignCandidates = useMemo(
    () => buildAutoAssignCandidates(data.inkPlan, data.testInks, today, days, computedByInk),
    [data.inkPlan, data.testInks, today, computedByInk],
  );

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
          <InkPlanToolbar
            search={search}
            setSearch={setSearch}
            dayFilter={dayFilter}
            setDayFilter={setDayFilter}
            today={today}
            threeDays={threeDays}
            showTestOnly={showTestOnly}
            setShowTestOnly={setShowTestOnly}
            testCount={testCount}
            filteredCount={filtered.length}
          />

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
                {filtered.map((ink, i) => (
                  <InkPlanRow
                    key={ink.name}
                    ink={ink}
                    visibleDays={visibleDays}
                    today={today}
                    days={days}
                    computedByInk={computedByInk}
                    productsUsingInk={productsUsingInk}
                    inkToMachine={inkToMachine}
                    onUpdateCell={updateCell}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>조건에 맞는 잉크가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {showAutoAssign && (
          <AutoAssignModal
            today={today}
            dates={dates}
            candidates={autoAssignCandidates}
            onApply={applyAutoAssign}
            onClose={() => setShowAutoAssign(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── 셀 component: 잉크명 (커스텀 hover popover) ──────────────────────────────
// body로 portal해서 sticky/overflow 클리핑 회피
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

// ── 셀 component: 엑셀식 항상 input 셀 — 숫자 ────────────────────────────────
// - type="text" + inputMode="decimal" 으로 spinner(화살표) 없음, 숫자만 허용
// - Enter → 같은 컬럼의 다음 row input으로 focus 이동 (blur 자동 트리거 → commit)
// - 값이 외부에서 바뀌면 자동 동기화
function CellNumInput({ value, onCommit, focusCol }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    const trimmed = v.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    const result = isNaN(num) ? null : num;
    if (result !== value) onCommit(result);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="inkplan-cellinp inkplan-cellinp--num"
      value={v}
      placeholder="·"
      data-focuscol={focusCol}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) setV(raw);
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusNextInColumn(e.currentTarget);
        } else if (e.key === 'Escape') {
          setV(value == null ? '' : String(value));
          e.currentTarget.blur();
        }
      }}
      onFocus={e => e.currentTarget.select()}
    />
  );
}

// ── 셀 component: 엑셀식 항상 input 셀 — 텍스트 ──────────────────────────────
// 현재 사용처 없음. 향후 다른 자유텍스트 셀이 필요할 때 재사용 가능하도록 보존.
function CellTextInput({ value, onCommit, listId, focusCol }) {
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
      data-focuscol={focusCol}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusNextInColumn(e.currentTarget);
        } else if (e.key === 'Escape') {
          setV(value || '');
          e.currentTarget.blur();
        }
      }}
      onFocus={e => e.currentTarget.select()}
    />
  );
}

// ── 셀 component: 호기 표시 전용 ─────────────────────────────────────────────
// 잉크 마스터(잉크 추가 및 관리)에서만 편집 가능 — 여기서는 표시만
function InkMachineReadonly({ machine }) {
  if (!machine) {
    return (
      <span
        style={{ color: 'var(--ink-400)', fontSize: 11, cursor: 'help' }}
        title="잉크 추가 및 관리 페이지에서 호기를 지정하세요"
      >호기 미지정</span>
    );
  }
  return (
    <span
      className="tag"
      style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'help' }}
      title="호기는 잉크 추가 및 관리 페이지에서만 변경할 수 있습니다"
    >
      {machine}
    </span>
  );
}

window.InkPlanPage = InkPlanPage;
