// 변경 이력(audit-trail) — 저장 시점에 기록된 사출계획·제품·잉크 배정 변경분 타임라인.
// 읽기 전용. 데이터는 GET /api/audit (최신순) 로만 가져온다.

const AUDIT_CHANGE_META = {
  added:   { label: '추가', symbol: '+', tone: 'added' },
  changed: { label: '변경', symbol: '~', tone: 'changed' },
  removed: { label: '삭제', symbol: '-', tone: 'removed' },
};

// 저장 출처(view id) → 한글 라벨. NAV/화면 식별자와 일치.
const AUDIT_SOURCE_LABEL = {
  injection: '사출계획',
  'ink-plan': '잉크 생산계획',
  products: '제품 관리',
  machines: '잉크 관리',
  review: '미등록 제품 확인',
  'ocr-import': 'INK 요청서 입력',
  inventory: '재고 조사',
  'ink-add': '넣어줄 잉크',
  chemicals: '약품요청서',
  'test-inks': '양산대응',
  dashboard: '대시보드',
  'data-quality': '데이터 점검',
  web: '기타',
};

const AUDIT_KINDS = [
  { value: 'all', label: '전체' },
  { value: 'injection', label: '사출계획' },
  { value: 'products', label: '제품 마스터' },
  { value: 'machineAssignments', label: '잉크 배정' },
];

function sourceLabel(src) {
  return AUDIT_SOURCE_LABEL[src] || src || '기타';
}

function formatAuditTime(ts) {
  // 'YYYY-MM-DDTHH:MM:SS' → 'MM-DD HH:MM' (+ 날짜 그룹 키)
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return { date: ts || '', time: '', label: ts || '' };
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, label: `${m[2]}-${m[3]} ${m[4]}:${m[5]}` };
}

function AuditPage({ ctx }) {
  const { notify } = ctx;
  const [entries, setEntries] = useState([]);
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/audit?limit=500', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`audit ${r.status}`);
        return r.json();
      })
      .then(rows => setEntries(Array.isArray(rows) ? rows : []))
      .catch(e => {
        console.warn('audit load failed:', e);
        notify('변경 이력을 불러오지 못했습니다');
        setEntries([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => DataService.summarizeAuditEntries(entries), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      const parsed = DataService.parseAuditField(e.field);
      if (kind !== 'all' && parsed.kind !== kind) return false;
      if (!q) return true;
      const hay = [e.field, e.before, e.after, e.source, sourceLabel(e.source)]
        .map(v => String(v == null ? '' : v).toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [entries, kind, query]);

  // 날짜별로 그룹핑(이미 최신순) → 타임라인 헤더
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const e of filtered) {
      const t = formatAuditTime(e.ts);
      if (!cur || cur.date !== t.date) {
        cur = { date: t.date, rows: [] };
        out.push(cur);
      }
      cur.rows.push({ entry: e, time: t.time });
    }
    return out;
  }, [filtered]);

  return (
    <div className="page audit-page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">변경 이력</div>
            <div className="page__meta">저장 시점에 기록된 사출계획·제품·잉크 배정 변경 내역 (최신순)</div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={load}><Icon name="refresh" size={12} /> 새로고침</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div className="audit-summary">
          <div className="audit-summary__item"><span>전체 변경</span><strong>{summary.total}</strong></div>
          <div className="audit-summary__item"><span>사출계획</span><strong>{summary.byKind.injection || 0}</strong></div>
          <div className="audit-summary__item"><span>제품 마스터</span><strong>{summary.byKind.products || 0}</strong></div>
          <div className="audit-summary__item"><span>잉크 배정</span><strong>{summary.byKind.machineAssignments || 0}</strong></div>
        </div>

        <Card flush>
          <div className="toolbar">
            <Seg value={kind} onChange={setKind} options={AUDIT_KINDS} />
            <input
              className="input input--search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="이력 안에서 검색 (제품·잉크·출처)"
              style={{ minWidth: 240 }}
            />
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
              {loading ? '불러오는 중...' : `${filtered.length}건`}
            </span>
          </div>

          <div className="audit-timeline">
            {groups.map(g => (
              <div className="audit-day" key={g.date}>
                <div className="audit-day__head">{g.date}</div>
                {g.rows.map(({ entry, time }, i) => {
                  const parsed = DataService.parseAuditField(entry.field);
                  const change = DataService.auditChangeKind(entry.before, entry.after);
                  const meta = AUDIT_CHANGE_META[change] || AUDIT_CHANGE_META.changed;
                  return (
                    <div className={`audit-row audit-row--${meta.tone}`} key={`${entry.ts}-${i}`}>
                      <div className="audit-row__time">{time}</div>
                      <span className={`audit-change audit-change--${meta.tone}`}>{meta.symbol} {meta.label}</span>
                      <div className="audit-row__field">
                        <span className="audit-row__kind">{parsed.kindLabel}</span>
                        <span className="audit-row__target">{parsed.target}</span>
                        {parsed.detail && <span className="audit-row__detail">{parsed.detail}</span>}
                      </div>
                      <div className="audit-row__values">
                        <span className="audit-val audit-val--before">{entry.before || '∅'}</span>
                        <span className="audit-arrow">→</span>
                        <span className="audit-val audit-val--after">{entry.after || '∅'}</span>
                      </div>
                      <div className="audit-row__source">{sourceLabel(entry.source)}</div>
                    </div>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="muted" style={{ textAlign: 'center', padding: 48 }}>
                {loading ? '불러오는 중...' : '기록된 변경 이력이 없습니다'}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

window.AuditPage = AuditPage;
