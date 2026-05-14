// Main App + Sidebar + data load

const { useState, useEffect, useMemo, useRef } = React;

// 제품 마스터를 신구조로 변환 (idempotent).
// 구버전: 같은 name이 잉크 수만큼 row로 복제, days/f3/f1 필드 보유.
// 신버전: { name, brand, inks: [1도, 2도, 3도] } — 길이 3 고정, null 허용.
function migrateData(raw) {
  if (!raw) return raw;
  const products = raw.products || [];
  let nextProducts;
  // 이미 신구조(inks 배열)면 길이 3 정규화만
  if (products.length === 0 || products[0].inks !== undefined) {
    nextProducts = products.map(p => ({ ...p, inks: padInks3(p.inks) }));
  } else {
    // 구조 변환: 같은 name row를 합쳐 1·2·3도 순서로 inks 채움
    const map = new Map();
    for (const p of products) {
      const key = p.name || '';
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, { name: p.name, brand: p.brand || '', _inks: [] });
      }
      const entry = map.get(key);
      if (p.ink && !entry._inks.includes(p.ink)) {
        entry._inks.push(p.ink);
      }
      if (!entry.brand && p.brand) entry.brand = p.brand;
    }
    nextProducts = Array.from(map.values()).map(e => ({
      name: e.name,
      brand: e.brand,
      inks: padInks3(e._inks),
    }));
  }
  // machineAssignments: { ink, machine } 단일 형태로 정규화 (구버전 product/name 흡수)
  const nextAssignments = (raw.machineAssignments || []).map(a => ({
    ink: a.ink || a.product || a.name || '',
    machine: a.machine || '',
  })).filter(a => a.ink);
  return { ...raw, products: nextProducts, machineAssignments: nextAssignments };
}

const NAV = [
  { group: '생산 계획', items: [
    { id: 'ocr-import', label: 'INK 요청서 입력', icon: 'upload' },
    { id: 'review', label: '제품명 검수', icon: 'sparkle' },
    { id: 'injection', label: '사출계획', icon: 'injection' },
    { id: 'ink-plan', label: '잉크 생산계획', icon: 'ink' },
  ]},
  { group: '잉크 관리', items: [
    { id: 'inventory', label: '재고 조사', icon: 'flask' },
    { id: 'ink-add', label: '넣어줄 잉크', icon: 'add' },
    { id: 'floor3', label: '3층', icon: 'floor' },
    { id: 'floor1', label: '1층', icon: 'floor' },
    { id: 'test-inks', label: '양산대응 (테스트)', icon: 'beaker' },
  ]},
  { group: '마스터', items: [
    { id: 'products', label: '제품 추가', icon: 'plus' },
    { id: 'machines', label: '잉크 추가', icon: 'beaker' },
  ]},
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "default",
  "density": "default",
  "accent": "blue",
  "stickySidebar": true,
  "showRowNum": true
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  blue:   ['oklch(0.28 0.08 245)', 'oklch(0.42 0.12 245)', 'oklch(0.55 0.15 245)', 'oklch(0.95 0.025 245)'],
  indigo: ['oklch(0.27 0.10 285)', 'oklch(0.42 0.14 285)', 'oklch(0.55 0.17 285)', 'oklch(0.95 0.030 285)'],
  teal:   ['oklch(0.27 0.07 200)', 'oklch(0.42 0.10 200)', 'oklch(0.55 0.12 200)', 'oklch(0.95 0.025 200)'],
  amber:  ['oklch(0.30 0.07 60)',  'oklch(0.50 0.12 65)',  'oklch(0.62 0.14 65)',  'oklch(0.95 0.04 70)'],
};

