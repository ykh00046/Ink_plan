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
  // inkMachines 필드 제거 — 호기 정보는 machineAssignments(잉크→호기)로 일원화
  if (products.length === 0 || products[0].inks !== undefined) {
    nextProducts = products.map(p => {
      const { inkMachines, ...rest } = p;
      return { ...rest, inks: padInks3(p.inks) };
    });
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
  // machineAssignments: { ink, machine, code } 단일 형태로 정규화 (구버전 product/name 흡수)
  const nextAssignments = (raw.machineAssignments || []).map(a => ({
    ink: a.ink || a.product || a.name || '',
    machine: a.machine || '',
    code: a.code || '',
  })).filter(a => a.ink);
  return { ...raw, products: nextProducts, machineAssignments: nextAssignments };
}

// 일일 워크플로우 순서로 구성:
//   재고 조사 → INK 요청서 → 검수 → 사출계획 → 잉크 생산계획 → 층별 공급
const NAV = [
  { group: '일일 작업', items: [
    { id: 'inventory',  step: '1', label: '재고 조사',       icon: 'flask' },
    { id: 'ocr-import', step: '2', label: 'INK 요청서 입력', icon: 'upload' },
    { id: 'review',     step: '3', label: '미등록 제품 확인', icon: 'sparkle' },
    { id: 'injection',  step: '4', label: '사출계획',        icon: 'injection' },
    { id: 'ink-plan',   step: '5', label: '잉크 생산계획',   icon: 'ink' },
    { id: 'history',    label: '기록 조회', icon: 'history' },
  ]},
  { group: '현장 공급', items: [
    { id: 'ink-add',   label: '넣어줄 잉크', icon: 'add' },
    { id: 'chemicals', label: '약품요청서',   icon: 'beaker' },
    { id: 'test-inks', label: '양산대응',     icon: 'beaker' },
  ]},
  { group: '마스터', items: [
    { id: 'machines', label: '잉크 추가 및 관리', icon: 'beaker' },
    { id: 'products', label: '제품 추가 및 관리', icon: 'plus' },
  ]},
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "default",
  "density": "default",
  "accent": "blue",
  "stickySidebar": true,
  "showRowNum": true
}/*EDITMODE-END*/;

// 앱 리비전 — 배포 시 수동으로 올림 (헤더/푸터에서 단일 출처로 참조)
const APP_REV = 48;

const ACCENT_PRESETS = {
  blue:   ['oklch(0.28 0.08 245)', 'oklch(0.42 0.12 245)', 'oklch(0.55 0.15 245)', 'oklch(0.95 0.025 245)'],
  indigo: ['oklch(0.27 0.10 285)', 'oklch(0.42 0.14 285)', 'oklch(0.55 0.17 285)', 'oklch(0.95 0.030 285)'],
  teal:   ['oklch(0.27 0.07 200)', 'oklch(0.42 0.10 200)', 'oklch(0.55 0.12 200)', 'oklch(0.95 0.025 200)'],
  amber:  ['oklch(0.30 0.07 60)',  'oklch(0.50 0.12 65)',  'oklch(0.62 0.14 65)',  'oklch(0.95 0.04 70)'],
};

