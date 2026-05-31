// Shared UI primitives + icons (global window scope for cross-file React access)

const Icon = ({ name, size = 16 }) => {
  const stroke = 'currentColor';
  const sw = 1.8;
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></>,
    injection: <><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="1" fill={stroke}/><circle cx="7" cy="17" r="1" fill={stroke}/></>,
    ink: <><path d="M12 3v6"/><path d="M8 9h8l-1 11H9z"/><path d="M10 13h4"/></>,
    add: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
    floor: <><path d="M3 20h18"/><path d="M5 20V8l7-4 7 4v12"/><path d="M10 20v-6h4v6"/></>,
    machine: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></>,
    trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    sparkle: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="2"/></>,
    filter: <><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></>,
    chevron: <><polyline points="6 9 12 15 18 9"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    check: <><polyline points="20 6 9 17 4 12"/></>,
    arrow: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></>,
    moon: <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    grip: <><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
    beaker: <><path d="M9 3h6v5l4 9a2 2 0 0 1-1.8 2.8H6.8A2 2 0 0 1 5 16.9L9 8V3z"/><path d="M8 3h8"/><path d="M7 12h10"/></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
    flask: <><path d="M10 2v6L5 18a2 2 0 0 0 1.8 2.8h10.4A2 2 0 0 0 19 18l-5-10V2"/><path d="M8 2h8"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
};

const Pill = ({ tone = 'default', children, dot = false }) => (
  <span className={`pill ${tone === 'default' ? '' : 'pill--' + tone}`}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

const Card = ({ title, actions, children, flush = false }) => (
  <div className="card">
    {title && (
      <div className="card__head">
        <span className="title">{title}</span>
        {actions}
      </div>
    )}
    <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
  </div>
);

const Modal = ({ title, onClose, children, footer }) => (
  <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div className="modal__head">
        <span className="modal__title">{title}</span>
        <button className="modal__close" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal__body">{children}</div>
      {footer && <div className="modal__foot">{footer}</div>}
    </div>
  </div>
);

const Toast = ({ message }) => message ? <div className="toast">{message}</div> : null;

const Seg = ({ value, onChange, options }) => (
  <div className="seg">
    {options.map(opt => (
      <button
        key={opt.value}
        className={`seg__btn ${value === opt.value ? 'active' : ''}`}
        onClick={() => onChange(opt.value)}
      >{opt.label}</button>
    ))}
  </div>
);

// ── Product name normalization (OCR ↔ master 비교용) ─────────────────────────

// 본체는 data-service.js 로 이전. 기존 글로벌 호출부 호환을 위한 위임 래퍼.
function normalizeProductName(name) {
  return DataService.normalizeProductName(name);
}

// ── 공통 상수 ───────────────────────────────────────
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const WEEKDAYS_PLUS = ['월', '화', '수', '목', '금', '토', '일', '차주월'];
const INK_DAY_FIELDS = ['현재고', '가용일수', '필요수량', '제조량'];

// ── 공통 헬퍼 ───────────────────────────────────────

// 잉크 배열을 길이 3으로 정규화 (1·2·3도 슬롯). null/빈문자열은 null로 통일.
function padInks3(arr) {
  const v = Array.isArray(arr) ? arr.slice(0, 3) : [];
  while (v.length < 3) v.push(null);
  return v.map(x => (x == null || x === '' ? null : x));
}

// 한국어 요일을 ISO 날짜에서 자동 계산 ('월'~'일'). 본체는 data-service.js (위임).
function dayFromDate(iso, fallback = '월') {
  return DataService.dayFromDate(iso, fallback);
}

// 제품의 채워진 잉크들 (null 제외)
function productInks(product) {
  return (product?.inks || []).filter(Boolean);
}

// machineAssignments record에서 잉크명 추출 (구버전 호환). 본체는 data-service.js (위임).
function inkOfAssignment(a) {
  return DataService.inkOfAssignment(a);
}

// 시스템 날짜에서 "이번 주" 정보 계산.
//   - today: 한국어 요일 ('월'~'일') — 토/일이면 그 자체
//   - dates: { '월': '5/12', '화': '5/13', ..., '일': '5/18', '차주월': '5/19' }
function getWeekInfo(now = new Date()) {
  const DAY_BY_IDX = ['일', '월', '화', '수', '목', '금', '토'];
  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const todayName = DAY_BY_IDX[now.getDay()];
  // 월요일까지 며칠 빼야 하는가 (일=6, 월=0, 화=1, …, 토=5)
  const offsetToMonday = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - offsetToMonday);
  const dates = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates[days[i]] = `${d.getMonth() + 1}/${d.getDate()}`;
  }
  const nextMon = new Date(monday);
  nextMon.setDate(monday.getDate() + 7);
  dates['차주월'] = `${nextMon.getMonth() + 1}/${nextMon.getDate()}`;

  // ISO 8601 주차 (그 주 목요일이 속한 해 기준)
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const isoYear = thursday.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const isoWeek = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  const isoLabel = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

  // "n월 n주차" — 그 주 월요일이 그 달의 몇 번째 월요일인지
  const weekOfMonth = Math.floor((monday.getDate() - 1) / 7) + 1;
  const monthWeekLabel = `${monday.getMonth() + 1}월 ${weekOfMonth}주차`;

  return { today: todayName, dates, isoLabel, monthWeekLabel };
}

