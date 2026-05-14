// 넣어줄 잉크 page

function InkAddPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [floor, setFloor] = useState('all');
  const [quickAdd, setQuickAdd] = useState({ name: '', f3: 0, f1: 0 });

  const filtered = useMemo(() => {
    let list = data.inkAdd;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (floor === '3') list = list.filter(i => (i.f3 || 0) > 0);
    if (floor === '1') list = list.filter(i => (i.f1 || 0) > 0);
    return [...list].sort((a, b) => (b.total || 0) - (a.total || 0));
  }, [data.inkAdd, search, floor]);

  const totals = useMemo(() => {
    let f3 = 0, f1 = 0;
    for (const i of filtered) { f3 += i.f3 || 0; f1 += i.f1 || 0; }
    return { f3, f1, total: f3 + f1 };
  }, [filtered]);

  const setQty = (idx, key, val) => {
    const n = val === '' ? 0 : Number(val);
    const newData = { ...data };
    newData.inkAdd = [...newData.inkAdd];
    const target = newData.inkAdd.find(i => i === filtered[idx]);
    const realIdx = newData.inkAdd.indexOf(target);
    newData.inkAdd[realIdx] = { ...target, [key]: isNaN(n) ? 0 : n };
    newData.inkAdd[realIdx].total = (newData.inkAdd[realIdx].f3 || 0) + (newData.inkAdd[realIdx].f1 || 0);
    setData(newData);
  };

  const handleQuickAdd = () => {
    if (!quickAdd.name.trim()) return;
    const f3 = Number(quickAdd.f3) || 0;
    const f1 = Number(quickAdd.f1) || 0;
    const existing = data.inkAdd.findIndex(i => i.name.toLowerCase() === quickAdd.name.trim().toLowerCase());
    const newData = { ...data, inkAdd: [...data.inkAdd] };
    if (existing >= 0) {
      newData.inkAdd[existing] = { ...newData.inkAdd[existing], f3: (newData.inkAdd[existing].f3 || 0) + f3, f1: (newData.inkAdd[existing].f1 || 0) + f1 };
      newData.inkAdd[existing].total = newData.inkAdd[existing].f3 + newData.inkAdd[existing].f1;
      notify(`'${quickAdd.name.trim()}' 수량 추가됨`);
    } else {
      newData.inkAdd = [{ name: quickAdd.name.trim(), f3, f1, total: f3 + f1 }, ...newData.inkAdd];
      notify(`'${quickAdd.name.trim()}' 신규 추가됨`);
    }
    setData(newData);
    setQuickAdd({ name: '', f3: 0, f1: 0 });
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">넣어줄 잉크</div>
            <div className="page__meta">3층 / 1층 호기에 보충할 잉크 수량 · 요일별 배정</div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 출고 지시서</button>
            <button className="btn btn--primary"><Icon name="check" /> 일괄 처리</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">3층 보충 총량</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{totals.f3}<span className="kpi__unit">건</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">1층 보충 총량</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{totals.f1}<span className="kpi__unit">건</span></div>
          </div>
          <div className="kpi kpi--ok" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__accent" />
            <div className="kpi__label">처리 대상 SKU</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{filtered.length}<span className="kpi__unit">종</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">전체 합계</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{totals.total}<span className="kpi__unit">건</span></div>
          </div>
        </div>

        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="잉크명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
            <Seg
              value={floor}
              onChange={setFloor}
              options={[
                { value: 'all', label: '전체' },
                { value: '3', label: '3층만' },
                { value: '1', label: '1층만' },
              ]}
            />
            <div className="spacer" />
            <button className="btn"><Icon name="download" /> 인쇄 라벨</button>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>잉크명</th>
                  <th className="num" style={{ width: 120 }}>3층 (개)</th>
                  <th className="num" style={{ width: 120 }}>1층 (개)</th>
                  <th className="num" style={{ width: 100 }}>합계</th>
                  <th style={{ width: 120 }}>분포</th>
                  <th style={{ width: 100, textAlign: 'center' }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {/* Quick add row */}
                <tr style={{ background: 'var(--brand-50)' }}>
                  <td style={{ background: 'var(--brand-50)', textAlign: 'center', color: 'var(--brand-700)', fontWeight: 700 }}>+</td>
                  <td>
                    <input className="input" placeholder="잉크명 입력 또는 선택" list="all-inks" value={quickAdd.name} onChange={e => setQuickAdd({ ...quickAdd, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} style={{ width: '100%' }} />
                    <datalist id="all-inks">
                      {data.inkPlan.map(i => <option key={i.name} value={i.name} />)}
                      {(data.testInks || []).map(i => <option key={'t-' + i.name} value={i.name}>(테스트)</option>)}
                    </datalist>
                  </td>
                  <td className="num">
                    <input className="input" type="number" min="0" value={quickAdd.f3} onChange={e => setQuickAdd({ ...quickAdd, f3: e.target.value })} style={{ width: 70, textAlign: 'right', padding: '2px 6px' }} />
                  </td>
                  <td className="num">
                    <input className="input" type="number" min="0" value={quickAdd.f1} onChange={e => setQuickAdd({ ...quickAdd, f1: e.target.value })} style={{ width: 70, textAlign: 'right', padding: '2px 6px' }} />
                  </td>
                  <td className="num" style={{ color: 'var(--ink-500)' }}>{(Number(quickAdd.f3) || 0) + (Number(quickAdd.f1) || 0)}</td>
                  <td colSpan={2} style={{ textAlign: 'right' }}>
                    <button className="btn btn--primary btn--sm" onClick={handleQuickAdd} disabled={!quickAdd.name.trim()}>
                      <Icon name="plus" size={11} /> 추가
                    </button>
                  </td>
                </tr>
                {filtered.map((ink, idx) => {
                  const total = (ink.f3 || 0) + (ink.f1 || 0);
                  const maxV = Math.max(...filtered.map(i => (i.f3 || 0) + (i.f1 || 0)), 1);
                  return (
                    <tr key={ink.name + idx}>
                      <td className="row-num">{idx + 1}</td>
                      <td style={{ fontWeight: 600 }}>{ink.name}</td>
                      <td className="num">
                        <input className="input" type="number" min="0" value={ink.f3 || 0} onChange={e => setQty(idx, 'f3', e.target.value)} style={{ width: 70, textAlign: 'right', padding: '2px 6px' }} />
                      </td>
                      <td className="num">
                        <input className="input" type="number" min="0" value={ink.f1 || 0} onChange={e => setQty(idx, 'f1', e.target.value)} style={{ width: 70, textAlign: 'right', padding: '2px 6px' }} />
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: total > 0 ? 'var(--brand-700)' : 'var(--ink-500)' }}>{total}</td>
                      <td>
                        <div className="bar">
                          <div className="bar__fill" style={{ width: `${(total / maxV) * 100}%` }} />
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <Pill tone={total > 0 ? 'warn' : 'default'} dot={total > 0}>{total > 0 ? '대기' : '없음'}</Pill>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>조건에 맞는 잉크가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

window.InkAddPage = InkAddPage;
