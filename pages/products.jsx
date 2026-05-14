// 제품 마스터 page - 1제품 = 1 row, 잉크는 [1도, 2도, 3도] 길이 3 고정 배열

function ProductsPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [quickAdd, setQuickAdd] = useState({ name: '', brand: '', inks: [null, null, null] });

  const brands = useMemo(() => {
    const s = new Set(data.products.map(p => p.brand).filter(Boolean));
    return ['all', ...Array.from(s).sort()];
  }, [data.products]);

  const allInks = useMemo(() => {
    const s = new Set();
    for (const p of data.products) for (const ink of (p.inks || [])) if (ink) s.add(ink);
    return Array.from(s).sort();
  }, [data.products]);

  const filtered = useMemo(() => {
    let list = data.products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q)
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
    if (!quickAdd.name.trim()) return;
    const newProduct = {
      name: quickAdd.name.trim(),
      brand: quickAdd.brand.trim(),
      inks: padInks3(quickAdd.inks),
    };
    setData({ ...data, products: [newProduct, ...data.products] });
    notify(`'${newProduct.name}' 제품 추가됨`);
    setQuickAdd({ name: '', brand: '', inks: [null, null, null] });
  };

  const handleSave = (product) => {
    const newData = { ...data };
    const normalized = { ...product, inks: padInks3(product.inks) };
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
            <div className="page__title">제품 마스터</div>
            <div className="page__meta">1개 제품 = 1행 · 1도/2도/3도 슬롯에 사용 잉크 등록 (최소 1도)</div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 내보내기</button>
            <button className="btn btn--primary" onClick={() => setEditing({ mode: 'add', product: { name: '', brand: '', inks: [null, null, null] } })}>
              <Icon name="plus" size={12} /> 상세 등록
            </button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="제품명, 브랜드, 잉크 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 240 }} />
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
                  <th className="sticky-col" style={{ width: 220 }}>제품명</th>
                  <th style={{ width: 110 }}>브랜드</th>
                  <th style={{ width: 130, textAlign: 'center' }}>1도</th>
                  <th style={{ width: 130, textAlign: 'center' }}>2도</th>
                  <th style={{ width: 130, textAlign: 'center' }}>3도</th>
                  <th style={{ width: 80, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {/* Quick add row */}
                <tr style={{ background: 'var(--brand-50)' }}>
                  <td className="sticky-col" style={{ background: 'var(--brand-50)' }}>
                    <input className="input" placeholder="신규 제품명*" value={quickAdd.name} onChange={e => setQuickAdd({ ...quickAdd, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} style={{ width: '100%' }} />
                  </td>
                  <td>
                    <input className="input" placeholder="브랜드" list="brand-list-quick" value={quickAdd.brand} onChange={e => setQuickAdd({ ...quickAdd, brand: e.target.value })} style={{ width: '100%' }} />
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
                    <td className="sticky-col" style={{ fontWeight: 500 }}>{p.name}</td>
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
                {filtered.length === 0 && <tr><td colSpan="6" className="muted" style={{ textAlign: 'center', padding: 40 }}>제품이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        {editing && <ProductEditor product={editing.product} mode={editing.mode} onSave={handleSave} onClose={() => setEditing(null)} brands={brands.filter(b => b !== 'all')} allInks={allInks} />}
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

function ProductEditor({ product, mode, onSave, onClose, brands, allInks }) {
  const [form, setForm] = useState({
    name: product.name || '',
    brand: product.brand || '',
    inks: padInks3(product.inks),
  });

  const setInk = (idx, v) => {
    const next = [...form.inks];
    next[idx] = v;
    setForm({ ...form, inks: next });
  };

  const filledCount = form.inks.filter(Boolean).length;

  return (
    <Modal
      title={mode === 'add' ? '신규 제품 등록' : '제품 수정'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn--primary" onClick={() => onSave(form)} disabled={!form.name || filledCount === 0}>
            <Icon name="save" size={12} /> 저장
          </button>
        </>
      }
    >
      <div className="row-2">
        <div className="field">
          <label className="field__label">제품명<span className="req">*</span></label>
          <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: RHAPSODY" autoFocus />
        </div>
        <div className="field">
          <label className="field__label">브랜드</label>
          <input className="input" list="brand-list" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="브랜드 선택/입력" />
          <datalist id="brand-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
        </div>
      </div>
      <div className="field">
        <label className="field__label">잉크 (1도 / 2도 / 3도) — 최소 1개</label>
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
        <div className="field__hint">자리는 항상 3개 제공. 빈 슬롯은 미사용. 잉크 이름은 자동완성에서 고르거나 새로 입력 가능.</div>
      </div>
    </Modal>
  );
}

// 단일 잉크 슬롯 입력 — text + datalist + X 버튼
function InkSlotInput({ value, onChange, suggestions = [], placeholder = '' }) {
  const datalistId = useMemo(() => `ink-dl-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        className="input"
        list={datalistId}
        value={value || ''}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', paddingRight: value ? 24 : 8 }}
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
    </div>
  );
}

window.ProductsPage = ProductsPage;
window.ProductEditor = ProductEditor;
window.InkSlotInput = InkSlotInput;
