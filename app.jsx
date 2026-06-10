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
    { id: 'dashboard',  label: '대시보드', icon: 'sparkle' },
    { id: 'inventory',  step: '1', label: '재고 조사',       icon: 'flask' },
    { id: 'ocr-import', step: '2', label: 'INK 요청서 입력', icon: 'upload' },
    { id: 'review',     step: '3', label: '미등록 제품 확인', icon: 'sparkle' },
    { id: 'injection',  step: '4', label: '사출계획',        icon: 'injection' },
    { id: 'ink-plan',   step: '5', label: '잉크 생산계획',   icon: 'ink' },
    { id: 'history',    label: '기록 조회', icon: 'history' },
  ]},
  { group: '현장 공급', items: [
    { id: 'ink-add',   label: '넣어줄 잉크', icon: 'add',    desc: '오늘·내일 공급 (자동 누적)' },
    { id: 'chemicals', label: '약품요청서',   icon: 'beaker', desc: '기간별 발주 집계 (코드)' },
    { id: 'test-inks', label: '양산대응',     icon: 'beaker' },
  ]},
  { group: '마스터', items: [
    { id: 'machines', label: '잉크 추가 및 관리', icon: 'beaker' },
    { id: 'products', label: '제품 추가 및 관리', icon: 'plus' },
    { id: 'data-quality', label: '데이터 점검', icon: 'sparkle' },
  ]},
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "default",
  "density": "default",
  "accent": "blue",
  "stickySidebar": true,
  "showRowNum": true,
  "requester": ""
}/*EDITMODE-END*/;

// 앱 리비전 — 배포 시 수동으로 올림 (헤더/푸터에서 단일 출처로 참조)
const APP_REV = 57;

const ACCENT_PRESETS = {
  blue:   ['oklch(0.28 0.08 245)', 'oklch(0.42 0.12 245)', 'oklch(0.55 0.15 245)', 'oklch(0.95 0.025 245)'],
  indigo: ['oklch(0.27 0.10 285)', 'oklch(0.42 0.14 285)', 'oklch(0.55 0.17 285)', 'oklch(0.95 0.030 285)'],
  teal:   ['oklch(0.27 0.07 200)', 'oklch(0.42 0.10 200)', 'oklch(0.55 0.12 200)', 'oklch(0.95 0.025 200)'],
  amber:  ['oklch(0.30 0.07 60)',  'oklch(0.50 0.12 65)',  'oklch(0.62 0.14 65)',  'oklch(0.95 0.04 70)'],
};

