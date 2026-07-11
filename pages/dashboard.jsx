// 통합 대시보드 — 흩어진 핵심 지표(마스터 정합성·재고 부족·이번 주 일정·마스터 규모)를
// 진입 화면 한 곳에 요약한다. 모든 수치는 data-service.buildDashboardSummary에서 파생되어
// 각 페이지·사이드바 배지·bell과 항상 일치한다.
// read-only(데이터 변경 없음). 카드 클릭 → ctx.setView로 해당 작업 화면 이동.

function DashboardPage({ ctx }) {
  const { data, dates, today, setView } = ctx;

  const sum = React.useMemo(
    () => DataService.buildDashboardSummary(data, dates, {
      today,
      normalize: typeof normalizeProductName === 'function' ? normalizeProductName : undefined,
    }),
    [data, dates, today]
  );

  const { master, shortage, depletion, week } = sum;

  // 주간 마감은 앱 열 때 자동 처리(app.jsx) — 별도 유도 배너 불필요.
  const Card = ({ tone, title, value, sub, go }) => (
    <button
      type="button"
      className={`dash-card${tone === 'bad' ? ' dash-card--bad' : tone === 'warn' ? ' dash-card--warn' : ''}`}
      onClick={() => setView(go)}
    >
      <div className="dash-card__title">{title}</div>
      <div className="dash-card__value">{value}</div>
      <div className="dash-card__sub">{sub}</div>
    </button>
  );

  const shortNames = shortage.items.map(i => i.ink).join(' · ');
  const depletionNames = depletion.items.map(i => i.ink).join(' · ');
  const weekValue = week.today
    ? `오늘 ${week.today}요일${week.todayDate ? ` (${week.todayDate})` : ''}`
    : '이번 주';

  // 오늘 사출 라인업 — 카드 아래 빈 공간을 실제 작업 정보로 채움 (read-only)
  const lineup = React.useMemo(
    () => DataService.buildTodayLineup(data?.injection, today),
    [data, today]
  );

  return (
    <div className="page dash">
      <h1 className="page__title">대시보드</h1>
      <p className="page__desc">오늘의 시스템 상태를 한눈에. 카드를 누르면 해당 화면으로 이동합니다.</p>


      <div className="dash-grid">
        <Card
          tone={master.tone}
          title="마스터 정합성"
          value={master.errorCount > 0 ? `점검 필요 ${master.errorCount}건` : '정상'}
          sub={master.errorCount > 0 ? master.tooltip : '제품·잉크 마스터 이상 없음'}
          go="data-quality"
        />
        <Card
          tone={shortage.tone}
          title="재고 부족 임박"
          value={shortage.count > 0 ? `부족 ${shortage.count}건` : '정상'}
          sub={shortage.count > 0 ? shortNames : '이번 주 소요 대비 재고 충분'}
          go="ink-plan"
        />
        <Card
          tone="ok"
          title="이번 주 일정"
          value={weekValue}
          sub={week.dayCount > 0 ? `${week.dates.join(' · ')}` : '일정 정보 없음'}
          go="injection"
        />
        <Card
          tone={depletion.tone}
          title="잉크 소진 임박"
          value={depletion.count > 0 ? `${depletion.count}건` : '정상'}
          sub={depletion.count > 0 ? depletionNames : '3일 이내 소진 예상 없음'}
          go="ink-plan"
        />
      </div>

      {/* 하단 상세: 오늘 라인업(좌) + 부족 상세/빠른 작업(우) — 카드 요약과 동일 출처, read-only */}
      <div className="dash-detail">
        <div className="card">
          <div className="card__head">
            <span className="title">오늘 사출 라인업{week.today ? ` — ${week.today}요일` : ''}</span>
            <button className="btn btn--sm" onClick={() => setView('injection')}>사출계획 열기</button>
          </div>
          <div className="card__body card__body--flush">
            {lineup.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state__title">오늘 잡힌 사출 일정이 없습니다</div>
                <div className="empty-state__hint">INK 요청서를 파싱하면 여기에 오늘 라인업이 표시됩니다.</div>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>층</th>
                    <th style={{ width: 70 }}>호기</th>
                    <th>주간</th>
                    <th>야간</th>
                  </tr>
                </thead>
                <tbody>
                  {lineup.map(r => (
                    <tr key={`${r.floor}-${r.machine}`} style={{ cursor: 'pointer' }} onClick={() => setView('injection')}>
                      <td><span className="tag">{r.floor}</span></td>
                      <td style={{ fontWeight: 600 }}>{r.machine}</td>
                      <td>{r.day || <span style={{ color: 'var(--ink-400)' }}>·</span>}</td>
                      <td>{r.night || <span style={{ color: 'var(--ink-400)' }}>·</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <span className="title">{shortage.count > 0 || depletion.count > 0 ? '재고 위험 상세' : '빠른 작업'}</span>
          </div>
          <div className="card__body">
            {shortage.count > 0 || depletion.count > 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {shortage.items.map(it => (
                  <button key={`shortage-${it.ink}`} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setView('ink-plan')}>
                    <span style={{ fontWeight: 600 }}>{it.ink}</span>
                    <span style={{ color: 'var(--bad-600)', fontWeight: 600 }}>부족 {Math.abs(it.weeklyNeed).toLocaleString()}</span>
                  </button>
                ))}
                {depletion.items.map(it => (
                  <button key={`depletion-${it.ink}`} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setView('ink-plan')}>
                    <span style={{ fontWeight: 600 }}>{it.ink} · {it.day}요일</span>
                    <span style={{ color: it.tone === 'bad' ? 'var(--bad-600)' : 'var(--warn-700)', fontWeight: 600 }}>
                      잔여 {it.availableDays.toLocaleString()}일
                    </span>
                  </button>
                ))}
                {/* items는 buildDashboardSummary에서 카테고리별 상위 5로 캡 — 넘친 건수는 count로 산출 */}
                {(shortage.count + depletion.count) > (shortage.items.length + depletion.items.length) && (
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', textAlign: 'center' }}>
                    외 {(shortage.count + depletion.count) - (shortage.items.length + depletion.items.length)}건 — 잉크 생산계획에서 확인
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="btn" onClick={() => setView('inventory')}><Icon name="search" size={12} /> 재고 조사 입력</button>
                <button className="btn" onClick={() => setView('ocr-import')}><Icon name="image" size={12} /> INK 요청서 파싱</button>
                <button className="btn" onClick={() => setView('ink-plan')}><Icon name="ink" size={12} /> 잉크 생산계획</button>
                <button className="btn" onClick={() => setView('ink-add')}><Icon name="add" size={12} /> 넣어줄 잉크</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.DashboardPage = DashboardPage;
