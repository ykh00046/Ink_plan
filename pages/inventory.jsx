// 잉크 재고 조사표 v4
// - 컬럼: # | 잉크명 | 최초 Lot | (기록된 일자들) | 2차 Lot | 3차 Lot | [+Lot]
//   · 2차/3차 Lot 은 오른쪽 끝, 인쇄 시 숨김 (.col-lot-extra)
// - 오늘 일자 컬럼은 자동 생성. [이어서 생성] 버튼은 수동 보조 동작으로 유지
//   · 마지막 기록 일자 = 입력 가능 (current). 그 외 과거는 read-only
// - 자동 숨김: D-2 일자 재고 명시적 0 인 lot
//
// 구조: 파일 상단부터 차례로
//   1) 모듈 스코프 상수/헬퍼 — 색상, 날짜 계산, 인쇄 스타일 hook
//   2) 표 sub-component — InventoryRow (잉크 1행), NewLotFooterRow (표 마지막 + 등록), BulkAddModal
//   3) InventoryPage — state·핸들러 + sub-component 조립

// ── 모듈 스코프 상수 ─────────────────────────────────────────────────────────

// 컬럼 영역별 배경 톤 (화면용은 부드럽게, 인쇄용은 별도 처리)
const INVENTORY_BG = {
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

// ── 모듈 스코프 날짜 헬퍼 (순수 함수) ────────────────────────────────────────
// 파일 내 여러 컴포넌트가 공유하므로 페이지 안에서 재선언하지 않고 끌어올림.
// 'inv' prefix 로 다른 파일의 동명 헬퍼와 충돌 회피.

function invAddDays(iso, n) {
  const d = parseDateLocal(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return localDateISO(d);
}

function invFmtDate(iso) {
  const d = parseDateLocal(iso);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
}

function invDayKor(iso) {
  // 요일 추출 단일 출처(data-service.js). fallback '' 로 기존 동작 보존.
  return DataService.dayFromDate(iso, '');
}

function invDaysBetween(fromISO, toISO) {
  const from = parseDateLocal(fromISO);
  const to = parseDateLocal(toISO);
  if (!from || !to) return null;
  return Math.round((to - from) / 86400000);
}

// LOT 잔여 유효기간 계산은 data-service.js로 이전됨 (R3-1순위)
const invInkLifeInfo = DataService.inkLifeInfo;

// 다음 input 포커스 이동은 ui.jsx 공용 focusNextInColumn(data-focuscol=dateISO) 사용.
// 같은 셀의 lot input 여럿 → 문서 순서상 셀 내부 먼저, 그다음 행 — 기존 동작과 동일.

// ── 인쇄 스타일 ──────────────────────────────────────────────────────────────
// 페이지 마운트 시 1회만 <style>을 head에 삽입.
const INVENTORY_PRINT_CSS = `
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
      text-align: center !important;
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

function useInventoryPrintStyle() {
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'inventory-print-style';
    style.textContent = INVENTORY_PRINT_CSS;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch (e) {} };
  }, []);
}

// ── InventoryRow ─────────────────────────────────────────────────────────────
// 잉크 1개 = 최초 LOT 한 행. addingFor 가 자신이면 인라인 Lot 추가 행도 함께 렌더.
function InventoryRow({
  initialLot, gi, inv, currentDate, today, visibleDates, isCurrent,
  addingFor, addingLotNo, addingRef, setAddingLotNo, onConfirmAddLot, onCancelAddLot,
  onSetStock, onDeleteLot, onRelabelInk, onStartAddLot, onMoveRow,
  isLast,
}) {
  const BG = INVENTORY_BG;
  const relabels = DataService.relabelLotsForInitial(inv.lots, initialLot);
  const actualLot = currentDate
    ? DataService.actualInventoryLotForInitial(inv.lots, initialLot, currentDate)
    : initialLot;
  const life = invInkLifeInfo(actualLot, currentDate || today);
  const lot2 = relabels.find(l => Number(l.order) === 2);
  const lot3 = relabels.find(l => Number(l.order) === 3);
  const rowAlt = gi % 2 === 1;
  const rowBg = rowAlt ? 'oklch(0.985 0.003 250)' : null;
  const orderLabel = (n) => `${String(n).padStart(2, '0')}회차`;

  return (
    <React.Fragment>
      <tr style={{ height: 40, background: rowBg }}>
        <td className="row-num" style={{ background: BG.num }}>{gi + 1}</td>
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
              {stocks.map(({ lot, v }) => {
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
                        data-focuscol={dateISO}
                        onChange={e => onSetStock(lot.id, dateISO, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusNextInColumn(e.currentTarget);
                          }
                        }}
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
          title={lot2 ? `등록일 ${invFmtDate(lot2.registeredDate)}` : ''}
        >
          {lot2 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {lot2.lotNo}
              <button
                className="btn btn--sm no-print"
                onClick={() => onDeleteLot(lot2)}
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
          title={lot3 ? `등록일 ${invFmtDate(lot3.registeredDate)}` : ''}
        >
          {lot3 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {lot3.lotNo}
              <button
                className="btn btn--sm no-print"
                onClick={() => onDeleteLot(lot3)}
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
              onClick={() => onRelabelInk(initialLot)}
              title={`${initialLot.lotNo} 를 당일 LOT로 재라벨`}
              style={{ padding: '2px 8px', fontSize: 11 }}
              disabled={relabels.length >= 2 || !initialLot}
            >
              재라벨
            </button>
            <button
              className="btn btn--sm btn--danger"
              onClick={() => onDeleteLot(initialLot)}
              title={`${initialLot.lotNo} 재고 조사 행 삭제`}
              style={{ padding: '2px 8px', fontSize: 11 }}
            >
              삭제
            </button>
            <button
              className="btn btn--sm"
              onClick={() => onMoveRow(initialLot.id, -1)}
              disabled={gi === 0}
              title="위로 이동"
              style={{ padding: '2px 6px', fontSize: 11 }}
            >↑</button>
            <button
              className="btn btn--sm"
              onClick={() => onMoveRow(initialLot.id, 1)}
              disabled={isLast}
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
                if (e.key === 'Enter') { e.preventDefault(); onConfirmAddLot(); }
                if (e.key === 'Escape') onCancelAddLot();
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
            <button className="btn btn--primary btn--sm" onClick={onConfirmAddLot} style={{ marginRight: 4 }}>등록</button>
            <button className="btn btn--sm" onClick={onCancelAddLot}>×</button>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

// ── NewLotFooterRow ──────────────────────────────────────────────────────────
// 표 최하단의 "신규 잉크 첫 Lot 등록" 한 줄.
function NewLotFooterRow({ newLot, setNewLot, newLotRef, previewInk, previewOrder, visibleDates, onAdd }) {
  return (
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
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
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
          onClick={onAdd}
          disabled={!newLot.trim() || !previewInk}
        >
          <Icon name="plus" size={11} /> 등록
        </button>
      </td>
    </tr>
  );
}

// ── BulkAddModal ─────────────────────────────────────────────────────────────
// Lot 일괄 추가 모달 — 줄바꿈/탭으로 구분된 Lot No 들을 한번에 입력.
function BulkAddModal({ bulkText, setBulkText, bulkResult, onAdd, onClose }) {
  return (
    <Modal
      title="Lot 일괄 추가"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn--primary" onClick={onAdd} disabled={!bulkText.trim()}>
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
  );
}

// ── InventoryPage ────────────────────────────────────────────────────────────
function InventoryPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const BG = INVENTORY_BG;

  // ── state ──
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

  // ── inventory 초기화 ──
  useEffect(() => {
    if (!data.inventory) {
      setData({ ...data, inventory: { lots: [], daily: {} } });
    }
  }, []);

  // ── 인쇄 스타일 ──
  useInventoryPrintStyle();

  const inv = data.inventory || { lots: [], daily: {} };
  const inkNames = useMemo(() => (data.inkPlan || []).map(i => i.name), [data.inkPlan]);

  // ── 기록된 일자 & 현재 일자 ──
  const recordedDates = useMemo(() => Object.keys(inv.daily).sort(), [inv.daily]);
  const currentDate = recordedDates.length > 0 ? recordedDates[recordedDates.length - 1] : null;
  const d2 = currentDate ? invAddDays(currentDate, -2) : null;

  // ── 표시 일자 ──
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
    notify(`${invFmtDate(today)} (${invDayKor(today)}) 일자가 자동 생성됨`);
  }, [data.inventory, today]);

  // ── Lot prefix 자동 매칭 ──
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

  // ── 표시할 최초 lot 필터 ──
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

  // ── 엑셀 재고 조사표 가져오기 ──
  // 파싱(SheetJS)·계획 수립(DataService 순수 함수) 후 미리보기 모달 → 오늘 재고로 적용
  const excelInputRef = useRef(null);
  const [excelImport, setExcelImport] = useState(null); // { parsed, label, fileName } | null

  const handleExcelFile = async (file) => {
    if (!file) return;
    if (typeof XLSX === 'undefined') { notify('엑셀 파서(xlsx.full.min.js)가 로드되지 않았습니다'); return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      // 차트시트 등을 건너뛰고 '잉크명' 헤더가 있는 첫 시트 사용
      let parsed = null;
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws || !ws['!ref']) continue;
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
        const p = DataService.parseInventorySheetRows(rows);
        if (!p.error && p.rows.length) { parsed = p; break; }
      }
      if (!parsed) { notify('재고 조사표 형식(잉크명/Lot No. 헤더)을 찾지 못했습니다'); return; }
      // 기본 컬럼 = 값이 있는 가장 최근(오른쪽) 날짜 컬럼
      const withValues = parsed.dateCols.filter(dc => parsed.rows.some(r => r.values[dc.label] != null));
      const defaultLabel = withValues.length ? withValues[withValues.length - 1].label : (parsed.dateCols[0]?.label || '');
      setExcelImport({ parsed, label: defaultLabel, fileName: file.name });
    } catch (e) {
      console.error('엑셀 파싱 실패:', e);
      notify(`엑셀 파싱 실패: ${e.message || e}`);
    }
  };

  const excelPlan = useMemo(
    () => excelImport ? DataService.buildInventoryImportPlan(excelImport.parsed, excelImport.label, data, today) : null,
    [excelImport, data, today]
  );

  const applyExcelImport = () => {
    if (!excelPlan) return;
    let nextInv = { ...inv, lots: [...inv.lots], daily: { ...inv.daily } };
    const dayMap = { ...(nextInv.daily[today] || {}) };
    for (const s of excelPlan.sets) dayMap[s.lotId] = s.value;
    for (const c of excelPlan.creates) {
      const lotNo = (c.lotNo || DataService.nextInventoryLotNo(c.ink, today, nextInv.lots)).toUpperCase();
      const lot = {
        id: `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ink: c.ink, lotNo, registeredDate: today, order: 1, role: 'initial',
      };
      nextInv.lots.push(lot);
      nextInv.order = appendOrderForNewInitial(nextInv, lot);
      dayMap[lot.id] = c.value;
    }
    nextInv.daily[today] = dayMap;
    setData({ ...data, inventory: nextInv });
    notify(`엑셀 가져오기 완료 — 입력 ${excelPlan.sets.length}건 · 신규 lot ${excelPlan.creates.length}건${excelPlan.unknowns.length ? ` · 제외 ${excelPlan.unknowns.length}건` : ''}`);
    setExcelImport(null);
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

  // ── Lot 등록 ──
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
    // id→lot Map 으로 order 내 동일 잉크의 마지막 위치를 O(order)로 탐색 (중첩 find 제거 → 대량 붙여넣기 시 멈춤 방지).
    const lotById = new Map(working.lots.map(l => [l.id, l]));
    for (const ln of lines) {
      const r = registerLot(ln, working);
      if (r.ok) {
        working.lots.push(r.lot);
        lotById.set(r.lot.id, r.lot);
        let sameInkIdx = -1;
        for (let i = 0; i < working.order.length; i++) {
          if (lotById.get(working.order[i])?.ink === r.lot.ink) sameInkIdx = i;
        }
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

  // ── 재고 입력 ──
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

  // ── 새 일자 생성 ──
  const canCreateToday = !inv.daily[today];
  const createTodayCol = () => {
    if (!canCreateToday) return;
    setData({ ...data, inventory: { ...inv, daily: { ...inv.daily, [today]: {} } } });
    notify(`${invFmtDate(today)} (${invDayKor(today)}) 일자 생성됨`);
  };

  // ── 통계 / 미리보기 ──
  const previewInk = newLot.trim() ? matchInk(newLot) : null;
  const previewOrder = previewInk ? DataService.lotSequenceForDate(inv.lots, previewInk, today) : null;
  const currentCount = currentDate ? Object.keys(inv.daily[currentDate] || {}).length : 0;

  return (
    <div className="page">
      <div className="page__head no-print">
        <div className="page__title-row">
          <div>
            <div className="page__title">잉크 재고 조사</div>
            {currentDate ? (
              <div className="page__meta-chips">
                <span className="page__meta-chip page__meta-chip--today">
                  마지막 기록 {invFmtDate(currentDate)} ({invDayKor(currentDate)})
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
            <button className="btn btn--sm" onClick={() => excelInputRef.current?.click()} title="잉크 재고 조사표(.xlsx)를 읽어 선택한 날짜 컬럼 값을 오늘 재고로 입력">
              <Icon name="image" size={11} /> 엑셀 불러오기
            </button>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => { handleExcelFile(e.target.files?.[0]); e.target.value = ''; }}
            />
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
                ? `${invFmtDate(today)} (${invDayKor(today)}) 일자 컬럼 생성`
                : `${invFmtDate(today)} 컬럼은 이미 생성됨`}
            >
              <Icon name="plus" size={11} />
              {canCreateToday
                ? ` 이어서 생성 (${invFmtDate(today)})`
                : ` ${invFmtDate(today)} 생성됨`}
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
                      {invFmtDate(dateISO)} ({invDayKor(dateISO)})
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
                {visibleLots.map((initialLot, gi) => (
                  <InventoryRow
                    key={initialLot.id}
                    initialLot={initialLot}
                    gi={gi}
                    inv={inv}
                    currentDate={currentDate}
                    today={today}
                    visibleDates={visibleDates}
                    isCurrent={isCurrent}
                    addingFor={addingFor}
                    addingLotNo={addingLotNo}
                    addingRef={addingRef}
                    setAddingLotNo={setAddingLotNo}
                    onConfirmAddLot={confirmAddLot}
                    onCancelAddLot={cancelAddLot}
                    onSetStock={setStock}
                    onDeleteLot={deleteLot}
                    onRelabelInk={relabelInk}
                    onStartAddLot={startAddLot}
                    onMoveRow={moveRow}
                    isLast={gi === visibleLots.length - 1}
                  />
                ))}

                <NewLotFooterRow
                  newLot={newLot}
                  setNewLot={setNewLot}
                  newLotRef={newLotRef}
                  previewInk={previewInk}
                  previewOrder={previewOrder}
                  visibleDates={visibleDates}
                  onAdd={handleAddNew}
                />

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

      {bulkOpen && (
        <BulkAddModal
          bulkText={bulkText}
          setBulkText={setBulkText}
          bulkResult={bulkResult}
          onAdd={handleBulkAdd}
          onClose={() => { setBulkOpen(false); setBulkResult(null); setBulkText(''); }}
        />
      )}

      {excelImport && excelPlan && (
        <Modal
          title={`엑셀 재고 가져오기 — ${excelImport.fileName}`}
          onClose={() => setExcelImport(null)}
          footer={
            <>
              <button className="btn" onClick={() => setExcelImport(null)}>취소</button>
              <button
                className="btn btn--primary"
                disabled={excelPlan.sets.length + excelPlan.creates.length === 0}
                onClick={applyExcelImport}
              >
                <Icon name="check" size={12} /> 오늘({invFmtDate(today)}) 재고로 적용
              </button>
            </>
          }
        >
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="field__label">가져올 날짜 컬럼</label>
            <select
              className="input select"
              value={excelImport.label}
              onChange={e => setExcelImport({ ...excelImport, label: e.target.value })}
              style={{ width: 220 }}
            >
              {excelImport.parsed.dateCols.map(dc => (
                <option key={`${dc.col}`} value={dc.label}>{dc.label} ({dc.day})</option>
              ))}
            </select>
            <div className="field__hint">엑셀의 이 컬럼 값이 오늘 날짜 재고로 들어갑니다.</div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 12 }}>
            <span className="tag">기존 lot 입력 {excelPlan.sets.length}</span>
            <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>신규 lot {excelPlan.creates.length}</span>
            {excelPlan.unknowns.length > 0 && (
              <span className="tag" style={{ background: 'oklch(0.97 0.02 25)', color: 'var(--bad-600)' }}>마스터에 없어 제외 {excelPlan.unknowns.length}</span>
            )}
          </div>

          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--ink-200)', borderRadius: 8 }}>
            <table className="tbl">
              <thead>
                <tr><th>잉크</th><th>Lot</th><th className="num">값</th><th>처리</th></tr>
              </thead>
              <tbody>
                {excelPlan.sets.slice(0, 100).map(s => (
                  <tr key={`s-${s.lotId}`}>
                    <td>{s.ink}</td><td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{s.lotNo}</td>
                    <td className="num">{s.value}</td><td><span className="tag">기존 lot</span></td>
                  </tr>
                ))}
                {excelPlan.creates.slice(0, 50).map((c, i) => (
                  <tr key={`c-${i}`}>
                    <td>{c.ink}</td><td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{c.lotNo || '(자동 생성)'}</td>
                    <td className="num">{c.value}</td><td><span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>신규 등록</span></td>
                  </tr>
                ))}
                {excelPlan.unknowns.slice(0, 50).map((u, i) => (
                  <tr key={`u-${i}`} style={{ opacity: 0.55 }}>
                    <td>{u.ink}</td><td>·</td>
                    <td className="num">{u.value}</td><td><span className="tag" style={{ color: 'var(--bad-600)' }}>마스터에 없음 — 제외</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {excelPlan.sets.length > 100 && (
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 6 }}>미리보기는 100행까지 — 적용은 전체 {excelPlan.sets.length + excelPlan.creates.length}건에 수행됩니다.</div>
          )}
        </Modal>
      )}
    </div>
  );
}

window.InventoryPage = InventoryPage;