function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState('dashboard');
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS);
  const [toast, setToast] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.1-flash-lite');
  const [ocrResult, setOcrResult] = useState(null); // { parsed, sourceImageUrl(data URL), sourceFileName, parsedAt, model } - 검수 페이지로 전달
  const [lastMergeInfo, setLastMergeInfo] = useState(null); // { days: ['수','목'], at: Date.now() } - 사출계획에서 자동 요일 확장 트리거
  const toastTimer = useRef(null);
  const dbRevRef = useRef(null);      // 서버 DB 리비전(ETag) — 다중 탭 OCC 의 base
  const lastSyncedRef = useRef(null); // 마지막으로 서버와 일치한 data — 3-way 병합·skip 의 base
  const [conflictState, setConflictState] = useState(null); // {local,server,serverRev,conflictKeys}|null

  // 초기 로드: 파일 DB API 우선, 실패하면 localStorage → /api/seed fallback
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

      fetch('/api/seed', { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`fetch ${r.status}`);
          return r.json();
        })
        .then(raw => {
          const migrated = safeMigrate(raw, 'seed-api');
          setData(migrated);
          console.log('[init] 시드(/api/seed)에서 로드');
        })
        .catch(e => {
          console.error('[init] 시드 로드 실패:', e);
          setData({ products: [], inkPlan: [], inkAdd: [], injection: { '3층': [], '1층': [] }, testInks: [], machineAssignments: [] });
        });
    };
    fetch('/api/db', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`api ${r.status}`);
        // ETag = 서버 DB 리비전. 이후 저장 시 If-Match 로 되돌려 lost-update 를 막는다.
        dbRevRef.current = (r.headers.get('ETag') || '').replace(/"/g, '') || null;
        return r.json();
      })
      .then(raw => {
        const migrated = safeMigrate(raw, 'file-db');
        lastSyncedRef.current = migrated; // 서버 동기화 기준점 — 직후 무변경 저장은 skip
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
          // 마지막 동기화본과 동일하면 저장 불필요 — 로드/병합/덮어쓰기 직후 멱등 수렴.
          if (DataService.stableEqual(snapshot, lastSyncedRef.current)) return;

          // If-Match=base rev 송신. 200→새 rev 반환, 409→conflict 플래그로 throw, 기타→throw.
          const postDb = async (payload, baseRev) => {
            const r = await fetch('/api/db', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(baseRev ? { 'If-Match': `"${baseRev}"` } : {}),
              },
              body: JSON.stringify(payload),
            });
            if (r.status === 409) { const e = new Error('conflict'); e.conflict = true; throw e; }
            if (!r.ok) {
              let detail = '';
              try { detail = await r.text(); } catch (e) {}
              throw new Error(`file DB ${r.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
            }
            const body = await r.json().catch(() => ({}));
            return (body && body.rev) || (r.headers.get('ETag') || '').replace(/"/g, '') || null;
          };

          try {
            const rev = await postDb(snapshot, dbRevRef.current);
            dbRevRef.current = rev;
            lastSyncedRef.current = snapshot;
          } catch (err) {
            if (!err || !err.conflict) throw err; // 비충돌 오류 → 아래 fallback

            // 충돌: 최신본을 받아 base(마지막 동기화본) 대비 3-way 병합 판정.
            const fresh = await fetch('/api/db', { cache: 'no-store' });
            const serverRev = (fresh.headers.get('ETag') || '').replace(/"/g, '') || null;
            let server;
            try { server = migrateData(await fresh.json()); } catch (e) { server = {}; }
            const res = DataService.resolveConcurrentEdit(lastSyncedRef.current, snapshot, server);

            if (res.status === 'identical') {
              // 내 편집이 이미 서버와 동일 — rev 만 동기화.
              dbRevRef.current = serverRev;
              lastSyncedRef.current = server;
            } else if (res.status === 'merged') {
              // 서로 다른 섹션 편집 → 무손실 자동 병합 후 1회 재저장.
              try {
                const rev2 = await postDb(res.data, serverRev);
                dbRevRef.current = rev2;
                lastSyncedRef.current = res.data;
                setData(res.data);
                notify('다른 창의 변경과 자동 병합되었습니다');
              } catch (e2) {
                if (e2 && e2.conflict) {
                  // 재충돌(그 짧은 사이 또 저장) → 사용자 선택 모달로 강등.
                  try { localStorage.setItem('inkPlanData.conflict', JSON.stringify(snapshot)); } catch (e) {}
                  setConflictState({ local: snapshot, server, serverRev, conflictKeys: res.conflictKeys });
                } else { throw e2; }
              }
            } else {
              // 같은 섹션을 양쪽이 변경 → 진짜 충돌. 패자 후보 백업 + 사용자 선택.
              try { localStorage.setItem('inkPlanData.conflict', JSON.stringify(snapshot)); } catch (e) {}
              setConflictState({ local: snapshot, server, serverRev, conflictKeys: res.conflictKeys });
            }
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

  // 마스터 정합성 전역 경고 배지 — data-quality 페이지와 동일한 lintMasters 단일 출처에서 파생.
  // data===null이어도 lintMasters는 null-safe → show=false.
  const masterHealth = useMemo(() => {
    const lint = DataService.lintMasters(data, { normalize: normalizeProductName });
    return DataService.buildMasterHealthBadge(lint.summary);
  }, [data]);

  // 재고 부족 예상 전역 알림 — ink-plan 페이지와 동일한 computeInkMetrics().weeklyNeed 단일 출처에서 파생.
  const inkShortage = useMemo(() => {
    if (!data) return { shortageCount: 0, items: [], show: false, tooltip: '재고 정상' };
    return DataService.buildInkShortageBadge(data, weekInfo.dates);
  }, [data, weekInfo.dates]);

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

  // 충돌 모달 해소 — 두 선택 모두 패자 후보는 inkPlanData.conflict 에 백업되어 silent loss=0.
  const resolveConflictUseServer = () => {
    const c = conflictState; if (!c) return;
    dbRevRef.current = c.serverRev;
    lastSyncedRef.current = c.server; // 직후 저장 effect 는 stableEqual 로 skip
    setData(c.server);
    setConflictState(null);
    notify('서버 최신본을 적용했습니다 (이전 편집은 임시 보관됨)');
  };
  const resolveConflictUseLocal = async () => {
    const c = conflictState; if (!c) return;
    try { localStorage.setItem('inkPlanData.conflict', JSON.stringify(c.server)); } catch (e) {}
    try {
      const r = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(c.serverRev ? { 'If-Match': `"${c.serverRev}"` } : {}) },
        body: JSON.stringify(c.local),
      });
      if (!r.ok) throw new Error(`file DB ${r.status}`);
      const body = await r.json().catch(() => ({}));
      dbRevRef.current = (body && body.rev) || (r.headers.get('ETag') || '').replace(/"/g, '') || null;
      lastSyncedRef.current = c.local;
      setData(c.local);
      setConflictState(null);
      notify('내 변경으로 덮어썼습니다 (서버 쪽 변경은 임시 보관됨)');
    } catch (e) {
      setConflictState(null);
      notify('덮어쓰기 실패 — 잠시 후 다시 시도하세요');
    }
  };

  // 헤더 bell = 통합 알림 센터(마스터 결함 + 재고 부족). 심각도 우선: 마스터 error는 빨강·data-quality.
  const bellShow = masterHealth.show || inkShortage.show;
  const bellCount = (masterHealth.show ? masterHealth.errorCount : 0) + inkShortage.shortageCount;
  const bellTip = [masterHealth.show ? masterHealth.tooltip : null, inkShortage.show ? inkShortage.tooltip : null].filter(Boolean).join(' / ') || '처리 필요 알림 없음';
  const bellBad = masterHealth.show; // 마스터 error 있으면 빨강, 아니면 주황
  const bellTo = masterHealth.show ? 'data-quality' : 'ink-plan';
  const bellStyle = bellBad
    ? { background: 'var(--bad-100, oklch(0.95 0.05 25))', borderColor: 'var(--bad-600, oklch(0.55 0.18 25))', color: 'var(--bad-600, oklch(0.55 0.18 25))' }
    : { background: 'var(--warn-100, oklch(0.96 0.06 80))', borderColor: 'var(--warn-600, oklch(0.62 0.14 70))', color: 'var(--warn-600, oklch(0.62 0.14 70))' };

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
          <button
            className="app__chip"
            title={bellTip}
            onClick={() => bellShow && setView(bellTo)}
            style={bellShow ? bellStyle : null}
          >
            <Icon name="bell" size={12} />
            {bellShow && <span style={{ marginLeft: 4, fontWeight: 700 }}>{bellCount}</span>}
          </button>
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
                {item.desc
                  ? <span className="sb-item__text"><span>{item.label}</span><span className="sb-item__desc">{item.desc}</span></span>
                  : <span>{item.label}</span>}
                {item.id === 'products' && <span className="sb-item__badge">{data.products?.length || 0}</span>}
                {item.id === 'test-inks' && <span className="sb-item__badge" style={{background:'oklch(0.95 0.05 30)',color:'oklch(0.50 0.16 30)'}}>{data.testInks?.length || 0}</span>}
                {item.id === 'data-quality' && masterHealth.show && (
                  <span className="sb-item__badge sb-item__badge--alert" title={masterHealth.tooltip}>{masterHealth.errorCount}</span>
                )}
                {item.id === 'ink-plan' && inkShortage.show && (
                  <span className="sb-item__badge sb-item__badge--warn" title={inkShortage.tooltip}>{inkShortage.shortageCount}</span>
                )}
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
        {view === 'dashboard' && <DashboardPage ctx={ctx} />}
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
        {view === 'data-quality' && <DataQualityPage ctx={ctx} />}
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

      {conflictState && (
        <ConflictModal
          conflictKeys={conflictState.conflictKeys}
          onUseServer={resolveConflictUseServer}
          onUseLocal={resolveConflictUseLocal}
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
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',        meta: 'RPM 5 · RPD 20 · 신형(preview)' },
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      meta: 'RPM 5 · RPD 20 · 정확도 검증됨' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', meta: 'RPM 10 · RPD 20 · 빠름' },
];
// OCR 입력 페이지의 인라인 모델 선택에서도 사용 (설정 모달과 단일 출처)
window.GEMINI_MODELS = GEMINI_MODELS;

// 충돌 모달용 top-level 섹션 라벨 — 사용자에게 충돌 위치를 한국어로 보여준다.
const SECTION_LABELS = {
  products: '제품 마스터',
  inkPlan: '잉크 생산계획',
  inkAdd: '넣어줄 잉크',
  injection: '사출계획',
  testInks: '양산대응',
  machineAssignments: '호기 배정',
};

function ConflictModal({ conflictKeys, onUseServer, onUseLocal }) {
  const labels = (conflictKeys && conflictKeys.length)
    ? conflictKeys.map(k => SECTION_LABELS[k] || k)
    : ['여러 항목'];
  return (
    <Modal
      title="동시 편집 충돌"
      onClose={onUseServer}
      footer={
        <>
          <button className="btn" onClick={onUseServer}>
            <Icon name="history" size={12} /> 다시 불러오기(서버 적용)
          </button>
          <button className="btn btn--danger" onClick={onUseLocal}>
            <Icon name="check" size={12} /> 내 변경으로 덮어쓰기
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink-700)' }}>
        다른 창(또는 다른 PC)에서 같은 항목을 먼저 저장해 <strong>충돌</strong>이 발생했습니다.
        <div style={{ margin: '10px 0', padding: 10, background: 'var(--warn-50, #fff7ed)', borderRadius: 8 }}>
          충돌 항목: <strong>{labels.join(', ')}</strong>
        </div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--ink-600)' }}>
          <li><strong>다시 불러오기</strong> — 서버 최신본을 적용. 내 편집은 임시 보관(복구 가능).</li>
          <li><strong>내 변경으로 덮어쓰기</strong> — 내 편집을 저장. 서버 쪽 변경은 임시 보관.</li>
        </ul>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-500)' }}>
          어느 쪽이든 덮인 데이터는 브라우저 임시 저장소(<code>inkPlanData.conflict</code>)에 백업됩니다.
        </div>
      </div>
    </Modal>
  );
}

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
      <div className="field__hint">자동 백업은 매일 18:30에 생성됩니다. 수동·복원전·예약 백업은 최근 90개, 자동 시작 백업은 최근 20개를 보관합니다.</div>
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
      <TweakSection title="약품요청서">
        <TweakText label="발주 작성자" value={tweaks.requester || ''}
          placeholder="예: 김선명 (생산관리팀)"
          onChange={v => setTweak('requester', v)} />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
