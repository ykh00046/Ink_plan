// Read-only history viewer backed by saved backup snapshots.

const HISTORY_COMPARE_CONFIG = {
  injection: {
    keyFields: ['floor', 'machine', 'day', 'shift'],
    valueFields: ['value'],
  },
  ink: {
    keyFields: ['name', 'day'],
    valueFields: ['values'],
  },
  inventory: {
    keyFields: ['date', 'ink', 'lotNo'],
    valueFields: ['value'],
  },
};

const HISTORY_CHANGE_META = {
  added: { label: '추가', symbol: '+', tone: 'added' },
  changed: { label: '변경', symbol: '~', tone: 'changed' },
  removed: { label: '삭제', symbol: '-', tone: 'removed' },
  unchanged: { label: '동일', symbol: '=', tone: 'unchanged' },
};

function HistoryPage({ ctx }) {
  const { data, notify } = ctx;
  const [backups, setBackups] = useState([]);
  const [selected, setSelected] = useState('current');
  const [snapshot, setSnapshot] = useState(data);
  const [tab, setTab] = useState('injection');
  const [query, setQuery] = useState('');
  const [changesOnly, setChangesOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadBackups = () => {
    fetch('/api/backups', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`backups ${r.status}`);
        return r.json();
      })
      .then(setBackups)
      .catch(e => {
        console.warn('backup list failed:', e);
        notify('기록 목록을 불러오지 못했습니다');
      });
  };

  useEffect(() => { loadBackups(); }, []);

  const selectSnapshot = (name) => {
    setQuery('');
    setChangesOnly(false);
    if (name === 'current') {
      setSelected(name);
      setSnapshot(data);
      return;
    }
    setLoading(true);
    fetch(`/api/backup?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`backup ${r.status}`);
        return r.json();
      })
      .then(raw => {
        setSnapshot(migrateData(raw));
        setSelected(name);
      })
      .catch(e => {
        console.warn('backup load failed:', e);
        notify('선택한 기록을 열지 못했습니다');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selected === 'current') setSnapshot(data);
  }, [data, selected]);

  const summary = useMemo(() => summarizeSnapshot(snapshot), [snapshot]);
  const backupOptions = useMemo(() => [
    { name: 'current', label: '현재 데이터' },
    ...backups.map(b => ({ name: b.name, label: formatBackupName(b.name) })),
  ], [backups]);

  const snapshotRows = useMemo(() => buildHistoryRows(snapshot, tab), [snapshot, tab]);
  const currentRows = useMemo(() => buildHistoryRows(data, tab), [data, tab]);
  const comparison = useMemo(() => {
    if (selected === 'current') {
      return {
        rows: snapshotRows,
        summary: {
          added: 0,
          changed: 0,
          removed: 0,
          unchanged: snapshotRows.length,
          totalChanges: 0,
        },
      };
    }
    const config = HISTORY_COMPARE_CONFIG[tab];
    return DataService.compareHistoryRows(
      snapshotRows,
      currentRows,
      config.keyFields,
      config.valueFields,
    );
  }, [selected, snapshotRows, currentRows, tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return comparison.rows.filter(row => {
      if (changesOnly && row._change === 'unchanged') return false;
      if (!q) return true;
      return Object.values(row).some(v => {
        if (v && typeof v === 'object') return false;
        return String(v || '').toLowerCase().includes(q);
      });
    });
  }, [comparison.rows, query, changesOnly]);

  const comparing = selected !== 'current';
  const diff = comparison.summary;
  const filteredEmpty = '조건에 맞는 변경 기록이 없습니다';

  return (
    <div className="page history-page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">기록 조회</div>
            <div className="page__meta">백업 시점의 사출계획, 잉크 생산계획, 재고 조사 내용을 현재 데이터와 비교</div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={loadBackups}><Icon name="refresh" size={12} /> 새로고침</button>
          </div>
        </div>
      </div>

      <div className="page__body history-layout">
        <Card flush>
          <div className="history-picker">
            <div className="field__label">조회 시점</div>
            <div className="history-list">
              {backupOptions.map(opt => (
                <button
                  key={opt.name}
                  className={`history-list__item ${selected === opt.name ? 'active' : ''}`}
                  onClick={() => selectSnapshot(opt.name)}
                >
                  <span>{opt.label}</span>
                  {opt.name !== 'current' && <small>{opt.name}</small>}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <div className="history-main">
          <div className="history-summary">
            <div className="history-summary__item"><span>사출 배정</span><strong>{summary.injectionCells}</strong></div>
            <div className="history-summary__item"><span>사출기</span><strong>{summary.machines}</strong></div>
            <div className="history-summary__item"><span>잉크 계획</span><strong>{summary.inkRows}</strong></div>
            <div className="history-summary__item"><span>재고 날짜</span><strong>{summary.inventoryDates}</strong></div>
            <div className="history-summary__item"><span>LOT</span><strong>{summary.lots}</strong></div>
          </div>

          <div className={`history-diff ${comparing ? 'history-diff--active' : ''}`}>
            <div>
              <strong>{comparing ? '현재 대비 변화' : '현재 데이터 조회 중'}</strong>
              <span>{comparing ? formatBackupName(selected) : '백업을 선택하면 현재 데이터와의 차이를 표시합니다.'}</span>
            </div>
            {comparing && (
              <div className="history-diff__counts" aria-label="현재 대비 변화 요약">
                <HistoryDiffCount type="added" count={diff.added} />
                <HistoryDiffCount type="changed" count={diff.changed} />
                <HistoryDiffCount type="removed" count={diff.removed} />
              </div>
            )}
          </div>

          <Card flush>
            <div className="toolbar">
              <Seg
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'injection', label: '사출계획' },
                  { value: 'ink', label: '잉크 생산계획' },
                  { value: 'inventory', label: '재고 조사' },
                ]}
              />
              <input
                className="input input--search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="기록 안에서 검색"
                style={{ minWidth: 220 }}
              />
              {comparing && (
                <label className="history-change-filter">
                  <input
                    type="checkbox"
                    checked={changesOnly}
                    onChange={e => setChangesOnly(e.target.checked)}
                  />
                  변경 항목만
                </label>
              )}
              <div className="spacer" />
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                {loading ? '불러오는 중...' : `${filtered.length}건`}
              </span>
            </div>

            <div className="tbl-wrap history-table-wrap">
              {tab === 'injection' && <HistoryTable comparing={comparing} rows={filtered} columns={[
                ['floor', '층'], ['machine', '사출기'], ['day', '요일'], ['shift', '구분'], ['value', '제품'],
              ]} empty={changesOnly ? filteredEmpty : '저장된 사출 배정이 없습니다'} />}
              {tab === 'ink' && <HistoryTable comparing={comparing} rows={filtered} columns={[
                ['name', '잉크'], ['day', '요일'], ['values', '기록값'],
              ]} empty={changesOnly ? filteredEmpty : '저장된 잉크 생산계획이 없습니다'} />}
              {tab === 'inventory' && <HistoryTable comparing={comparing} rows={filtered} columns={[
                ['date', '날짜'], ['ink', '잉크'], ['lotNo', 'LOT'], ['value', '재고'],
              ]} empty={changesOnly ? filteredEmpty : '저장된 재고 조사 기록이 없습니다'} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HistoryDiffCount({ type, count }) {
  const meta = HISTORY_CHANGE_META[type];
  return <span className={`history-diff__count history-change--${meta.tone}`}>{meta.symbol}{count} {meta.label}</span>;
}

function HistoryTable({ rows, columns, empty, comparing }) {
  return (
    <table className="tbl history-table">
      <thead>
        <tr>
          {comparing && <th style={{ width: 72 }}>상태</th>}
          {columns.map(([key, label]) => <th key={key}>{label}</th>)}
          {comparing && <th>이전 → 현재</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const meta = HISTORY_CHANGE_META[row._change] || HISTORY_CHANGE_META.unchanged;
          return (
            <tr key={idx} className={comparing ? `history-row--${meta.tone}` : ''}>
              {comparing && (
                <td>
                  <span className={`history-change history-change--${meta.tone}`}>
                    {meta.symbol} {meta.label}
                  </span>
                </td>
              )}
              {columns.map(([key]) => <td key={key}>{row[key] ?? '-'}</td>)}
              {comparing && <td className="history-change-detail">{row._changeDetail || '-'}</td>}
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr><td colSpan={columns.length + (comparing ? 2 : 0)} className="muted" style={{ textAlign: 'center', padding: 40 }}>{empty}</td></tr>
        )}
      </tbody>
    </table>
  );
}

function buildHistoryRows(snapshot, tab) {
  if (tab === 'injection') return buildInjectionRows(snapshot);
  if (tab === 'ink') return buildInkPlanRows(snapshot);
  return buildInventoryRows(snapshot);
}

function summarizeSnapshot(s) {
  const injection = s?.injection || {};
  let machines = 0;
  let injectionCells = 0;
  for (const list of Object.values(injection)) {
    machines += (list || []).length;
    for (const machine of list || []) {
      for (const shifts of Object.values(machine.schedule || {})) {
        if (shifts.day) injectionCells++;
        if (shifts.night) injectionCells++;
      }
    }
  }
  return {
    machines,
    injectionCells,
    inkRows: (s?.inkPlan || []).length,
    inventoryDates: Object.keys(s?.inventory?.daily || {}).length,
    lots: (s?.inventory?.lots || []).length,
  };
}

function buildInjectionRows(s) {
  const out = [];
  for (const [floor, list] of Object.entries(s?.injection || {})) {
    for (const machine of list || []) {
      for (const [day, shifts] of Object.entries(machine.schedule || {})) {
        // 셀이 {name,id} 객체일 수 있음 — diff·표시는 이름 기준(객체↔문자열 노이즈 방지)
        if (shifts.day) out.push({ floor, machine: machine.machine, day, shift: '주간', value: DataService.productCellName(shifts.day) });
        if (shifts.night) out.push({ floor, machine: machine.machine, day, shift: '야간', value: DataService.productCellName(shifts.night) });
      }
    }
  }
  return out;
}

function buildInkPlanRows(s) {
  const out = [];
  for (const ink of s?.inkPlan || []) {
    for (const [day, values] of Object.entries(ink.days || {})) {
      const entries = Object.entries(values || {})
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([k, v]) => `${k}: ${v}`);
      if (entries.length) out.push({ name: ink.name, day, values: entries.join(' / ') });
    }
  }
  return out;
}

function buildInventoryRows(s) {
  const lotsById = new Map((s?.inventory?.lots || []).map(lot => [lot.id, lot]));
  const out = [];
  for (const [date, values] of Object.entries(s?.inventory?.daily || {})) {
    for (const [lotId, value] of Object.entries(values || {})) {
      const lot = lotsById.get(lotId) || {};
      out.push({ date, ink: lot.ink || '', lotNo: lot.lotNo || lotId, value });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.ink).localeCompare(String(b.ink)));
}

function formatBackupName(name) {
  const m = String(name || '').match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(.+?))?(?:-\d+)?\.json$/);
  if (!m) return name;
  const label = m[7] ? ` · ${m[7]}` : '';
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${label}`;
}

window.HistoryPage = HistoryPage;
