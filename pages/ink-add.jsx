// 넣어줄 잉크 — 사출계획에서 자동 집계(필요 잉크 수) + 현장 수동 조정
// 산출: 사출계획 셀(호기×시프트×제품) → 제품의 잉크 → 호기 층(3F/1F)별 카운트
// 현장에 미사용 재고가 남는 경우가 있어 수량 변경·삭제·추가·리셋(자동값 복원) 가능.
// 수동 조정은 data.inkAdd = { edits: { [name]: {f3,f1} }, hidden: [name] } 에 저장.

// 층 수량 입력 셀 — 로컬 값 보유, blur/Enter 에 커밋(저장 스팸 방지)
function InkQtyInput({ value, onCommit }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    const n = v.trim() === '' ? 0 : Math.max(0, parseInt(v, 10) || 0);
    if (n !== (value || 0)) onCommit(n);
  };
  return (
    <input
      className="input"
      inputMode="numeric"
      value={v}
      placeholder="·"
      onChange={e => setV(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
      style={{ width: '100%', textAlign: 'right', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
    />
  );
}

function InkAddPage({ ctx }) {
  const { data, setData, notify, today } = ctx;
  const [search, setSearch] = useState('');
  const [floor, setFloor] = useState('all');
  const [newInk, setNewInk] = useState({ name: '', f3: '', f1: '' });

  const WEEK = WEEKDAYS; // 요일 단일 출처(data-service.js)

  // 집계 대상 = 오늘 주간 + 오늘 야간 + 내일 주간 (INK 요청서 3칸과 동일 범위)
  const targetCells = useMemo(() => {
    const idx = WEEK.indexOf(today);
    const nextDay = idx >= 0 && idx < 6 ? WEEK[idx + 1] : null;
    return [
      { day: today, shift: 'day' },
      { day: today, shift: 'night' },
      ...(nextDay ? [{ day: nextDay, shift: 'day' }] : []),
    ];
  }, [today]);

  const targetLabel = useMemo(
    () => targetCells.map(c => `${c.day} ${c.shift === 'day' ? '주' : '야'}`).join(' · '),
    [targetCells]
  );

  const productLookup = useMemo(() => DataService.buildProductLookup(data.products), [data.products]);
  const allInks = useMemo(() => DataService.buildInkMaster(data), [data.products, data.machineAssignments, data.inkPlan]);

  // 사출계획 자동 집계: name → { f3, f1 } (읽기 전용 기준값)
  const autoMap = useMemo(() => {
    const map = new Map();
    for (const fl of Object.keys(data.injection || {})) {
      const isF3 = fl === '3층';
      for (const m of data.injection[fl]) {
        for (const { day, shift } of targetCells) {
          const product = DataService.resolveProductCell(productLookup, m.schedule?.[day]?.[shift]);
          if (!product) continue;
          for (const ink of (product.inks || []).filter(Boolean)) {
            if (!map.has(ink)) map.set(ink, { f3: 0, f1: 0 });
            const e = map.get(ink);
            if (isF3) e.f3 += 1; else e.f1 += 1;
          }
        }
      }
    }
    return map;
  }, [data.injection, productLookup, targetCells]);

  // 수동 조정 상태 (기존 배열 형태면 빈 상태로 간주)
  const editState = (data.inkAdd && !Array.isArray(data.inkAdd)) ? data.inkAdd : {};
  const edits = editState.edits || {};
  const hidden = editState.hidden || [];

  // 표시 행 = 자동 ∪ 수동추가, hidden 제외. 수동값이 있으면 우선.
  const rows = useMemo(() => {
    const hiddenSet = new Set(hidden);
    const names = new Set([...autoMap.keys(), ...Object.keys(edits)]);
    const out = [];
    for (const name of names) {
      if (hiddenSet.has(name)) continue;
      const auto = autoMap.get(name) || { f3: 0, f1: 0 };
      const e = edits[name];
      const f3 = e && e.f3 != null ? Number(e.f3) : auto.f3;
      const f1 = e && e.f1 != null ? Number(e.f1) : auto.f1;
      out.push({
        name, f3, f1, total: f3 + f1,
        edited: !!e, isAuto: autoMap.has(name),
        autoF3: auto.f3, autoF1: auto.f1,
      });
    }
    return out;
  }, [autoMap, edits, hidden]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (floor === '3') list = list.filter(i => i.f3 > 0);
    if (floor === '1') list = list.filter(i => i.f1 > 0);
    return [...list].sort((a, b) => b.total - a.total);
  }, [rows, search, floor]);

  const totals = useMemo(() => {
    let f3 = 0, f1 = 0;
    for (const i of rows) { f3 += i.f3; f1 += i.f1; }
    return { f3, f1, total: f3 + f1 };
  }, [rows]);

  const editedCount = rows.filter(r => r.edited).length + hidden.length;

  // ── 수동 조정 mutations (data.inkAdd 저장) ──
  const writeState = (next) => setData({ ...data, inkAdd: next });
  const setEdit = (name, f3, f1) => {
    writeState({ edits: { ...edits, [name]: { f3, f1 } }, hidden: hidden.filter(h => h !== name) });
  };
  const changeQty = (name, key, val) => {
    const row = rows.find(r => r.name === name) || { f3: 0, f1: 0 };
    setEdit(name, key === 'f3' ? val : row.f3, key === 'f1' ? val : row.f1);
  };
  const resetRow = (name) => {
    const nextEdits = { ...edits }; delete nextEdits[name];
    writeState({ edits: nextEdits, hidden: hidden.filter(h => h !== name) });
    notify(`'${name}' 자동값으로 복원`);
  };
  const deleteRow = (name) => {
    const nextEdits = { ...edits }; delete nextEdits[name];
    const nextHidden = autoMap.has(name) ? Array.from(new Set([...hidden, name])) : hidden;
    writeState({ edits: nextEdits, hidden: nextHidden });
    notify(`'${name}' 목록에서 제외`);
  };
  const resetAll = () => {
    if (editedCount === 0) { notify('수동 변경 없음 — 이미 자동값입니다'); return; }
    if (!confirm('수동 변경(수량·삭제·추가)을 모두 지우고 사출계획 자동값으로 되돌릴까요?')) return;
    writeState({ edits: {}, hidden: [] });
    notify('사출계획 자동값으로 리셋됨');
  };
  const addNew = () => {
    const name = newInk.name.trim();
    if (!name) { notify('잉크명을 입력하세요'); return; }
    const f3 = newInk.f3.trim() === '' ? 0 : Math.max(0, parseInt(newInk.f3, 10) || 0);
    const f1 = newInk.f1.trim() === '' ? 0 : Math.max(0, parseInt(newInk.f1, 10) || 0);
    if (f3 === 0 && f1 === 0) { notify('3층 또는 1층 수량을 입력하세요'); return; }
    setEdit(name, f3, f1);
    setNewInk({ name: '', f3: '', f1: '' });
    notify(`'${name}' 추가됨`);
  };

  // 층 선택에 따른 열 표시
  const showF3 = floor === 'all' || floor === '3';
  const showF1 = floor === 'all' || floor === '1';
  const showTotal = floor === 'all';
  const colCount = 2 + (showF3 ? 1 : 0) + (showF1 ? 1 : 0) + (showTotal ? 1 : 0) + 1;

  // 층별 복사 — 현재(수동 반영) 수량 기준
  const copyFloor = (fl) => {
    const key = fl === '3' ? 'f3' : 'f1';
    const lines = rows.filter(i => i[key] > 0).sort((a, b) => b[key] - a[key]).map(i => `${i.name}\t${i[key]}`);
    if (lines.length === 0) { notify(`${fl}층 넣어줄 잉크 없음`); return; }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(lines.join('\n'))
        .then(() => notify(`${fl}층 ${lines.length}건 복사됨 (붙여넣기 가능)`))
        .catch(() => notify('복사 실패 — 브라우저 권한 확인'));
    } else notify('이 브라우저에서 복사 불가');
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">넣어줄 잉크</div>
            <div className="page__subtitle"><strong>사출계획에서 자동 누적</strong> · 오늘 주/야 + 내일 주 현장에 넣어줄 잉크 (현장 재고에 맞게 수정 가능)</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">3층 <strong>{totals.f3}</strong></span>
              <span className="page__meta-chip">1층 <strong>{totals.f1}</strong></span>
              <span className="page__meta-chip">합계 <strong>{totals.total}</strong></span>
              <span className="page__meta-chip page__meta-chip--today">{targetLabel}</span>
              {editedCount > 0 && <span className="page__meta-chip" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }} title="자동 집계값을 직접 수정/삭제/추가함">수동 조정 {editedCount}</span>}
            </div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={resetAll} disabled={editedCount === 0} title="수동 변경을 모두 지우고 사출계획 자동값으로 복원">
              <Icon name="refresh" size={12} /> 리셋
            </button>
            <button className="btn btn--emphasis-brand" onClick={() => copyFloor('3')}>
              <Icon name="download" size={12} /> 3층 복사
            </button>
            <button className="btn btn--emphasis-brand" onClick={() => copyFloor('1')}>
              <Icon name="download" size={12} /> 1층 복사
            </button>
            <button className="btn btn--primary btn--lg" onClick={() => window.print()}>
              <Icon name="download" size={14} /> 인쇄
            </button>
          </div>
        </div>
      </div>

      <div className="page__body">
        {/* 큰 층 전환 탭 */}
        <div className="floor-tabs no-print">
          {[
            { value: 'all', label: '전체', sub: `${totals.total}` },
            { value: '3', label: '3층', sub: `${totals.f3}` },
            { value: '1', label: '1층', sub: `${totals.f1}` },
          ].map(t => (
            <button key={t.value} className={`floor-tab ${floor === t.value ? 'active' : ''}`} onClick={() => setFloor(t.value)}>
              <span className="floor-tab__label">{t.label}</span>
              <span className="floor-tab__sub">{t.sub}</span>
            </button>
          ))}
        </div>

        <Card flush>
          <div className="toolbar no-print">
            <input className="input input--search" placeholder="잉크명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}종 · 많이 필요한 순</span>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>잉크명</th>
                  {showF3 && <th className="num" style={{ width: 130 }}>3층</th>}
                  {showF1 && <th className="num" style={{ width: 130 }}>1층</th>}
                  {showTotal && <th className="num" style={{ width: 100 }}>합계</th>}
                  <th className="no-print" style={{ width: 110, textAlign: 'right' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {/* 수동 추가 행 */}
                <tr className="no-print" style={{ background: 'var(--brand-50)' }}>
                  <td className="row-num" style={{ background: 'var(--brand-50)' }}>＋</td>
                  <td>
                    <input className="input" placeholder="잉크명 추가" list="inkadd-inklist" value={newInk.name}
                      onChange={e => setNewInk({ ...newInk, name: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') addNew(); }} style={{ width: '100%' }} />
                    <datalist id="inkadd-inklist">{allInks.map(v => <option key={v} value={v} />)}</datalist>
                  </td>
                  {showF3 && <td><input className="input" inputMode="numeric" placeholder="3층" value={newInk.f3} onChange={e => setNewInk({ ...newInk, f3: e.target.value.replace(/[^\d]/g, '') })} onKeyDown={e => { if (e.key === 'Enter') addNew(); }} style={{ width: '100%', textAlign: 'right' }} /></td>}
                  {showF1 && <td><input className="input" inputMode="numeric" placeholder="1층" value={newInk.f1} onChange={e => setNewInk({ ...newInk, f1: e.target.value.replace(/[^\d]/g, '') })} onKeyDown={e => { if (e.key === 'Enter') addNew(); }} style={{ width: '100%', textAlign: 'right' }} /></td>}
                  {showTotal && <td />}
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn--primary btn--sm" onClick={addNew} disabled={!newInk.name.trim()}><Icon name="plus" size={11} /> 추가</button>
                  </td>
                </tr>

                {filtered.map((ink, idx) => (
                  <tr key={ink.name}>
                    <td className="row-num">{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>
                      {ink.name}
                      {ink.edited && <span className="badge-count" style={{ marginLeft: 8, background: 'var(--brand-50)', color: 'var(--brand-700)' }} title="자동 집계값을 직접 수정함">수정됨</span>}
                      {!ink.isAuto && <span className="badge-count" style={{ marginLeft: 6 }} title="사출계획에 없는 수동 추가 잉크">추가</span>}
                    </td>
                    {showF3 && <td className="num"><InkQtyInput value={ink.f3} onCommit={v => changeQty(ink.name, 'f3', v)} /></td>}
                    {showF1 && <td className="num"><InkQtyInput value={ink.f1} onCommit={v => changeQty(ink.name, 'f1', v)} /></td>}
                    {showTotal && <td className="num" style={{ fontWeight: 700, color: 'var(--brand-700)' }}>{ink.total}</td>}
                    <td className="no-print" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {ink.edited && <button className="row-act" onClick={() => resetRow(ink.name)} title="이 잉크를 사출계획 자동값으로 복원">↺</button>}
                      <button className="row-act row-act--danger" style={{ marginLeft: 4 }} onClick={() => deleteRow(ink.name)} title="이 잉크를 목록에서 제외 (현장 재고로 대체 등)">삭제</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={colCount}>
                    <div className="empty-state">
                      <div className="empty-state__title">넣어줄 잉크 없음</div>
                      <div className="empty-state__hint">
                        {targetLabel} 사출계획에 제품이 배정되면 그 제품의 잉크가 층별로 자동 집계됩니다.
                        위 행에서 직접 추가할 수도 있어요.
                      </div>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="tbl-footnote">
            <span>사출계획에서 자동 누적 · 현장 재고에 맞게 수량 수정·삭제·추가 가능 · [리셋]으로 자동값 복원</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

window.InkAddPage = InkAddPage;
window.InkQtyInput = InkQtyInput;