// OCR brand "PIA / 액상" → "PIA" 정규화. 본체는 data-service.js (위임).
function normalizeBrand(brand) {
  return DataService.normalizeBrand(brand);
}

// CascadePicker — 브랜드 → 제품 (→ 선택적으로 잉크) 단계별 선택
// props:
//   products: [{name, brand, inks}]
//   mode: 'product' | 'ink' (기본 'product')
//   onSelect: (value) => void  // 최종 선택값
//   currentValue?: string      // 현재 값 표시
//   onClose?: () => void
function CascadePicker({ products, mode = 'product', onSelect, currentValue, onClose, initialBrand = '' }) {
  // initialBrand가 들어오면 마스터에서 정규화된 동일 브랜드를 찾아 자동 선택
  const initBrand = React.useMemo(() => {
    if (!initialBrand) return '';
    const norm = normalizeBrand(initialBrand);
    if (!norm) return '';
    const match = products.find(p => p.brand && normalizeBrand(p.brand) === norm);
    return match?.brand || '';
  }, []); // 첫 렌더 1회만

  const [brand, setBrand] = React.useState(initBrand);
  const [productName, setProductName] = React.useState('');
  const [brandSearch, setBrandSearch] = React.useState('');
  const [productSearch, setProductSearch] = React.useState('');

  const brands = React.useMemo(() => {
    const s = new Set();
    for (const p of products) if (p.brand) s.add(p.brand);
    return Array.from(s).sort();
  }, [products]);

  const productsInBrand = React.useMemo(() => {
    if (!brand) return [];
    return products.filter(p => p.brand === brand);
  }, [brand, products]);

  const inksInProduct = React.useMemo(() => {
    if (!productName) return [];
    const p = products.find(x => x.name === productName);
    return (p?.inks || []).filter(Boolean);
  }, [productName, products]);

  const visibleBrands = React.useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    return q ? brands.filter(b => b.toLowerCase().includes(q)) : brands;
  }, [brands, brandSearch]);

  const visibleProducts = React.useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return q ? productsInBrand.filter(p => p.name.toLowerCase().includes(q)) : productsInBrand;
  }, [productsInBrand, productSearch]);

  const pickProduct = (p) => {
    if (mode === 'product') {
      onSelect(p.name);
      onClose?.();
    } else {
      setProductName(p.name);
    }
  };

  const pickInk = (ink) => {
    onSelect(ink);
    onClose?.();
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: mode === 'ink' ? '1fr 1.4fr 1fr' : '1fr 1.5fr',
      gap: 12,
      minHeight: 360,
    }}>
      {/* 브랜드 컬럼 */}
      <div className="cascade-col">
        <div className="cascade-col__header">
          <span>브랜드</span>
          <span className="cascade-col__count">{brands.length}</span>
        </div>
        <input
          className="input"
          placeholder="브랜드 검색"
          value={brandSearch}
          onChange={e => setBrandSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 6 }}
          autoFocus
        />
        <div className="cascade-list">
          {visibleBrands.map(b => (
            <button
              key={b}
              className={`cascade-item ${brand === b ? 'cascade-item--active' : ''}`}
              onClick={() => { setBrand(b); setProductName(''); setProductSearch(''); }}
            >
              {b}
            </button>
          ))}
          {visibleBrands.length === 0 && <div className="cascade-empty">결과 없음</div>}
        </div>
      </div>

      {/* 제품 컬럼 */}
      <div className="cascade-col">
        <div className="cascade-col__header">
          <span>제품</span>
          <span className="cascade-col__count">{productsInBrand.length}</span>
        </div>
        {brand ? (
          <>
            <input
              className="input"
              placeholder="제품명 검색"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 6 }}
            />
            <div className="cascade-list">
              {visibleProducts.map(p => {
                const inkCount = (p.inks || []).filter(Boolean).length;
                const isActive = mode === 'ink' && productName === p.name;
                return (
                  <button
                    key={p.name}
                    className={`cascade-item ${isActive ? 'cascade-item--active' : ''}`}
                    onClick={() => pickProduct(p)}
                  >
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-500)', marginTop: 1 }}>
                      잉크 {inkCount}개{inkCount > 0 ? ` · ${(p.inks || []).filter(Boolean).join('·')}` : ''}
                    </div>
                  </button>
                );
              })}
              {visibleProducts.length === 0 && <div className="cascade-empty">결과 없음</div>}
            </div>
          </>
        ) : (
          <div className="cascade-empty cascade-empty--guide">← 브랜드를 먼저 선택</div>
        )}
      </div>

      {/* 잉크 컬럼 (mode='ink'일 때만) */}
      {mode === 'ink' && (
        <div className="cascade-col">
          <div className="cascade-col__header">
            <span>잉크 (1·2·3도)</span>
            <span className="cascade-col__count">{inksInProduct.length}</span>
          </div>
          {productName ? (
            <div className="cascade-list">
              {inksInProduct.map((ink, idx) => (
                <button
                  key={ink + idx}
                  className="cascade-item"
                  onClick={() => pickInk(ink)}
                >
                  <span style={{ fontSize: 9, color: 'var(--brand-700)', fontWeight: 700, marginRight: 6 }}>{idx + 1}도</span>
                  {ink}
                </button>
              ))}
              {inksInProduct.length === 0 && <div className="cascade-empty">등록된 잉크 없음</div>}
            </div>
          ) : (
            <div className="cascade-empty cascade-empty--guide">← 제품을 먼저 선택</div>
          )}
        </div>
      )}
    </div>
  );
}

// Stock status by 가용일수 (days available)
const stockStatus = (days) => {
  if (days === null || days === undefined || days === '') return { tone: 'default', label: '-' };
  const d = Number(days);
  if (isNaN(d)) return { tone: 'default', label: '-' };
  if (d < 0) return { tone: 'bad', label: '결품' };
  if (d <= 1) return { tone: 'bad', label: '긴급' };
  if (d <= 3) return { tone: 'warn', label: '주의' };
  if (d <= 7) return { tone: 'info', label: '양호' };
  return { tone: 'ok', label: '충분' };
};

const heatLevel = (v) => {
  if (v === null || v === undefined || v === '' || v === 0) return 'l0';
  const n = Number(v);
  if (isNaN(n)) return 'l0';
  if (n < 0) return 'negative';
  if (n === 0) return 'l0';
  if (n <= 1) return 'l1';
  if (n <= 3) return 'l2';
  if (n <= 6) return 'l3';
  return 'l4';
};

const fmtNum = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (isNaN(n)) return v;
  return n.toLocaleString();
};

Object.assign(window, { Icon, Pill, Card, Modal, Toast, Seg, stockStatus, heatLevel, fmtNum });
