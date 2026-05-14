// 사출계획 page - weekly machine schedule with drag-and-drop

function InjectionPage({ ctx }) {
  const { data, setData, notify, dates } = ctx;
  const [floor, setFloor] = useState('3층');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // {floor, mi, day, shift}
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [editingMaster, setEditingMaster] = useState(null); // {mode: 'add'|'edit', product}
  const [showAlertList, setShowAlertList] = useState(false);

  const days = ['월', '화', '수', '목', '금', '토', '일', '차주월'];
  const columns = useMemo(() => DataService.getInjectionColumns(days), []);

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

  const isTestValue = (v) => {
    if (!v) return false;
    const lv = v.toLowerCase();
    if (lv === 'test' || lv.includes('test')) return true;
    if (testSets.testInkNames.has(lv)) return true;
    if (testSets.testProducts.has(lv)) return true;
    const productInks = testSets.productInks.get(lv);
    if (productInks && productInks.some(ink => testSets.testInkNames.has(ink))) return true;
    return false;
  };

  // 마스터 lookup (이름 → 제품)
  const productByName = useMemo(() => {
    const m = new Map();
    for (const p of data.products) {
      if (p.name) m.set(p.name, p);
    }
    return m;
  }, [data.products]);

  // 셀 상태: 'ok' | 'unregistered' | 'no-inks'
  const cellStatus = (value) => {
    if (!value || isTestValue(value)) return 'ok';
    const p = productByName.get(value);
    if (!p) return 'unregistered';
    const inkCount = (p.inks || []).filter(Boolean).length;
    if (inkCount === 0) return 'no-inks';
    return 'ok';
  };

  // 브랜드·잉크 후보 (ProductEditor용)
  const brandsList = useMemo(() => {
    const s = new Set(data.products.map(p => p.brand).filter(Boolean));
    return Array.from(s).sort();
  }, [data.products]);
  const allInksList = useMemo(() => {
    const s = new Set();
    for (const p of data.products) for (const ink of (p.inks || [])) if (ink) s.add(ink);
    return Array.from(s).sort();
  }, [data.products]);

  // 마스터 편집 저장
  const handleMasterSave = (product) => {
    const newData = { ...data };
    if (editingMaster.mode === 'add') {
      newData.products = [product, ...data.products];
      notify(`마스터에 추가: '${product.name}'`);
    } else {
      const idx = data.products.findIndex(p => p.name === editingMaster.product.name);
      if (idx >= 0) {
        newData.products = [...data.products];
        newData.products[idx] = product;
        notify(`마스터 수정: '${product.name}'`);
      }
    }
    setData(newData);
    setEditingMaster(null);
  };

  const machines = data.injection[floor];
  const filtered = useMemo(() => {
    if (!search) return machines;
    const q = search.toLowerCase();
    return machines.filter(m => {
      if (m.machine.toLowerCase().includes(q)) return true;
      for (const d of Object.values(m.schedule)) {
        if ((d.day || '').toLowerCase().includes(q) || (d.night || '').toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [machines, search]);

  const setCell = (mi, day, shift, value) => {
    const newData = { ...data };
    const f = [...newData.injection[floor]];
    f[mi] = { ...f[mi], schedule: { ...f[mi].schedule, [day]: { ...f[mi].schedule[day], [shift]: value } } };
    newData.injection = { ...newData.injection, [floor]: f };
    setData(newData);
  };

  const handleDrop = (target) => {
    if (!dragging) return;
    const value = data.injection[floor][dragging.mi].schedule[dragging.day][dragging.shift];
    setData(DataService.moveInjectionCell(data, floor, dragging, target));
    notify(`${value} → ${data.injection[floor][target.mi].machine} ${target.day} ${target.shift === 'day' ? '주간' : '야간'}`);
    setDragging(null);
    setDragOver(null);
  };

  // 마스터 알림 (이 층 + 모든 층 합산)
  const masterAlerts = useMemo(() => {
    const unregistered = new Map(); // name → [floor, machine, day, shift][]
    const noInks = new Map();
    for (const fl of Object.keys(data.injection || {})) {
      for (const m of data.injection[fl]) {
        for (const [d, sh] of Object.entries(m.schedule || {})) {
          for (const sk of ['day', 'night']) {
            const v = sh[sk];
            if (!v || isTestValue(v)) continue;
            const p = productByName.get(v);
            if (!p) {
              if (!unregistered.has(v)) unregistered.set(v, []);
              unregistered.get(v).push({ fl, machine: m.machine, d, sk });
            } else if (!(p.inks || []).filter(Boolean).length) {
              if (!noInks.has(v)) noInks.set(v, []);
              noInks.get(v).push({ fl, machine: m.machine, d, sk });
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
  }, [data.injection, productByName, testSets]);

  // Stats
  const stats = useMemo(() => {
    let total = 0, filled = 0;
    for (const m of machines) {
      for (const d of days) {
        for (const sh of ['day', 'night']) {
          total++;
          if (m.schedule[d]?.[sh]) filled++;
        }
      }
    }
    return { total, filled, util: total ? Math.round(filled / total * 100) : 0 };
  }, [machines]);

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
                className="btn"
                onClick={() => setShowAlertList(true)}
                style={{
                  borderColor: 'var(--warn-500)',
                  background: 'var(--warn-50)',
                  color: 'var(--warn-700)',
                  fontWeight: 600,
                }}
                title="마스터에 없는 제품 또는 잉크가 비어있는 제품"
              >
                ⚠ 마스터 점검 필요 ({masterAlerts.total})
              </button>
            )}
            <Seg value={floor} onChange={setFloor} options={[{ value: '3층', label: '3층' }, { value: '1층', label: '1층' }]} />
            <button className="btn"><Icon name="download" /> 엑셀 내보내기</button>
            <button className="btn btn--primary"><Icon name="save" /> 저장</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">가동률</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{stats.util}<span className="kpi__unit">%</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">투입 시프트</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{stats.filled}<span className="kpi__unit">/ {stats.total}</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">{floor} 호기 수</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{machines.length}<span className="kpi__unit">대</span></div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">고유 제품 수</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{(() => {
              const s = new Set();
              for (const m of machines) for (const d of Object.values(m.schedule)) { if (d.day) s.add(d.day); if (d.night) s.add(d.night); }
              return s.size;
            })()}</div>
          </div>
        </div>

        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="호기 또는 제품 검색" value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn"><Icon name="filter" size={12} /> 필터</button>
            <div className="spacer" />
            <div style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--info-600)', marginRight: 4, borderRadius: 2, verticalAlign: 'middle' }} />주간</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--brand-700)', marginRight: 4, borderRadius: 2, verticalAlign: 'middle' }} />야간</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--warn-600)', marginRight: 4, borderRadius: 2, verticalAlign: 'middle' }} />테스트 잉크</span>
            </div>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="sticky-col injection-machine-head" rowSpan="2" style={{ width: 90 }}>호기</th>
                  {days.map(d => (
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
                      <td className="sticky-col" style={{ fontWeight: 600 }}>
                        <div style={{ fontSize: 10, color: 'var(--ink-500)', fontWeight: 500 }}>{m.no != null ? `#${m.no}` : ''}</div>
                        <div>{m.machine}</div>
                      </td>
                      {columns.map(col => {
                        const value = m.schedule[col.day]?.[col.shift] || '';
                        const isTest = isTestValue(value);
                        const isDragOver = dragOver && dragOver.mi === realMi && dragOver.day === col.day && dragOver.shift === col.shift;
                        const isDragging = dragging && dragging.mi === realMi && dragging.day === col.day && dragging.shift === col.shift;
                        const status = cellStatus(value);
                        const statusTitle = status === 'unregistered'
                          ? '마스터 미등록 — 클릭해서 추가'
                          : status === 'no-inks'
                            ? '잉크 미등록 — 클릭해서 등록'
                            : '';
                        return (
                          <td
                            key={`${col.day}-${col.shift}`}
                            className={`injection-shift-cell injection-shift-cell--${col.shift}`}
                          >
                            <div
                              className={`shift-pill ${col.shift} ${!value ? 'empty' : ''} ${isTest ? 'test' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''} ${status !== 'ok' ? `shift-pill--${status}` : ''}`}
                              draggable={!!value}
                              onDragStart={() => setDragging({ mi: realMi, day: col.day, shift: col.shift })}
                              onDragEnd={() => { setDragging(null); setDragOver(null); }}
                              onDragOver={(e) => { e.preventDefault(); setDragOver({ mi: realMi, day: col.day, shift: col.shift }); }}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={(e) => { e.preventDefault(); handleDrop({ mi: realMi, day: col.day, shift: col.shift }); }}
                              onClick={() => setEditing({ mi: realMi, day: col.day, shift: col.shift, value })}
                              title={value ? `${value} (${col.shift === 'day' ? '주간' : '야간'})${isTest ? ' · 테스트 잉크' : ''}` : '클릭하여 배정'}
                            >
                              {isTest && value && <span className="test-mark">TEST</span>}
                              {status === 'unregistered' && (
                                <button
                                  className="shift-pill__alert shift-pill__alert--bad"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingMaster({ mode: 'add', product: { name: value, brand: '', inks: [] } });
                                  }}
                                  title={statusTitle}
                                >신규</button>
                              )}
                              {status === 'no-inks' && (
                                <button
                                  className="shift-pill__alert shift-pill__alert--warn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingMaster({ mode: 'edit', product: productByName.get(value) });
                                  }}
                                  title={statusTitle}
                                >잉크</button>
                              )}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '미배정'}</span>
                            </div>
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
                  {Array.from(masterAlerts.noInks.entries()).map(([name, occurs]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--warn-50)', borderRadius: 6, border: '1px solid var(--warn-200)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                          {occurs.length}곳 사용 — 브랜드: {productByName.get(name)?.brand || '미지정'}
                        </div>
                      </div>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => {
                          setEditingMaster({ mode: 'edit', product: productByName.get(name) });
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
                  setCell(editing.mi, editing.day, editing.shift, editing.value);
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
                  onClick={() => setEditing({ ...editing, value: '' })}
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
              initialBrand={editing.value ? (data.products.find(p => p.name === editing.value)?.brand || '') : ''}
              onSelect={(name) => setEditing({ ...editing, value: name })}
            />
          </Modal>
        )}
      </div>
    </div>
  );
}

window.InjectionPage = InjectionPage;
