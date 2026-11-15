(() => {
  'use strict';
  const ids = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const settings = { endpoint: '', key: '', poll: 20, motion: 'normal', effects: 'normal', view: 'grid', sort: 'updated', welcomed: false };
  const colors = { amber:'#e4bc88', blue:'#a6bdeb', green:'#a2cfb7', rose:'#e3a8bc', violet:'#c7b1ee', silver:'#bcbcc4' };
  const icons = {
    home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm6 11v-7h6v7"/>',
    trend:'<path d="M4 18h16M6 14v-3m4 3V8m4 6v-5m4 5V5"/>',
    vault:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 0v10m9-5-9 5-9-5m9 5v10m-9-5 9-5 9 5"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
    folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M9.8 3h4.4l.6 2.2 1.5.9 2.3-.6 2.2 3.8-1.6 1.6v1.9l1.6 1.6-2.2 3.8-2.3-.6-1.5.9-.6 2.5H9.8l-.6-2.5-1.5-.9-2.3.6-2.2-3.8 1.6-1.6v-1.9L3.2 9.3l2.2-3.8 2.3.6 1.5-.9Z"/>',
    search:'<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4 4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    cloud:'<path d="M5.7 18a4.7 4.7 0 0 1-.4-9.4 6 6 0 0 1 11.5 1.5 4 4 0 0 1 1.2 7.9Z"/>',
    chev:'<path d="m9 6 6 6-6 6"/>',
    list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    filter:'<path d="M4 7h16M7 12h10m-7 5h4"/>',
    file:'<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    back:'<path d="m11 6-6 6 6 6m-6-6h14"/>',
    edit:'<path d="m14 6 4 4M4 20l4-1 11-11-4-4L4 15Z"/>',
    move:'<path d="M3 7h6l2 2h10v10H3Zm8 7h6m-2-2 2 2-2 2"/>',
    restore:'<path d="M3 11a9 9 0 1 1 3 7m-3-7V5m0 6h6m3-4v5l3 2"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
    code:'<path d="m9 6-6 6 6 6m6-12 6 6-6 6m-2-15-2 18"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-4 3 2 4-4 5 5"/>',
    flag:'<path d="M5 21V4c3-4 7 4 14 0v11c-7 4-11-4-14 0"/>',
    merge:'<path d="M5 4v4a6 6 0 0 0 6 6h7m-3-3 3 3-3 3M5 20v-2m7-14v4"/>',
    link:'<path d="m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 6a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2"/>',
  };
  const folderIcons = { folder:'Папка', code:'Код', image:'Зображення', file:'Текст', star:'Зірка', flag:'Прапорець' };
  const MAX_BODY = 400000;
  const date = new Intl.DateTimeFormat('uk-UA', { day:'numeric', month:'short', year:'numeric' });
  const time = new Intl.DateTimeFormat('uk-UA', { dateStyle:'medium', timeStyle:'short' });

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" class="'+ name +'">'+ (icons[name] || icons.file) +'</svg>';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  }

  function regexFor(query) {
    const terms = [...new Set(query.trim().split(/\s+/u).filter(Boolean))].slice(0,12);
    const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return escaped.sort((a,b) => b.length-a.length);
  }

  function highlight(text, expression) {
    if (!expression) return esc(text);
    expression.lastIndex = 0;
    let result = '', start = 0;
    for (const match of text.matchAll(expression)) {
      result += esc(text.slice(start,match.index)) + '<mark>' + esc(match[0]) + '</mark>';
      start = match.index + match[0].length;
    }
    return result + esc(text.slice(start));
  }

  function fresh(kind, patch = {}) {
    const now = new Date().toISOString();
    const defaults = kind === 'prompt'
      ? { title:'', body:'', folderId:null, tags:[], favorite:false }
      : { title:'', parentId:null, color:'amber', icon:'folder' };
    return { ...defaults, created:now, updated:now, deleted:null, ...patch };
  }

  function iso(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  }

  function validData(kind, d, allowPurge = false) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (d.purged === true) return allowPurge && iso(d.updated) && iso(d.deleted);
    if (typeof d.title !== 'string' || d.title.length > 180 || !iso(d.created) || !iso(d.updated) || !(d.deleted === null || iso(d.deleted))) return false;
    if (kind === 'folder') {
      return (d.parentId === null || (typeof d.parentId === 'string' && ids.test(d.parentId))) &&
        Object.hasOwn(colors,d.color) && Object.hasOwn(folderIcons,d.icon);
    }
    return kind === 'prompt' && typeof d.body === 'string' && d.body.length <= MAX_BODY && typeof d.favorite === 'boolean' &&
      (d.folderId === null || (typeof d.folderId === 'string' && ids.test(d.folderId))) &&
      Array.isArray(d.tags) && d.tags.length <= 20 && d.tags.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 48);
  }

  function cleanData(kind, d) {
    if (d.purged) return { purged:true, updated:d.updated, deleted:d.deleted };
    const common = { title:d.title, created:d.created, updated:d.updated, deleted:d.deleted };
    return kind === 'prompt'
      ? { ...common, body:d.body, folderId:d.folderId, tags:d.tags, favorite:d.favorite }
      : { ...common, parentId:d.parentId, color:d.color, icon:d.icon };
  }

  function equal(a, b) {
    if (!a || !b) return a === b;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(key => Array.isArray(a[key])
        ? Array.isArray(b[key]) && a[key].length === b[key].length && a[key].every((value,index) => value === b[key][index])
        : a[key] === b[key]);
  }

  function tags(value) {
    return [...new Set(value.split(',').map(x => x.trim().slice(0,48)).filter(Boolean))].slice(0,20);
  }

  function rawOffset(raw,index) {
    let pointer = 0;
    for (let count=0; count<index; count++,pointer++) {
      if (raw[pointer] === '\r' && raw[pointer+1] === '\n') pointer++;
    }
    return pointer;
  }

  function restoreLineEndings(raw, value) {
    if (!raw.includes('\r')) return value;
    const normalized = raw.replace(/\r\n?/g,'\n');
    if (normalized === value) return raw;
    let prefix = 0, suffix = 0;
    while (prefix < normalized.length && prefix < value.length && normalized[prefix] === value[prefix]) prefix++;
    while (suffix < normalized.length - prefix && suffix < value.length - prefix &&
      normalized[normalized.length-1-suffix] === value[value.length-1-suffix]) suffix++;
    const newline = raw.match(/\r\n|\r|\n/)[0];
    return raw.slice(0,rawOffset(raw,prefix)) + value.slice(prefix,value.length-suffix).replace(/\n/g,newline) +
      raw.slice(rawOffset(raw,normalized.length-suffix));
  }

  const dbScope = location.protocol === 'file:' ? location.href.split(/[?#]/)[0] : new URL('./',location.href).pathname;
  window.Vault = { ids, uid, icon, esc, highlight, regexFor, fresh, validData, cleanData, equal, tags, rawOffset, restoreLineEndings, settings,
    colors, folderIcons, date, time, MAX_BODY, dbScope };
})();
