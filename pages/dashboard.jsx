// 통합 대시보드 — 흩어진 핵심 지표(마스터 정합성·재고 부족·이번 주 일정·마스터 규모)를
// 진입 화면 한 곳에 요약한다. 모든 수치는 data-service.buildDashboardSummary(기존 어댑터
// lintMasters·buildInkShortageBadge 합성)에서 파생되어 각 페이지·사이드바 배지·bell과 항상 일치.
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

  const { master, shortage, masters, week } = sum;

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
  const weekValue = week.today
    ? `오늘 ${week.today}요일${week.todayDate ? ` (${week.todayDate})` : ''}`
    : '이번 주';

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
          tone="ok"
          title="마스터 규모"
          value={`제품 ${masters.products} · 잉크 ${masters.inks} · 약품 ${masters.chemicals}`}
          sub="제품·잉크·약품 마스터 관리"
          go="products"
        />
      </div>
    </div>
  );
}

window.DashboardPage = DashboardPage;
