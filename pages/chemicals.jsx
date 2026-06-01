// 약품요청서 — 사출계획에서 자동 산출되는 잉크 발주 양식.
// ink-add는 "오늘 주/야 + 내일 주" 3시프트만 카운트했지만, 여기는 사용자가 범위를 선택해서
// 인쇄·공유용 발주서를 만든다. 데이터 변경 없음(read-only 집계).

function ChemicalsPage({ ctx }) {
  const { data, notify, today } = ctx;
  const WEEK = WEEKDAYS;          // 요일 단일 출처(data-service.js)
  const ALL_DAYS = WEEKDAYS_PLUS; // +차주월

  const [preset, setPreset] = useState('week');
  const [customDays, setCustomDays] = useState([...WEEKDAYS]); // 변형 가능 seed → spread 복사
  const [shiftMode, setShiftMode] = useState('all'); // 'day' | 'night' | 'all'
  const [floorMode, setFloorMode] = useState('all'); // '3층' | '1층' | 'all'

  const days = useMemo(() => {
    switch (preset) {
      case 'today': return today ? [today] : [];
      case 'week':  return [...WEEK];
      case 'next':  return ['차주월'];
      case 'all':   return [...ALL_DAYS];
      case 'custom': return customDays;
      default: return [...WEEK];
    }
  }, [preset, customDays, today]);

  const shifts = shiftMode === 'all' ? DataService.SHIFTS : [shiftMode];
  const floors = floorMode === 'all' ? Object.keys(data.injection || {}) : [floorMode];

  const { rows, unmappedProducts } = useMemo(
    () => DataService.aggregateChemicalRequest(data, { days, shifts, floors }),
    [data, days.join(','), shifts.join(','), floors.join(',')]
  );

  const totals = useMemo(() => {
    let f3 = 0, f1 = 0, noCode = 0;
    for (const r of rows) {
      f3 += r.f3; f1 += r.f1;
      if (!r.hasCode) noCode++;
    }
    return { f3, f1, total: f3 + f1, kinds: rows.length, noCode };
  }, [rows]);

  const rangeLabel = useMemo(() => {
    const dayLabel = days.length === 0
      ? '없음'
      : days.length === 8 ? '전체(이번주+차주월)'
      : days.length === 7 ? '이번주(월~일)'
      : days.length === 1 ? days[0] + '요일'
      : days.join('·');
    const shiftLabel = shiftMode === 'all' ? '주/야' : (shiftMode === 'day' ? '주간' : '야간');
    const floorLabel = floorMode === 'all' ? '3F+1F' : floorMode;
    return `${dayLabel} · ${shiftLabel} · ${floorLabel}`;
  }, [days, shiftMode, floorMode]);

  const todayISO = DataService.localDateISO();
  const printedAt = useMemo(() => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${todayISO} ${hh}:${mm}`;
  }, [todayISO]);

  // 클립보드: 잉크명 + 코드 + 총세트 (탭 구분, 엑셀 붙여넣기 가능)
  const copyTSV = () => {
    if (rows.length === 0) { notify('복사할 데이터 없음'); return; }
    const header = ['품목코드', '잉크명', '사용 호기', '3층', '1층', '총'].join('\t');
    const lines = rows.map(r => [r.code, r.ink, r.machine, r.f3, r.f1, r.total].join('\t'));
    const text = [header, ...lines].join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => notify(`${rows.length}건 복사됨 — 엑셀에 붙여넣기 가능`))
        .catch(() => notify('복사 실패 — 브라우저 권한 확인'));
    } else {
      notify('이 브라우저에서 복사 불가');
    }
  };

  const toggleCustomDay = (d) => {
    setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">약품요청서</div>
            <div className="page__subtitle"><strong>사출계획에서 자동 누적</strong> · 선택 기간의 발주용 집계 (품목코드·사용 호기 포함)</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">잉크 <strong>{totals.kinds}</strong>종</span>
              <span className="page__meta-chip">3층 <strong>{totals.f3}</strong></span>
              <span className="page__meta-chip">1층 <strong>{totals.f1}</strong></span>
              <span className="page__meta-chip">총 <strong>{totals.total}</strong> 세트</span>
              <span className="page__meta-chip page__meta-chip--today">{rangeLabel}</span>
              {totals.noCode > 0 && (
                <span className="page__meta-chip" style={{ background: 'var(--warn-50, oklch(0.96 0.05 80))', color: 'var(--warn-700, oklch(0.45 0.15 60))' }}>
                  코드미입력 <strong>{totals.noCode}</strong>건
                </span>
              )}
            </div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={copyTSV}><Icon name="download" size={12} /> TSV 복사</button>
            <button className="btn btn--primary btn--lg" onClick={() => window.print()}>
              <Icon name="download" size={14} /> 인쇄 / PDF 저장
            </button>
          </div>
        </div>
      </div>

      <div className="page__body">
        {/* 필터 — 인쇄 시 숨김 */}
        <div className="chem-filter-bar" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12, padding: 12, background: 'var(--ink-50)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--ink-200)' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <FilterGroup label="범위">
              {[
                { value: 'today', label: `오늘(${today || '?'})` },
                { value: 'week',  label: '이번주' },
                { value: 'next',  label: '차주월' },
                { value: 'all',   label: '이번주+차주월' },
                { value: 'custom', label: '사용자' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`btn btn--sm ${preset === opt.value ? 'btn--primary' : ''}`}
                  onClick={() => setPreset(opt.value)}
                >{opt.label}</button>
              ))}
            </FilterGroup>
            <FilterGroup label="시프트">
              {[
                { value: 'all',   label: '주+야' },
                { value: 'day',   label: '주간만' },
                { value: 'night', label: '야간만' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`btn btn--sm ${shiftMode === opt.value ? 'btn--primary' : ''}`}
                  onClick={() => setShiftMode(opt.value)}
                >{opt.label}</button>
              ))}
            </FilterGroup>
            <FilterGroup label="층">
              {[
                { value: 'all', label: '3F+1F' },
                { value: '3층', label: '3F만' },
                { value: '1층', label: '1F만' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`btn btn--sm ${floorMode === opt.value ? 'btn--primary' : ''}`}
                  onClick={() => setFloorMode(opt.value)}
                >{opt.label}</button>
              ))}
            </FilterGroup>
          </div>
          {preset === 'custom' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-600)', marginRight: 4 }}>요일 선택:</span>
              {ALL_DAYS.map(d => (
                <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', padding: '2px 8px', borderRadius: 4, background: customDays.includes(d) ? 'var(--brand-50)' : 'transparent', border: `1px solid ${customDays.includes(d) ? 'var(--brand-500)' : 'var(--ink-200)'}` }}>
                  <input
                    type="checkbox"
                    checked={customDays.includes(d)}
                    onChange={() => toggleCustomDay(d)}
                  />
                  {d}
                </label>
              ))}
            </div>
          )}
          {unmappedProducts.size > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warn-700, oklch(0.45 0.15 60))', padding: '6px 8px', background: 'var(--warn-50, oklch(0.96 0.05 80))', borderRadius: 4 }}>
              ⚠ 잉크 미등록 제품 {unmappedProducts.size}건 (제품 마스터에서 잉크 등록 필요):{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {Array.from(unmappedProducts).slice(0, 6).join(', ')}
                {unmappedProducts.size > 6 && ` 외 ${unmappedProducts.size - 6}건`}
              </span>
            </div>
          )}
        </div>

        {/* 인쇄용 헤더 — 평소 숨김, 인쇄 시 표시 */}
        <div className="chem-print-header">
          <h1>잉크 발주 요청서</h1>
          <div className="meta">
            <div>작성일: {todayISO}</div>
            <div>작성자: 김선명 (생산관리팀)</div>
            <div>출력 시각: {printedAt}</div>
            <div>대상 범위: {rangeLabel}</div>
            <div>총 잉크: {totals.kinds}종 / 총 세트: {totals.total} (3F {totals.f3} · 1F {totals.f1})</div>
          </div>
        </div>

        <Card flush>
          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ width: 110 }}>품목코드</th>
                  <th>잉크명</th>
                  <th style={{ width: 110 }}>사용 호기</th>
                  <th className="num" style={{ width: 80 }}>3층</th>
                  <th className="num" style={{ width: 80 }}>1층</th>
                  <th className="num" style={{ width: 90 }}>총 세트</th>
                  <th style={{ width: 220 }}>비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.ink}>
                    <td className="row-num">{idx + 1}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: r.hasCode ? 'var(--ink-700)' : 'var(--bad-500)' }}>
                      {r.code || '미입력'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.ink}</td>
                    <td>
                      {r.machine
                        ? <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>{r.machine}</span>
                        : <span style={{ color: 'var(--ink-400)', fontSize: 11 }}>미지정</span>}
                    </td>
                    <td className="num" style={{ color: r.f3 > 0 ? 'var(--ink-900)' : 'var(--ink-300)' }}>
                      {r.f3 > 0 ? r.f3 : '·'}
                    </td>
                    <td className="num" style={{ color: r.f1 > 0 ? 'var(--ink-900)' : 'var(--ink-300)' }}>
                      {r.f1 > 0 ? r.f1 : '·'}
                    </td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--brand-700)' }}>{r.total}</td>
                    <td style={{ fontSize: 11, color: 'var(--ink-600)' }}>
                      {!r.hasCode && '품목코드 미입력 — 마스터 보완'}
                      {!r.machine && r.hasCode && '호기 미지정'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan="100">
                    <div className="empty-state">
                      <div className="empty-state__title">선택한 범위에 데이터 없음</div>
                      <div className="empty-state__hint">
                        사출계획이 비어있거나, 필터가 너무 좁아요. 범위를 넓혀보세요.
                      </div>
                    </div>
                  </td></tr>
                )}
                {rows.length > 0 && (
                  <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                    <td colSpan="4" style={{ textAlign: 'right' }}>합계</td>
                    <td className="num">{totals.f3}</td>
                    <td className="num">{totals.f1}</td>
                    <td className="num" style={{ color: 'var(--brand-700)' }}>{totals.total}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600, marginRight: 2 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>{children}</div>
    </div>
  );
}

window.ChemicalsPage = ChemicalsPage;
