(() => {
  'use strict';
  const V = window.Vault, S = V.store, Cloud = V.sync;
  const { icon:I,esc:E,colors,folderIcons } = V;
  const $ = (selector,root=document) => root.querySelector(selector);
  const main = $('#main'), editor = $('#editor'), modal = $('#modal'), menu = $('#menu');
  const routes = {
    all:{ title:'Бібліотека', icon:'home', nav:'Головна' },
    folders:{ title:'Папки', icon:'folder', nav:'Папки' },
    favorites:{ title:'Обране', icon:'star', nav:'Обране' },
    recent:{ title:'Нещодавні', icon:'clock' },
    trash:{ title:'Кошик', icon:'trash' },
    settings:{ title:'Налаштування', icon:'settings', nav:'Параметри' },
    search:{ title:'Пошук', icon:'search', nav:'Пошук' },
    conflicts:{ title:'Конфлікти', icon:'merge' },
  };
  const statusLabels = {
    local:'Збережено локально', syncing:'Синхронізація…', synced:'Синхронізовано', offline:'Немає з’єднання',
    pending:'Є локальні зміни', failed:'Помилка синхронізації', conflict:'Виявлено конфлікт'
  };
  const sortLabels = { updated:'Остання зміна', created:'Дата створення', title:'За назвою' };
  const colorLabels = { amber:'Бурштин', silver:'Срібло', blue:'Блакить', green:'Шавлія', rose:'Троянда', violet:'Фіалка' };
  const collator = new Intl.Collator('uk',{ sensitivity:'base',numeric:true });
  const dayLabel = new Intl.DateTimeFormat('uk-UA',{ weekday:'short' });
  const chartDate = new Intl.DateTimeFormat('uk-UA',{ day:'numeric',month:'short' });
  const navOrder = ['all','folders','search','favorites','settings'];
  const digitDots = [
    '01110100011001110101110011000101110',
    '00100011000010000100001000010001110',
    '01110100010000100110010001000011111',
    '11110000010000101110000010000111110',
    '00010001100101010010111110001000010',
    '11111100001000011110000010000111110',
    '01110100001000011110100011000101110',
    '11111000010001000100010000100001000',
    '01110100011000101110100011000101110',
    '01110100011000101111000010000101110'
  ];
  const filters = { open:false,folder:'',tag:'',favorite:false };
  const cache = new Map();
  let state, route = 'all', folderId, folders = new Map(), prompts = [], live = [], counts = {};
  let query = '', limit = 24, findTimer, refreshTimer, toastTimer, editorRow, savedBody = '', draftTasks = Promise.resolve();
  let dirtyFields = new Map(), draftError = '', refreshSeq = 0, pendingWrites = 0, modalSubmit, initialized = false;
  const briefTitle = data => data?.title.trim() || 'Без назви';
  const sortNames = (a,b) => collator.compare(briefTitle(a.data),briefTitle(b.data));
  const btn = (label,action,kind='secondary',symbol='',extra='') =>
    '<button type="button" class="'+kind+'" data-action="'+action+'" '+extra+'>'+ (symbol ? I(symbol) : '') + E(label) + '</button>';
  const ib = (label,action,symbol,extra='') =>
    '<button type="button" class="icon-button" data-action="'+action+'" title="'+E(label)+'" aria-label="'+E(label)+'" '+extra+'>'+I(symbol)+'</button>';
  const option = (value,label,picked) => '<option value="'+E(value)+'"'+(value === picked ? ' selected' : '')+'>'+E(label)+'</option>';
  const dataId = id => 'data-id="'+E(id)+'"';
  const currentFolder = () => folders.get(folderId);
  const folderStyle = data => 'style="color:'+colors[data.color]+'"';

  function say(message) {
    const t = $('#toast');
    clearTimeout(toastTimer);
    t.textContent = message;
    if (typeof t.showPopover === 'function') {
      t.setAttribute('popover','manual');
      if (t.matches(':popover-open')) t.hidePopover();
      t.showPopover();
    }
    t.classList.add('visible');
    toastTimer = setTimeout(() => {
      t.classList.remove('visible');
      setTimeout(() => { if (typeof t.hidePopover==='function' && !t.classList.contains('visible') && t.matches(':popover-open')) t.hidePopover(); },190);
    },2600);
  }

  function problem(error) {
    const known = { QuotaExceededError:'Сховище переповнене. Звільніть місце в браузері та повторіть дію.',
      InvalidStateError:'Локальне сховище недоступне. Перевідкрийте вкладку.',
      UnknownError:'Браузер не зміг записати зміни. Перевірте доступ до локального сховища.' };
    return known[error?.name] || error?.message || 'Не вдалося виконати дію. Спробуйте ще раз.';
  }

  function rebuild() {
    folders = new Map(state.rows.filter(row => row.kind === 'folder' && !row.data.deleted && !row.data.purged).map(row => [row.id,row]));
    prompts = state.rows.filter(row => row.kind === 'prompt' && !row.data.purged);
    live = prompts.filter(row => !row.data.deleted);
    counts = {
      all:live.length, favorites:live.filter(row => row.data.favorite).length,
      trash:state.rows.filter(row => row.data.deleted && !row.data.purged).length, conflicts:state.rows.filter(row => row.conflict).length,
      queued:state.rows.filter(row => row.head).length, folder:new Map()
    };
    for (const row of live) {
      const id = effectiveFolder(row.data);
      counts.folder.set(id,(counts.folder.get(id) || 0)+1);
    }
    const known = new Set(prompts.map(row => row.id));
    for (const id of cache.keys()) if (!known.has(id)) cache.delete(id);
  }

  function effectiveFolder(data) {
    return folders.has(data.folderId) ? data.folderId : null;
  }

  function parentOf(row) {
    const parent = row.data.parentId;
    if (!folders.has(parent)) return null;
    const seen = new Set([row.id]);
    let next = parent;
    while (folders.has(next)) {
      if (seen.has(next)) return null;
      seen.add(next);
      next = folders.get(next).data.parentId;
    }
    return parent;
  }

  function folderTrail(id) {
    const parents = [];
    let row = folders.get(id);
    while (row) {
      parents.unshift(row);
      row = folders.get(parentOf(row));
    }
    return parents;
  }

  function folderPath(id) {
    return folderTrail(id).map(row=>briefTitle(row.data)).join(' / ');
  }

  function folderOptions(picked,exclude = null,rootLabel='Без папки') {
    const rows = [...folders.values()].filter(row => {
      let parent = row.id;
      while (parent) {
        if (parent === exclude) return false;
        parent = parentOf(folders.get(parent));
      }
      return true;
    }).map(row => ({ id:row.id,title:folderPath(row.id) })).sort((a,b) => collator.compare(a.title,b.title));
    return option('',rootLabel,picked || '') + rows.map(row => option(row.id,row.title,picked)).join('');
  }

  function navigation() {
    const nav = $('#bottom-nav');
    if (!nav.firstElementChild) {
      nav.innerHTML = navOrder.map(name =>
        '<a href="#'+name+'">'+I(routes[name].icon)+'<span>'+routes[name].nav+'</span></a>').join('');
    }
    const section = { folder:'folders', recent:'all', trash:'all', conflicts:'settings' }[route] || route;
    for (const link of nav.children) {
      if (link.hash==='#'+section) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    $('.top-create').hidden = ['trash','settings','conflicts'].includes(route);
  }

  function syncState() {
    if (!state) return 'local';
    if (counts.conflicts) return 'conflict';
    const hasKey = Cloud.credentials().key;
    if (!state.prefs.endpoint || !hasKey) return 'local';
    if (!navigator.onLine) return 'offline';
    const { phase } = Cloud.status();
    if (phase==='syncing') return 'syncing';
    if (phase==='failed') return 'failed';
    if (counts.queued || !state.cloud.at) return 'pending';
    return 'synced';
  }

  function statusUI() {
    const phase = syncState();
    const dot = '<span class="status-dot" data-state="'+phase+'"></span>';
    const control = $('#sync-control');
    if (control.dataset.state!==phase) {
      control.dataset.state = phase;
      control.title = statusLabels[phase];
      control.setAttribute('aria-label',statusLabels[phase]+' · Налаштування синхронізації');
      control.innerHTML = I(phase==='conflict'?'merge':'cloud')+
        '<span class="sync-label">'+({ local:'Локально',synced:'Синхронізовано',offline:'Офлайн' }[phase] || statusLabels[phase])+'</span>'+dot;
    }
    const setting = $('#setting-status');
    if (setting) {
      setting.innerHTML = dot+'<span>'+statusLabels[phase]+' · '+counts.queued+' у черзі'+
        (state.cloud.at?' · '+V.time.format(state.cloud.at):'')+'</span>';
      const err = $('#connection-error');
      if (err && !(err.dataset.local && err.textContent)) err.textContent = Cloud.status().error;
      $('#settings-conflict-link').hidden = !counts.conflicts;
    }
    const line = $('#editor-status');
    if (line) line.textContent = draftError || (pendingWrites?'Збереження…':statusLabels[phase]);
  }

  function pageHead(title,description='',actions='') {
    return '<div class="page-head"><div><h1>'+E(title)+'</h1>'+(description?'<p>'+E(description)+'</p>':'')+'</div>'+
      (actions?'<div class="actions">'+actions+'</div>':'')+'</div>';
  }

  function empty(symbol,title,message,actions='') {
    return '<div class="empty"><div><div class="empty-symbol">'+I(symbol)+'</div><h3>'+E(title)+'</h3>'+
      '<p>'+E(message)+'</p>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div></div>';
  }

  function dottedNumber(count) {
    const digits = String(count);
    const dots = [...digits].map((digit,i)=>[...digitDots[Number(digit)]].map((dot,j)=>
      dot==='1'?'<circle cx="'+(i*6+j%5+.5)+'" cy="'+(Math.floor(j/5)+.5)+'" r=".32"/>':''
    ).join('')).join('');
    return '<svg class="dot-number" viewBox="0 0 '+(digits.length*6-1)+' 7" role="img" aria-label="'+digits+'">'+dots+'</svg>';
  }

  function periodActivity() {
    const dateKey = date=>[date.getFullYear(),date.getMonth(),date.getDate()].join('-');
    const today = new Date();
    const days = Array.from({length:7},(_,index)=>{
      const day = new Date(today);
      day.setHours(0,0,0,0);
      day.setDate(day.getDate()-6+index);
      return { day,count:0 };
    });
    const byDate = new Map(days.map(entry=>[dateKey(entry.day),entry]));
    for (const row of live) {
      const entry = byDate.get(dateKey(new Date(row.data.updated)));
      if (entry) entry.count++;
    }
    return days;
  }

  function metric(name,number,tone,description) {
    const item = routes[name];
    return '<a class="metric '+tone+'" href="#'+name+'"><div class="metric-top"><span>'+item.title+'</span>'+I(item.icon)+'</div>'+
      dottedNumber(number)+'<small>'+description+'</small></a>';
  }

  function drawOverview() {
    const container = $('#overview');
    if (!container) return;
    const days = periodActivity();
    const recent = days.reduce((total,entry)=>total+entry.count,0);
    const signature = [counts.all,counts.favorites,folders.size,counts.trash,...days.map(entry=>entry.day.getTime()+'-'+entry.count)].join(':');
    if (container.dataset.signature===signature) return;
    container.dataset.signature = signature;
    const highest = Math.max(1,...days.map(entry=>entry.count));
    const labels = days.map(({day,count})=>chartDate.format(day)+': '+count).join(', ');
    const chart = days.map(({day,count},index)=>{
      const filled = Math.ceil(count/highest*10);
      return '<div class="chart-day'+(index===6?' today':'')+'" title="'+E(chartDate.format(day)+' · '+count)+'"><div class="chart-dots">'+
        Array.from({length:10},(_,i)=>i>=10-filled?'<i class="lit"></i>':'<i></i>').join('')+
        '</div><span>'+E(dayLabel.format(day).replace(/\.$/,''))+'</span></div>';
    }).join('');
    const activeHref = container.contains(document.activeElement)?document.activeElement.getAttribute('href'):null;
    container.innerHTML = '<article class="overview-main"><div class="overview-top"><span>Промптів у бібліотеці</span>'+
      I('trend')+'</div><div class="overview-number">'+dottedNumber(counts.all)+'</div><div class="chart-caption">Останні зміни · 7 днів</div>'+
      '<div class="activity-chart" role="img" aria-label="'+E('Промпти за днем останньої зміни. '+labels)+'">'+chart+'</div></article>'+
      '<div class="metric-grid">'+metric('favorites',counts.favorites,'berry','Зі зірочкою')+
      metric('folders',folders.size,'mint','У бібліотеці')+metric('recent',recent,'ember','Змінено за 7 днів')+
      metric('trash',counts.trash,'slate','Видалені записи')+'</div>';
    if (activeHref) [...container.querySelectorAll('a')].find(link=>link.getAttribute('href')===activeHref)?.focus({preventScroll:true});
  }

  function folderBreadcrumb(id) {
    const parents = folderTrail(id).slice(0,-1);
    return '<nav class="breadcrumbs" aria-label="Шлях до папки"><a href="#folders">Папки</a>'+
      parents.map(row=>I('chev')+'<a href="#folder/'+row.id+'">'+E(briefTitle(row.data))+'</a>').join('')+I('chev')+'</nav>';
  }

  function folderCards(parent) {
    const rows = [...folders.values()].filter(row => parentOf(row)===parent).sort(sortNames);
    if (!rows.length) return '';
    return '<div class="folder-grid">'+rows.map(({ id,data }) =>
      '<article class="folder-card"><a href="#folder/'+id+'"><span class="folder-icon" '+folderStyle(data)+'>'+I(data.icon)+
      '</span><span><strong>'+E(briefTitle(data))+'</strong><small>Промпти · '+(counts.folder.get(id)||0)+'</small></span></a>'+
      ib('Дії з папкою','folder-menu','more',dataId(id))+'</article>').join('')+'</div>';
  }

  function toolbar() {
    return '<div class="toolbar"><label class="inline-search">'+I('search')+
      '<input id="inline-query" type="search" maxlength="160" aria-label="Пошук промптів" placeholder="Пошук промптів…" value="'+E(query)+'"></label>'+
      '<div class="toolbar-actions">'+(route==='recent'?'':'<select id="sort" aria-label="Сортування">'+
      Object.entries(sortLabels).map(([key,title])=>option(key,title,state.prefs.sort)).join('')+'</select>')+
      btn('Фільтри','filters','secondary','filter','aria-expanded="'+filters.open+'"')+
      '<div class="group" role="group" aria-label="Відображення">'+
      ib('Картки','grid','grid','aria-pressed="'+(state.prefs.view==='grid')+'"')+
      ib('Список','list','list','aria-pressed="'+(state.prefs.view==='list')+'"')+'</div></div></div>'+
      '<div id="filter-fields" class="filters" '+(filters.open?'':'hidden')+'></div>';
  }

  function filterFields() {
    const container = $('#filter-fields');
    if (!container || !filters.open) return;
    const names = [...new Set(prompts.flatMap(row => row.data.tags))].sort(collator.compare);
    container.innerHTML = '<select id="filter-folder" aria-label="Папка">'+option('','Усі папки',filters.folder)+
      option('~','Без папки',filters.folder)+[...folders.values()].sort(sortNames).map(row => option(row.id,folderPath(row.id),filters.folder)).join('')+
      '</select><select id="filter-tag" aria-label="Тег">'+option('','Усі теги',filters.tag)+
      names.map(tag => option(tag,tag,filters.tag)).join('')+'</select>'+
      '<label class="check"><input id="filter-fav" type="checkbox" '+(filters.favorite?'checked':'')+'> Лише обране</label>'+
      btn('Скинути','reset','ghost');
  }

  function getResults() {
    const terms = V.regexFor(query), tests = terms.map(term => new RegExp(term,'iu'));
    const result = (route==='trash'?prompts.filter(row => row.data.deleted):live).filter(row => {
      const d = row.data, group = effectiveFolder(d);
      if (route==='folder' && group!==folderId || route==='favorites' && !d.favorite ||
          filters.favorite && !d.favorite || filters.folder && filters.folder!==(group || '~') ||
          filters.tag && !d.tags.includes(filters.tag)) return false;
      if (!tests.length) return true;
      const path = folderPath(group);
      let previous = cache.get(row.id);
      if (!previous || previous.updated!==d.updated || previous.path!==path || previous.data!==d && !V.equal(previous.data,d)) {
        previous = { updated:d.updated,path,data:d,text:[d.title,d.body,path,...d.tags].join('\n') };
        cache.set(row.id,previous);
      }
      return tests.every(test => test.test(previous.text));
    });
    const order = route==='recent'?'updated':state.prefs.sort;
    result.sort((a,b) => order==='title'?sortNames(a,b):(b.data[order]||'').localeCompare(a.data[order]||'')||sortNames(a,b));
    return { result, expression:terms.length?new RegExp(terms.join('|'),'giu'):null };
  }

  function preview(text,expression) {
    if (!text) return 'Текст ще не додано.';
    if (!expression) return text.slice(0,220)+(text.length>220?'…':'');
    expression.lastIndex = 0;
    const match = expression.exec(text);
    const offset = Math.max(0,(match?.index || 0)-38);
    const length = Math.max(210,(match?.[0].length || 0)+50);
    return (offset?'…':'')+text.slice(offset,offset+length)+(text.length>offset+length?'…':'');
  }

  function paintMatches(node,text,expression) {
    if (!expression) { node.textContent=text; return; }
    expression.lastIndex=0;
    const fragment=document.createDocumentFragment();
    let offset=0;
    for (const match of text.matchAll(expression)) {
      fragment.append(text.slice(offset,match.index));
      const mark=document.createElement('mark');
      mark.textContent=match[0];
      fragment.append(mark);
      offset=match.index+match[0].length;
    }
    fragment.append(text.slice(offset));
    node.replaceChildren(fragment);
  }

  function card(row,expression) {
    const { id,data,conflict } = row;
    const folder = folders.get(effectiveFolder(data));
    const label = folder ? folderPath(folder.id) : 'Без папки';
    const tags = expression ? [...data.tags].sort((a,b) => {
      function matches(tag) { expression.lastIndex=0; return Number(expression.test(tag)); }
      return matches(b)-matches(a);
    }) : data.tags;
    return '<article class="card"><div class="card-top"><div class="card-type" '+(folder?folderStyle(folder.data):'')+'>'+
      I(conflict?'merge':folder?'folder':'file')+'<span>'+V.highlight(conflict?'Конфлікт версій':label,expression)+'</span></div>'+
      '<div class="card-actions">'+
      (data.deleted?ib('Відновити','restore','restore',dataId(id)):
        ib(data.favorite?'Вилучити з обраного':'Додати до обраного','favorite','star',dataId(id)+' aria-pressed="'+data.favorite+'"')+
        ib('Копіювати промпт','copy','copy',dataId(id)))+
      ib('Дії з промптом','prompt-menu','more',dataId(id))+'</div></div>'+
      '<h3><button type="button" class="card-open" data-action="open" '+dataId(id)+'></button></h3>'+
      '<p class="card-summary"></p><div class="card-foot">'+
      tags.slice(0,2).map(tag=>'<span class="tag">'+V.highlight(tag,expression)+'</span>').join('')+
      '<time datetime="'+E(data.updated)+'" title="'+E(V.time.format(new Date(data.updated)))+'">'+V.date.format(new Date(data.updated))+'</time></div></article>';
  }

  function drawResults() {
    const target = $('#results');
    if (!target) return;
    const { result,expression } = getResults();
    $('#result-count').textContent = result.length;
    if (result.length) {
      const visible=result.slice(0,limit);
      target.innerHTML = '<div class="cards '+(state.prefs.view==='list'?'list':'')+'">'+visible.map(row=>card(row,expression)).join('')+'</div>'+
        (result.length>limit?'<div class="more-wrap">'+btn('Показати ще · '+(result.length-limit),'show-more')+'</div>':'');
      const cards=$('.cards',target).children;
      visible.forEach(({data},index)=>{
        paintMatches($('.card-open',cards[index]),briefTitle(data),expression);
        paintMatches($('.card-summary',cards[index]),preview(data.body,expression),expression);
      });
    } else if (query.trim() || filters.folder || filters.tag || filters.favorite || route==='search') {
      target.innerHTML = empty('search',query.trim()||filters.folder||filters.tag||filters.favorite?'Нічого не знайдено':'Знайдіть промпт',
        'Пошук охоплює назви, текст, папки й теги.',query||filters.folder||filters.tag||filters.favorite?btn('Очистити пошук','reset','ghost'):'');
    } else if (route==='favorites') target.innerHTML = empty('star','Тут буде обране','Позначте промпт зірочкою, щоб знайти його тут.');
    else if (route==='trash') target.innerHTML = counts.trash && prompts.every(row=>!row.data.deleted)
      ? empty('file','Видалених промптів немає','Видалені папки наведено вище.')
      : empty('trash','Кошик порожній','Видалені записи можна відновити з цього розділу.');
    else target.innerHTML = empty('vault',route==='all'?'Тут починається ваша бібліотека':'Промптів поки немає',
      'Створіть промпт, щоб зберегти його для наступної задачі.',
      btn('Створити промпт','new-prompt','secondary','plus')+
      (!state.prefs.welcomed && route==='all'?btn('Додати приклади','examples','ghost'):''));
  }

  function drawLibrary() {
    const folder = currentFolder();
    if (route==='folders') {
      main.innerHTML = pageHead('Папки','Організовуйте промпти за темами й робочими процесами.',btn('Нова папка','new-folder','primary','plus'))+
        (folderCards(null) || empty('folder','Папок поки немає','Створіть папку для пов’язаних промптів.',btn('Створити папку','new-folder','secondary','plus')));
      return;
    }
    const header = route==='all'?pageHead('Бібліотека')+'<section id="overview" class="overview" aria-label="Огляд бібліотеки"></section>':
      route==='folder'?folderBreadcrumb(folderId)+pageHead(briefTitle(folder.data),'',
      ib('Дії з папкою','folder-menu','more',dataId(folderId))+btn('Підпапка','new-folder','secondary','plus')):
      pageHead(routes[route].title,{
        favorites:'Промпти, до яких ви повертаєтеся найчастіше.',recent:'Промпти в порядку останньої зміни.',
        trash:'Відновіть записи або видаліть їх із бібліотеки.',search:'Знайдіть потрібний промпт у всій бібліотеці.'
      }[route],route==='trash' && counts.trash?btn('Очистити','empty-trash','danger','trash'):'');
    const label = route==='all'?'Усі промпти':route==='search'?'Результати':route==='folder'?'Промпти в папці':'Промпти';
    main.innerHTML = header + (folder?'<div id="child-folders">'+folderCards(folderId)+'</div>':'')+
      (route==='trash'?'<div id="trash-folders">'+trashFolders()+'</div>':'')+
      '<section class="library" aria-labelledby="results-label"><div class="section-head"><div class="head-title"><h2 id="results-label">'+
      E(label)+'</h2><span class="count" id="result-count">0</span></div></div>'+toolbar()+'<div id="results"></div></section>';
    drawOverview();
    filterFields();
    drawResults();
  }

  function navigate(focus=false) {
    const hash = location.hash.slice(1).split('/');
    const old = route;
    route = hash[0]==='folder' && folders.has(hash[1])?'folder':Object.hasOwn(routes,hash[0])?hash[0]:'all';
    folderId = route==='folder'?hash[1]:null;
    query = '';
    Object.assign(filters,{ open:false,folder:'',tag:'',favorite:false });
    limit = 24;
    drawPage();
    window.scrollTo(0,0);
    if (route==='search') $('#inline-query')?.focus();
    else if (focus && old!==route) main.focus({preventScroll:true});
  }

  function drawPage() {
    navigation();
    if (route==='settings') drawSettings();
    else if (route==='conflicts') drawConflicts();
    else drawLibrary();
    statusUI();
  }

  async function refresh(type) {
    const sequence = ++refreshSeq;
    const next = await S.snapshot();
    if (sequence!==refreshSeq) return;
    const last = state;
    state = next;
    rebuild();
    Cloud.configure(next.prefs);
    document.documentElement.dataset.motion = next.prefs.motion;
    document.documentElement.dataset.effects = next.prefs.effects;
    if (!last || !initialized || route==='folder' && !currentFolder()) {
      initialized = true;
      navigate();
    } else {
      navigation();
      if (route==='all') drawOverview();
      if (route==='conflicts') drawConflicts();
      if (route==='folders') drawLibrary();
      if (route==='folder' && $('#child-folders')) $('#child-folders').innerHTML = folderCards(folderId);
      if (route==='trash' && $('#trash-folders')) {
        $('#trash-folders').innerHTML = trashFolders();
        const emptyButton = $('[data-action=empty-trash]');
        if (emptyButton) emptyButton.hidden = !counts.trash;
        else if (counts.trash) $('.page-head').insertAdjacentHTML('beforeend',
          '<div class="actions">'+btn('Очистити','empty-trash','danger','trash')+'</div>');
      }
      if ($('#results')) {
        drawResults();
        if (type==='prefs') {
          if ($('#sort')) $('#sort').value = state.prefs.sort;
          for (const name of ['grid','list']) $('[data-action="'+name+'"]').setAttribute('aria-pressed',String(state.prefs.view===name));
        }
      }
      if (editor.open) refreshEditor();
      statusUI();
    }
  }

  function queueRefresh(type) {
    if (type==='data') Cloud.schedule(5000);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(type).catch(error=>say(problem(error))),type==='data'?170:30);
  }

  function dismiss(dialog) {
    if (!dialog.open) return Promise.resolve();
    const closed = new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
    if (dialog.classList.contains('closing')) return closed;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || state?.prefs.motion==='low' || dialog===menu) {
      dialog.close();
      return closed;
    }
    dialog.classList.add('closing');
    setTimeout(() => { dialog.close(); dialog.classList.remove('closing'); },145);
    return closed;
  }

  function dialogContent(title,body,onSubmit,actions) {
    modalSubmit = onSubmit;
    modal.innerHTML = '<form class="modal-inner" id="modal-form"><div class="dialog-head"><h2 id="modal-label">'+E(title)+'</h2>'+
      ib('Закрити','close-modal','close')+'</div>'+body+
      '<p class="problem" id="modal-error" role="alert"></p><div class="actions">'+actions+'</div></form>';
    if (!modal.open) modal.showModal();
    const focus = $('[autofocus]',modal);
    focus?.focus();
  }

  const cancelButton = () => btn('Скасувати','close-modal','ghost');
  const submitButton = (label,kind='primary',value='ok') => '<button class="'+kind+'" type="submit" value="'+value+'">'+E(label)+'</button>';

  function ask(title,description,action,label='Видалити') {
    dialogContent(title,'<p class="dialog-copy">'+E(description)+'</p>',action,cancelButton()+submitButton(label,'danger'));
  }

  function find(kind,id) {
    return state.rows.find(row => row.kind===kind && row.id===id);
  }

  async function modify(kind,id,patch) {
    return S.mutate([{kind,id,patch}]);
  }

  async function newPrompt(source) {
    const id = V.uid();
    const now = new Date().toISOString();
    const patch = source ? { ...source,title:briefTitle(source).slice(0,160)+' · копія',created:now,updated:now,deleted:null } :
      V.fresh('prompt',{ folderId:currentFolder()?.id || null });
    const [row] = await S.mutate([{ kind:'prompt',id,patch,create:true }]);
    openEditor(row,!source);
    if (source) say('Копію створено.');
  }

  function resizeEditor() {
    if (editor.open) editor.style.setProperty('--editor-height',Math.round(window.visualViewport?.height || innerHeight)+'px');
  }

  function openEditor(row,focusTitle = false) {
    if (!row?.data || row.data.purged) return;
    const d = row.data, readOnly = d.deleted ? ' disabled' : '';
    editorRow = row;
    dirtyFields = new Map();
    draftError = '';
    savedBody = d.body;
    editor.innerHTML = '<div class="editor-head"><div class="actions">'+ib('Закрити редактор','close-editor','back')+
      '<strong id="editor-label">'+(d.deleted?'Промпт у кошику':'Редактор промпту')+'</strong></div>'+
      '<div class="actions">'+btn('Копіювати','copy','secondary','copy',dataId(row.id))+
      ib('Дії з промптом','prompt-menu','more',dataId(row.id))+'</div></div>'+
      '<div class="editor-content"><label class="field">Назва<input id="edit-title" class="title-input" maxlength="180" autocomplete="off" placeholder="Без назви"'+readOnly+'></label>'+
      '<div class="editor-fields"><label class="field">Папка<select id="edit-folder"'+readOnly+'>'+folderOptions(effectiveFolder(d))+'</select></label>'+
      '<label class="field">Теги<input id="edit-tags" maxlength="1000" autocomplete="off" placeholder="Розділяйте комами"'+readOnly+'></label></div>'+
      '<div id="editor-conflict"></div><label class="field body-field">Текст промпту<textarea id="edit-body" maxlength="'+V.MAX_BODY+
      '" spellcheck="false" placeholder="Напишіть або вставте промпт…"'+readOnly+'></textarea></label></div>'+
      '<div class="editor-foot"><span id="editor-status" aria-live="polite"></span><span id="body-count"></span>'+
      btn('Зберегти','save-draft','ghost','check')+'</div>';
    $('#edit-title').value = d.title;
    $('#edit-tags').value = d.tags.join(', ');
    $('#edit-body').value = d.body;
    $('#body-count').textContent = d.body.length.toLocaleString('uk-UA')+' симв.';
    if (!editor.open) editor.showModal();
    resizeEditor();
    refreshEditor();
    if (focusTitle) $('#edit-title').focus();
    else $('[data-action=close-editor]',editor).focus();
  }

  function refreshEditor() {
    const row = find('prompt',editorRow.id);
    if (!row || row.data.purged) return;
    editorRow = row;
    const d = row.data;
    const title = $('#edit-title'), tags = $('#edit-tags'), body = $('#edit-body'), folder = $('#edit-folder');
    if ([title,tags,body,folder].some(input => input.disabled!==Boolean(d.deleted)) && !pendingWrites && !dirtyFields.size) {
      openEditor(row);
      return;
    }
    if (document.activeElement!==title && !dirtyFields.has('title')) title.value = d.title;
    if (document.activeElement!==tags && !dirtyFields.has('tags')) tags.value = d.tags.join(', ');
    if (document.activeElement!==body && !dirtyFields.has('body')) {
      savedBody = d.body;
      if (body.value !== d.body.replace(/\r\n?/g,'\n')) body.value = d.body;
      $('#body-count').textContent = d.body.length.toLocaleString('uk-UA')+' симв.';
    }
    if (document.activeElement!==folder && !dirtyFields.has('folderId')) folder.innerHTML = folderOptions(effectiveFolder(d));
    const conflict = $('#editor-conflict');
    if (row.conflict && !conflict.firstChild) {
      conflict.innerHTML = '<div class="conflict-box"><span>Збережено дві версії.</span>'+
        btn('Порівняти','resolve','secondary','merge',dataId(row.id)+' data-kind="prompt"')+'</div>';
    } else if (!row.conflict) conflict.replaceChildren();
  }

  function draft(field,value) {
    if (!editorRow || editorRow.data.deleted) return;
    dirtyFields.set(field,value);
    const id = editorRow.id;
    pendingWrites++;
    statusUI();
    draftTasks = draftTasks.then(async () => {
      try {
        await modify('prompt',id,{[field]:value});
        if (dirtyFields.get(field)===value) dirtyFields.delete(field);
        if (!dirtyFields.size) draftError = '';
      } catch (error) { draftError = problem(error); }
      finally { pendingWrites--; statusUI(); }
    });
  }

  async function flushDraft() {
    await draftTasks;
    if (draftError && dirtyFields.size) {
      const changes = Object.fromEntries(dirtyFields);
      try {
        await modify('prompt',editorRow.id,changes);
        dirtyFields.clear();
        draftError='';
      } catch (error) {
        draftError=problem(error);
        statusUI();
        throw error;
      }
    }
    statusUI();
  }

  async function closeEditor() {
    await flushDraft();
    await dismiss(editor);
    if (document.activeElement===document.body) main.focus({preventScroll:true});
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(value); return; } catch {}
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.readOnly = true;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    const parent = modal.open?modal:editor.open?editor:document.body;
    const focused = document.activeElement;
    parent.append(input);
    input.select();
    const success = document.execCommand('copy');
    input.remove();
    focused?.focus();
    if (!success) throw new Error('Браузер заблокував доступ до буфера обміну. Виділіть і скопіюйте текст у редакторі.');
  }

  async function copyPrompt(id,button) {
    const row = find('prompt',id);
    const editing = editor.open && editorRow.id===id;
    if (!editing && !row) return;
    await copyText(editing ? savedBody : row.data.body);
    if (button.isConnected) {
      const previous = button.innerHTML;
      button.innerHTML = I('check')+(button.classList.contains('icon-button')?'':'Скопійовано');
      button.classList.add('inline-feedback');
      setTimeout(() => { button.innerHTML=previous; button.classList.remove('inline-feedback'); },950);
    }
    say('Промпт скопійовано.');
  }

  function showMenu(button,items) {
    if (menu.open) menu.close();
    menu.innerHTML = '<div class="context-list">'+items.filter(Boolean).map(item =>
      '<button class="menu-item" type="button" '+(item.danger?'data-danger="true" ':'')+'data-action="'+item.action+'" '+
      (item.id?dataId(item.id):'')+'>'+I(item.icon)+E(item.label)+'</button>').join('')+'</div>';
    const box = button.getBoundingClientRect();
    menu.style.top = Math.max(7,Math.min(box.bottom+4,innerHeight-36*items.filter(Boolean).length-23))+'px';
    menu.style.left = Math.max(7,Math.min(box.right-231,innerWidth-238))+'px';
    menu.showModal();
  }

  function promptMenu(id,button) {
    const row = find('prompt',id);
    if (!row) return;
    const item = (label,action,icon,danger=false) => ({label,action,icon,id,danger});
    showMenu(button,row.data.deleted?[
      item('Відновити','restore','restore'),item('Видалити назавжди','purge','trash',true)
    ]:[
      item('Перейменувати','rename','edit'),item('Перемістити','move','move'),item('Дублювати','duplicate','copy'),
      item(row.data.favorite?'Вилучити з обраного':'Додати до обраного','favorite','star'),
      item('Перемістити в кошик','delete-prompt','trash',true)
    ]);
  }

  function folderMenu(id,button) {
    if (!folders.has(id)) return;
    showMenu(button,[{label:'Редагувати папку',action:'edit-folder',icon:'edit',id},
      {label:'Видалити папку',action:'delete-folder',icon:'trash',id,danger:true}]);
  }

  function folderDialog(id) {
    const row = folders.get(id), d = row?.data;
    dialogContent(row?'Редагувати папку':'Нова папка',
      '<label class="field">Назва<input name="title" maxlength="180" value="'+E(d?.title)+'" required autofocus></label>'+
      '<label class="field">У папці<select name="parent">'+folderOptions(d?parentOf(row):currentFolder()?.id,row?.id,'Бібліотека')+'</select></label>'+
      '<div class="editor-fields"><label class="field">Колір<select name="color">'+
      Object.entries(colorLabels).map(([key,label])=>option(key,label,d?.color || 'amber')).join('')+
      '</select></label><label class="field">Іконка<select name="icon">'+
      Object.entries(folderIcons).map(([key,label])=>option(key,label,d?.icon || 'folder')).join('')+'</select></label></div>',
      async form => {
        const title = form.get('title').trim(), parentId = form.get('parent') || null;
        if (!title) throw new Error('Введіть назву папки.');
        if (parentId && !folders.has(parentId)) throw new Error('Батьківська папка вже недоступна.');
        let parent = parentId;
        while (parent) {
          if (parent===id) throw new Error('Папка не може містити саму себе.');
          parent = parentOf(folders.get(parent));
        }
        const nextId = id || V.uid();
        await S.mutate([{kind:'folder',id:nextId,create:!row,patch:{ title,parentId,color:form.get('color'),icon:form.get('icon') }}]);
        if (!row) { await refresh('data'); location.hash = 'folder/'+nextId; }
        say(row?'Папку оновлено.':'Папку створено.');
      },cancelButton()+submitButton(row?'Зберегти':'Створити'));
  }

  function deleteFolder(id) {
    const folder = folders.get(id);
    if (!folder) return;
    dialogContent('Видалити папку?',
      '<p class="dialog-copy">Папка «'+E(briefTitle(folder.data))+'» переміститься в кошик. Її підпапки залишаться в батьківському розділі.</p>'+
      '<label class="field">Промпти безпосередньо в папці<select name="handling"><option value="keep">Перемістити в загальну бібліотеку</option>'+
      '<option value="trash">Перемістити разом із папкою в кошик</option></select></label>',
      async form => {
        const now = new Date().toISOString(), toTrash = form.get('handling')==='trash';
        const changes = [{ kind:'folder',id,patch:{deleted:now} }];
        for (const child of folders.values()) {
          if (child.data.parentId===id) changes.push({kind:'folder',id:child.id,patch:{parentId:parentOf(folder)}});
        }
        for (const row of live) {
          if (row.data.folderId===id) changes.push({kind:'prompt',id:row.id,patch:toTrash?{deleted:now}:{folderId:null}});
        }
        await S.mutate(changes);
        if (folderId===id) location.hash='folders';
        say('Папку переміщено в кошик.');
      },cancelButton()+submitButton('Видалити','danger'));
  }

  function promptField(id,field) {
    const row = find('prompt',id);
    if (!row) return;
    const rename = field==='title';
    dialogContent(rename?'Перейменувати промпт':'Перемістити промпт',rename?
      '<label class="field">Назва<input name="value" maxlength="180" value="'+E(row.data.title)+'" autofocus></label>':
      '<label class="field">Папка<select name="value" autofocus>'+folderOptions(effectiveFolder(row.data))+'</select></label>',
    async form => {
      await flushDraft();
      await modify('prompt',id,{[field]:rename?form.get('value'):form.get('value') || null});
      say(rename?'Назву оновлено.':'Промпт переміщено.');
    },cancelButton()+submitButton(rename?'Зберегти':'Перемістити'));
  }

  function drawConflicts() {
    const rows = state.rows.filter(row => row.conflict);
    main.innerHTML = pageHead('Конфлікти','Порівняйте локальні й серверні зміни та виберіть, що зберегти.')+
      (rows.length?'<div class="folder-grid">'+rows.map(row=>'<article class="folder-card"><span class="folder-icon">'+I('merge')+
        '</span><span><strong>'+E(briefTitle(row.data.purged?row.remote:row.data))+'</strong><small>'+
        (row.kind==='prompt'?'Промпт':'Папка')+'</small></span>'+ib('Порівняти версії','resolve','chev',dataId(row.id)+' data-kind="'+row.kind+'"')+'</article>').join('')+
      '</div>':empty('check','Усі конфлікти вирішено','Нові конфлікти з’являться тут.'));
  }

  function compareConflict(kind,id) {
    const row = find(kind,id);
    if (!row?.conflict) return;
    const local = row.data, remote = row.remote;
    const present = data => !data?'Запис відсутній':data.purged?'Видалено назавжди':
      briefTitle(data)+(data.deleted?' · у кошику':'')+(kind==='prompt'?
      '\n\n'+data.body+'\n\nТеги: '+data.tags.join(', ')+'\nПапка: '+(folderPath(data.folderId)||'Без папки')+(data.favorite?'\nВ обраному':''):
      '\n\nБатьківська папка: '+(folderPath(data.parentId)||'Бібліотека')+'\nКолір: '+colorLabels[data.color]+'\nІконка: '+folderIcons[data.icon]);
    const manual = kind==='prompt' && !local.purged;
    const preserveBoth = Boolean(remote && !local.purged);
    dialogContent('Конфлікт версій',
      '<p class="dialog-copy">Цей запис змінено на двох пристроях. Виберіть версію або збережіть обидві.</p>'+
      '<div class="compare"><div><strong>На пристрої</strong><pre id="local-version"></pre></div>'+
      '<div><strong>У Google Sheets</strong><pre id="server-version"></pre></div></div>'+
      (manual?'<details><summary>Об’єднати текст вручну</summary><label class="field">Об’єднаний текст<textarea rows="6" name="merged" maxlength="'+V.MAX_BODY+'"></textarea></label>'+
        submitButton('Зберегти об’єднаний','secondary','merged')+'</details>':''),
      async (form,choice) => {
        await flushDraft();
        await S.resolve(kind,id,choice,row.rev,choice==='merged'?V.restoreLineEndings(local.body,form.get('merged')):undefined);
        say('Конфлікт вирішено.');
      },cancelButton()+submitButton('Серверна','secondary','remote')+submitButton('Локальна','secondary','local')+
      (preserveBoth?submitButton('Зберегти обидві','primary','both'):''));
    $('#local-version',modal).textContent=present(local);
    $('#server-version',modal).textContent=present(remote);
    if (manual) $('textarea[name=merged]',modal).value=local.body;
  }

  function drawSettings() {
    const p = state.prefs;
    main.innerHTML = pageHead('Налаштування','Керуйте підключенням, виглядом і резервними копіями.')+
      '<div class="settings"><section class="setting-card cloud"><h2>Хмарна синхронізація</h2>'+
      '<p>Вставте URL вебзастосунку й ключ, який покаже меню Prompt Vault у таблиці Google.</p>'+
      '<label class="field">URL вебзастосунку<input id="endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>'+
      '<label class="field">Персональний ключ<input id="access-key" type="password" maxlength="128" autocomplete="off" spellcheck="false"></label>'+
      '<label class="check"><input id="remember" type="checkbox" '+(p.key?'checked':'')+'> Запам’ятати ключ на цьому пристрої</label>'+
      '<p class="helper">Запам’ятований ключ доступний цьому сайту в браузері. На спільному пристрої залиште цей параметр вимкненим.</p>'+
      '<div class="actions">'+btn('Перевірити','test-connection','secondary','link')+
      btn('Підключити','save-connection','primary','cloud')+btn('Синхронізувати зараз','sync-now','secondary','restore')+'</div>'+
      '<div id="setting-status" class="setting-status" aria-live="polite"></div><p id="connection-error" class="problem" role="status"></p>'+
      '<label class="field">Оновлення з Google<select id="poll">'+[10,20,30,60,120].map(n=>option(n,n+' с',p.poll)).join('')+'</select></label>'+
      '<div class="actions">'+btn('Інструкція','onboard','ghost','file')+
      btn('Копіювати ключ','copy-key','ghost','copy')+(p.endpoint?btn('Відключити','disconnect','ghost','close'):'')+'</div></section>'+
      '<section class="setting-card"><h2>Інтерфейс</h2><p>Параметри вигляду зберігаються на пристрої.</p>'+
      '<label class="field">Вигляд промптів<select id="view-pref">'+option('grid','Картки',p.view)+option('list','Список',p.view)+'</select></label>'+
      '<label class="field">Анімації<select id="motion">'+option('normal','Системні налаштування',p.motion)+option('low','Мінімальні',p.motion)+'</select></label>'+
      '<label class="field">Скляні ефекти<select id="effects">'+option('normal','Повні',p.effects)+option('low','Спрощені',p.effects)+'</select></label></section>'+
      '<section class="setting-card"><h2>Резервні копії</h2><p>Переносьте бібліотеку у форматі JSON. Імпорт об’єднує записи й зберігає наявні версії.</p>'+
      '<input type="file" id="import-file" accept=".json,application/json" hidden><div class="actions">'+
      btn('Експорт','export','secondary','download')+btn('Імпорт','import','secondary','upload')+'</div></section>'+
      '<section class="setting-card"><h2>Локальні дані</h2><p>Очистіть локальну копію після синхронізації. Записи в Google Sheets залишаться доступними.</p>'+
      '<div class="actions">'+btn('Очистити кеш','clear-cache','secondary','trash')+
      '<a class="secondary" href="#recent">'+I('clock')+' Нещодавні</a>'+
      '<a class="secondary" href="#trash">'+I('trash')+' Кошик</a>'+
      '<a class="secondary" href="#conflicts" id="settings-conflict-link" '+(counts.conflicts?'':'hidden')+'>'+I('merge')+' Конфлікти</a>'+
      '</div></section></div>';
    $('#endpoint').value = p.endpoint;
    $('#access-key').value = Cloud.credentials().key;
  }

  function onboarding() {
    dialogContent('Підключіть Prompt Vault',
      '<p class="dialog-copy">Бібліотека працює на цьому пристрої відразу. Підключіть Google Sheets, коли будете готові синхронізувати промпти.</p>'+
      '<ol class="setup-steps"><li>Вставте Code.gs у Apps Script приватної таблиці.</li>'+
      '<li>У таблиці відкрийте Prompt Vault → Налаштувати підключення, вставте адресу цього сайту й скопіюйте ключ.</li>'+
      '<li>Розгорніть Apps Script як вебзастосунок і вставте його адресу <code>/exec</code> разом із ключем у налаштування.</li></ol>',
      null,btn('Закрити','close-modal','ghost')+
      '<a href="README.md" target="_blank" rel="noopener" class="secondary">'+I('file')+' Інструкція</a>'+
      btn('Налаштувати','go-settings','primary','cloud'));
  }

  function connectionError(message) {
    const node = $('#connection-error');
    if (node) {
      node.textContent = message;
      if (message) node.dataset.local = 'true';
      else delete node.dataset.local;
    }
  }

  async function connection(save,button) {
    const endpoint = $('#endpoint').value.trim(), key = $('#access-key').value.trim(), remember = $('#remember').checked;
    if (!Cloud.validEndpoint(endpoint)) throw new Error('Введіть адресу розгорнутого Apps Script, що закінчується на /exec.');
    connectionError('');
    button.disabled = true;
    try {
      const info = await Cloud.test(endpoint,key);
      const current = await S.snapshot();
      if (current.cloud.id && current.cloud.id!==info.archiveId) {
        throw new Error('Цей URL веде до іншого архіву. Для окремого архіву використайте інший профіль браузера.');
      }
      if (!save) { say('Ключ прийнято. Серверна ревізія '+info.revision+'.'); return; }
      Cloud.useSessionKey(remember?'':key);
      await S.setPrefs({ endpoint,key:remember?key:'' });
      await refresh('prefs');
      Cloud.schedule(100);
      say('Хмару підключено.');
      if (route==='settings') drawSettings();
      statusUI();
    } catch (error) { connectionError(problem(error)); }
    finally { button.disabled = false; }
  }

  async function syncNow(button) {
    button.disabled = true;
    connectionError('');
    try { await flushDraft(); await Cloud.run(true); await refresh('sync'); say(statusLabels[syncState()]); }
    catch(error) { connectionError(problem(error)); }
    finally { button.disabled = false; }
  }

  async function exportData() {
    const snapshot = await S.snapshot();
    const nodes = snapshot.rows.filter(row => !row.data.purged).map(row=>({id:row.id,kind:row.kind,data:row.data}));
    for (const row of snapshot.rows) {
      if (!row.conflict || !row.remote || row.remote.purged) continue;
      const title = briefTitle(row.remote).slice(0,155)+' · серверна копія';
      nodes.push({id:V.uid(),kind:row.kind,data:{...row.remote,title}});
    }
    const payload = { format:'prompt-vault',version:1,exported:new Date().toISOString(),records:nodes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const a = document.createElement('a');
    a.href=url;
    a.download='prompt-vault-'+payload.exported.slice(0,10)+'.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    say('Резервну копію підготовлено.');
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size>60*1024*1024) throw new Error('Файл перевищує 60 МБ.');
    let payload;
    try { payload=JSON.parse(await file.text()); }
    catch { throw new Error('Файл має містити коректний JSON.'); }
    if (payload?.format!=='prompt-vault' || payload.version!==1 || !Array.isArray(payload.records) || payload.records.length>10000) {
      throw new Error('Потрібна резервна копія Prompt Vault версії 1 із не більш ніж 10 000 записів.');
    }
    const seen = new Set();
    const records = payload.records.map(record => {
      if (!record || !['folder','prompt'].includes(record.kind) || typeof record.id!=='string' || !V.ids.test(record.id) ||
          !V.validData(record.kind,record.data) || seen.has(record.kind+':'+record.id)) throw new Error('Файл містить пошкоджені або повторювані записи.');
      seen.add(record.kind+':'+record.id);
      return { kind:record.kind,id:record.id,patch:V.cleanData(record.kind,record.data),create:true,preserve:true };
    });
    dialogContent('Імпортувати резервну копію?',
      '<p class="dialog-copy">У файлі '+records.length+' записів. Однакові записи буде пропущено. Версії з однаковим ідентифікатором і різними даними буде додано як копії.</p>',
      async () => {
        const current = new Map((await S.snapshot()).rows.map(row => [row.key,row]));
        const mappedFolders = new Map(), folderEntries = records.filter(row=>row.kind==='folder');
        for (const entry of folderEntries) {
          const present = current.get('folder:'+entry.id);
          mappedFolders.set(entry.id,present && !V.equal(present.data,entry.patch)?V.uid():entry.id);
        }
        let changed;
        do {
          changed = false;
          for (const entry of folderEntries) {
            const parent = entry.patch.parentId;
            if (parent && mappedFolders.has(parent) && mappedFolders.get(parent)!==parent &&
                mappedFolders.get(entry.id)===entry.id && current.has('folder:'+entry.id)) {
              mappedFolders.set(entry.id,V.uid());
              changed = true;
            }
          }
        } while (changed);
        const changes = [];
        for (const entry of records) {
          const folder = entry.kind==='folder', reference = folder?'parentId':'folderId', parent = entry.patch[reference];
          const patch = { ...entry.patch,[reference]:mappedFolders.get(parent) || parent };
          const id = folder?mappedFolders.get(entry.id):entry.id;
          const present = current.get(entry.kind+':'+id);
          if (present && V.equal(present.data,patch)) continue;
          changes.push({ ...entry,id:present?V.uid():id,patch });
        }
        await S.mutate(changes);
        say('Додано записів: '+changes.length+'.');
      },cancelButton()+submitButton('Об’єднати','primary'));
  }

  async function examples() {
    const ids = [V.uid(),V.uid(),V.uid()];
    const foldersToAdd = [['Письмо','amber','file'],['Візуальні ідеї','violet','image'],['Розробка','blue','code']];
    const examplesToAdd = [
      ['Редактор ясного тексту','Перепиши текст нижче зрозумілою українською. Збережи факти, числа й намір автора.\n\n1. Визнач аудиторію.\n2. Прибери повтори та канцеляризми.\n3. Запропонуй коротший заголовок.\n\nТекст:\n{{текст}}',['редагування','мовні моделі']],
      ['Артдирекція для кампанії','Запропонуй три візуальні напрями для {{продукт}}.\n\nДля кожного опиши композицію, матеріали, світло, палітру й настрій. Заверши готовим промптом для генератора зображень.',['зображення','дизайн']],
      ['Огляд коду перед релізом','Переглянь зміни нижче. Для кожного зауваження вкажи місце, умову відтворення та наслідок.\n\nЗверни увагу на граничні випадки, обробку помилок і доступність.\n\nЗміни:\n{{зміни}}',['код','рев’ю']]
    ];
    const changes = foldersToAdd.map(([title,color,icon],index)=>({kind:'folder',id:ids[index],create:true,patch:V.fresh('folder',{title,color,icon})}));
    for (let index=0; index<examplesToAdd.length; index++) {
      const [title,body,tags] = examplesToAdd[index];
      changes.push({kind:'prompt',id:V.uid(),create:true,patch:V.fresh('prompt',{title,body,tags,folderId:ids[index],favorite:index===0})});
    }
    await S.mutate(changes);
    await S.setPrefs({welcomed:true});
    say('Додано три приклади.');
  }

  function trashFolders() {
    const rows = state.rows.filter(row=>row.kind==='folder' && row.data.deleted && !row.data.purged);
    if (!rows.length) return '';
    return '<h3 class="trash-heading">Папки</h3><div class="folder-grid">'+rows.map(({id,data})=>
      '<article class="folder-card"><span class="folder-icon" '+folderStyle(data)+'>'+I(data.icon)+'</span><span><strong>'+
      E(briefTitle(data))+'</strong><small>У кошику</small></span><div class="actions">'+
      ib('Відновити папку','restore-folder','restore',dataId(id))+
      ib('Видалити папку назавжди','purge-folder','trash',dataId(id))+'</div></article>').join('')+'</div>';
  }

  function destructive(kind,id,purge=false) {
    const row = find(kind,id);
    if (!row || row.data.purged) return;
    const name = briefTitle(row.data);
    if (purge) {
      ask('Видалити назавжди?','«'+name+'» зникне з бібліотеки та кошика. Google Sheets може зберігати попередні ревізії.',
        async () => {
          await flushDraft();
          await modify(kind,id,{purged:true,deleted:row.data.deleted || new Date().toISOString()});
          if (editor.open && editorRow.id===id) dismiss(editor);
          say('Запис видалено з бібліотеки.');
        });
    } else {
      ask('Перемістити в кошик?','«'+name+'» можна буде відновити з кошика.',
        async () => {
          await flushDraft();
          await modify(kind,id,{deleted:new Date().toISOString()});
          if (editor.open && editorRow.id===id) dismiss(editor);
          say('Промпт переміщено в кошик.');
        },'Перемістити');
    }
  }

  const handlers = {
    'new-prompt':async () => { await flushDraft(); await newPrompt(); },
    'new-folder':()=>folderDialog(),
    'edit-folder':(_,id)=>folderDialog(id),
    'delete-folder':(_,id)=>deleteFolder(id),
    'folder-menu':(button,id)=>folderMenu(id,button),
    'prompt-menu':(button,id)=>promptMenu(id,button),
    'open':(_,id)=>openEditor(find('prompt',id)),
    'copy':(button,id)=>copyPrompt(id,button),
    'favorite':async (_,id)=>{
      const row=find('prompt',id);
      if (row) {
        await modify('prompt',id,{favorite:!row.data.favorite});
        await refresh('data');
      }
    },
    'duplicate':async (_,id)=>{ await flushDraft(); await newPrompt((await S.snapshot()).rows.find(row=>row.kind==='prompt' && row.id===id)?.data); },
    'rename':(_,id)=>promptField(id,'title'),
    'move':(_,id)=>promptField(id,'folderId'),
    'delete-prompt':(_,id)=>destructive('prompt',id),
    'purge':(_,id)=>destructive('prompt',id,true),
    'purge-folder':(_,id)=>destructive('folder',id,true),
    'restore':async (_,id)=>{ await modify('prompt',id,{deleted:null}); say('Промпт відновлено.'); },
    'restore-folder':async (_,id)=>{ await modify('folder',id,{deleted:null}); say('Папку відновлено.'); },
    'empty-trash':()=>ask('Очистити кошик?','Видалені промпти й папки зникнуть із бібліотеки. Google Sheets може зберігати попередні ревізії.',async ()=>{
      await S.mutate(state.rows.filter(row=>row.data.deleted && !row.data.purged).map(row=>
        ({kind:row.kind,id:row.id,patch:{purged:true,deleted:row.data.deleted}})));
      say('Кошик очищено.');
    },'Очистити'),
    'save-draft':async ()=>{ await flushDraft(); say('Збережено локально.'); },
    'close-editor':()=>closeEditor(),
    'close-modal':()=>dismiss(modal),
    'search':()=>{ if (route==='search') $('#inline-query')?.focus(); else location.hash='search'; },
    'filters':button=>{
      filters.open=!filters.open;
      $('#filter-fields').hidden=!filters.open;
      button.setAttribute('aria-expanded',String(filters.open));
      filterFields();
    },
    'reset':()=>{
      query='';
      Object.assign(filters,{folder:'',tag:'',favorite:false});
      $('#inline-query').value='';
      filterFields();
      drawResults();
      $('#inline-query').focus();
    },
    'grid':()=>S.setPrefs({view:'grid'}),
    'list':()=>S.setPrefs({view:'list'}),
    'show-more':()=>{ limit+=24; drawResults(); },
    'onboard':()=>onboarding(),
    'go-settings':()=>{ dismiss(modal); location.hash='settings'; },
    'sync-settings':()=>{
      if (counts.conflicts) location.hash='conflicts';
      else if (!state.prefs.endpoint && route!=='settings') onboarding();
      else location.hash='settings';
    },
    'resolve':(button,id)=>compareConflict(button.dataset.kind,id),
    'examples':()=>examples(),
    'test-connection':button=>connection(false,button),
    'save-connection':button=>connection(true,button),
    'sync-now':button=>syncNow(button),
    'copy-key':async ()=>{
      const value=$('#access-key').value.trim();
      if (!value) throw new Error('Спершу вставте ключ із таблиці Google.');
      await copyText(value);
      say('Ключ скопійовано.');
    },
    'disconnect':()=>{
      dialogContent('Відключити синхронізацію?',
        '<p class="dialog-copy">Дані залишаться в браузері й у Google Sheets. Для підключення знадобляться адреса та ключ.</p>',
        async ()=>{
          await S.setPrefs({endpoint:'',key:''});
          Cloud.useSessionKey('');
          await refresh('prefs');
          drawSettings();
          statusUI();
          say('Хмару відключено.');
        },cancelButton()+submitButton('Відключити','danger'));
    },
    'clear-cache':()=>ask('Очистити локальну копію?','Застосунок перевірить підключення і завантажить записи з тієї ж таблиці. Незбережені зміни та конфлікти блокують очищення.',
      async ()=>{
        const config=Cloud.credentials();
        if (!config.endpoint || !config.key) throw new Error('Для очищення кешу підключіть хмару.');
        const info=await Cloud.test(config.endpoint,config.key);
        if (info.revision < state.cloud.cursor) throw new Error('Серверна ревізія старіша за локальну.');
        await S.clear(info.archiveId,info.revision);
        await refresh('clear');
        say('Локальну копію очищено. Завантажуємо дані Google.');
        Cloud.schedule(50);
      },'Очистити'),
    'export':()=>exportData(),
    'import':()=>$('#import-file').click(),
  };

  document.addEventListener('click', event => {
    if (event.target===menu) { menu.close(); return; }
    const button=event.target.closest('[data-action]');
    if (!button || !state) return;
    const task=handlers[button.dataset.action];
    if (!task) return;
    if (menu.contains(button)) menu.close();
    Promise.resolve().then(()=>task(button,button.dataset.id)).catch(error=>say(problem(error)));
  });

  document.addEventListener('submit',async event => {
    if (event.target.id!=='modal-form') return;
    event.preventDefault();
    if (!modalSubmit || event.target.dataset.busy) return;
    const form=event.target, controls=[...form.querySelectorAll('button')], submit=modalSubmit;
    form.dataset.busy='true';
    controls.forEach(control=>control.disabled=true);
    try {
      await submit(new FormData(form),event.submitter?.value || 'ok');
      dismiss(modal);
    } catch (error) {
      $('#modal-error').textContent=problem(error);
    } finally {
      controls.forEach(control=>control.disabled=false);
      delete form.dataset.busy;
    }
  });

  function saveBody(body) {
    savedBody=body;
    $('#body-count').textContent=body.length.toLocaleString('uk-UA')+' симв.';
    draft('body',body);
  }

  document.addEventListener('paste',event=>{
    const field=event.target;
    if (field.id!=='edit-body' || field.disabled || !event.clipboardData) return;
    const text=event.clipboardData.getData('text/plain');
    const start=V.rawOffset(savedBody,field.selectionStart), end=V.rawOffset(savedBody,field.selectionEnd);
    if (savedBody.length-(end-start)+text.length>V.MAX_BODY) {
      event.preventDefault();
      say('Вставлений текст перевищує ліміт промпту.');
      return;
    }
    if (!text || !(text.includes('\r') || savedBody.includes('\r') && text.includes('\n'))) return;
    event.preventDefault();
    field.setRangeText(text.replace(/\r\n?/g,'\n'),field.selectionStart,field.selectionEnd,'end');
    saveBody(savedBody.slice(0,start)+text+savedBody.slice(end));
  });

  document.addEventListener('input',event=>{
    const {id,value}=event.target;
    if (id==='edit-title') draft('title',value);
    if (id==='edit-tags') draft('tags',V.tags(value));
    if (id==='edit-body') saveBody(V.restoreLineEndings(savedBody,value));
    if (id==='inline-query') {
      query=value;
      limit=24;
      clearTimeout(findTimer);
      findTimer=setTimeout(drawResults,90);
    }
  });

  document.addEventListener('change',event=>{
    const {id,value,checked,files}=event.target;
    const setting={sort:'sort',poll:'poll','view-pref':'view',motion:'motion',effects:'effects'}[id];
    if (setting) S.setPrefs({[setting]:id==='poll'?Number(value):value}).catch(error=>say(problem(error)));
    if (id==='edit-folder') draft('folderId',value || null);
    if (id==='filter-folder') { filters.folder=value; limit=24; drawResults(); }
    if (id==='filter-tag') { filters.tag=value; limit=24; drawResults(); }
    if (id==='filter-fav') { filters.favorite=checked; limit=24; drawResults(); }
    if (id==='import-file') {
      const file=files[0];
      event.target.value='';
      importFile(file).catch(error=>say(problem(error)));
    }
  });

  document.addEventListener('keydown',event=>{
    if (!state || event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    const key=event.key.toLowerCase();
    if (key==='k') {
      event.preventDefault();
      if (menu.open) menu.close();
      const after=modal.open?dismiss(modal):Promise.resolve();
      after.then(()=>editor.open?closeEditor():undefined).then(()=>handlers.search()).catch(error=>say(problem(error)));
    }
    if (key==='s') {
      event.preventDefault();
      flushDraft().then(()=>say('Збережено локально.')).catch(error=>say(problem(error)));
    }
  });

  editor.addEventListener('cancel',event=>{ event.preventDefault(); closeEditor().catch(error=>say(problem(error))); });
  modal.addEventListener('cancel',event=>{ event.preventDefault(); if (!$('#modal-form')?.dataset.busy) dismiss(modal); });
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden && state && route==='all') drawOverview();
  });
  window.visualViewport?.addEventListener('resize',resizeEditor);
  window.addEventListener('hashchange',()=>{ if (state) navigate(true); });
  S.subscribe(queueRefresh);
  Cloud.onStatus(statusUI);

  async function start() {
    $('.plus-symbol').innerHTML=I('plus');
    await S.open();
    await refresh('init');
    if (location.protocol==='https:' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }
  start().catch(error=>{
    main.innerHTML=empty('cloud','Локальне сховище недоступне',problem(error),'<a class="secondary" href="./">Перезавантажити</a>');
  });
})();
