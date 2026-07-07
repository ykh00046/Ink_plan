// 넣어줄 잉크 — 사출계획에서 자동 집계 (필요 잉크 수)
// 산출: 사출계획 셀(호기×시프트×제품) → 제품의 잉크 → 호기 층(3F/1F)별 카운트
// 재고·제조량 무관. 순수하게 "필요한 잉크 수"만.

function InkAddPage({ ctx }) {
  const { data, notify, today } = ctx;
  const [search, setSearch] = useState('');
  const [floor, setFloor] = useState('all');

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

  const targetLabel = useMemo(() => {
    return targetCells
      .map(c => `${c.day} ${c.shift === 'day' ? '주' : '야'}`)
      .join(' · ');
  }, [targetCells]);

  // 제품명 → 잉크 배열 lookup
  // 셀(문자열/{name,id})을 id-정밀 해소 — 동명 액상/분말도 정확한 잉크
  const productLookup = useMemo(() => DataService.buildProductLookup(data.products), [data.products]);

  // 사출계획 자동 집계: 잉크명 → { f3, f1 }
  // 범위 = 오늘 주/야 + 내일 주 (targetCells)
  const inkAdd = useMemo(() => {
    const map = new Map();
    for (const fl of Object.keys(data.injection || {})) {
      const isF3 = fl === '3층';
      for (const m of data.injection[fl]) {
        for (const { day, shift } of targetCells) {
          const product = DataService.resolveProductCell(productLookup, m.schedule?.[day]?.[shift]);
          if (!product) continue;
          const inks = (product.inks || []).filter(Boolean);
          if (inks.length === 0) continue;
          for (const ink of inks) {
            if (!map.has(ink)) map.set(ink, { name: ink, f3: 0, f1: 0 });
            const entry = map.get(ink);
            if (isF3) entry.f3 += 1;
            else entry.f1 += 1;
          }
        }
      }
    }
    return Array.from(map.values()).map(e => ({ ...e, total: e.f3 + e.f1 }));
  }, [data.injection, productLookup, targetCells]);

  const filtered = useMemo(() => {
    let list = inkAdd;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (floor === '3') list = list.filter(i => i.f3 > 0);
    if (floor === '1') list = list.filter(i => i.f1 > 0);
    return [...list].sort((a, b) => b.total - a.total);
  }, [inkAdd, search, floor]);

  const totals = useMemo(() => {
    let f3 = 0, f1 = 0;
    for (const i of inkAdd) { f3 += i.f3; f1 += i.f1; }
    return { f3, f1, total: f3 + f1 };
  }, [inkAdd]);

  // 층별 넣어줄 잉크 목록을 클립보드로 복사 (잉크명 + 수량, 탭 구분)
  const copyFloor = (fl) => {
    const key = fl === '3' ? 'f3' : 'f1';
    const lines = inkAdd
      .filter(i => i[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .map(i => `${i.name}\t${i[key]}`);
    if (lines.length === 0) {
      notify(`${fl}층 넣어줄 잉크 없음`);
      return;
    }
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => notify(`${fl}층 ${lines.length}건 복사됨 (붙여넣기 가능)`))
        .catch(() => notify('복사 실패 — 브라우저 권한 확인'));
    } else {
      notify('이 브라우저에서 복사 불가');
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">넣어줄 잉크</div>
            <div className="page__subtitle"><strong>사출계획에서 자동 누적</strong> · 오늘 주/야 + 내일 주 현장에 넣어줄 잉크 (직접 안 세도 됨)</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">3층 <strong>{totals.f3}</strong></span>
              <span className="page__meta-chip">1층 <strong>{totals.f1}</strong></span>
              <span className="page__meta-chip">합계 <strong>{totals.total}</strong></span>
              <span className="page__meta-chip page__meta-chip--today">{targetLabel}</span>
            </div>
          </div>
          <div className="page__actions">
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
        <div className="floor-tabs">
          {[
            { value: 'all', label: '전체', sub: `${totals.total}` },
            { value: '3', label: '3층', sub: `${totals.f3}` },
            { value: '1', label: '1층', sub: `${totals.f1}` },
          ].map(t => (
            <button
              key={t.value}
              className={`floor-tab ${floor === t.value ? 'active' : ''}`}
              onClick={() => setFloor(t.value)}
            >
              <span className="floor-tab__label">{t.label}</span>
              <span className="floor-tab__sub">{t.sub}</span>
            </button>
          ))}
        </div>

        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="잉크명 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}종</span>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>잉크명</th>
                  <th className="num" style={{ width: 140 }}>3층</th>
                  <th className="num" style={{ width: 140 }}>1층</th>
                  <th className="num" style={{ width: 120 }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ink, idx) => (
                  <tr key={ink.name}>
                    <td className="row-num">{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>{ink.name}</td>
                    <td className="num" style={{ color: ink.f3 > 0 ? 'var(--ink-900)' : 'var(--ink-300)' }}>
                      {ink.f3 > 0 ? ink.f3 : '·'}
                    </td>
                    <td className="num" style={{ color: ink.f1 > 0 ? 'var(--ink-900)' : 'var(--ink-300)' }}>
                      {ink.f1 > 0 ? ink.f1 : '·'}
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--brand-700)' }}>{ink.total}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="100">
                    <div className="empty-state">
                      <div className="empty-state__title">넣어줄 잉크 없음</div>
                      <div className="empty-state__hint">
                        {targetLabel} 사출계획에 제품이 배정되면 그 제품의 잉크가 층별로 자동 집계됩니다.
                        제품에 잉크가 등록돼 있어야 집계돼요.
                      </div>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

window.InkAddPage = InkAddPage;