function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState('inventory');
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS);
  const [toast, setToast] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.1-flash-lite');
  const [ocrResult, setOcrResult] = useState(null); // { parsed, sourceImageUrl(data URL), sourceFileName, parsedAt, model } - 검수 페이지로 전달
  const [lastMergeInfo, setLastMergeInfo] = useState(null); // { days: ['수','목'], at: Date.now() } - 사출계획에서 자동 요일 확장 트리거
  const toastTimer = useRef(null);

  // 초기 로드: 파일 DB API 우선, 실패하면 localStorage/clean.json fallback
  useEffect(() => {
    const safeMigrate = (raw, source) => {
      try {
        return migrateData(raw);
      } catch (e) {
        console.error(`[${source}] migrateData 실패 — raw data로 fallback:`, e);
        return raw;
      }
    };

    const loadFallback = () => {
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
          setData({ products: [], inkPlan: [], inkAdd: [], injection: { '3층': [], '1층': [] }, testInks: [], machineAssignments: [] });
        });
    };
    fetch('/api/db', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`api ${r.status}`);
        return r.json();
      })
      .then(raw => {
        const migrated = safeMigrate(raw, 'file-db');
        setData(migrated);
        console.log('[init] file DB에서 로드');
      })
      .catch(e => {
        console.warn('[init] file DB 로드 실패, fallback 사용:', e);
        loadFallback();
      });
  }, []);

  // data가 바뀔 때마다 자동 저장 (debounce 가볍게)
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!data) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snapshot = data;
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          const r = await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
          });
          if (!r.ok) {
            let detail = '';
            try { detail = await r.text(); } catch (e) {}
            throw new Error(`file DB ${r.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
          }
        })
        .catch(e => {
          console.warn('file DB 저장 실패, localStorage fallback:', e);
          try { localStorage.setItem('inkPlanData', JSON.stringify(snapshot)); }
          catch (err) { console.warn('localStorage 저장 실패:', err); }
          notify('파일 저장 실패 - 브라우저 임시 저장소에 보관됨');
        });
    }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  useEffect(() => {
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`settings ${r.status}`);
        return r.json();
      })
      .then(settings => {
        setApiKey(settings.apiKey || '');
        setGeminiModel(settings.model || 'gemini-3.1-flash-lite');
        try {
          localStorage.removeItem('geminiApiKey');
          sessionStorage.removeItem('geminiApiKey');
          localStorage.removeItem('geminiModel');
        } catch (e) {}
      })
      .catch(e => console.warn('설정 로드 실패:', e));
  }, []);

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
  const saveSettings = (key, m) => {
    const nextKey = key.trim();
    const nextModel = m || 'gemini-3.1-flash-lite';
    setApiKey(nextKey);
    setGeminiModel(nextModel);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: nextKey, model: nextModel }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`settings ${r.status}`);
        return r.json();
      })
      .then(settings => {
        setApiKey(settings.apiKey || '');
        setGeminiModel(settings.model || nextModel);
      })
      .catch(e => {
        console.warn('설정 저장 실패:', e);
        notify('설정 저장 실패');
      });
  };
  const ctx = { data, setData, notify, tweaks, setTweaks, apiKey, saveSettings, geminiModel, ocrResult, setOcrResult, lastMergeInfo, setLastMergeInfo, setView, today: weekInfo.today, dates: weekInfo.dates };

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
          <div className="app__chip"><span className="dot" /><span>주차: {weekInfo.isoLabel}</span></div>
          <div className="app__chip">Rev. {APP_REV}</div>
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
                {item.step
                  ? <span className="sb-item__step">{item.step}</span>
                  : <span className="sb-item__icon"><Icon name={item.icon} /></span>}
                <span>{item.label}</span>
                {item.id === 'products' && <span className="sb-item__badge">{data.products?.length || 0}</span>}
                {item.id === 'test-inks' && <span className="sb-item__badge" style={{background:'oklch(0.95 0.05 30)',color:'oklch(0.50 0.16 30)'}}>{data.testInks?.length || 0}</span>}
              </div>
            ))}
          </React.Fragment>
        ))}
        <div className="sb-footer">
          <div>김선명 · 생산관리팀</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>{weekInfo.monthWeekLabel} · v{APP_REV}</div>
        </div>
      </aside>

      <main className="app__main">
        {view === 'ocr-import' && <OcrImportPage ctx={ctx} />}
        {view === 'review' && <ReviewPage ctx={ctx} />}
        {view === 'injection' && <InjectionPage ctx={ctx} />}
        {view === 'ink-plan' && <InkPlanPage ctx={ctx} />}
        {view === 'history' && <HistoryPage ctx={ctx} />}
        {view === 'ink-add' && <InkAddPage ctx={ctx} />}
        {view === 'chemicals' && <ChemicalsPage ctx={ctx} />}
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
          setData={setData}
          notify={notify}
          onSave={(key, m) => {
            saveSettings(key, m);
            notify(key ? '설정 저장됨' : 'API 키 삭제됨');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

// 한도(RPD) 큰 순서대로 정렬. 일상 운영은 3.1 Flash Lite(500 RPD)가 안전.
// 정확도가 더 필요한 어려운 표는 3.5 Flash / 3 Flash 시도 (RPD 20).
const GEMINI_MODELS = [
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', meta: 'RPM 15 · RPD 500 · 한도 최대 (일상 권장)' },
  { value: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash',      meta: 'RPM 5 · RPD 20 · 최신, 표 정확도 기대' },
  { value: 'gemini-3-flash',        label: 'Gemini 3 Flash',        meta: 'RPM 5 · RPD 20 · 신형' },
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      meta: 'RPM 5 · RPD 20 · 정확도 검증됨' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', meta: 'RPM 10 · RPD 20 · 빠름' },
];

function SettingsModal({ apiKey, model, setData, notify, onSave, onClose }) {
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
            disabled={!dirty}
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
          {' · '}처음 한 번 저장하면 이 PC에서 계속 기억됩니다.
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
        일상 운영은 <strong>3.1 Flash Lite (RPD 500)</strong> 권장. 같은 이미지에서 표가 잘 안 잡히면 신형 <strong>3.5 Flash</strong> / <strong>3 Flash</strong> 로 재시도(각 RPD 20).
      </div>

      <BackupControls setData={setData} notify={notify} />
    </Modal>
  );
}

function BackupControls({ setData, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/backups', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`backup ${r.status}`);
        return r.json();
      })
      .then(setItems)
      .catch(() => notify('백업 목록을 불러오지 못했습니다. start.vbs로 실행했는지 확인하세요.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const makeBackup = () => {
    fetch('/api/backup', { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error(`backup ${r.status}`);
        return r.json();
      })
      .then(j => { notify(`백업 생성: ${j.name}`); load(); })
      .catch(() => notify('백업 생성 실패'));
  };

  const restore = (name) => {
    if (!confirm(`${name} 백업으로 복원할까요? 현재 데이터는 복원 전 백업으로 먼저 보관됩니다.`)) return;
    fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`restore ${r.status}`);
        return fetch('/api/db', { cache: 'no-store' });
      })
      .then(r => r.json())
      .then(d => { setData(migrateData(d)); notify('백업 복원 완료'); load(); })
      .catch(() => notify('백업 복원 실패'));
  };

  return (
    <div className="field" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label className="field__label" style={{ margin: 0 }}>데이터 백업</label>
        <div className="spacer" />
        <button className="btn btn--sm" onClick={load} disabled={loading}>새로고침</button>
        <button className="btn btn--sm btn--primary" onClick={makeBackup}>지금 백업</button>
      </div>
      <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--ink-200)', borderRadius: 8 }}>
        {items.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-500)' }}>
            백업 파일이 없습니다.
          </div>
        )}
        {items.slice(0, 20).map(item => (
          <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--ink-100)', fontSize: 12 }}>
            <span style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace' }}>{item.name}</span>
            <button className="btn btn--sm" onClick={() => restore(item.name)}>복원</button>
          </div>
        ))}
      </div>
      <div className="field__hint">자동 백업은 매일 18:30에 생성됩니다. 최근 백업 90개를 보관합니다.</div>
    </div>
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