function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState('injection');
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS);
  const [toast, setToast] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    try {
      localStorage.removeItem('geminiApiKey');
      return sessionStorage.getItem('geminiApiKey') || '';
    } catch (e) { return ''; }
  });
  const [geminiModel, setGeminiModel] = useState(() => {
    try { return localStorage.getItem('geminiModel') || 'gemini-2.5-flash'; } catch (e) { return 'gemini-2.5-flash'; }
  });
  const [ocrResult, setOcrResult] = useState(null); // {parsed, sourceImage(blob url), parsedAt} - 검수 페이지로 전달
  const toastTimer = useRef(null);

  // 초기 로드: localStorage 있으면 그 데이터, 없으면 clean.json fetch
  useEffect(() => {
    const safeMigrate = (raw, source) => {
      try {
        return migrateData(raw);
      } catch (e) {
        console.error(`[${source}] migrateData 실패 — raw data로 fallback:`, e);
        return raw;
      }
    };

    try {
      const saved = localStorage.getItem('inkPlanData');
      if (saved) {
        const parsed = JSON.parse(saved);
        const migrated = safeMigrate(parsed, 'localStorage');
        if (migrated) {
          setData(migrated);
          console.log('[init] localStorage에서 로드:', Object.keys(migrated).length, '키');
          return;
        }
      }
    } catch (e) {
      console.error('[init] localStorage 파싱 실패:', e);
    }

    fetch('data/clean.json')
      .then(r => {
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        return r.json();
      })
      .then(raw => {
        const migrated = safeMigrate(raw, 'clean.json');
        setData(migrated);
        console.log('[init] clean.json에서 로드');
      })
      .catch(e => {
        console.error('[init] clean.json 로드 실패:', e);
        // 데이터 못 받아도 빈 상태로라도 화면 띄움
        setData({ products: [], inkPlan: [], inkAdd: [], injection: { '3층': [], '1층': [] }, testInks: [], machineAssignments: [] });
      });
  }, []);

  // data가 바뀔 때마다 자동 저장 (debounce 가볍게)
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!data) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem('inkPlanData', JSON.stringify(data)); }
      catch (e) { console.warn('localStorage 저장 실패:', e); }
    }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  // Apply tweaks: theme and density via data attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme || 'default');
    document.documentElement.setAttribute('data-density', tweaks.density || 'default');
    const preset = ACCENT_PRESETS[tweaks.accent] || ACCENT_PRESETS.blue;
    document.documentElement.style.setProperty('--brand-900', preset[0]);
    document.documentElement.style.setProperty('--brand-700', preset[1]);
    document.documentElement.style.setProperty('--brand-500', preset[2]);
    document.documentElement.style.setProperty('--brand-50', preset[3]);
  }, [tweaks]);

  const notify = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  const weekInfo = useMemo(() => getWeekInfo(), []);

  if (!data) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--ink-600)' }}>로딩 중…</div>;
  }

  const navItem = NAV.flatMap(g => g.items).find(i => i.id === view);
  const saveApiKey = (key) => {
    setApiKey(key);
    try {
      if (key) sessionStorage.setItem('geminiApiKey', key);
      else sessionStorage.removeItem('geminiApiKey');
      localStorage.removeItem('geminiApiKey');
    } catch (e) { /* private mode */ }
  };
  const saveModel = (m) => {
    setGeminiModel(m);
    try { localStorage.setItem('geminiModel', m); } catch (e) {}
  };
  const ctx = { data, setData, notify, tweaks, setTweaks, apiKey, saveApiKey, geminiModel, saveModel, ocrResult, setOcrResult, setView, today: weekInfo.today, dates: weekInfo.dates };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__logo">
          <div className="app__logo-mark">i</div>
          <span>잉크/사출 생산계획 시스템</span>
        </div>
        <nav className="app__breadcrumb">
          <span>제조운영</span>
          <span className="sep">›</span>
          <span>주간계획</span>
          <span className="sep">›</span>
          <span className="crumb-active">{navItem ? navItem.label : ''}</span>
        </nav>
        <div className="app__toolbar">
          <div className="app__chip"><span className="dot" /><span>주차: 2025-W20</span></div>
          <div className="app__chip">Rev. 41</div>
          <button
            className="app__chip"
            title="브라우저 저장된 데이터를 비우고 clean.json으로 되돌리기 (현재 변경사항 모두 사라짐)"
            onClick={() => {
              if (confirm('저장된 모든 변경사항을 비우고 초기 데이터로 되돌릴까? 되돌릴 수 없어.')) {
                try { localStorage.removeItem('inkPlanData'); } catch (e) {}
                location.reload();
              }
            }}
          ><Icon name="refresh" size={12} /> 초기화</button>
          <button className="app__chip" title="알림"><Icon name="bell" size={12} /></button>
          <button
            className="app__chip"
            title="설정"
            onClick={() => setShowSettings(true)}
            style={apiKey ? null : { background: 'var(--warn-50)', borderColor: 'var(--warn-300)', color: 'var(--warn-700)' }}
          >
            <Icon name="settings" size={12} />
            {!apiKey && <span style={{ marginLeft: 4 }}>API 키 필요</span>}
          </button>
          <div className="app__user">KSM</div>
        </div>
      </header>

      <aside className="app__sidebar">
        {NAV.map(group => (
          <React.Fragment key={group.group}>
            <div className="sb-section">{group.group}</div>
            {group.items.map(item => (
              <div
                key={item.id}
                className={`sb-item ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <span className="sb-item__icon"><Icon name={item.icon} /></span>
                <span>{item.label}</span>
                {item.id === 'injection' && <span className="sb-item__badge">{data.injection['3층'].length + data.injection['1층'].length}</span>}
                {item.id === 'ink-add' && <span className="sb-item__badge">{data.inkAdd.length}</span>}
                {item.id === 'products' && <span className="sb-item__badge">{data.products.length}</span>}
                {item.id === 'test-inks' && <span className="sb-item__badge" style={{background:'oklch(0.95 0.05 30)',color:'oklch(0.50 0.16 30)'}}>{data.testInks?.length || 0}</span>}
              </div>
            ))}
          </React.Fragment>
        ))}
        <div className="sb-footer">
          <div>김선명 · 생산관리팀</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>5월 2주차 · v41</div>
        </div>
      </aside>

      <main className="app__main">
        {view === 'ocr-import' && <OcrImportPage ctx={ctx} />}
        {view === 'review' && <ReviewPage ctx={ctx} />}
        {view === 'injection' && <InjectionPage ctx={ctx} />}
        {view === 'ink-plan' && <InkPlanPage ctx={ctx} />}
        {view === 'ink-add' && <InkAddPage ctx={ctx} />}
        {view === 'floor3' && <FloorPage ctx={ctx} floor="3" />}
        {view === 'floor1' && <FloorPage ctx={ctx} floor="1" />}
        {view === 'products' && <ProductsPage ctx={ctx} />}
        {view === 'machines' && <MachinesPage ctx={ctx} />}
        {view === 'test-inks' && <TestInksPage ctx={ctx} />}
        {view === 'inventory' && <InventoryPage ctx={ctx} />}
      </main>

      <TweaksControls tweaks={tweaks} setTweak={setTweaks} />

      {showSettings && (
        <SettingsModal
          apiKey={apiKey}
          model={geminiModel}
          onSave={(key, m) => {
            saveApiKey(key);
            if (m !== geminiModel) saveModel(m);
            notify(key ? '설정 저장됨' : 'API 키 삭제됨');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

const GEMINI_MODELS = [
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      meta: 'RPM 5 · RPD 20 · 정확도 검증됨' },
  { value: 'gemini-3-flash',        label: 'Gemini 3 Flash',        meta: 'RPM 5 · RPD 20 · 신형(정확도↑ 기대)' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', meta: 'RPM 10 · RPD 20 · 빠름' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', meta: 'RPM 15 · RPD 500 · 한도 최대' },
];

function SettingsModal({ apiKey, model, onSave, onClose }) {
  const [key, setKey] = useState(apiKey);
  const [m, setM] = useState(model);
  const [show, setShow] = useState(false);
  const masked = apiKey ? apiKey.slice(0, 6) + '…' + apiKey.slice(-4) : '';
  const dirty = key.trim() !== apiKey || m !== model;

  return (
    <Modal
      title="설정"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>취소</button>
          {apiKey && (
            <button
              className="btn btn--danger"
              onClick={() => { onSave('', m); onClose(); }}
            ><Icon name="trash" size={12} /> 키 삭제</button>
          )}
          <button
            className="btn btn--primary"
            onClick={() => { onSave(key.trim(), m); onClose(); }}
            disabled={!key.trim() || !dirty}
          ><Icon name="check" size={12} /> 저장</button>
        </>
      }
    >
      <div className="field">
        <label className="field__label">Gemini API 키<span className="req">*</span></label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input"
            type={show ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder={apiKey ? `현재: ${masked}` : 'AIza...'}
            style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace' }}
            autoFocus
          />
          <button className="btn" onClick={() => setShow(s => !s)} title={show ? '숨기기' : '보기'}>
            {show ? '숨김' : '표시'}
          </button>
        </div>
        <div className="field__hint">
          Google AI Studio에서 발급:{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: 'var(--brand-700)' }}>
            aistudio.google.com/apikey
          </a>
          {' · '}현재 탭 세션에만 저장됨. 브라우저를 닫으면 삭제됩니다.
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label className="field__label">모델</label>
        <select className="input" value={m} onChange={e => setM(e.target.value)} style={{ width: '100%' }}>
          {GEMINI_MODELS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <div className="field__hint">{GEMINI_MODELS.find(g => g.value === m)?.meta}</div>
      </div>

      <div style={{ marginTop: 16, padding: 10, background: 'var(--ink-50)', borderRadius: 8, fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.6 }}>
        매일 1장이면 2.5 Flash로 충분, 여러 장/재시도 많으면 <strong>3.1 Flash Lite (500 RPD)</strong> 추천.
      </div>
    </Modal>
  );
}

function TweaksControls({ tweaks, setTweak }) {
  return (
    <TweaksPanel title="화면 설정">
      <TweakSection title="외관">
        <TweakRadio label="테마" value={tweaks.theme} onChange={v => setTweak('theme', v)}
          options={[
            { value: 'default', label: 'Light' },
            { value: 'midnight', label: 'Dark' },
          ]}
        />
        <TweakSelect label="포인트 컬러" value={tweaks.accent} onChange={v => setTweak('accent', v)}
          options={[
            { value: 'blue', label: 'Enterprise Blue' },
            { value: 'indigo', label: 'Indigo' },
            { value: 'teal', label: 'Teal' },
            { value: 'amber', label: 'Amber' },
          ]}
        />
        <TweakRadio label="밀도" value={tweaks.density} onChange={v => setTweak('density', v)}
          options={[
            { value: 'compact', label: '컴팩트' },
            { value: 'default', label: '기본' },
            { value: 'comfortable', label: '여유' },
          ]}
        />
      </TweakSection>
      <TweakSection title="테이블">
        <TweakToggle label="행 번호 표시" value={tweaks.showRowNum} onChange={v => setTweak('showRowNum', v)} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
