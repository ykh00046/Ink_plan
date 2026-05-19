// 잉크 재고 조사표 v4
// - 컬럼: # | 잉크명 | 최초 Lot | (기록된 일자들) | 2차 Lot | 3차 Lot | [+Lot]
//   · 2차/3차 Lot 은 오른쪽 끝, 인쇄 시 숨김 (.col-lot-extra)
// - 오늘 일자 컬럼은 자동 생성. [이어서 생성] 버튼은 수동 보조 동작으로 유지
//   · 마지막 기록 일자 = 입력 가능 (current). 그 외 과거는 read-only
// - 가독성:
//   · # 회색, 잉크명 흰색(가장 진한 글씨), 최초Lot 옅은 청록, 2/3차 옅은 회색
//   · 일자 옅은 노란, 오늘(current) 진한 노란
// - 자동 숨김: D-2 일자 재고 명시적 0 인 lot

function InventoryPage({ ctx }) {
  const { data, setData, notify } = ctx;

  // ── state ────────────────────────────────────────────────────────────────
  const [today, setToday] = useState(() => localDateISO());
  const [viewRange, setViewRange] = useState('3days'); // today | 3days | all
  const [search, setSearch] = useState('');
  const [newLot, setNewLot] = useState('');
  const [addingFor, setAddingFor] = useState(null);
  const [addingLotNo, setAddingLotNo] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const newLotRef = useRef(null);
  const addingRef = useRef(null);
  const autoCreatedTodayRef = useRef(false);

  // ── inventory 초기화 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!data.inventory) {
      setData({ ...data, inventory: { lots: [], daily: {} } });
    }
  }, []);

  // ── 인쇄 스타일 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'inventory-print-style';
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 8mm 10mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }

        /* 부모 chain 의 height/overflow 제한 모두 해제 → 모든 행이 인쇄됨 */
        html, body, #root, .app, .app__main, .page, .page__body,
        .card, .card__body, .tbl-wrap {
          height: auto !important;
          max-height: none !important;
          min-height: 0 !important;
          overflow: visible !important;
        }

        .app__header, .app__sidebar, .app__breadcrumb, .app__toolbar,
        .app__user, .tweaks, .sb-footer, .no-print { display: none !important; }
        .col-lot-extra { display: none !important; }  /* 2차/3차 Lot 인쇄 시 숨김 */
        .app { display: block !important; }
        .app__main { padding: 0 !important; grid-column: 1 / -1 !important; }
        .page { padding: 0 !important; }
        .page__head { border: 0 !important; padding: 0 0 3mm 0 !important; }
        .page__title { font-size: 13pt !important; margin: 0 !important; }
        .page__meta { font-size: 9pt !important; margin-top: 1mm !important; }
        .card, .card__body { box-shadow: none !important; border: 0 !important; padding: 0 !important; }
        .tbl-wrap { border: 0 !important; }
        table.tbl { width: 100% !important; border-collapse: collapse !important; }
        table.tbl thead { display: table-header-group !important; }  /* 페이지마다 헤더 반복 */
        table.tbl th, table.tbl td {
          border: 0.5pt solid #000 !important;
          padding: 2pt 4pt !important;
          font-size: 9pt !important;
          line-height: 1.2 !important;
          font-family: 'Pretendard', sans-serif !important;
          text-align: center !important;       /* 가운데 정렬 통일 */
          vertical-align: middle !important;
        }
        table.tbl thead th { font-weight: 800 !important; font-size: 9pt !important; }
        table.tbl tbody tr { page-break-inside: avoid !important; height: 16pt !important; }
        table.tbl tbody td { min-height: 16pt !important; height: 16pt !important; }
        table.tbl .ink-name { font-size: 10.5pt !important; font-weight: 900 !important; color: #000 !important; }
        table.tbl .lot-no { font-family: 'JetBrains Mono', monospace !important; font-size: 8.5pt !important; }
        table.tbl .stock-cell { text-align: center !important; }
        table.tbl input {
          border: 0 !important; background: transparent !important;
          padding: 0 !important; font-size: 9pt !important;
          font-family: 'Pretendard', sans-serif !important;
          text-align: center !important;
        }
        .pill { border: 0 !important; background: transparent !important; padding: 0 !important; font-size: 8pt !important; }
      }
    `;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch (e) {} };
  }, []);

  const inv = data.inventory || { lots: [], daily: {} };
  const inkNames = useMemo(() => (data.inkPlan || []).map(i => i.name), [data.inkPlan]);

  // ── 컬럼 영역별 배경 톤 (화면용은 부드럽게, 인쇄용은 별도 처리) ────────
  const BG = {
    num:        'var(--ink-100)',
    ink:        null,
    lotMain:    'oklch(0.97 0.02 200)',        // 최초 Lot — 매우 옅은 청록
    lotMainHdr: 'oklch(0.94 0.04 200)',        // 최초 Lot 헤더
    lotExtra:   'oklch(0.985 0.008 250)',      // 2차/3차 Lot — 거의 흰색
    date:       'oklch(0.985 0.012 90)',       // 일자 — 거의 흰색에 살짝 노란
    dateHdr:    'oklch(0.96 0.025 90)',        // 일자 헤더 — 옅은 노란
    today:      'oklch(0.97 0.04 90)',         // 오늘 — 옅은 노란
    todayHdr:   'oklch(0.92 0.07 90)',         // 오늘 헤더 — 노란
    create:     'oklch(0.97 0.03 150)',        // 이어서 생성 컬럼
  };

  // ── 날짜 헬퍼 ────────────────────────────────────────────────────────────
  const addDays = (iso, n) => {
    const d = parseDateLocal(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + n);
    return localDateISO(d);
  };
  const fmtDate = (iso) => {
    const d = parseDateLocal(iso);
    return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
  };
  const dayKor = (iso) => {
    const d = parseDateLocal(iso);
    return d ? ['일', '월', '화', '수', '목', '금', '토'][d.getDay()] : '';
  };
  const daysBetween = (fromISO, toISO) => {
    const from = parseDateLocal(fromISO);
    const to = parseDateLocal(toISO);
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
  };
  const inkLifeInfo = (lot, baseDate) => {
    if (!lot || !baseDate) return { text: '-', tone: 'empty', title: '' };
    const age = daysBetween(lot.registeredDate, baseDate);
    if (age === null) return { text: '-', tone: 'empty', title: '' };
    const remaining = 4 - age;
    if (remaining >= 0) {
      return {
        text: `${remaining}일 남음`,
        tone: remaining <= 1 ? 'warn' : 'ok',
        title: `LOT 날짜 ${fmtDate(lot.registeredDate)} 기준 · 유효기간 4일`,
      };
    }
    const overdue = Math.abs(remaining);
    return {
      text: `${overdue}일 지남`,
      tone: overdue <= 2 ? 'relabel' : 'expired',
      title: overdue <= 2
        ? `LOT 날짜 ${fmtDate(lot.registeredDate)} 기준 · 재라벨 검토 가능`
        : `LOT 날짜 ${fmtDate(lot.registeredDate)} 기준 · 유효기간 초과`,
    };
  };

  // ── 기록된 일자 & 현재 일자 ──────────────────────────────────────────────
  const recordedDates = useMemo(() => Object.keys(inv.daily).sort(), [inv.daily]);
  const currentDate = recordedDates.length > 0 ? recordedDates[recordedDates.length - 1] : null;
  const d2 = currentDate ? addDays(currentDate, -2) : null;

  // ── 표시 일자 ────────────────────────────────────────────────────────────
  const visibleDates = useMemo(() => {
    if (recordedDates.length === 0) return [];
    if (viewRange === 'today') return [currentDate];
    if (viewRange === '3days') return recordedDates.slice(-3);
    return recordedDates;
  }, [recordedDates, viewRange]);

  const isCurrent = (iso) => iso === currentDate;

  // 재고 조사 진입 시 오늘 일자 컬럼 자동 생성.
  // 버튼은 남겨두되, 초보 사용자가 매일 눌러야 하는 흐름은 없앤다.
  useEffect(() => {
    if (!data.inventory) return;
    if (inv.daily[today] || autoCreatedTodayRef.current) return;
    autoCreatedTodayRef.current = true;
    setData({
      ...data,
      inventory: {
        ...inv,
        daily: {
          ...inv.daily,
          [today]: {},
        },
      },
    });
    notify(`${fmtDate(today)} (${dayKor(today)}) 일자가 자동 생성됨`);
  }, [data.inventory, today]);

  // ── Lot prefix 자동 매칭 ─────────────────────────────────────────────────
  const matchInk = (lotNo) => {
    if (!lotNo) return null;
    const upper = lotNo.toUpperCase().trim();
    const sorted = [...inkNames].sort((a, b) =>
      Math.min(b.length, 4) - Math.min(a.length, 4)
    );
    for (const ink of sorted) {
      const prefix = ink.toUpperCase().slice(0, 4);
      if (upper.startsWith(prefix)) return ink;
    }
    return null;
  };

  const orderedInitialLots = useMemo(() => {
    const initials = (inv.lots || []).filter(l => l.role !== 'relabel' && !l.parentId);
    const byId = new Map(initials.map(l => [l.id, l]));
    const ordered = [];
    for (const id of (inv.order || [])) {
      const lot = byId.get(id);
      if (lot) {
        ordered.push(lot);
        byId.delete(id);
      }
    }
    const rest = Array.from(byId.values()).sort((a, b) =>
      (a.ink || '').localeCompare(b.ink || '') ||
      (a.registeredDate || '').localeCompare(b.registeredDate || '') ||
      (a.lotNo || '').localeCompare(b.lotNo || '')
    );
    return [...ordered, ...rest];
  }, [inv.lots, inv.order]);

  // ── 표시할 최초 lot 필터 ──────────────────────────────────────────────────
  const visibleLots = useMemo(() => {
    let lots = orderedInitialLots;
    if (d2) {
      lots = lots.filter(lot => {
        if (lot.registeredDate > d2) return true;
        const actual = DataService.actualInventoryLotForInitial(inv.lots, lot, d2);
        const v = (inv.daily[d2] || {})[actual?.id];
        return v !== 0;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      lots = lots.filter(l =>
        l.ink.toLowerCase().includes(q) ||
        l.lotNo.toLowerCase().includes(q)
      );
    }
    return lots;
  }, [orderedInitialLots, inv.lots, inv.daily, d2, search]);

  const moveRow = (lotId, delta) => {
    const current = orderedInitialLots.map(l => l.id);
    const idx = current.indexOf(lotId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= current.length) return;
    const next = [...current];
    [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
    setData({ ...data, inventory: { ...inv, order: next } });
  };

  const appendOrderForNewInitial = (currentInv, lot) => {
    const current = orderedInitialLots.map(l => l.id).filter(id => id !== lot.id);
    let insertAt = current.length;
    for (let i = current.length - 1; i >= 0; i--) {
      const existing = (currentInv.lots || []).find(l => l.id === current[i]);
      if (existing?.ink === lot.ink) {
        insertAt = i + 1;
        break;
      }
    }
    return [...current.slice(0, insertAt), lot.id, ...current.slice(insertAt)];
  };

  // ── Lot 등록 ─────────────────────────────────────────────────────────────
  const registerLot = (lotNo, currentInv) => {
    const ln = lotNo.toUpperCase().trim();
    if (!ln) return { ok: false, reason: 'empty' };
    const ink = matchInk(ln);
    if (!ink) return { ok: false, reason: 'no-ink', lotNo: ln };
    if (currentInv.lots.some(l => l.lotNo === ln)) return { ok: false, reason: 'dup', lotNo: ln };
    const lotDate = DataService.dateFromLotNo(ln, today);
    const lot = {
      id: `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ink, lotNo: ln, registeredDate: lotDate, order: 1, role: 'initial',
    };
    return { ok: true, lot };
  };

  const handleAddNew = () => {
    const result = registerLot(newLot, inv);
    if (!result.ok) {
      if (result.reason === 'no-ink') notify(`'${result.lotNo}' 의 잉크가 마스터에 없습니다. [잉크 추가] 페이지에서 먼저 등록하세요`);
      else if (result.reason === 'dup') notify(`Lot '${result.lotNo}' 는 이미 등록되어 있습니다`);
      return;
    }
    const nextInv = { ...inv, lots: [...inv.lots, result.lot] };
    nextInv.order = appendOrderForNewInitial(nextInv, result.lot);
    setData({ ...data, inventory: nextInv });
    notify(`${result.lot.ink} · ${result.lot.lotNo} 신규 생산 LOT 등록`);
    setNewLot('');
    setTimeout(() => newLotRef.current?.focus(), 0);
  };

  const startAddLot = (initialLot) => {
    setAddingFor(initialLot.id);
    setAddingLotNo(DataService.nextInventoryLotNo(initialLot.ink, today, inv.lots));
    setTimeout(() => {
      addingRef.current?.focus();
      const el = addingRef.current;
      if (el) { const len = el.value.length; el.setSelectionRange(len, len); }
    }, 0);
  };
  const cancelAddLot = () => { setAddingFor(null); setAddingLotNo(''); };
  const confirmAddLot = () => {
    if (!addingFor) return;
    const initialLot = inv.lots.find(l => l.id === addingFor);
    if (!initialLot) return;
    const matched = matchInk(addingLotNo);
    if (matched !== initialLot.ink) {
      notify(`'${addingLotNo}' 는 ${initialLot.ink} 의 Lot 이 아닙니다 (prefix 불일치)`);
      return;
    }
    if (inv.lots.some(l => l.lotNo === addingLotNo.toUpperCase().trim())) {
      notify(`Lot '${addingLotNo}' 는 이미 등록되어 있습니다`);
      return;
    }
    const relabels = DataService.relabelLotsForInitial(inv.lots, initialLot);
    if (relabels.length >= 2) {
      notify(`${initialLot.lotNo} 는 3차 LOT까지 생성되어 있습니다`);
      return;
    }
    const order = relabels.some(l => Number(l.order) === 2) ? 3 : 2;
    const lot = {
      id: `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ink: initialLot.ink,
      lotNo: addingLotNo.toUpperCase().trim(),
      registeredDate: DataService.dateFromLotNo(addingLotNo, today),
      order,
      role: 'relabel',
      parentId: initialLot.id,
    };
    setData({ ...data, inventory: { ...inv, lots: [...inv.lots, lot] } });
    notify(`${initialLot.lotNo} 재라벨 등록: ${lot.lotNo}`);
    cancelAddLot();
  };

  const handleBulkAdd = () => {
    const lines = bulkText.split(/[\r\n\t]+/).map(s => s.trim()).filter(Boolean);
    const added = [];
    const failed = [];
    let working = { ...inv, lots: [...inv.lots], order: orderedInitialLots.map(l => l.id) };
    for (const ln of lines) {
      const r = registerLot(ln, working);
      if (r.ok) {
        working.lots.push(r.lot);
        const sameInkIdx = working.order.map(id => working.lots.find(l => l.id === id)).reduce((last, l, i) => l?.ink === r.lot.ink ? i : last, -1);
        const insertAt = sameInkIdx >= 0 ? sameInkIdx + 1 : working.order.length;
        working.order = [...working.order.slice(0, insertAt), r.lot.id, ...working.order.slice(insertAt)];
        added.push(r.lot);
      }
      else failed.push({ lotNo: ln, reason: r.reason });
    }
    if (added.length > 0) setData({ ...data, inventory: working });
    setBulkResult({ added, failed });
    setBulkText('');
  };

  // ── 재고 입력 ────────────────────────────────────────────────────────────
  const setStock = (lotId, dateISO, value) => {
    const newDaily = { ...inv.daily };
    if (value === '' || value === null) {
      if (newDaily[dateISO]) {
        newDaily[dateISO] = { ...newDaily[dateISO] };
        delete newDaily[dateISO][lotId];
      }
    } else {
      const v = Number(value);
      if (isNaN(v)) return;
      newDaily[dateISO] = { ...(newDaily[dateISO] || {}), [lotId]: v };
    }
    setData({ ...data, inventory: { ...inv, daily: newDaily } });
  };

  const deleteLot = (lot) => {
    if (!lot) return;
    if (!confirm(`${lot.ink} · ${lot.lotNo} 를 삭제할까요? 입력된 재고도 함께 삭제됩니다.`)) return;
    setData({ ...data, inventory: DataService.removeInventoryLot(inv, lot.id) });
    notify(`${lot.ink} · ${lot.lotNo} 삭제됨`);
  };

  const deleteInk = (ink) => {
    if (!confirm(`${ink} 재고 조사 행을 삭제할까요? 최초/재라벨 LOT와 입력된 재고가 모두 삭제됩니다.`)) return;
    setData({ ...data, inventory: DataService.removeInventoryInk(inv, ink) });
    notify(`${ink} 삭제됨`);
  };

  const relabelInk = (initialLot) => {
    const relabels = DataService.relabelLotsForInitial(inv.lots, initialLot);
    if (relabels.length >= 2) {
      notify(`${initialLot.lotNo} 는 3차 LOT까지 생성되어 있습니다`);
      return;
    }
    const nextInv = DataService.relabelInventoryLot(inv, initialLot.id, today);
    if (nextInv === inv) return;
    const created = nextInv.lots[nextInv.lots.length - 1];
    setData({ ...data, inventory: nextInv });
    notify(`${initialLot.lotNo} 재라벨: ${created.lotNo}`);
  };

  const focusNextInCol = (input) => {
    const cell = input.closest('td');
    if (!cell) return;
    const cellInputs = Array.from(cell.querySelectorAll('input'));
    const myIdx = cellInputs.indexOf(input);
    if (myIdx >= 0 && myIdx < cellInputs.length - 1) {
      const next = cellInputs[myIdx + 1];
      next.focus(); next.select();
      return;
    }
    const row = cell.parentElement;
    const cellIdx = Array.from(row.children).indexOf(cell);
    let nextRow = row.nextElementSibling;
    while (nextRow) {
      const cellTd = nextRow.children[cellIdx];
      const inp = cellTd?.querySelector('input');
      if (inp && !inp.disabled) { inp.focus(); inp.select(); return; }
      nextRow = nextRow.nextElementSibling;
    }
    input.blur();
  };

  // ── 새 일자 생성 ─────────────────────────────────────────────────────────
  const canCreateToday = !inv.daily[today];
  const createTodayCol = () => {
    if (!canCreateToday) return;
    setData({ ...data, inventory: { ...inv, daily: { ...inv.daily, [today]: {} } } });
    notify(`${fmtDate(today)} (${dayKor(today)}) 일자 생성됨`);
  };

  // ── 통계 / 미리보기 ──────────────────────────────────────────────────────
  const previewInk = newLot.trim() ? matchInk(newLot) : null;
  const previewOrder = previewInk ? DataService.lotSequenceForDate(inv.lots, previewInk, today) : null;
  const currentCount = currentDate ? Object.keys(inv.daily[currentDate] || {}).length : 0;
  const orderLabel = (n) => `${String(n).padStart(2, '0')}회차`;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page__head no-print">
        <div className="page__title-row">
          <div>
            <div className="page__title">잉크 재고 조사</div>
            {currentDate ? (
              <div className="page__meta-chips">
                <span className="page__meta-chip page__meta-chip--today">
                  마지막 기록 {fmtDate(currentDate)} ({dayKor(currentDate)})
                </span>
                <span className="page__meta-chip">행 <strong>{visibleLots.length}</strong></span>
                <span className="page__meta-chip">Lot <strong>{visibleLots.length}</strong></span>
                <span className="page__meta-chip">오늘 입력 <strong>{currentCount}</strong></span>
              </div>
            ) : (
              <div className="page__meta">오늘 일자가 자동 생성됩니다. 필요하면 우측 [이어서 생성] 버튼으로 다시 확인하세요.</div>
            )}
          </div>
          <div className="page__actions">
            <button className="btn btn--sm" onClick={() => setBulkOpen(true)}>
              <Icon name="upload" size={11} /> 일괄 추가
            </button>
            <button className="btn btn--sm" onClick={() => window.print()}>
              <Icon name="download" size={11} /> 인쇄
            </button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar no-print">
            <Seg
              value={viewRange}
              onChange={setViewRange}
              options={[
                { value: 'today', label: '당일' },
                { value: '3days', label: '3일' },
                { value: 'all', label: '전체' },
              ]}
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={createTodayCol}
              disabled={!canCreateToday}
              title={canCreateToday
                ? `${fmtDate(today)} (${dayKor(today)}) 일자 컬럼 생성`
                : `${fmtDate(today)} 컬럼은 이미 생성됨`}
            >
              <Icon name="plus" size={11} />
              {canCreateToday
                ? ` 이어서 생성 (${fmtDate(today)})`
                : ` ${fmtDate(today)} 생성됨`}
            </button>
            <div className="spacer" />
            <input
              className="input input--search"
              placeholder="잉크명 또는 Lot No 검색"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>행 순서는 ↑↓ 버튼으로 조정</span>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40, background: BG.num }}>#</th>
                  <th style={{ width: 140, minWidth: 120 }}>잉크명</th>
                  <th style={{
                    width: 140, background: BG.lotMainHdr,
                    color: 'oklch(0.25 0.10 200)', fontWeight: 800,
                  }}>실제 LOT</th>
                  <th style={{
                    width: 96, background: BG.lotMainHdr,
                    color: 'oklch(0.25 0.10 200)', fontWeight: 800,
                  }}>유효기간</th>
                  {visibleDates.map(dateISO => (
                    <th
                      key={dateISO}
                      className="num"
                      style={{
                        width: 100, minWidth: 90,
                        background: isCurrent(dateISO) ? BG.todayHdr : BG.dateHdr,
                        color: isCurrent(dateISO) ? 'oklch(0.28 0.13 70)' : 'var(--ink-800)',
                        fontWeight: 800,
                        borderBottom: isCurrent(dateISO) ? '2px solid oklch(0.55 0.18 70)' : null,
                      }}
                    >
                      {fmtDate(dateISO)} ({dayKor(dateISO)})
                    </th>
                  ))}
                  {visibleDates.length === 0 && (
                    <th className="num" style={{ width: 220, background: BG.create, color: 'oklch(0.30 0.13 150)', fontWeight: 700 }}>
                      ← [이어서 생성] 으로 일자 시작
                    </th>
                  )}
                  <th className="col-lot-extra" style={{ width: 130, background: BG.lotExtra, fontWeight: 700 }}>2차 LOT</th>
                  <th className="col-lot-extra" style={{ width: 130, background: BG.lotExtra, fontWeight: 700 }}>3차 LOT</th>
                  <th className="col-lot-extra" style={{ width: 130, background: BG.lotExtra, fontWeight: 700 }}>최초 LOT</th>
                  <th className="no-print" style={{ width: 130, background: BG.num }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleLots.map((initialLot, gi) => {
                  const relabels = DataService.relabelLotsForInitial(inv.lots, initialLot);
                  const actualLot = currentDate ? DataService.actualInventoryLotForInitial(inv.lots, initialLot, currentDate) : initialLot;
                  const life = inkLifeInfo(actualLot, currentDate || today);
                  const lot2 = relabels.find(l => Number(l.order) === 2);
                  const lot3 = relabels.find(l => Number(l.order) === 3);
                  const rowAlt = gi % 2 === 1;
                  const rowBg = rowAlt ? 'oklch(0.985 0.003 250)' : null;
                  return (
                    <React.Fragment key={initialLot.id}>
                      <tr style={{ height: 40, background: rowBg }}>
                        <td className="row-num" style={{ background: BG.num }}>
                          {gi + 1}
                        </td>
                        <td className="inv-ink ink-name">{initialLot.ink}</td>
                        {/* 실제 LOT = 3차 > 2차 > 최초 */}
                        <td
                          className={`inv-lot-main lot-no ${actualLot ? '' : 'inv-lot-empty'}`}
                          style={{ background: BG.lotMain, color: actualLot ? 'oklch(0.30 0.12 200)' : undefined }}
                          title={actualLot ? `실제 LOT: ${actualLot.lotNo}` : ''}
                        >
                          {actualLot ? actualLot.lotNo : '-'}
                        </td>
                        <td
                          className={`inv-life inv-life--${life.tone}`}
                          style={{ background: BG.lotMain }}
                          title={life.title}
                        >
                          {life.text}
                        </td>
                        {/* 일자 셀들 */}
                        {visibleDates.map(dateISO => {
                          const editable = isCurrent(dateISO);
                          const actualForDate = DataService.actualInventoryLotForInitial(inv.lots, initialLot, dateISO);
                          const dateLots = actualForDate ? [actualForDate] : [];
                          const stocks = dateLots.map(l => ({ lot: l, v: (inv.daily[dateISO] || {})[l.id] }));
                          const sum = stocks.reduce((s, x) => s + (Number(x.v) || 0), 0);
                          const hasAny = stocks.some(x => x.v !== undefined);
                          return (
                            <td
                              key={dateISO}
                              className="stock-cell num inv-stock"
                              style={{ background: editable ? BG.today : BG.date }}
                            >
                              {stocks.map(({ lot, v }, si) => {
                                const showLabel = dateLots.length > 1;
                                if (editable) {
                                  return (
                                    <div key={lot.id} className="inv-stock__row">
                                      {showLabel && <span className="inv-lot-badge">{lot.order}</span>}
                                      <input
                                        className="inv-stock-input"
                                        type="number"
                                        min="0"
                                        value={v === undefined ? '' : v}
                                        onChange={e => setStock(lot.id, dateISO, e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInCol(e.currentTarget); } }}
                                      />
                                    </div>
                                  );
                                }
                                const displayClass = v === undefined
                                  ? 'inv-stock__display--empty'
                                  : v === 0 ? 'inv-stock__display--zero' : 'inv-stock__display--has';
                                return (
                                  <div key={lot.id} className={`inv-stock__row inv-stock__display ${displayClass}`}>
                                    {showLabel && <span className="inv-lot-badge">{lot.order}</span>}
                                    <span>{v === undefined ? '-' : v}</span>
                                  </div>
                                );
                              })}
                              {dateLots.length > 1 && hasAny && (
                                <div className="inv-stock__sum">{sum}</div>
                              )}
                            </td>
                          );
                        })}
                        {visibleDates.length === 0 && (
                          <td style={{ background: BG.create, color: 'oklch(0.30 0.13 150)', fontStyle: 'italic', fontSize: 12 }}>
                            일자 컬럼 없음
                          </td>
                        )}
                        {/* 2차/3차 LOT 변경값 */}
                        <td
                          className={`col-lot-extra inv-lot-extra lot-no ${lot2 ? '' : 'inv-lot-empty'}`}
                          style={{ background: BG.lotExtra }}
                          title={lot2 ? `등록일 ${fmtDate(lot2.registeredDate)}` : ''}
                        >
                          {lot2 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {lot2.lotNo}
                              <button
                                className="btn btn--sm no-print"
                                onClick={() => deleteLot(lot2)}
                                title="2차 LOT 삭제"
                                style={{ padding: '1px 4px' }}
                              >
                                <Icon name="trash" size={10} />
                              </button>
                            </span>
                          ) : '-'}
                        </td>
                        <td
                          className={`col-lot-extra inv-lot-extra lot-no ${lot3 ? '' : 'inv-lot-empty'}`}
                          style={{ background: BG.lotExtra }}
                          title={lot3 ? `등록일 ${fmtDate(lot3.registeredDate)}` : ''}
                        >
                          {lot3 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {lot3.lotNo}
                              <button
                                className="btn btn--sm no-print"
                                onClick={() => deleteLot(lot3)}
                                title="3차 LOT 삭제"
                                style={{ padding: '1px 4px' }}
                              >
                                <Icon name="trash" size={10} />
                              </button>
                            </span>
                          ) : '-'}
                        </td>
                        <td
                          className={`col-lot-extra inv-lot-extra lot-no ${initialLot ? '' : 'inv-lot-empty'}`}
                          style={{ background: BG.lotExtra }}
                          title={initialLot ? `최초 LOT: ${initialLot.lotNo}` : ''}
                        >
                          {initialLot ? initialLot.lotNo : '-'}
                        </td>
                        {/* 액션 */}
                        <td className="no-print" style={{ textAlign: 'center', background: BG.num, borderLeft: '2px solid var(--ink-200)' }}>
                          <div style={{ display: 'inline-flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => relabelInk(initialLot)}
                              title={`${initialLot.lotNo} 를 당일 LOT로 재라벨`}
                              style={{ padding: '2px 8px', fontSize: 11 }}
                              disabled={relabels.length >= 2 || !initialLot}
                            >
                              재라벨
                            </button>
                            <button
                              className="btn btn--sm btn--danger"
                              onClick={() => deleteLot(initialLot)}
                              title={`${initialLot.lotNo} 재고 조사 행 삭제`}
                              style={{ padding: '2px 8px', fontSize: 11 }}
                            >
                              삭제
                            </button>
                            <button
                              className="btn btn--sm"
                              onClick={() => moveRow(initialLot.id, -1)}
                              disabled={gi === 0}
                              title="위로 이동"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                            >↑</button>
                            <button
                              className="btn btn--sm"
                              onClick={() => moveRow(initialLot.id, 1)}
                              disabled={gi === visibleLots.length - 1}
                              title="아래로 이동"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                            >↓</button>
                          </div>
                        </td>
                      </tr>

                      {/* Lot 변경 inline 입력 행 */}
                      {addingFor === initialLot.id && (
                        <tr className="no-print" style={{ background: 'var(--info-100)' }}>
                          <td></td>
                          <td style={{ color: 'var(--info-600)', fontWeight: 700, fontSize: 12 }}>
                            ↳ {initialLot.lotNo} 재라벨 {orderLabel(relabels.length + 2)}
                          </td>
                          <td colSpan={2 + visibleDates.length + (visibleDates.length === 0 ? 1 : 0) + 1}>
                            <input
                              ref={addingRef}
                              className="input"
                              value={addingLotNo}
                              onChange={e => setAddingLotNo(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); confirmAddLot(); }
                                if (e.key === 'Escape') cancelAddLot();
                              }}
                              placeholder={`${initialLot.ink.toUpperCase().slice(0, 4)}MMDD02`}
                              style={{
                                width: '100%', maxWidth: 220,
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: 12,
                              }}
                            />
                          </td>
                          <td colSpan={2} style={{ fontSize: 11, color: 'var(--ink-600)' }}>
                            Enter = 등록 · Esc = 취소
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn--primary btn--sm" onClick={confirmAddLot} style={{ marginRight: 4 }}>등록</button>
                            <button className="btn btn--sm" onClick={cancelAddLot}>×</button>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* 표 최하단: 신규 잉크 첫 Lot 등록 */}
                <tr className="no-print" style={{ background: 'var(--brand-50)', borderTop: '2px solid var(--brand-100)', height: 44 }}>
                  <td style={{ textAlign: 'center', color: 'var(--brand-700)', fontWeight: 700, fontSize: 16, background: 'var(--brand-50)' }}>+</td>
                  <td style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: previewInk ? 'var(--brand-700)' : (newLot.trim() ? 'var(--bad-600)' : 'var(--ink-500)'),
                  }}>
                    {newLot.trim()
                      ? (previewInk || '매칭 잉크 없음')
                      : <span style={{ fontStyle: 'italic', fontWeight: 400, fontSize: 13 }}>(자동 매칭)</span>}
                  </td>
                  <td colSpan={2 + Math.max(visibleDates.length, 1) + 3}>
                    <input
                      ref={newLotRef}
                      className="input"
                      placeholder="새 Lot No. 입력 (예: SHAD051301)"
                      value={newLot}
                      onChange={e => setNewLot(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNew(); } }}
                      style={{
                        width: '100%', maxWidth: 280,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 13,
                      }}
                    />
                    {previewInk && previewOrder !== null && (
                      <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--brand-700)' }}>
                        → {previewInk} 신규 생산 LOT
                      </span>
                    )}
                    {newLot.trim() && !previewInk && (
                      <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--bad-600)' }}>
                        잉크 마스터에 없습니다. [잉크 추가] 페이지에서 먼저 등록하세요.
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={handleAddNew}
                      disabled={!newLot.trim() || !previewInk}
                    >
                      <Icon name="plus" size={11} /> 등록
                    </button>
                  </td>
                </tr>

                {visibleLots.length === 0 && (
                  <tr><td colSpan={4 + Math.max(visibleDates.length, 1) + 4} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    {inv.lots.length === 0 ? '등록된 Lot 이 없습니다. 아래 행에서 Lot No 를 입력해 추가하세요.' : '조건에 맞는 Lot 이 없습니다'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 일괄 추가 모달 */}
      {bulkOpen && (
        <Modal
          title="Lot 일괄 추가"
          onClose={() => { setBulkOpen(false); setBulkResult(null); setBulkText(''); }}
          footer={
            <>
              <button className="btn" onClick={() => { setBulkOpen(false); setBulkResult(null); setBulkText(''); }}>닫기</button>
              <button className="btn btn--primary" onClick={handleBulkAdd} disabled={!bulkText.trim()}>
                <Icon name="plus" size={11} /> 등록
              </button>
            </>
          }
        >
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-700)' }}>
            엑셀에서 Lot 한 열을 복사해 아래에 붙여넣으세요. 줄 단위로 자동 매칭됩니다.
          </div>
          <textarea
            className="input"
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={"SHAD051301\nARNO051301\nELIS051301\n..."}
            rows={10}
            style={{
              width: '100%',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          {bulkResult && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div style={{ color: 'var(--ok-600)', fontWeight: 600 }}>
                ✓ {bulkResult.added.length}개 등록됨
              </div>
              {bulkResult.added.length > 0 && (
                <div style={{ color: 'var(--ink-600)', maxHeight: 80, overflowY: 'auto', marginTop: 4 }}>
                  {bulkResult.added.map(l => `${l.ink} · ${l.lotNo} (${l.order}차)`).join(', ')}
                </div>
              )}
              {bulkResult.failed.length > 0 && (
                <>
                  <div style={{ color: 'var(--bad-600)', fontWeight: 600, marginTop: 8 }}>
                    ✗ {bulkResult.failed.length}개 실패
                  </div>
                  <ul style={{ margin: '4px 0 0 16px', color: 'var(--ink-700)', maxHeight: 120, overflowY: 'auto' }}>
                    {bulkResult.failed.map((f, i) => (
                      <li key={i}>
                        <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{f.lotNo}</code>
                        {' — '}
                        {f.reason === 'no-ink' ? '잉크 마스터에 없음 (잉크 추가 페이지에서 먼저 등록)' :
                         f.reason === 'dup' ? '이미 등록됨' : '오류'}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

window.InventoryPage = InventoryPage;
