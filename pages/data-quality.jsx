// 마스터 정합성 검증 — 사출계획/제품/잉크 마스터 간 결함을 카테고리별로 모아 보여준다.
// read-only 집계. 카드 클릭으로 펼침/접힘, 행 클릭으로 해당 마스터 페이지로 이동.

const LINT_CATEGORY_META = {
  'product-not-in-master':    { label: '사출계획에 있으나 제품 마스터에 없음', severity: 'error' },
  'product-no-inks':          { label: '제품에 잉크가 비어 있음',              severity: 'error' },
  'ink-not-in-assignments':   { label: '잉크가 잉크 마스터에 등록 안 됨',       severity: 'warn'  },
  'ink-no-code':              { label: '잉크 품목코드 미입력',                severity: 'warn'  },
  'ink-no-machine':           { label: '잉크 사용 호기 미지정',                severity: 'warn'  },
  'duplicate-ink-assignment': { label: '잉크가 여러 호기에 중복 등록',         severity: 'warn'  },
  'orphan-ink-assignment':    { label: '사용되지 않는 잉크 마스터',            severity: 'info'  },
};
const LINT_CATEGORY_ORDER = [
  'product-not-in-master',
  'product-no-inks',
  'ink-not-in-assignments',
  'ink-no-code',
  'ink-no-machine',
  'duplicate-ink-assignment',
  'orphan-ink-assignment',
];

