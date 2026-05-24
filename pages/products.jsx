// 제품 마스터 page - 1제품 = 1 row, 잉크는 [1도, 2도, 3도] 길이 3 고정 배열

function ProductsPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editing, setEditing] = useState(null);
  const [quickAdd, setQuickAdd] = useState({ factory: '', name: '', type: '', brand: '', inks: [null, null, null] });

  const brands = useMemo(() => {
    const s = new Set(data.products.map(p => p.brand).filter(Boolean));
    return ['all', ...Array.from(s).sort()];
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

  // 마스터에 알려진 잉크: machineAssignments(정본) + inkPlan + 기존 제품의 inks 합집합.
  // 정규화 후 dedup하되 표시 이름은 첫 발견 원형 유지.
  const allInks = useMemo(() => {
    const map = new Map();
    const add = (raw) => {
      if (!raw) return;
      const norm = String(raw).trim().toLowerCase();
      if (norm && !map.has(norm)) map.set(norm, raw);
    };
    for (const a of (data.machineAssignments || [])) add(inkOfAssignment(a));
    for (const i of (data.inkPlan || [])) add(i.name);
    for (const p of data.products) for (const ink of (p.inks || [])) add(ink);
    return Array.from(map.values()).sort();
  }, [data.products, data.machineAssignments, data.inkPlan]);

  // 마스터에 없는 잉크인지 검사 (정규화 비교)
  const knownInkSet = useMemo(() => {
    const s = new Set();
    for (const v of allInks) s.add(String(v).trim().toLowerCase());
    return s;
  }, [allInks]);
  const findUnknownInks = (inks) => (inks || [])
    .filter(Boolean)
    .filter(ink => !knownInkSet.has(String(ink).trim().toLowerCase()));

  const filtered = useMemo(() => {
    let list = data.products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q)
        || (p.factory || '').toLowerCase().includes(q)
        || (p.type || '').toLowerCase().includes(q)
        || (p.brand || '').toLowerCase().includes(q)
        || (p.inks || []).some(ink => ink && ink.toLowerCase().includes(q))
      );
    }
    if (brandFilter !== 'all') {
      list = list.filter(p => p.brand === brandFilter);
    }
    return list;
  }, [data.products, search, brandFilter]);

  // padInks3는 ui.jsx의 헬퍼 사용
  const handleQuickAdd = () => {
    const filledInks = quickAdd.inks.filter(Boolean);
    if (!quickAdd.factory.trim() || !quickAdd.name.trim() || !quickAdd.type.trim() || !quickAdd.brand.trim() || filledInks.length === 0) {
      notify('공장, 제품명, TYPE, 고객사, 잉크를 모두 입력해야 추가할 수 있습니다');
      return;
    }
    const unknown = findUnknownInks(quickAdd.inks);
    if (unknown.length) {
      notify(`마스터에 없는 잉크: ${unknown.join(', ')} — 잉크 추가 및 관리에서 먼저 등록하세요`);
      return;
    }
    const newProduct = {
      factory: quickAdd.factory.trim(),
      name: quickAdd.name.trim(),
      type: quickAdd.type.trim(),
      brand: quickAdd.brand.trim(),
      customer: quickAdd.brand.trim(),
      inks: padInks3(quickAdd.inks),
    };
    setData({ ...data, products: [newProduct, ...data.products] });
    notify(`'${newProduct.name}' 제품 추가됨`);
    setQuickAdd({ factory: '', name: '', type: '', brand: '', inks: [null, null, null] });
  };

  const handleSave = (product) => {
    const filledInks = (product.inks || []).filter(Boolean);
    if (!product.factory?.trim() || !product.name?.trim() || !product.type?.trim() || !product.brand?.trim() || filledInks.length === 0) {
      notify('공장, 제품명, TYPE, 고객사, 잉크를 모두 입력해야 저장할 수 있습니다');
      return;
    }
    const unknown = findUnknownInks(filledInks);
    if (unknown.length) {
      notify(`마스터에 없는 잉크: ${unknown.join(', ')} — 잉크 추가 및 관리에서 먼저 등록하세요`);
      return;
    }
    const newData = { ...data };
    const normalized = { ...product, customer: product.brand || product.customer || '', inks: padInks3(product.inks) };
    if (editing.mode === 'add') {
      newData.products = [normalized, ...newData.products];
      notify('제품이 추가되었습니다');
    } else {
      const idx = newData.products.findIndex(p => p === editing.product);
      if (idx < 0) {
        notify('수정할 제품을 찾을 수 없습니다. 목록을 새로 확인하세요.');
        setEditing(null);
        return;
      }
      const oldName = editing.product.name;
      newData.products = [...newData.products];
      newData.products[idx] = normalized;
      newData.injection = DataService.renameInjectionRefs(data.injection, oldName, normalized.name);
      notify('제품이 수정되었습니다');
    }
    setData(newData);
    setEditing(null);
  };

  const handleDelete = (product) => {
    const refCount = DataService.countInjectionRefs(data, product.name);
    if (refCount > 0) {
      notify(`사출계획에서 ${refCount}칸이 '${product.name}'을 사용 중이라 삭제할 수 없습니다`);
      setConfirmDelete(null);
      return;
    }
    const newData = { ...data };
    newData.products = newData.products.filter(p => p !== product);
    setData(newData);
    setConfirmDelete(null);
    notify('제품이 삭제되었습니다');
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">제품 추가 및 관리</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">전체 <strong>{data.products.length}</strong>개 제품</span>
              <span className="page__meta-chip">공장 · TYPE · 고객사 · 1·2·3도 잉크</span>
            </div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 내보내기</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="공장, 제품명, TYPE, 고객사, 잉크 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 280 }} />
            <select className="input select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
              {brands.map(b => <option key={b} value={b}>{b === 'all' ? '전체 브랜드' : b}</option>)}
            </select>
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}건 표시 / 전체 {data.products.length}</span>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>공장</th>
                  <th className="sticky-col" style={{ width: 220 }}>제품명</th>
                  <th style={{ width: 90 }}>TYPE</th>
                  <th style={{ width: 110 }}>고객사</th>
                  <th style={{ width: 130, textAlign: 'center' }}>1도</th>
                  <th style={{ width: 130, textAlign: 'center' }}>2도</th>
                  <th style={{ width: 130, textAlign: 'center' }}>3도</th>
                  <th style={{ width: 80, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                  {/* Quick add row */}
                  <tr style={{ background: 'var(--brand-50)' }}>
                  <td>
                    <select className="input select" value={quickAdd.factory} onChange={e => setQuickAdd({ ...quickAdd, factory: e.target.value })} style={{ width: '100%' }}>
                      <option value="">공장 선택</option>
                      {factoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </td>
                  <td className="sticky-col" style={{ background: 'var(--brand-50)' }}>
                    <input className="input" placeholder="신규 제품명*" value={quickAdd.name} onChange={e => setQuickAdd({ ...quickAdd, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} style={{ width: '100%' }} />
                  </td>
                  <td>
                    <select className="input select" value={quickAdd.type} onChange={e => setQuickAdd({ ...quickAdd, type: e.target.value })} style={{ width: '100%' }}>
                      <option value="">TYPE 선택</option>
                      {typeOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="input" placeholder="고객사" list="brand-list-quick" value={quickAdd.brand} onChange={e => setQuickAdd({ ...quickAdd, brand: e.target.value })} style={{ width: '100%' }} />
                    <datalist id="brand-list-quick">{brands.filter(b => b !== 'all').map(b => <option key={b} value={b} />)}</datalist>
                  </td>
                  {[0, 1, 2].map(i => (
                    <td key={i}>
                      <InkSlotInput
                        value={quickAdd.inks[i]}
                        suggestions={allInks}
                        onChange={(v) => {
                          const next = [...quickAdd.inks];
                          next[i] = v;
                          setQuickAdd({ ...quickAdd, inks: next });
                        }}
                        placeholder={`${i + 1}도`}
                      />
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn--primary btn--sm" onClick={handleQuickAdd} disabled={!quickAdd.name.trim()}>
                      <Icon name="plus" size={11} /> 추가
                    </button>
                  </td>
                </tr>
                {filtered.map((p, i) => (
                  <tr key={p.name + i}>
                    <td>{p.factory ? <span className="tag">{p.factory}</span> : <span style={{ color: 'var(--ink-400)' }}>·</span>}</td>
                    <td className="sticky-col" style={{ fontWeight: 500 }}>{p.name}</td>
                    <td>{p.type ? <span className="tag">{p.type}</span> : <span style={{ color: 'var(--ink-400)' }}>·</span>}</td>
                    <td>{p.brand ? <span className="tag">{p.brand}</span> : <span style={{ color: 'var(--ink-400)' }}>·</span>}</td>
                    {[0, 1, 2].map(idx => {
                      const ink = (p.inks || [])[idx];
                      return (
                        <td key={idx} style={{ textAlign: 'center' }}>
                          {ink ? (
                            <span className="tag" style={{ color: 'var(--brand-700)', background: 'var(--brand-50)', borderColor: 'var(--brand-200)' }}>{ink}</span>
                          ) : (
                            <span style={{ color: 'var(--ink-300)', fontSize: 11 }}>·</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn--sm btn--ghost" onClick={() => setEditing({ mode: 'edit', product: p })}><Icon name="edit" size={11} /></button>
                      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => setConfirmDelete(p)}><Icon name="trash" size={11} /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="8">
                    <div className="empty-state">
                      <div className="empty-state__title">
                        {search || brandFilter !== 'all' ? '조건에 맞는 제품 없음' : '등록된 제품 없음'}
                      </div>
                      <div className="empty-state__hint">표 맨 위 행에서 공장·제품명·TYPE·고객사·잉크를 입력해 추가하세요.</div>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {editing && (
          <ProductEditor
            product={editing.product}
            mode={editing.mode}
            onSave={handleSave}
            onClose={() => setEditing(null)}
            brands={brands.filter(b => b !== 'all')}
            allInks={allInks}
            factoryOptions={factoryOptions}
            typeOptions={typeOptions}
          />
        )}
        {confirmDelete && (
          <Modal title="제품 삭제" onClose={() => setConfirmDelete(null)} footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>취소</button>
              <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}><Icon name="trash" size={12} /> 삭제</button>
            </>
          }>
            <p style={{ fontSize: 13 }}><strong>{confirmDelete.name}</strong> 제품을 삭제하시겠습니까?</p>
            <p style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 8 }}>이 작업은 되돌릴 수 없습니다.</p>
          </Modal>
        )}
      </div>
    </div>
  );
}

function ProductEditor({ product, mode, onSave, onClose, brands, allInks, factoryOptions, typeOptions }) {
  const [form, setForm] = useState({
    factory: product.factory || '',
    name: product.name || '',
    type: product.type || '',
    brand: product.brand || product.customer || '',
    inks: padInks3(product.inks),
  });

  const setInk = (idx, v) => {
    const next = [...form.inks];
    next[idx] = v;
    setForm({ ...form, inks: next });
  };

  const filledCount = form.inks.filter(Boolean).length;
  const canSave = form.factory.trim() && form.name.trim() && form.type.trim() && form.brand.trim() && filledCount > 0;

  return (
    <Modal
      title={mode === 'add' ? '신규 제품 등록' : '제품 수정'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn--primary" onClick={() => onSave(form)} disabled={!canSave}>
            <Icon name="save" size={12} /> 저장
          </button>
        </>
      }
    >
      <div className="row-2">
        <div className="field">
          <label className="field__label">공장</label>
          <select className="input select" value={form.factory} onChange={e => setForm({ ...form, factory: e.target.value })}>
            <option value="">공장 선택</option>
            {factoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">제품명<span className="req">*</span></label>
          <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: RHAPSODY" autoFocus />
        </div>
      </div>
      <div className="row-2">
        <div className="field">
          <label className="field__label">TYPE</label>
          <select className="input select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="">TYPE 선택</option>
            {typeOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="row-2">
        <div className="field">
          <label className="field__label">고객사</label>
          <input className="input" list="brand-list" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="고객사 선택/입력" />
          <datalist id="brand-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
        </div>
      </div>
      <div className="field">
        <label className="field__label">잉크 (1도 / 2도 / 3도)<span className="req">*</span></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i}>
              <div style={{ fontSize: 10, color: 'var(--ink-500)', marginBottom: 4, fontWeight: 600 }}>{i + 1}도</div>
              <InkSlotInput
                value={form.inks[i]}
                suggestions={allInks}
                onChange={(v) => setInk(i, v)}
                placeholder={`${i + 1}도 잉크명`}
              />
            </div>
          ))}
        </div>
        <div className="field__hint">호기는 잉크 추가 및 관리 화면에서만 관리합니다. 제품에서는 어떤 잉크를 쓰는지만 등록합니다.</div>
      </div>
    </Modal>
  );
}

// 잉크명 정규화 (마스터 비교용) — 잉크 추가 페이지의 중복 검사와 동일 규칙
function normalizeInkName(name) {
  return String(name || '').trim().toLowerCase();
}

// 단일 잉크 슬롯 입력 — text + datalist + X 버튼.
// suggestions는 마스터의 알려진 잉크명. 미등록 입력이면 빨간 테두리 + 힌트로 표기.
function InkSlotInput({ value, onChange, suggestions = [], placeholder = '' }) {
  const datalistId = useMemo(() => `ink-dl-${Math.random().toString(36).slice(2, 8)}`, []);
  const knownSet = useMemo(() => {
    const s = new Set();
    for (const v of suggestions) s.add(normalizeInkName(v));
    return s;
  }, [suggestions]);
  const trimmed = (value || '').trim();
  const isUnknown = trimmed.length > 0 && !knownSet.has(normalizeInkName(trimmed));

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        className="input"
        list={datalistId}
        value={value || ''}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          paddingRight: value ? 24 : 8,
          borderColor: isUnknown ? 'var(--bad-500)' : undefined,
        }}
        title={isUnknown ? '잉크 마스터에 없는 이름입니다. 잉크 추가 및 관리 페이지에서 먼저 등록하세요.' : undefined}
      />
      <datalist id={datalistId}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="비우기"
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            width: 18, height: 18, padding: 0, lineHeight: 1, fontSize: 11,
            background: 'transparent', border: 0, color: 'var(--ink-400)', cursor: 'pointer',
          }}
          onMouseOver={e => e.currentTarget.style.color = 'var(--bad-600)'}
          onMouseOut={e => e.currentTarget.style.color = 'var(--ink-400)'}
        >×</button>
      )}
      {isUnknown && (
        <div style={{ position: 'absolute', top: '100%', left: 0, fontSize: 10, color: 'var(--bad-600)', marginTop: 2, lineHeight: 1.3 }}>
          마스터 미등록
        </div>
      )}
    </div>
  );
}

window.ProductsPage = ProductsPage;
window.ProductEditor = ProductEditor;
window.InkSlotInput = InkSlotInput;
