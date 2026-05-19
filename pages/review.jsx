// 미등록 제품 확인 페이지
// OCR 결과 중 마스터에 없는 제품을 바로 등록한다.
// 최신 마스터 기준 운영이므로 유사 제품 매칭/rename 흐름은 쓰지 않는다.

function ReviewPage({ ctx }) {
  const { data, setData, notify, ocrResult, setOcrResult, setView } = ctx;

  // 모든 잉크 후보 (신규 모달 자동완성)
  const allInks = useMemo(() => {
    const s = new Set();
    for (const p of data.products) for (const ink of (p.inks || [])) if (ink) s.add(ink);
    return Array.from(s).sort();
  }, [data.products]);

  const factoryOptions = useMemo(() => {
    const s = new Set(['C관', 'S관']);
    for (const p of data.products) if (p.factory) s.add(p.factory);
    return Array.from(s).sort();
  }, [data.products]);

  const typeOptions = useMemo(() => {
    const s = new Set(['POWDER', 'LIQUID']);
    for (const p of data.products) if (p.type) s.add(p.type);
    return Array.from(s).sort();
  }, [data.products]);

  // 신구조에서는 1제품=1row라 dedup 불필요. 이름→제품 map만 만들면 끝.
  const masterIndex = useMemo(() => {
    const byName = new Map();
    for (const p of data.products) {
      if (p.name) byName.set(p.name, p);
    }
    return {
      uniqueNames: Array.from(byName.keys()),
      products: data.products,
      get: (name) => byName.get(name),
      getInks: (name) => byName.get(name)?.inks || [],
      getBrand: (name) => byName.get(name)?.brand || '',
    };
  }, [data.products]);

  // 행을 flatten해서 [{rowKey, shift, machine_no, floor, brand, variant, ocrName, status, matched, candidates, decision}]
  const rows = useMemo(() => {
    if (!ocrResult?.parsed) return [];
    const out = [];
    const findExactProduct = (productName, customer) => {
      const normName = normalizeProductName(productName);
      const normCustomer = normalizeBrand(customer);
      if (!normName || !normCustomer) return null;
      const matches = masterIndex.products.filter(p => normalizeProductName(p.name) === normName);
      return matches.find(p => normalizeBrand(p.customer || p.brand) === normCustomer) || null;
    };
    for (const sh of ocrResult.parsed.shifts || []) {
      for (let i = 0; i < (sh.rows || []).length; i++) {
        const r = sh.rows[i];
        const isTest = !r.product_name || /^TEST$/i.test(r.product_name.trim());
        const exactProduct = isTest ? null : findExactProduct(r.product_name, r.brand);
        const match = isTest
          ? { ocrName: r.product_name, matchedName: null, confidence: 0, status: 'skip', candidates: [] }
          : exactProduct
            ? { ocrName: r.product_name, matchedName: exactProduct.name, confidence: 1, status: 'exact', candidates: [] }
            : { ocrName: r.product_name, matchedName: null, confidence: 0, status: 'none', candidates: [] };
        out.push({
          rowKey: `${sh.shift}-${r.machine_no}-${i}`,
          shift: sh.shift,
          machine_no: r.machine_no,
          floor: r.floor,
          brand: r.brand,
          variant: r.variant,
          ocrName: r.product_name,
          isTest,
          ...match,
        });
      }
    }
    return out;
  }, [ocrResult, masterIndex]);

  const productGroups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = row.isTest
        ? `TEST:${row.rowKey}`
        : `${normalizeProductName(row.ocrName)}|${normalizeBrand(row.brand)}`;
      if (!map.has(key)) {
        map.set(key, {
          ...row,
          groupKey: key,
          rowKeys: [],
          occurs: [],
        });
      }
      const group = map.get(key);
      group.rowKeys.push(row.rowKey);
      group.occurs.push({ machine_no: row.machine_no, shift: row.shift, floor: row.floor });
      if (row.status === 'exact' && group.status !== 'exact') {
        group.status = row.status;
        group.matchedName = row.matchedName;
      }
    }
    return Array.from(map.values());
  }, [rows]);

  // 각 행의 사용자 결정: { rowKey: { action: 'match'|'new'|'skip'|'auto', target?: string } }
  // auto = 시스템이 자동 처리 (exact match는 자동 'match')
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter] = useState('pending'); // pending | all | done
  const [newProductDialog, setNewProductDialog] = useState(null); // { row } — 신규 등록 시 잉크 입력 모달
  const autoAppliedRef = useRef(false);

  // 초기화: exact는 auto match로 채움
  useEffect(() => {
    if (!rows.length) return;
    const init = {};
    for (const r of rows) {
      if (r.isTest) init[r.rowKey] = { action: 'skip', reason: 'TEST' };
      else if (r.status === 'exact') init[r.rowKey] = { action: 'auto', target: r.matchedName };
    }
    setDecisions(init);
  }, [rows]);

  const groupDecision = (group) => group.rowKeys.map(k => decisions[k]).find(Boolean);

  const stats = useMemo(() => {
    const total = productGroups.length;
    const auto = productGroups.filter(g => groupDecision(g)?.action === 'auto').length;
    const decided = productGroups.filter(g => groupDecision(g)).length;
    const pending = total - decided;
    return { total, auto, decided, pending };
  }, [productGroups, decisions]);

  const addMasterProduct = ({ factory, name, type, brand, inks }) => {
    const cleanInks = padInks3(inks);
    const newProduct = {
      factory: factory || '',
      name,
      type: type || '',
      brand: brand || '',
      customer: brand || '',
      inks: cleanInks,
      createdFromReview: true,
    };

    const nextData = { ...data, products: [newProduct, ...data.products] };
    const existingInks = new Set((data.inkPlan || []).map(i => String(i.name || '').trim().toLowerCase()));
    const newInkRows = cleanInks
      .filter(Boolean)
      .filter(ink => !existingInks.has(String(ink).trim().toLowerCase()))
      .map(ink => ({
        name: ink,
        days: Object.fromEntries(WEEKDAYS.map(d => [d, {
          '현재고': null,
          '가용일수': null,
          '필요수량': d === '월' ? null : undefined,
          '제조량': null,
        }])),
      }));

    if (newInkRows.length) {
      nextData.inkPlan = [...newInkRows, ...(data.inkPlan || [])];
    }
    setData(nextData);
  };

  const handleNew = (row) => {
    // 잉크 입력받기 위해 모달 띄움
    setNewProductDialog({ row });
  };

  const confirmNewProduct = ({ factory, name, type, brand, inks }) => {
    addMasterProduct({ factory, name, type, brand, inks });
    setDecisions(d => {
      const next = { ...d };
      for (const rowKey of newProductDialog.row.rowKeys || [newProductDialog.row.rowKey]) {
        next[rowKey] = { action: 'new', target: name };
      }
      return next;
    });
    notify(`마스터에 추가: '${name}'`);
    setNewProductDialog(null);
  };

  const handleSkip = (row) => {
    setDecisions(d => {
      const next = { ...d };
      for (const rowKey of row.rowKeys || [row.rowKey]) next[rowKey] = { action: 'skip' };
      return next;
    });
  };

  // OCR 결과를 사출계획 그리드(data.injection)에 머지
  // 같은 요일·시프트 셀에 기존 값이 있어도 덮어씀 (현장이 최신)
  const handleApplyToInjection = () => {
    const DAY_BY_IDX = ['일','월','화','수','목','금','토'];
    const dayFromDate = (iso) => {
      const d = parseDateLocal(iso);
      return d ? DAY_BY_IDX[d.getDay()] : null;
    };

    const requestDay = dayFromDate(ocrResult.parsed.request_date);
    const nextDay = dayFromDate(ocrResult.parsed.next_date);

    if (!requestDay) {
      notify('요청일에서 요일을 계산할 수 없어 (request_date 누락/형식 오류)');
      return;
    }

    // 깊은 복사 (injection 안의 schedule까지)
    const newData = { ...data };
    newData.injection = {};
    for (const floor of Object.keys(data.injection || {})) {
      newData.injection[floor] = data.injection[floor].map(m => ({
        ...m,
        schedule: Object.fromEntries(
          Object.entries(m.schedule || {}).map(([d, s]) => [d, { ...s }])
        ),
      }));
    }

    let mergedCount = 0;
    let skippedNoMachine = 0;
    let skippedNoMatch = 0;

    for (const sheet of ocrResult.parsed.shifts || []) {
      const targetDay = sheet.shift === '명일주간' ? nextDay : requestDay;
      const shiftKey = sheet.shift === '야간' ? 'night' : 'day';
      if (!targetDay) continue;

      for (let i = 0; i < (sheet.rows || []).length; i++) {
        const r = sheet.rows[i];
        const rowKey = `${sheet.shift}-${r.machine_no}-${i}`;
        const decision = decisions[rowKey];
        if (!decision) { skippedNoMatch++; continue; }
        if (decision.action === 'skip') continue;
        if (decision.reason === 'TEST') {
          // TEST 셀로 그대로 머지
        }

        const productName = decision.target || r.product_name;
        if (!productName) continue;

        // 해당 호기를 모든 층에서 찾기
        let found = false;
        for (const floor of Object.keys(newData.injection)) {
          const machine = newData.injection[floor].find(m => m.no === r.machine_no);
          if (!machine) continue;
          if (!machine.schedule[targetDay]) machine.schedule[targetDay] = { day: '', night: '' };
          machine.schedule[targetDay][shiftKey] = productName;
          mergedCount++;
          found = true;
          break;
        }
        if (!found) skippedNoMachine++;
      }
    }

    setData(newData);
    let msg = `사출계획에 ${mergedCount}건 반영`;
    if (skippedNoMachine) msg += ` · 호기 없음 ${skippedNoMachine}건`;
    if (skippedNoMatch) msg += ` · 미결정 ${skippedNoMatch}건`;
    notify(msg);

    // OCR 결과 비우고 사출계획 페이지로 이동
    setOcrResult(null);
    setView('injection');
  };

  const handleUndo = (row) => {
    setDecisions(d => {
      const n = { ...d };
      for (const rowKey of row.rowKeys || [row.rowKey]) delete n[rowKey];
      return n;
    });
  };

  useEffect(() => {
    if (!ocrResult || autoAppliedRef.current) return;
    if (stats.pending !== 0) return;
    autoAppliedRef.current = true;
    handleApplyToInjection();
  }, [ocrResult, stats.pending]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return productGroups;
    if (filter === 'done') return productGroups.filter(g => groupDecision(g));
    // pending: 결정 안 됐고 auto도 아닌 것
    return productGroups.filter(g => !groupDecision(g));
  }, [productGroups, decisions, filter]);

  // OCR 결과 없으면 안내
  if (!ocrResult) {
    return (
      <div className="page">
        <div className="page__head">
          <div className="page__title-row">
            <div>
              <div className="page__title">미등록 제품 확인</div>
              <div className="page__meta">OCR 제품명이 등록된 제품에 없을 때만 확인하고 추가합니다</div>
            </div>
          </div>
        </div>
        <div className="page__body">
          <Card>
            <div className="empty-state">
              <div className="empty-state__title">확인할 미등록 제품이 없습니다</div>
              <div className="empty-state__hint">INK 요청서 입력 후 등록된 제품과 모두 일치하면 자동으로 사출계획으로 이동합니다.</div>
              <div className="empty-state__actions">
                <button className="btn btn--primary" onClick={() => setView('ocr-import')}>
                  <Icon name="arrow" size={12} /> INK 요청서 입력으로 이동
                </button>
                <button className="btn" onClick={() => setView('injection')}>
                  <Icon name="arrow" size={12} /> 사출계획으로 이동
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">미등록 제품 확인</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip page__meta-chip--today">{ocrResult.parsed.request_date}</span>
              <span className="page__meta-chip">{ocrResult.sourceFileName}</span>
              <span className="page__meta-chip">{ocrResult.model}</span>
            </div>
          </div>
          <div className="page__actions">
            <button className="btn" onClick={() => setOcrResult(null)}>
              <Icon name="trash" size={12} /> OCR 결과 비우기
            </button>
            <button
              className="btn btn--primary"
              disabled={stats.pending > 0}
              onClick={handleApplyToInjection}
              title={stats.pending > 0 ? `${stats.pending}건 결정 필요` : '사출계획 그리드에 반영'}
            >
              <Icon name="check" size={12} /> 사출계획 반영
            </button>
          </div>
        </div>
        {/* 진행률 바 */}
        <div className="review-progress">
          <div className="review-progress__bar">
            <div
              className="review-progress__fill"
              style={{ width: `${stats.total ? Math.round(stats.decided / stats.total * 100) : 0}%` }}
            />
          </div>
          <div className="review-progress__stats">
            <span className="review-progress__stat"><strong>{stats.decided}</strong> / {stats.total} 결정</span>
            <span className="review-progress__stat review-progress__stat--auto">자동 {stats.auto}</span>
            {stats.pending > 0
              ? <span className="review-progress__stat review-progress__stat--pending">대기 {stats.pending}</span>
              : <span className="review-progress__stat review-progress__stat--done">✓ 미등록 없음</span>}
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar">
            <Seg value={filter} onChange={setFilter} options={[
              { value: 'pending', label: `대기 ${stats.pending}` },
              { value: 'all', label: `전체 ${stats.total}` },
              { value: 'done', label: `완료 ${stats.decided}` },
            ]} />
            <div className="spacer" />
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
              {filteredRows.length}건 표시
            </div>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>사용 위치</th>
                  <th style={{ width: 90 }}>브랜드</th>
                  <th>OCR 제품명</th>
                  <th style={{ width: 110 }}>상태</th>
                  <th>등록 내용</th>
                  <th style={{ width: 80, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <ReviewRow
                    key={row.groupKey || row.rowKey}
                    row={row}
                    decision={groupDecision(row)}
                    onNew={() => handleNew(row)}
                    onUndo={() => handleUndo(row)}
                  />
                ))}
                {filteredRows.length === 0 && (
                  <tr><td colSpan="7">
                    <div className="empty-state">
                      <div className="empty-state__title">
                        {filter === 'pending' ? '✓ 확인할 미등록 제품이 없습니다' : '표시할 행이 없습니다'}
                      </div>
                      {filter === 'pending' && (
                        <div className="empty-state__hint">우측 상단 [사출계획 반영] 버튼으로 진행하세요.</div>
                      )}
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {newProductDialog && (
        <NewProductDialog
          row={newProductDialog.row}
          allInks={allInks}
          factoryOptions={factoryOptions}
          typeOptions={typeOptions}
          onConfirm={confirmNewProduct}
          onCancel={() => setNewProductDialog(null)}
        />
      )}

    </div>
  );
}

function ReviewRow({ row, decision, onNew, onUndo }) {
  const renderStatus = () => {
    if (row.isTest) return <Pill tone="default">TEST</Pill>;
    if (decision?.action === 'auto') return <Pill tone="ok">자동 일치</Pill>;
    if (decision?.action === 'new') return <Pill tone="info">✓ 신규 등록</Pill>;
    if (decision?.action === 'skip') return <Pill tone="default">건너뜀</Pill>;
    if (row.status !== 'exact') return <Pill tone="bad">등록 필요</Pill>;
    return <Pill tone="default">{row.status}</Pill>;
  };

  const done = !!decision && decision.action !== 'auto';
  const autoDone = decision?.action === 'auto';

  return (
    <tr style={done || autoDone ? { background: 'var(--ok-50, #ecfdf5)', opacity: autoDone ? 0.7 : 1 } : null}>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(row.occurs || [{ machine_no: row.machine_no, shift: row.shift }]).slice(0, 4).map((o, i) => (
            <Pill key={`${o.machine_no}-${o.shift}-${i}`} tone={o.shift === '주간' ? 'info' : o.shift === '야간' ? 'default' : 'warn'}>
              {o.machine_no} {o.shift}
            </Pill>
          ))}
          {(row.occurs || []).length > 4 && (
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>+{row.occurs.length - 4}</span>
          )}
        </div>
      </td>
      <td style={{ fontSize: 11 }}>{row.brand}{row.variant ? ` / ${row.variant}` : ''}</td>
      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{row.ocrName}</td>
      <td>{renderStatus()}</td>
      <td>
        {row.isTest && <span style={{ color: 'var(--ink-500)', fontSize: 11 }}>TEST 행 — 등록 불필요</span>}
        {!row.isTest && decision && decision.action !== 'auto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
              등록됨 → {decision.target || row.ocrName}
            </span>
          </div>
        )}
        {!row.isTest && decision?.action === 'auto' && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
            → {decision.target}
          </span>
        )}
        {!row.isTest && !decision && (
          <span style={{ color: 'var(--bad-600)', fontSize: 12, fontWeight: 600 }}>
            마스터에 없는 제품입니다. 제품 정보를 등록하세요.
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {!row.isTest && !decision && (
          <button className="btn btn--sm btn--primary" onClick={onNew} title="제품 및 잉크 등록">
            제품 등록
          </button>
        )}
        {decision && decision.action !== 'auto' && (
          <button className="btn btn--sm btn--ghost" onClick={onUndo} title="결정 취소">
            <Icon name="refresh" size={11} />
          </button>
        )}
      </td>
    </tr>
  );
}