function DataQualityPage({ ctx }) {
  const { data, notify, setView } = ctx;
  const [expanded, setExpanded] = useState(() => new Set(['product-not-in-master', 'product-no-inks']));
  const [sevFilter, setSevFilter] = useState('all'); // 'all' | 'error' | 'warn' | 'info'

  const lint = useMemo(
    () => DataService.lintMasters(data, { normalize: normalizeProductName }),
    [data]
  );

  // 마스터 현황 통계(경보 아님·read-only) — 비대한 잉크 마스터를 한눈에.
  const stats = useMemo(() => DataService.buildMasterStats(data), [data]);

  const visibleIssues = useMemo(() => {
    let list = lint.issues;
    if (sevFilter !== 'all') list = list.filter(i => i.severity === sevFilter);
    if (expanded.size > 0) list = list.filter(i => expanded.has(i.category));
    return list;
  }, [lint.issues, sevFilter, expanded]);

  const toggleCard = (cat) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(LINT_CATEGORY_ORDER));
  const collapseAll = () => setExpanded(new Set());

  const copyTSV = () => {
    if (lint.issues.length === 0) { notify('복사할 이슈 없음'); return; }
    const header = ['심각도', '카테고리', '항목', '상세'].join('\t');
    const lines = lint.issues.map(i => [i.severity, LINT_CATEGORY_META[i.category]?.label || i.category, i.target, i.detail].join('\t'));
    const text = [header, ...lines].join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => notify(`${lint.issues.length}건 복사됨`))
        .catch(() => notify('복사 실패'));
    } else {
      notify('이 브라우저에서 복사 불가');
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">데이터 점검</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">총 <strong>{lint.summary.total}</strong>건</span>
              {lint.summary.bySeverity.error > 0 && (
                <span className="page__meta-chip" style={{ background: 'var(--bad-100)', color: 'var(--bad-600)' }}>
                  심각 <strong>{lint.summary.bySeverity.error}</strong>
                </span>
              )}
              {lint.summary.bySeverity.warn > 0 && (
                <span className="page__meta-chip" style={{ background: 'var(--warn-100)', color: 'var(--warn-600)' }}>
                  경고 <strong>{lint.summary.bySeverity.warn}</strong>
                </span>
              )}
              {lint.summary.bySeverity.info > 0 && (
                <span className="page__meta-chip" style={{ background: 'var(--info-100)', color: 'var(--info-600)' }}>
                  안내 <strong>{lint.summary.bySeverity.info}</strong>
                </span>
              )}
              <span className="page__meta-chip page__meta-chip--today">마스터 점검 (read-only)</span>
            </div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={copyTSV}><Icon name="download" size={12} /> TSV 복사</button>
            <button className="btn" onClick={expandAll}>모두 펼치기</button>
            <button className="btn" onClick={collapseAll}>모두 접기</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        {/* 마스터 현황(경보 아님) — 등록 규모 대비 실사용을 보여줘 마스터 정리 판단을 돕는다 */}
        <div className="dash-grid" style={{ marginBottom: 12 }}>
          <div className="dash-card" style={{ cursor: 'default' }}>
            <div className="dash-card__title">제품 마스터</div>
            <div className="dash-card__value">{stats.products.toLocaleString()}</div>
            <div className="dash-card__sub">동명 그룹 {stats.sameNameGroups}종(정상 구분 대상)</div>
          </div>
          <div className="dash-card" style={{ cursor: 'default' }}>
            <div className="dash-card__title">잉크 마스터</div>
            <div className="dash-card__value">{stats.inks.toLocaleString()}</div>
            <div className="dash-card__sub">고유 잉크(정규화 기준)</div>
          </div>
          <div className="dash-card" style={{ cursor: 'default' }}>
            <div className="dash-card__title">이번 사출에 실사용</div>
            <div className="dash-card__value">{stats.inksUsedInInjection.toLocaleString()}</div>
            <div className="dash-card__sub">나머지 {Math.max(0, stats.inks - stats.inksUsedInInjection).toLocaleString()}종은 현재 미사용</div>
          </div>
          <div className={`dash-card${stats.inksWithoutMachine > 0 ? ' dash-card--warn' : ''}`} style={{ cursor: 'default' }}>
            <div className="dash-card__title">호기 미배정 잉크</div>
            <div className="dash-card__value">{stats.inksWithoutMachine.toLocaleString()}</div>
            <div className="dash-card__sub">{stats.inksWithoutMachine > 0 ? '가용일이 뜨지 않음 — 호기 지정 필요' : '모든 잉크에 호기 지정됨'}</div>
          </div>
        </div>

        {lint.summary.total === 0 ? (
          <div className="lint-empty">
            <Icon name="check" size={48} />
            <div style={{ fontSize: 16, marginTop: 12, color: 'var(--ink-700)' }}>마스터 데이터가 깨끗합니다</div>
            <div style={{ fontSize: 12, marginTop: 6, color: 'var(--ink-500)' }}>
              제품·잉크·사출계획 간 정합성 결함이 없습니다.
            </div>
          </div>
        ) : (
          <>
            <div className="lint-card-grid">
              {LINT_CATEGORY_ORDER.map(cat => {
                const count = lint.summary.byCategory[cat] || 0;
                const meta = LINT_CATEGORY_META[cat];
                const isActive = expanded.has(cat);
                return (
                  <div
                    key={cat}
                    className={`lint-card ${meta.severity} ${isActive ? 'active' : ''}`}
                    onClick={() => toggleCard(cat)}
                    style={{ opacity: count === 0 ? 0.4 : 1 }}
                  >
                    <div className="lint-card__label">{meta.label}</div>
                    <div className="lint-card__count">{count}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-600)' }}>심각도 필터:</span>
              {[
                { value: 'all',   label: '전체' },
                { value: 'error', label: '심각만' },
                { value: 'warn',  label: '경고만' },
                { value: 'info',  label: '안내만' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`btn btn--sm ${sevFilter === opt.value ? 'btn--primary' : ''}`}
                  onClick={() => setSevFilter(opt.value)}
                >{opt.label}</button>
              ))}
              <div className="spacer" />
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                펼친 카테고리 {expanded.size}개 · 표시 {visibleIssues.length}건
              </span>
            </div>

            <Card flush>
              <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>심각도</th>
                      <th style={{ width: 240 }}>카테고리</th>
                      <th>항목</th>
                      <th style={{ width: 280 }}>상세</th>
                      <th style={{ width: 80 }}>이동</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleIssues.map(issue => (
                      <tr key={issue.key}>
                        <td>
                          <span className={`lint-sev lint-sev--${issue.severity}`}>
                            {issue.severity === 'error' ? '심각' : issue.severity === 'warn' ? '경고' : '안내'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--ink-700)' }}>
                          {LINT_CATEGORY_META[issue.category]?.label || issue.category}
                        </td>
                        <td style={{ fontWeight: 600 }}>{issue.target}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink-600)' }}>{issue.detail || '-'}</td>
                        <td>
                          <button
                            className="btn btn--sm"
                            onClick={() => setView(issue.navTo)}
                            title={`${issue.navTo} 페이지로 이동`}
                          >
                            <Icon name="arrow" size={11} />
                            {issue.navTo === 'products' ? ' 제품' : issue.navTo === 'machines' ? ' 잉크' : ' 사출'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {visibleIssues.length === 0 && (
                      <tr><td colSpan="100">
                        <div className="empty-state">
                          <div className="empty-state__title">표시할 이슈 없음</div>
                          <div className="empty-state__hint">
                            카테고리 카드를 클릭해서 펼치거나 심각도 필터를 바꿔보세요.
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

window.DataQualityPage = DataQualityPage;
