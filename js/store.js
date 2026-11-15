(() => {
  'use strict';
  const V = window.Vault;
  const dbName = 'prompt-vault:' + V.dbScope;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(dbName) : null;
  const subscribers = new Set();
  let database;
  const request = operation => new Promise((resolve,reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
  const key = (kind,id) => kind + ':' + id;

  if (channel) channel.onmessage = event => {
    if (['data','sync','prefs','clear'].includes(event.data)) for (const fn of subscribers) fn(event.data);
  };

  function notify(type) {
    channel?.postMessage(type);
    for (const fn of subscribers) fn(type);
  }

  async function open() {
    const operation = indexedDB.open(dbName,1);
    operation.onupgradeneeded = () => {
      const db = operation.result;
      const items = db.createObjectStore('items',{ keyPath:'key' });
      items.createIndex('queued','queued');
      db.createObjectStore('meta');
    };
    database = await request(operation);
    database.onversionchange = () => database.close();
  }

  async function transaction(mode, callback) {
    const dbtx = database.transaction(['items','meta'],mode);
    const complete = new Promise((resolve,reject) => {
      dbtx.oncomplete = resolve;
      dbtx.onabort = dbtx.onerror = () => reject(dbtx.error || new Error('Транзакцію перервано.'));
    });
    complete.catch(() => {});
    try {
      const result = await callback(dbtx.objectStore('items'), dbtx.objectStore('meta'));
      await complete;
      return result;
    } catch (error) {
      try { dbtx.abort(); } catch {}
      throw error;
    }
  }

  async function snapshot() {
    return transaction('readonly',async (items,meta) => {
      const [rows,prefs,cloud,dirtyAt] = await Promise.all([
        request(items.getAll()),request(meta.get('prefs')),request(meta.get('cloud')),request(meta.get('dirtyAt'))
      ]);
      return { rows,prefs:{ ...V.settings,...prefs },cloud:cloud || { id:null,cursor:0,at:0 },dirtyAt:dirtyAt || 0 };
    });
  }

  async function syncSnapshot() {
    return transaction('readonly',async (items,meta) => {
      const [cloud,dirtyAt,queued] = await Promise.all([
        request(meta.get('cloud')),request(meta.get('dirtyAt')),request(items.index('queued').count(1))
      ]);
      return { cloud:cloud || { id:null,cursor:0,at:0 },dirtyAt:dirtyAt || 0,queued };
    });
  }

  async function setPrefs(patch) {
    await transaction('readwrite',async (_,meta) => {
      const previous = await request(meta.get('prefs'));
      meta.put({ ...previous,...patch },'prefs');
    });
    notify('prefs');
  }

  function enqueue(row,data) {
    row.data = data;
    if (row.conflict) return;
    const operation = { opId:V.uid(),base:row.rev,data,sealed:false };
    if (row.head?.sealed) row.next = operation;
    else row.head = operation;
    row.queued = 1;
  }

  async function mutate(changes) {
    const result = await transaction('readwrite',async (items,meta) => {
      const now = new Date().toISOString();
      const changed = [];
      for (const change of changes) {
        const rowKey = key(change.kind,change.id);
        let row = await request(items.get(rowKey));
        if (change.create && row) throw new Error('Цей запис уже існує.');
        if (!row && !change.create) throw new Error('Запис уже недоступний.');
        if (row?.data.purged) throw new Error('Запис видалено.');
        row ||= { key:rowKey, id:change.id, kind:change.kind,rev:0,remote:null,conflict:false };
        const updated = change.preserve ? change.patch.updated : now;
        const patch = change.patch.purged ? { ...change.patch,updated } :
          { ...(row.data || V.fresh(change.kind)),...change.patch,updated };
        if (!V.validData(change.kind,patch,true)) throw new Error('Дані запису перевищують обмеження або мають неправильний формат.');
        const data = V.cleanData(change.kind,patch);
        if (V.equal(row.data,{ ...data,updated:row.data?.updated })) continue;
        enqueue(row,data);
        items.put(row);
        changed.push(row);
      }
      if (changed.length) meta.put(Date.now(),'dirtyAt');
      return changed;
    });
    if (result.length) notify('data');
    return result;
  }

  async function acquire(owner) {
    return transaction('readwrite',async (_,meta) => {
      const old = await request(meta.get('lease'));
      if (old && old.owner !== owner && old.until > Date.now()) return false;
      meta.put({ owner,until:Date.now()+55000 },'lease');
      return true;
    });
  }

  async function release(owner) {
    return transaction('readwrite',async (_,meta) => {
      if ((await request(meta.get('lease')))?.owner === owner) meta.delete('lease');
    });
  }

  async function checkOwner(meta,owner) {
    if ((await request(meta.get('lease')))?.owner !== owner) throw new Error('Синхронізацію продовжує інша вкладка.');
  }

  async function bind(owner,archiveId) {
    await transaction('readwrite',async (_,meta) => {
      await checkOwner(meta,owner);
      const old = await request(meta.get('cloud'));
      if (old && old.id !== archiveId) throw new Error('Архів цього пристрою вже підключено до іншої таблиці.');
      if (!old) meta.put({ id:archiveId,cursor:0,at:0 },'cloud');
    });
  }

  async function claim(owner,force) {
    return transaction('readwrite',async (items,meta) => {
      await checkOwner(meta,owner);
      if (!force && Date.now()-(await request(meta.get('dirtyAt')) || 0) < 5000) return [];
      const rows = await request(items.index('queued').getAll(1));
      const operations = [];
      let length = 0;
      for (const row of rows) {
        const head = row.head;
        if (!head || row.conflict) continue;
        const operation = { kind:row.kind,id:row.id,opId:head.opId,base:head.base,data:head.data };
        const size = JSON.stringify(operation).length;
        if (operations.length && length+size > 820000) break;
        length += size;
        operations.push(operation);
        if (!head.sealed) {
          head.sealed = true;
          items.put(row);
        }
        if (operations.length === 50) break;
      }
      return operations;
    });
  }

  function confirm(row,record) {
    row.rev = record.rev;
    row.remote = record.data;
    row.conflict = false;
    row.head = row.next ? { ...row.next,base:row.rev } : null;
    row.next = null;
    row.queued = row.head ? 1 : 0;
    if (!row.head) row.data = record.data;
  }

  function markConflict(row,record) {
    row.conflict = true;
    row.rev = record?.rev || 0;
    row.remote = record?.data || null;
    row.head = null;
    row.next = null;
    row.queued = 0;
  }

  async function accept(owner,results) {
    await transaction('readwrite',async (items,meta) => {
      await checkOwner(meta,owner);
      for (const result of results) {
        const row = await request(items.get(key(result.kind,result.id)));
        if (!row?.head || row.head.opId !== result.opId) continue;
        if (result.status === 'applied') confirm(row,result.record);
        else markConflict(row,result.record);
        items.put(row);
      }
    });
    notify('sync');
  }

  async function merge(owner,archiveId,page) {
    await transaction('readwrite',async (items,meta) => {
      await checkOwner(meta,owner);
      const cloud = (await request(meta.get('cloud'))) || { id:archiveId,cursor:0,at:0 };
      if (cloud.id !== archiveId || page.cursor < cloud.cursor) throw new Error('Ревізія архіву не відповідає локальній копії.');
      for (const event of page.events) {
        const rowKey = key(event.kind,event.id);
        const row = (await request(items.get(rowKey))) ||
          { key:rowKey,id:event.id,kind:event.kind,rev:0,conflict:false,queued:0,head:null,next:null };
        if (event.rev <= row.rev) continue;
        if (row.head?.opId === event.opId) confirm(row,event);
        else if (row.head || row.conflict) markConflict(row,event);
        else {
          row.rev = event.rev;
          row.data = event.data;
          row.remote = event.data;
        }
        items.put(row);
      }
      meta.put({ id:archiveId,cursor:page.cursor,at:page.more ? cloud.at : Date.now() },'cloud');
    });
    notify('sync');
  }

  async function resolve(kind,id,choice,version,manualBody) {
    await transaction('readwrite',async (items,meta) => {
      const row = await request(items.get(key(kind,id)));
      if (!row?.conflict || row.rev !== version) throw new Error('З’явилася нова версія. Відкрийте діалог ще раз.');
      const now = new Date().toISOString();
      if (choice === 'both' && row.remote && !row.data.purged) {
        const copyId = V.uid();
        const copy = { key:key(kind,copyId), id:copyId, kind,rev:0,remote:null,conflict:false };
        const title = (row.data.title || 'Без назви').slice(0,155) + ' · локальна копія';
        enqueue(copy,{ ...row.data,title,created:now,updated:now,deleted:null });
        items.put(copy);
      }
      row.conflict = false;
      if (choice === 'remote' || choice === 'both') {
        if (row.remote) items.put({ ...row,data:row.remote });
        else items.delete(row.key);
      } else {
        const data = { ...row.data,updated:now };
        if (manualBody !== undefined) data.body = manualBody;
        if (!V.validData(kind,data,true)) throw new Error('Об’єднаний запис перевищує обмеження.');
        enqueue(row,V.cleanData(kind,data));
        items.put(row);
      }
      meta.put(Date.now(),'dirtyAt');
    });
    notify('data');
  }

  async function clear(archiveId,serverRevision) {
    await transaction('readwrite',async (items,meta) => {
      const lease = await request(meta.get('lease'));
      if (lease?.until > Date.now()) throw new Error('Дочекайтеся завершення синхронізації.');
      const cloud = await request(meta.get('cloud'));
      const rows = await request(items.getAll());
      if (cloud?.id !== archiveId || cloud.cursor > serverRevision ||
          rows.some(row => row.head || row.conflict || row.rev === 0 || row.rev > serverRevision)) {
        throw new Error('Спочатку синхронізуйте всі локальні записи й вирішіть конфлікти.');
      }
      items.clear();
      meta.delete('dirtyAt');
      meta.put({ id:archiveId,cursor:0,at:0 },'cloud');
    });
    notify('clear');
  }

  V.store = { open,snapshot,syncSnapshot,mutate,setPrefs,acquire,release,bind,claim,accept,merge,resolve,clear,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } };
})();
