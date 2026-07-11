// 사출계획 page - weekly machine schedule with drag-and-drop

function InjectionPage({ ctx }) {
  const { data, setData, notify, today, dates, lastMergeInfo } = ctx;
  const [floor, setFloor] = useState('all'); // 기본 전체(3층+1층) — 층 구분 배지로 표시
  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState('3days'); // 7days | 3days
  const [editing, setEditing] = useState(null); // {floor, mi, day, shift}
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [editingMaster, setEditingMaster] = useState(null); // {mode: 'add'|'edit', product}
  const [showAlertList, setShowAlertList] = useState(false);

  const days = WEEKDAYS_PLUS; // 요일 단일 출처(data-service.js)
  // 보이는 요일 (3일/7일)
  const visibleDays = useMemo(() => DataService.getVisibleWeekdays(days, today, dayFilter), [dayFilter, today]);
  const columns = useMemo(() => DataService.getInjectionColumns(visibleDays), [visibleDays]);

  // OCR 머지 직후 — 머지된 요일이 현재 시야 밖이면 dayFilter를 'all'로 자동 확장.
  // (오늘=금인데 OCR 요청일=수 같은 케이스에서 '입력 안 됨'으로 오해되지 않도록)
  const handledMergeRef = useRef(null);
  useEffect(() => {
    if (!lastMergeInfo || handledMergeRef.current === lastMergeInfo.at) return;
    handledMergeRef.current = lastMergeInfo.at;
    const visible = DataService.getVisibleWeekdays(days, today, dayFilter);
    const missing = (lastMergeInfo.days || []).filter(d => !visible.includes(d));
    if (missing.length > 0) {
      setDayFilter('all');
      notify(`OCR 머지 결과 ${missing.join('·')}요일을 보려면 전체 요일로 펼쳤어`);
    }
  }, [lastMergeInfo]);

  // Test ink detection: value is a test ink name OR ANY of the product's inks is a test ink OR product is targetProduct of a test ink
  const testSets = useMemo(() => {
    const testInkNames = new Set((data.testInks || []).map(t => t.name.toLowerCase()));
    const testProducts = new Set((data.testInks || []).map(t => (t.targetProduct || '').toLowerCase()).filter(Boolean));
    // 신구조: product.inks 배열 → 소문자 배열로 매핑
    const productInks = new Map(data.products.map(p => [
      p.name.toLowerCase(),
      (p.inks || []).filter(Boolean).map(ink => ink.toLowerCase()),
    ]));
    return { testInkNames, testProducts, productInks };
  }, [data.testInks, data.products]);

  // 셀은 레거시 문자열 또는 {name, id} 객체 — 표시·판정은 이름으로.
  const cellName = (v) => DataService.productCellName(v);

  const isTestValue = (v) => {
    const s = cellName(v);
    if (!s) return false;
    const lv = s.toLowerCase();
    if (lv === 'test' || lv.includes('test')) return true;
    if (testSets.testInkNames.has(lv)) return true;
    if (testSets.testProducts.has(lv)) return true;
    const productInks = testSets.productInks.get(lv);
    if (productInks && productInks.some(ink => testSets.testInkNames.has(ink))) return true;
    return false;
  };

  // 마스터 lookup (이름 → 제품) — DataService 단일 로직에 위임 (ink-plan과 동일)
  const productLookup = useMemo(() => DataService.buildProductLookup(data.products), [data.products]);
  // 셀(문자열/객체) → 제품: id 있으면 정확, 없으면 이름 해소
  const resolveProduct = (value) => DataService.resolveProductCell(productLookup, value);

  // 수동 편집 저장값을 셀로 — 동명 아닌 이름은 {name, id}로 캡처, 그 외엔 문자열 유지
  const toCellValue = (value) => {
    if (!value || typeof value !== 'string' || isTestValue(value)) return value;
    const matches = (data.products || []).filter(p => p.name === value);
    return (matches.length === 1 && matches[0].id) ? { name: value, id: matches[0].id } : value;
  };

  // 편집 저장 시 셀 정체성 결정 (동명 강등 방지):
  //  1) CascadePicker로 특정 제품을 골랐으면 그 id 캡처(동명이라도 정확)
  //  2) 이름이 원래 셀과 같고 원래 셀에 id가 있었으면 그 id 보존
  //  3) 그 외 — 동명 아닌 이름만 자동 캡처(toCellValue)
  const resolveCellIdentity = (name, opts = {}) => {
    if (!name || typeof name !== 'string' || isTestValue(name)) return name;
    if (opts.pickedId && (data.products || []).some(p => p.id === opts.pickedId && p.name === name)) {
      return { name, id: opts.pickedId };
    }
    const orig = opts.originalCell;
    if (orig && typeof orig === 'object' && orig.id && orig.name === name) return orig;
    return toCellValue(name);
  };

  // 셀 상태: 'ok' | 'new' | 'unregistered' | 'no-inks'
  const cellStatus = (value) => {
    if (!value || isTestValue(value)) return 'ok';
    const p = resolveProduct(value);
    if (!p) return 'unregistered';
    if (p.createdFromReview || p.createdFromInjection) return 'new';
    const inkCount = (p.inks || []).filter(Boolean).length;
    if (inkCount === 0) return 'no-inks';
    return 'ok';
  };

  // 브랜드·잉크 후보 (ProductEditor용)
  const brandsList = useMemo(() => DataService.buildBrandOptions(data.products), [data.products]);
  const allInksList = useMemo(() => {
    const s = new Set();
    for (const p of data.products) for (const ink of (p.inks || [])) if (ink) s.add(ink);
    return Array.from(s).sort();
  }, [data.products]);

  // 마스터 편집 저장
  const handleMasterSave = (product) => {
    const newData = { ...data };
    if (editingMaster.mode === 'add') {
      newData.products = [{ ...product, createdFromInjection: true }, ...data.products];
      notify(`마스터에 추가: '${product.name}'`);
    } else {
      // 정체성 id 우선 — 동명 제품도 정확히 그 행을 수정(이름 findIndex는 첫 동명에 오적용).
      const target = editingMaster.product || {};
      const idx = target.id
        ? data.products.findIndex(p => p.id === target.id)
        : data.products.findIndex(p => p.name === target.name);
      if (idx >= 0) {
        newData.products = [...data.products];
        newData.products[idx] = {
          ...data.products[idx],
          ...product,
        };
        notify(`마스터 수정: '${product.name}'`);
      }
    }
    setData(newData);
    setEditingMaster(null);
  };

  // floor='all'이면 두 층 합쳐서 표시. machine에 _floor 메타 추가.
  const machines = useMemo(() => {
    if (floor === 'all') {
      const f3 = (data.injection['3층'] || []).map(m => ({ ...m, _floor: '3층' }));
      const f1 = (data.injection['1층'] || []).map(m => ({ ...m, _floor: '1층' }));
      return [...f3, ...f1];
    }
    return (data.injection[floor] || []).map(m => ({ ...m, _floor: floor }));
  }, [data.injection, floor]);

  const filtered = useMemo(() => {
    if (!search) return machines;
    const q = search.toLowerCase();
    return machines.filter(m => {
      if (m.machine.toLowerCase().includes(q)) return true;
      for (const d of Object.values(m.schedule)) {
        if (cellName(d.day).toLowerCase().includes(q) || cellName(d.night).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [machines, search]);

  const setCell = (mi, day, shift, value, identityOpts) => {
    const machine = machines[mi];
    if (!machine) return;
    const fl = machine._floor;
    const cellValue = resolveCellIdentity(value, identityOpts);
    const newData = { ...data };
    const list = [...(newData.injection[fl] || [])];
    const realIdx = list.findIndex(x => x.machine === machine.machine);
    if (realIdx < 0) return;
    list[realIdx] = { ...list[realIdx], schedule: { ...list[realIdx].schedule, [day]: { ...list[realIdx].schedule[day], [shift]: cellValue } } };
    newData.injection = { ...newData.injection, [fl]: list };
    setData(newData);
  };

  const handleDrop = (target) => {
    if (!dragging) return;
    const srcMachine = machines[dragging.mi];
    const tgtMachine = machines[target.mi];
    if (!srcMachine || !tgtMachine) return;
    const value = srcMachine.schedule[dragging.day]?.[dragging.shift] || '';
    // setData 한 번에 두 셀 변경 (src 비우기 + tgt 채우기)
    const newData = { ...data, injection: { ...data.injection } };
    const updateCell = (machine, day, shift, val) => {
      const fl = machine._floor;
      if (!newData.injection[fl] || newData.injection[fl] === data.injection[fl]) {
        newData.injection[fl] = [...(data.injection[fl] || [])];
      }
      const list = newData.injection[fl];
      const idx = list.findIndex(x => x.machine === machine.machine);
      if (idx < 0) return;
      list[idx] = { ...list[idx], schedule: { ...list[idx].schedule, [day]: { ...list[idx].schedule[day], [shift]: val } } };
    };
    updateCell(srcMachine, dragging.day, dragging.shift, '');
    updateCell(tgtMachine, target.day, target.shift, value);
    setData(newData);
    notify(`${cellName(value)} → ${tgtMachine.machine} ${target.day} ${target.shift === 'day' ? '주간' : '야간'}`);
    setDragging(null);
    setDragOver(null);
  };

  // 마스터 알림 (이 층 + 모든 층 합산)
  const masterAlerts = useMemo(() => {
    const unregistered = new Map(); // name → [floor, machine, day, shift][]
    const noInks = new Map();       // name → { product(id-해소), occurs[] }
    for (const fl of Object.keys(data.injection || {})) {
      for (const m of data.injection[fl]) {
        for (const [d, sh] of Object.entries(m.schedule || {})) {
          for (const sk of DataService.SHIFTS) {
            const v = sh[sk];
            const name = cellName(v);
            if (!name || isTestValue(v)) continue;
            const p = resolveProduct(v);   // 원본 셀(id 포함)로 정밀 해소
            if (!p) {
              if (!unregistered.has(name)) unregistered.set(name, []);
              unregistered.get(name).push({ fl, machine: m.machine, d, sk });
            } else if (!(p.inks || []).filter(Boolean).length) {
              // 동명 제품 중 잉크가 빈 바로 그 제품을 편집하도록 product 보관
              // (이름만으로 재해소하면 잉크 있는 형제를 편집할 수 있음).
              if (!noInks.has(name)) noInks.set(name, { product: p, occurs: [] });
              noInks.get(name).occurs.push({ fl, machine: m.machine, d, sk });
            }
          }
        }
      }
    }
    return {
      unregistered,
      noInks,
      total: unregistered.size + noInks.size,
    };
  }, [data.injection, productLookup, testSets]);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">사출계획</div>
            <div className="page__meta">호기별 주간/야간 사출 일정 · 드래그로 호기 간 이동 가능</div>
          </div>
          <div className="page__actions">
            {masterAlerts.total > 0 && (
              <button
                className="btn btn--emphasis-warn"
                onClick={() => setShowAlertList(true)}
                title="마스터에 없는 제품 또는 잉크가 비어있는 제품"
              >
                ⚠ 마스터 점검 <span className="btn--count-badge">({masterAlerts.total})</span>
              </button>
            )}
            <Seg
              value={floor}
              onChange={setFloor}
              options={[
                { value: 'all', label: '전체' },
                { value: '3층', label: '3층' },
                { value: '1층', label: '1층' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="호기 또는 제품 검색" value={search} onChange={e => setSearch(e.target.value)} />
            <Seg
              value={dayFilter}
              onChange={setDayFilter}
              options={[
                { value: '3days', label: `3일 (${today}부터)` },
                { value: '7days', label: '7일 (월~일)' },
              ]}
            />
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
              {filtered.length}대 · {floor === 'all' ? '전체 층' : floor}
            </span>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 240px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="sticky-col injection-machine-head" rowSpan="2" style={{ width: 90 }}>호기</th>
                  {visibleDays.map(d => (
                    <th key={d} colSpan="2" className="injection-day-head">
                      <div>{d}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-500)', marginTop: 2 }}>{dates[d]}</div>
                    </th>
                  ))}
                </tr>
                <tr>
                  {columns.map(col => (
                    <th
                      key={`${col.day}-${col.shift}`}
                      className={`injection-shift-head injection-shift-head--${col.shift}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, mi) => {
                  const realMi = machines.indexOf(m);
                  return (
                    <tr key={m.machine}>
                      <td className={`sticky-col injection-machine-cell ${floor === 'all' ? `injection-machine-cell--${m._floor === '3층' ? 'f3' : 'f1'}` : ''}`}>
                        <div className="injection-machine-name">
                          {floor === 'all' && (
                            <span className={`injection-floor-badge injection-floor-badge--${m._floor === '3층' ? 'f3' : 'f1'}`}>
                              {m._floor === '3층' ? '3F' : '1F'}
                            </span>
                          )}
                          {m.machine}
                        </div>
                        {m.no != null && <span className="injection-machine-no">#{m.no}</span>}
                      </td>
                      {columns.map(col => {
                        // 원본 셀(문자열/{name,id})을 보존 — 상태·해소·편집이 id를 잃지 않도록.
                        const rawCell = m.schedule[col.day]?.[col.shift];
                        const value = cellName(rawCell);
                        const isTest = isTestValue(rawCell);
                        const isDragOver = dragOver && dragOver.mi === realMi && dragOver.day === col.day && dragOver.shift === col.shift;
                        const isDragging = dragging && dragging.mi === realMi && dragging.day === col.day && dragging.shift === col.shift;
                        const status = cellStatus(rawCell);
                        const statusTitle = status === 'unregistered'
                          ? '마스터 미등록 — 클릭해서 추가'
                          : status === 'no-inks'
                            ? '잉크 미등록 — 클릭해서 등록'
                            : status === 'new'
                              ? '미등록 확인에서 새로 추가된 제품'
                            : '';
                        const classes = [
                          'injection-cell',
                          `injection-cell--${col.shift}`,
                          !value && 'injection-cell--empty',
                          isTest && 'injection-cell--test',
                          isDragOver && 'injection-cell--drag-over',
                          isDragging && 'injection-cell--dragging',
                          status !== 'ok' && `injection-cell--${status}`,
                        ].filter(Boolean).join(' ');
                        return (
                          <td
                            key={`${col.day}-${col.shift}`}
                            className={classes}
                            draggable={!!value}
                            onDragStart={() => setDragging({ mi: realMi, day: col.day, shift: col.shift })}
                            onDragEnd={() => { setDragging(null); setDragOver(null); }}
                            onDragOver={(e) => { e.preventDefault(); setDragOver({ mi: realMi, day: col.day, shift: col.shift }); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={(e) => { e.preventDefault(); handleDrop({ mi: realMi, day: col.day, shift: col.shift }); }}
                            onClick={() => setEditing({ mi: realMi, day: col.day, shift: col.shift, value, cell: rawCell })}
                            title={value ? `${value}${isTest ? ' · 테스트' : ''}` : '클릭하여 배정'}
                          >
                            {isTest && value && <span className="injection-cell__test" title="테스트 잉크 — 양산대응 메뉴에서 관리">TEST</span>}
                            {status === 'unregistered' && (
                              <button
                                className="injection-cell__alert injection-cell__alert--bad"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingMaster({ mode: 'add', product: { name: value, brand: '', inks: [] } });
                                }}
                                title={statusTitle}
                              >신규</button>
                            )}
                            {status === 'new' && (
                              <span
                                className="injection-cell__alert injection-cell__alert--info"
                                title={statusTitle}
                              >신규</span>
                            )}
                              {status === 'no-inks' && (
                              <button
                                className="injection-cell__alert injection-cell__alert--warn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingMaster({ mode: 'edit', product: resolveProduct(rawCell) });
                                }}
                                title={statusTitle}
                              >잉크</button>
                            )}
                            <span className="injection-cell__text">{value || ''}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {editingMaster && (
          <ProductEditor
            product={editingMaster.product}
            mode={editingMaster.mode}
            onSave={handleMasterSave}
            onClose={() => setEditingMaster(null)}
            brands={brandsList}
            allInks={allInksList}
          />
        )}

        {showAlertList && (
          <Modal
            title={`마스터 점검 필요 (${masterAlerts.total})`}
            onClose={() => setShowAlertList(false)}
            footer={<button className="btn btn--primary" onClick={() => setShowAlertList(false)}>닫기</button>}
          >
            {masterAlerts.unregistered.size > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad-700)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  ⚠ 마스터에 없는 제품 ({masterAlerts.unregistered.size})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Array.from(masterAlerts.unregistered.entries()).map(([name, occurs]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bad-50)', borderRadius: 6, border: '1px solid var(--bad-200)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                          {occurs.length}곳 사용 — {occurs.slice(0, 3).map(o => `${o.machine} ${o.d}${o.sk === 'day' ? '주' : '야'}`).join(', ')}{occurs.length > 3 ? ' 외' : ''}
                        </div>
                      </div>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => {
                          setEditingMaster({ mode: 'add', product: { name, brand: '', inks: [] } });
                          setShowAlertList(false);
                        }}
                      >
                        <Icon name="plus" size={11} /> 마스터에 추가
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {masterAlerts.noInks.size > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--warn-700)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  ⚠ 잉크가 비어있는 제품 ({masterAlerts.noInks.size})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Array.from(masterAlerts.noInks.entries()).map(([name, entry]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--warn-50)', borderRadius: 6, border: '1px solid var(--warn-200)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                          {entry.occurs.length}곳 사용 — 브랜드: {entry.product?.brand || '미지정'}
                        </div>
                      </div>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => {
                          setEditingMaster({ mode: 'edit', product: entry.product });
                          setShowAlertList(false);
                        }}
                      >
                        <Icon name="edit" size={11} /> 잉크 등록
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {masterAlerts.total === 0 && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ok-700)' }}>
                ✓ 모든 제품이 마스터에 등록되어 있고 잉크도 채워져 있습니다.
              </div>
            )}
          </Modal>
        )}

        {editing && (
          <Modal
            title={`${machines[editing.mi].machine} · ${editing.day} ${editing.shift === 'day' ? '주간' : '야간'}`}
            onClose={() => setEditing(null)}
            footer={
              <>
                <button className="btn" onClick={() => setEditing(null)}>취소</button>
                {editing.value && (
                  <button className="btn btn--danger" onClick={() => {
                    setCell(editing.mi, editing.day, editing.shift, '');
                    setEditing(null);
                    notify('배정 해제됨');
                  }}><Icon name="trash" size={12} /> 배정 해제</button>
                )}
                <button className="btn btn--primary" onClick={() => {
                  setCell(editing.mi, editing.day, editing.shift, editing.value, {
                    pickedId: editing.pickedId,
                    originalCell: editing.cell,
                  });
                  setEditing(null);
                  notify('배정 저장됨');
                }} disabled={!editing.value}><Icon name="check" size={12} /> 저장</button>
              </>
            }
          >
            {editing.value && (
              <div style={{ marginBottom: 12, padding: 10, background: 'var(--brand-50)', borderRadius: 8, fontSize: 12, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="check" size={12} /> 현재 선택:
                <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{editing.value}</strong>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => setEditing({ ...editing, value: '', pickedId: null, cell: '' })}
                  style={{ marginLeft: 'auto' }}
                  title="선택 해제"
                >×</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
              <button
                className="btn btn--sm"
                onClick={() => setEditing({ ...editing, value: 'TEST' })}
                title="TEST로 배정 (제품 안 고르고 빠르게)"
                style={{ background: 'var(--warn-50)', borderColor: 'var(--warn-300)', color: 'var(--warn-700)' }}
              >
                <Icon name="flask" size={11} /> 테스트 배정
              </button>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>또는 ↓에서 브랜드·제품 선택</div>
            </div>

            <CascadePicker
              products={data.products}
              mode="product"
              currentValue={editing.value}
              initialBrand={editing.value ? (resolveProduct(editing.cell)?.brand || '') : ''}
              onSelect={(name, product) => setEditing({ ...editing, value: name, pickedId: product?.id || null })}
            />
          </Modal>
        )}
      </div>
    </div>
  );
}

window.InjectionPage = InjectionPage;
