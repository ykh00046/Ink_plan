// 3층/1층 page - per-floor ink list

function FloorPage({ ctx, floor }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const isF3 = floor === '3';
  const inkList = isF3 ? data.floor3Ink : data.floor1Ink;
  const key = isF3 ? 'floor3Ink' : 'floor1Ink';

  const filtered = useMemo(() => {
    let list = inkList;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => (b.qty || 0) - (a.qty || 0));
  }, [inkList, search]);

  const totalQty = filtered.reduce((s, i) => s + (i.qty || 0), 0);
  const maxQty = Math.max(1, ...inkList.map(i => i.qty || 0));

  const setQty = (idx, val) => {
    const n = val === '' ? 0 : Number(val);
    const newData = { ...data };
    newData[key] = [...newData[key]];
    const target = filtered[idx];
    const realIdx = newData[key].indexOf(target);
    newData[key][realIdx] = { ...target, qty: isNaN(n) ? 0 : n };
    setData(newData);
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">{floor}층 잉크 보충 리스트</div>
            <div className="page__meta">{floor}층 호기에 투입할 잉크 종류와 수량</div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 인쇄 라벨</button>
            <button className="btn btn--primary"><Icon name="check" /> 출고 확정</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">{floor}층 SKU</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{filtered.length}<span className="kpi__unit">종</span></div>
          </div>
          <div className="kpi kpi--ok" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__accent" />
            <div className="kpi__label">총 투입 수량</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{totalQty}<span className="kpi__unit">건</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">평균</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{filtered.length ? (totalQty / filtered.length).toFixed(1) : '0'}</div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">최대 단일</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{maxQty}</div>
          </div>
        </div>

        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="잉크명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
            <div className="spacer" />
            <button className="btn"><Icon name="filter" size={12} /> 필터</button>
            <button className="btn"><Icon name="download" /> 엑셀</button>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>잉크명</th>
                  <th className="num" style={{ width: 120 }}>수량 (개)</th>
                  <th style={{ width: 200 }}>비중</th>
                  <th style={{ width: 100, textAlign: 'center' }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ink, idx) => (
                  <tr key={ink.name + idx}>
                    <td className="row-num">{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>
                      <span className={`floor-tag ${isF3 ? 'f3' : 'f1'}`} style={{ marginRight: 8 }}>{floor}F</span>
                      {ink.name}
                    </td>
                    <td className="num">
                      <input className="input" type="number" min="0" value={ink.qty || 0} onChange={e => setQty(idx, e.target.value)} style={{ width: 80, textAlign: 'right', padding: '2px 6px' }} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="bar" style={{ flex: 1 }}>
                          <div className="bar__fill" style={{ width: `${((ink.qty || 0) / maxQty) * 100}%`, background: isF3 ? 'var(--brand-500)' : 'var(--ok-500)' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink-500)', minWidth: 36, textAlign: 'right' }}>{totalQty ? ((ink.qty / totalQty) * 100).toFixed(0) : 0}%</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <Pill tone={(ink.qty || 0) >= 3 ? 'warn' : 'info'} dot>{(ink.qty || 0) >= 3 ? '집중' : '일반'}</Pill>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>잉크가 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

window.FloorPage = FloorPage;
