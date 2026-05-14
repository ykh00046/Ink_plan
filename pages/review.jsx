// 제품명 검수 페이지
// OCR 결과 각 행을 마스터와 매칭. 안 맞으면:
//   [기존 X와 동일=마스터 rename] / [신규 등록=마스터 add] / [건너뛰기]
// 매칭 정책: 마스터를 현장 표기로 정정 (alias 안 만듦).

function ReviewPage({ ctx }) {
  const { data, setData, notify, ocrResult, setOcrResult, setView } = ctx;

  // 모든 잉크 후보 (신규 모달 자동완성)
  const allInks = useMemo(() => {
    const s = new Set();
    for (const p of data.products) for (const ink of (p.inks || [])) if (ink) s.add(ink);
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
    for (const sh of ocrResult.parsed.shifts || []) {
      for (let i = 0; i < (sh.rows || []).length; i++) {
        const r = sh.rows[i];
        const isTest = !r.product_name || /^TEST$/i.test(r.product_name.trim());
        const match = isTest
          ? { ocrName: r.product_name, matchedName: null, confidence: 0, status: 'skip', candidates: [] }
          : matchProduct(r.product_name, r.brand, masterIndex.products);
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

  // 각 행의 사용자 결정: { rowKey: { action: 'match'|'new'|'skip'|'auto', target?: string } }
  // auto = 시스템이 자동 처리 (exact match는 자동 'match')
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter] = useState('pending'); // pending | all | done
  const [confirmRename, setConfirmRename] = useState(null); // { oldName, newName, rowKey, affectedCells }
  const [newProductDialog, setNewProductDialog] = useState(null); // { row } — 신규 등록 시 잉크 입력 모달

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

  const stats = useMemo(() => {
    const total = rows.length;
    const auto = rows.filter(r => decisions[r.rowKey]?.action === 'auto').length;
    const decided = rows.filter(r => decisions[r.rowKey]).length;
    const pending = total - decided;
    return { total, auto, decided, pending };
  }, [rows, decisions]);

  // 사출계획 그리드에서 해당 OCR 제품을 참조하는 셀 수 계산 (rename 영향 범위 표시용)
  const countAffectedCells = (productName) => {
    if (!productName || !data.injection) return 0;
    let n = 0;
    for (const floor of Object.keys(data.injection)) {
      for (const m of data.injection[floor]) {
        for (const d of Object.values(m.schedule)) {
          if (d.day === productName) n++;
          if (d.night === productName) n++;
        }
      }
    }
    return n;
  };

  // 마스터 rename: 1제품=1row 구조에서 단일 row 갱신. 사출계획 셀도 따라감.
  const renameMasterProduct = (oldName, newName) => {
    const newData = { ...data };
    newData.products = data.products.map(p =>
      p.name === oldName ? { ...p, name: newName } : p
    );
    newData.injection = {};
    for (const floor of Object.keys(data.injection)) {
      newData.injection[floor] = data.injection[floor].map(m => {
        const newSchedule = {};
        for (const [d, shifts] of Object.entries(m.schedule)) {
          newSchedule[d] = {
            day: shifts.day === oldName ? newName : shifts.day,
            night: shifts.night === oldName ? newName : shifts.night,
          };
        }
        return { ...m, schedule: newSchedule };
      });
    }
    setData(newData);
  };

  const addMasterProduct = ({ name, brand, inks }) => {
    const newProduct = {
      name,
      brand: brand || '',
      inks: padInks3(inks),
    };
    setData({ ...data, products: [newProduct, ...data.products] });
  };

  const handleMatch = (row, targetName) => {
    if (targetName === row.ocrName) {
      // 이름이 동일 = 이미 일치
      setDecisions(d => ({ ...d, [row.rowKey]: { action: 'match', target: targetName } }));
      return;
    }
    // 마스터 정정 (rename)
    const affected = countAffectedCells(targetName);
    setConfirmRename({ oldName: targetName, newName: row.ocrName, rowKey: row.rowKey, affectedCells: affected, brand: row.brand });
  };

  const confirmRenameAction = () => {
    const { oldName, newName, rowKey } = confirmRename;
    renameMasterProduct(oldName, newName);
    setDecisions(d => ({ ...d, [rowKey]: { action: 'match', target: newName, renamed: oldName } }));
    notify(`마스터: '${oldName}' → '${newName}'`);
    setConfirmRename(null);
  };

  const handleNew = (row) => {
    // 잉크 입력받기 위해 모달 띄움
    setNewProductDialog({ row });
  };

  const confirmNewProduct = ({ name, brand, inks }) => {
    addMasterProduct({ name, brand, inks });
    setDecisions(d => ({ ...d, [newProductDialog.row.rowKey]: { action: 'new', target: name } }));
    notify(`마스터에 추가: '${name}' (잉크 ${inks.length}개)`);
    setNewProductDialog(null);
  };

  const handleSkip = (row) => {
    setDecisions(d => ({ ...d, [row.rowKey]: { action: 'skip' } }));
  };

  // OCR 결과를 사출계획 그리드(data.injection)에 머지
  // 같은 요일·시프트 셀에 기존 값이 있어도 덮어씀 (현장이 최신)
  const handleApplyToInjection = () => {
    const DAY_BY_IDX = ['일','월','화','수','목','금','토'];
    const dayFromDate = (iso) => {
      if (!iso) return null;
      const d = new Date(iso);
      return isNaN(d) ? null : DAY_BY_IDX[d.getDay()];
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
      delete n[row.rowKey];
      return n;
    });
  };

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'done') return rows.filter(r => decisions[r.rowKey]);
    // pending: 결정 안 됐고 auto도 아닌 것
    return rows.filter(r => !decisions[r.rowKey] || (decisions[r.rowKey].action === 'auto' && r.status !== 'exact'));
  }, [rows, decisions, filter]);

  // 검수 결과 없으면 안내
  if (!ocrResult) {
    return (
      <div className="page">
        <div className="page__head">
          <div className="page__title-row">
            <div>
              <div className="page__title">제품명 검수</div>
              <div className="page__meta">OCR 결과의 제품명을 마스터와 매칭 · 안 맞으면 마스터를 현장 표기로 정정</div>
            </div>
          </div>
        </div>
        <div className="page__body">
          <Card>
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-500)' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>아직 OCR 결과가 없습니다.</div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>먼저 [INK 요청서 입력]에서 이미지를 파싱하세요.</div>
              <button className="btn btn--primary" onClick={() => setView('ocr-import')}>
                <Icon name="arrow" size={12} /> INK 요청서 입력으로 이동
              </button>
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
            <div className="page__title">제품명 검수</div>
            <div className="page__meta">
              {ocrResult.parsed.request_date} · {ocrResult.sourceFileName} · {ocrResult.model}
            </div>
          </div>
          <div className="page__actions">
            <Pill tone="ok">{stats.auto}건 자동</Pill>
            <Pill tone={stats.pending ? 'warn' : 'ok'}>{stats.pending}건 대기</Pill>
            <button className="btn" onClick={() => setOcrResult(null)}>
              <Icon name="trash" size={12} /> OCR 결과 비우기
            </button>
            <button
              className="btn btn--primary"
              disabled={stats.pending > 0}
              onClick={handleApplyToInjection}
              title={stats.pending > 0 ? `${stats.pending}건 결정 필요` : '검수 결과를 사출계획 그리드에 덮어쓰기'}
            >
              <Icon name="check" size={12} /> 사출계획 반영
            </button>
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
                  <th style={{ width: 60 }}>호기</th>
                  <th style={{ width: 80 }}>시프트</th>
                  <th style={{ width: 90 }}>브랜드</th>
                  <th>OCR 제품명</th>
                  <th style={{ width: 110 }}>상태</th>
                  <th>매칭 / 결정</th>
                  <th style={{ width: 80, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <ReviewRow
                    key={row.rowKey}
                    row={row}
                    decision={decisions[row.rowKey]}
                    products={data.products}
                    masterIndex={masterIndex}
                    onMatch={(target) => handleMatch(row, target)}
                    onNew={() => handleNew(row)}
                    onSkip={() => handleSkip(row)}
                    onUndo={() => handleUndo(row)}
                  />
                ))}
                {filteredRows.length === 0 && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-500)' }}>
                    {filter === 'pending' ? '✓ 모든 행 결정 완료' : '표시할 행이 없습니다'}
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
          onConfirm={confirmNewProduct}
          onCancel={() => setNewProductDialog(null)}
        />
      )}

      {confirmRename && (
        <Modal
          title="마스터 제품명 변경"
          onClose={() => setConfirmRename(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRename(null)}>취소</button>
              <button className="btn btn--primary" onClick={confirmRenameAction}>
                <Icon name="check" size={12} /> 변경 적용
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            마스터의 제품명을 현장 표기에 맞춰 변경합니다.
            <div style={{ marginTop: 12, padding: 12, background: 'var(--ink-50)', borderRadius: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
              <div style={{ color: 'var(--bad-700)' }}>
                <span style={{ color: 'var(--ink-500)' }}>− </span>{confirmRename.oldName}
              </div>
              <div style={{ color: 'var(--ok-700)', marginTop: 4 }}>
                <span style={{ color: 'var(--ink-500)' }}>+ </span>{confirmRename.newName}
              </div>
            </div>
            {confirmRename.affectedCells > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--warn-50)', border: '1px solid var(--warn-300)', borderRadius: 8, fontSize: 12, color: 'var(--warn-700)' }}>
                ⚠ 이 제품을 참조하는 <strong>사출계획 셀 {confirmRename.affectedCells}개</strong>도 함께 변경됩니다.
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReviewRow({ row, decision, products, masterIndex, onMatch, onNew, onSkip, onUndo }) {
  const [selectedTarget, setSelectedTarget] = useState(row.matchedName || '');

  const renderStatus = () => {
    if (row.isTest) return <Pill tone="default">TEST</Pill>;
    if (decision?.action === 'auto') return <Pill tone="ok">자동 일치</Pill>;
    if (decision?.action === 'match') return <Pill tone="ok">✓ 매칭됨{decision.renamed ? ' (마스터 정정)' : ''}</Pill>;
    if (decision?.action === 'new') return <Pill tone="info">✓ 신규 등록</Pill>;
    if (decision?.action === 'skip') return <Pill tone="default">건너뜀</Pill>;
    if (row.status === 'fuzzy') return <Pill tone="warn">유사 {Math.round(row.confidence * 100)}%</Pill>;
    if (row.status === 'none') return <Pill tone="bad">매칭 없음</Pill>;
    return <Pill tone="default">{row.status}</Pill>;
  };

  const done = !!decision && decision.action !== 'auto';
  const autoDone = decision?.action === 'auto';

  return (
    <tr style={done || autoDone ? { background: 'var(--ok-50, #ecfdf5)', opacity: autoDone ? 0.7 : 1 } : null}>
      <td style={{ fontWeight: 600 }}>{row.machine_no}</td>
      <td>
        <Pill tone={row.shift === '주간' ? 'info' : row.shift === '야간' ? 'default' : 'warn'}>{row.shift}</Pill>
      </td>
      <td style={{ fontSize: 11 }}>{row.brand}{row.variant ? ` / ${row.variant}` : ''}</td>
      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{row.ocrName}</td>
      <td>{renderStatus()}</td>
      <td>
        {row.isTest && <span style={{ color: 'var(--ink-500)', fontSize: 11 }}>TEST 행 — 매칭 불필요</span>}
        {!row.isTest && decision && decision.action !== 'auto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
              → {decision.target || '건너뜀'}
            </span>
            {decision.renamed && (
              <span style={{ fontSize: 10, color: 'var(--ink-500)' }}>(was: {decision.renamed})</span>
            )}
          </div>
        )}
        {!row.isTest && decision?.action === 'auto' && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-700)' }}>
            → {decision.target}
          </span>
        )}
        {!row.isTest && !decision && (
          <CandidatePicker
            row={row}
            products={products}
            masterIndex={masterIndex}
            selected={selectedTarget}
            onSelect={setSelectedTarget}
          />
        )}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {!row.isTest && !decision && (
          <>
            <button
              className="btn btn--sm btn--primary"
              disabled={!selectedTarget}
              onClick={() => onMatch(selectedTarget)}
              title="선택한 마스터 제품명을 OCR 이름으로 변경"
            >
              매칭
            </button>{' '}
            <button className="btn btn--sm" onClick={onNew} title="OCR 이름 그대로 마스터에 신규 추가">
              신규
            </button>{' '}
            <button className="btn btn--sm btn--ghost" onClick={onSkip}>스킵</button>
          </>
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

function CandidatePicker({ row, products, masterIndex, selected, onSelect }) {
  const [showCascade, setShowCascade] = useState(false);
  const candidates = row.candidates || [];
  const candidateNames = new Set(candidates.map(c => c.name));

  // OCR 브랜드 정규화 (검색 결과 브랜드 일치 강조용)
  const normOcrBrand = normalizeBrand(row.brand);

  const renderChip = (name, score, brandMatch) => {
    const inks = masterIndex.getInks(name);
    const brandText = masterIndex.getBrand(name);
    const inkText = inks.length ? inks.join('·') : '';
    const isSelected = selected === name;
    return (
      <button
        key={name}
        className={`btn btn--sm ${isSelected ? 'btn--primary' : ''}`}
        onClick={() => onSelect(name)}
        style={{
          fontSize: 11, lineHeight: 1.3, padding: '4px 8px', textAlign: 'left',
          borderColor: brandMatch && !isSelected ? 'var(--ok-500)' : undefined,
          background: brandMatch && !isSelected ? 'var(--ok-50, #ecfdf5)' : undefined,
        }}
        title={`${brandText ? brandText + ' · ' : ''}잉크 ${inks.length}개: ${inkText}${score != null ? ` · 유사도 ${Math.round(score * 100)}%` : ''}${brandMatch ? ' · OCR 브랜드 일치' : ''}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {brandMatch && <span style={{ color: 'var(--ok-600)', fontSize: 11, fontWeight: 600 }}>●</span>}
          <span style={{ fontWeight: 500 }}>{name}</span>
          {score != null && (
            <span style={{ opacity: 0.55, fontSize: 10 }}>{Math.round(score * 100)}%</span>
          )}
        </div>
        {(inkText || brandText) && (
          <div style={{ fontSize: 10, opacity: isSelected ? 0.85 : 0.6, marginTop: 1 }}>
            {brandText && (
              <span style={{ marginRight: 6, color: brandMatch && !isSelected ? 'var(--ok-700)' : undefined, fontWeight: brandMatch ? 600 : 400 }}>
                {brandText}
              </span>
            )}
            {inkText && <span>잉크: {inkText}</span>}
          </div>
        )}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {candidates.map(c => renderChip(c.name, c.score, c.brandMatch))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn--sm"
          onClick={() => setShowCascade(true)}
          title="브랜드부터 단계적으로 좁히며 다른 제품 고르기"
        >
          <Icon name="search" size={11} /> 다른 제품 찾기
        </button>
        {selected && !candidateNames.has(selected) && (
          <Pill tone="info">{selected}</Pill>
        )}
      </div>

      {showCascade && (
        <Modal
          title={`다른 제품 찾기 — OCR: ${row.ocrName}`}
          onClose={() => setShowCascade(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowCascade(false)}>닫기</button>
              {selected && (
                <button className="btn btn--primary" onClick={() => setShowCascade(false)}>
                  <Icon name="check" size={12} /> 이 제품으로 (선택은 행에서 매칭 버튼)
                </button>
              )}
            </>
          }
        >
          {row.brand && (
            <div style={{ marginBottom: 10, padding: 8, background: 'var(--brand-50)', borderRadius: 6, fontSize: 11, color: 'var(--ink-700)' }}>
              <Icon name="sparkle" size={11} /> OCR 브랜드: <strong>{row.brand}</strong>
              {row.variant && <span> · {row.variant}</span>}
              {' — 같은 브랜드 항목이 자연스럽게 먼저 보일거야'}
            </div>
          )}
          <CascadePicker
            products={products}
            mode="product"
            currentValue={selected}
            initialBrand={row.brand}
            onSelect={(name) => { onSelect(name); setShowCascade(false); }}
          />
        </Modal>
      )}
    </div>
  );
}

// 신규 제품 등록 모달: OCR row 정보(이름·브랜드)를 자동 채우고 1·2·3도 잉크 입력
function NewProductDialog({ row, allInks, onConfirm, onCancel }) {
  const [name, setName] = useState(row.ocrName || '');
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
            disabled={!name.trim() || filledCount === 0}
            onClick={() => onConfirm({ name: name.trim(), brand: brand.trim(), inks })}
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
          <label className="field__label">제품명<span className="req">*</span></label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label className="field__label">브랜드</label>
          <input className="input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="브랜드" style={{ width: '100%' }} />
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
