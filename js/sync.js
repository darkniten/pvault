(() => {
  'use strict';
  const V = window.Vault;
  const owner = V.uid();
  const googleOrigin = /^https:\/\/(?:script\.google\.com|(?:[a-z0-9-]+-)?script\.googleusercontent\.com)$/;
  const endpointPattern = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  let bridge, timer, polling, running = false, failures = 0, retryAt = 0;
  let prefs = V.settings, sessionKey = '', status = { phase:'idle',error:'' };
  let listener = () => {};

  function notify(phase,error = '') {
    status = { phase,error };
    listener(status);
  }

  function descendants(source,root) {
    try {
      for (let candidate=source, depth=0; candidate && depth<7; depth++) {
        if (candidate === root) return true;
        if (candidate.parent === candidate) break;
        candidate = candidate.parent;
      }
    } catch {}
    return false;
  }

  function destroy() {
    bridge?.dispose();
    bridge = null;
  }

  function makeBridge(endpoint) {
    if (!endpointPattern.test(endpoint)) throw new Error('Вкажіть HTTPS-адресу Apps Script, що закінчується на /exec.');
    if (location.protocol !== 'https:') throw new Error('Хмарне підключення доступне з опублікованого HTTPS-сайту.');
    const nonce = V.uid();
    const frame = document.createElement('iframe');
    frame.className = 'frame-bridge';
    frame.title = 'З’єднання з Google Apps Script';
    frame.setAttribute('aria-hidden','true');
    frame.tabIndex = -1;
    frame.referrerPolicy = 'no-referrer';
    let target, origin, waiting, disposed = false;
    let readyHandler;
    function inbound(event) {
      const packet = event.data;
      if (!packet || packet.service !== 'prompt-vault-v1' || packet.nonce !== nonce) return;
      if (!target && packet.type === 'ready' && googleOrigin.test(event.origin) && descendants(event.source,frame.contentWindow)) {
        target = event.source;
        origin = event.origin;
        readyHandler();
        return;
      }
      if (event.source !== target || event.origin !== origin || packet.type !== 'reply' || waiting?.id !== packet.id) return;
      waiting.finish(null,packet.response);
    }
    window.addEventListener('message',inbound);
    const ready = new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('Google Apps Script не відповів. Перевірте URL, дозволений origin і доступ «Усі».')),14000);
      readyHandler = () => { clearTimeout(timeout); resolve(); };
      frame.addEventListener('error',() => {
        clearTimeout(timeout);
        reject(new Error('Браузер не зміг завантажити Apps Script.'));
      },{ once:true });
    });
    const url = new URL(endpoint);
    url.searchParams.set('client',location.origin);
    url.searchParams.set('channel',nonce);
    frame.src = url.href;
    document.body.append(frame);
    return {
      endpoint,
      async call(action,secret,payload) {
        await ready;
        if (disposed) throw new Error('Підключення змінено.');
        const id = V.uid();
        return new Promise((resolve,reject) => {
          const timeout = setTimeout(() => waiting?.finish(new Error('Google не підтвердив відповідь. Зміни залишилися на пристрої.')),32000);
          waiting = { id,finish(error,data) {
            clearTimeout(timeout);
            waiting = null;
            if (error || !data?.ok) reject(error || new Error(data?.message || 'Сервер повернув невідому відповідь.'));
            else resolve(data);
          } };
          try { target.postMessage({ service:'prompt-vault-v1',type:'request',nonce,id,action,key:secret,payload },origin); }
          catch (error) { waiting.finish(error); }
        });
      },
      dispose() {
        disposed = true;
        readyHandler();
        waiting?.finish(new Error('Підключення закрито.'));
        window.removeEventListener('message',inbound);
        frame.remove();
      }
    };
  }

  function credentials() {
    return { endpoint:prefs.endpoint, key:prefs.key || sessionKey };
  }

  async function test(endpoint,key) {
    if (!key || key.length>260) throw new Error('Введіть персональний ключ доступу.');
    const temporary = makeBridge(endpoint);
    try {
      const reply = await temporary.call('ping',key,{});
      if (!V.ids.test(reply.archiveId) || !Number.isSafeInteger(reply.revision)) throw new Error('Несумісна версія Apps Script.');
      return reply;
    } finally { temporary.dispose(); }
  }

  function schedule(delay = 5000) {
    clearTimeout(timer);
    if (!navigator.onLine || !credentials().endpoint || !credentials().key) return;
    timer = setTimeout(() => run(),Math.max(delay,retryAt-Date.now(),0));
  }

  function configure(next) {
    const changed = prefs.endpoint !== next.endpoint || prefs.key !== next.key || prefs.poll !== next.poll;
    prefs = next;
    if (!changed) return;
    clearInterval(polling);
    polling = setInterval(() => run(),prefs.poll*1000);
    if (bridge?.endpoint !== prefs.endpoint) destroy();
    retryAt = 0;
    failures = 0;
    schedule(100);
  }

  function validRecord(record) {
    return record && ['prompt','folder'].includes(record.kind) && V.ids.test(record.id) && Number.isSafeInteger(record.rev) && record.rev > 0 &&
      V.ids.test(record.opId) && V.validData(record.kind,record.data,true);
  }

  async function run(manual = false) {
    if (running || (!manual && Date.now() < retryAt)) return;
    const config = credentials();
    if (!config.endpoint || !config.key || !navigator.onLine) {
      if (manual) throw new Error(navigator.onLine ? 'Підключіть Google Apps Script у налаштуваннях.' : 'Немає інтернет-з’єднання.');
      return;
    }
    running = true;
    let acquired = false, heartbeat, remaining = false;
    try {
      acquired = await V.store.acquire(owner);
      if (!acquired) {
        schedule(2500);
        if (manual) throw new Error('Синхронізація вже триває в іншій вкладці.');
        return;
      }
      heartbeat = setInterval(() => V.store.acquire(owner).catch(() => {}),10000);
      notify('syncing');
      if (!bridge || bridge.endpoint !== config.endpoint) bridge = makeBridge(config.endpoint);
      const activeBridge = bridge;
      const call = async (action,payload) => {
        const reply = await activeBridge.call(action,config.key,payload);
        if (credentials().endpoint !== config.endpoint || credentials().key !== config.key) throw new Error('Підключення змінено.');
        return reply;
      };
      const local = await V.store.syncSnapshot();
      const hello = await call('ping',{});
      if (!V.ids.test(hello.archiveId) || !Number.isSafeInteger(hello.revision) || hello.revision < local.cloud.cursor ||
        (local.cloud.id && local.cloud.id !== hello.archiveId)) throw new Error('Серверний архів відрізняється від збереженого на цьому пристрої.');
      const archiveId = hello.archiveId;
      if (!local.cloud.id) await V.store.bind(owner,archiveId);
      const operations = local.queued ? await V.store.claim(owner,manual) : [];
      if (operations.length) {
        const incoming = await call('push',{ archiveId,operations });
        if (!Array.isArray(incoming.results) || !incoming.results.length || incoming.results.length > operations.length ||
          incoming.results.some((result,index) => {
            const given = operations[index];
            return given.opId !== result.opId || given.id !== result.id || given.kind !== result.kind ||
              !['applied','conflict'].includes(result.status) || (result.status==='applied' && result.record?.opId!==given.opId) ||
              (result.record ? !validRecord(result.record) || result.record.id !== given.id || result.record.kind !== given.kind :
                result.status === 'applied');
          })) throw new Error('Сервер повернув неповне підтвердження.');
        await V.store.accept(owner,incoming.results);
      }
      let cursor = local.cloud.cursor;
      if (operations.length || hello.revision !== cursor || !local.cloud.id || !local.cloud.at) {
        for (let i=0; i<12; i++) {
          const page = await call('pull',{ archiveId,since:cursor });
          if (!Number.isSafeInteger(page.cursor) || page.cursor < cursor || (page.more && page.cursor === cursor) ||
            !Array.isArray(page.events) || page.events.some((event,index) => !validRecord(event) ||
              event.rev <= (page.events[index-1]?.rev || cursor) || event.rev > page.cursor)) {
            throw new Error('Сервер повернув пошкоджену сторінку архіву.');
          }
          await V.store.merge(owner,archiveId,page);
          cursor = page.cursor;
          remaining = page.more;
          if (!remaining) break;
        }
      }
      const end = await V.store.syncSnapshot();
      failures = 0;
      retryAt = 0;
      notify(remaining ? 'syncing' : 'idle');
      if (remaining) schedule(150);
      else if (end.queued) schedule(Math.max(200,5000-(Date.now()-end.dirtyAt)));
    } catch (error) {
      if (!acquired && manual) throw error;
      destroy();
      failures++;
      retryAt = Date.now() + Math.min(300000, 4000*2**Math.min(failures-1,7));
      notify('failed',error.message || 'Зв’язок із сервером перервано.');
      schedule();
      if (manual) throw error;
    } finally {
      clearInterval(heartbeat);
      if (acquired) await V.store.release(owner).catch(() => {});
      running = false;
    }
  }

  window.addEventListener('offline',() => { clearTimeout(timer); listener(status); });
  window.addEventListener('online',() => { retryAt=0; listener(status); schedule(100); });
  document.addEventListener('visibilitychange',() => { if (!document.hidden) schedule(250); });
  V.sync = { test,run,schedule,configure,credentials,status:() => status,
    onStatus(fn) { listener=fn; },
    useSessionKey(key) { sessionKey=key; retryAt=0; schedule(100); },
    validEndpoint:endpoint => endpointPattern.test(endpoint) };
})();