// 신규 제품 등록 모달: OCR row 정보(이름·브랜드)를 자동 채우고 1·2·3도 잉크 입력
function NewProductDialog({ row, allInks, factoryOptions, typeOptions, onConfirm, onCancel }) {
  const [factory, setFactory] = useState('');
  const [name, setName] = useState(row.ocrName || '');
  const [type, setType] = useState('');
  const [brand, setBrand] = useState(row.brand || '');
  const [inks, setInks] = useState([null, null, null]);
  const filledCount = inks.filter(Boolean).length;

  const setInk = (idx, v) => {
    const next = [...inks];
    next[idx] = v;
    setInks(next);
  };

  return (
    <Modal
      title="마스터에 신규 제품 등록"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>취소</button>
          <button
            className="btn btn--primary"
            disabled={!factory.trim() || !name.trim() || !type.trim() || !brand.trim() || filledCount === 0}
            onClick={() => onConfirm({ factory: factory.trim(), name: name.trim(), type: type.trim(), brand: brand.trim(), inks })}
          >
            <Icon name="check" size={12} /> 등록
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 12, padding: 10, background: 'var(--brand-50)', borderRadius: 8, fontSize: 11, color: 'var(--ink-700)' }}>
        <Icon name="sparkle" size={11} /> OCR에서 추출한 정보를 기본값으로 채웠어. 1도 잉크는 최소 입력.
      </div>

      <div className="row-2">
        <div className="field">
          <label className="field__label">공장<span className="req">*</span></label>
          <select className="input select" value={factory} onChange={e => setFactory(e.target.value)} style={{ width: '100%' }}>
            <option value="">공장 선택</option>
            {factoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">제품명<span className="req">*</span></label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ width: '100%' }} />
        </div>
      </div>
      <div className="row-2">
        <div className="field">
          <label className="field__label">TYPE<span className="req">*</span></label>
          <select className="input select" value={type} onChange={e => setType(e.target.value)} style={{ width: '100%' }}>
            <option value="">TYPE 선택</option>
            {typeOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">고객사<span className="req">*</span></label>
          <input className="input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="고객사" style={{ width: '100%' }} />
          <div className="field__hint">OCR 원본: <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{row.brand}{row.variant ? ` / ${row.variant}` : ''}</span></div>
        </div>
      </div>

      <div className="field">
        <label className="field__label">잉크 (1도 / 2도 / 3도) — 최소 1도<span className="req">*</span></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i}>
              <div style={{ fontSize: 10, color: 'var(--ink-500)', marginBottom: 4, fontWeight: 600 }}>{i + 1}도</div>
              <InkSlotInput
                value={inks[i]}
                suggestions={allInks}
                onChange={(v) => setInk(i, v)}
                placeholder={`${i + 1}도 잉크명`}
              />
            </div>
          ))}
        </div>
        <div className="field__hint">자동완성은 기존 잉크 목록. 새 잉크는 직접 입력 가능.</div>
      </div>
    </Modal>
  );
}

window.ReviewPage = ReviewPage;
