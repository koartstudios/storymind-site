/* StoryMind — mesclagem por item (Etapa 2)
 *
 * Código PURO: não toca em tela, rede, localStorage nem no resto do app.
 *
 * Ideia: em vez de tratar a história inteira como um bloco (quem salva por último vence),
 * cada "item" tem um carimbo de última alteração, e a mesclagem fica, item a item, com o mais recente.
 *
 * Itens:  a história (título etc.), cada página (nome, tema, layout...), cada nó, cada relação,
 *         cada entrada dos mapas (skillTrees, posições) e os blocos opacos (radialGroups).
 * Ordem:  a ordem de cada lista (páginas, nós, relações) tem o seu próprio carimbo.
 * Exclusão: deixa uma "lápide" (id + hora) por 30 dias, para o app saber que foi apagado
 *           e não que ainda não chegou.
 *
 * Os carimbos ficam em  story._sync  e são calculados por COMPARAÇÃO (hash do conteúdo) a cada
 * gravação — por isso funcionam com desfazer, importação e qualquer parte do app que edite
 * a história, sem precisar mexer nos lugares onde o app edita.
 *
 * API:
 *   SM_MERGE.stamp(story, { now, fallbackTs })        -> atualiza story._sync (muda o objeto) e devolve a história
 *   SM_MERGE.merge(local, remote, { now, localFallbackTs, remoteFallbackTs }) -> nova história mesclada (ou null se não der)
 *   SM_MERGE.same(a, b)                               -> mesmo conteúdo? (ignora _sync, activeSheetId, isFavorite)
 */
(function (root) {
  'use strict';

  var TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;           // 30 dias
  var ARRAY_COLLS = ['nodes', 'relationships', 'relations'];          // listas de itens com id
  var OPAQUE_COLLS = ['radialGroups'];                                  // listas tratadas como um bloco
  var MAP_COLLS = ['layoutPositions', 'relationWebPositions', 'skillTrees']; // objetos, um item por chave
  var ALL_COLLS = ARRAY_COLLS.concat(OPAQUE_COLLS, MAP_COLLS);
  var STORY_SKIP = { sheets: 1, _sync: 1, isFavorite: 1, activeSheetId: 1 };
  var SEP = '\u0001';

  // ---------- utilidades ----------
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  // texto canônico: chaves em ordem alfabética (o jsonb do Postgres reordena chaves)
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function hash(str) {                                  // cyrb53
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function strip(s) {
    var c = Object.assign({}, s);
    delete c._sync; delete c.activeSheetId; delete c.isFavorite;
    return c;
  }
  function same(a, b) { return canon(strip(a)) === canon(strip(b)); }

  // ---------- enumeração: história -> itens + listas de ordem ----------
  function enumerate(story) {
    var items = [], orders = [];

    var shell = {};
    Object.keys(story).forEach(function (k) { if (!STORY_SKIP[k]) shell[k] = story[k]; });
    items.push({ key: 'S', kind: 'story', value: shell });

    var sheets = Array.isArray(story.sheets) ? story.sheets : [];
    var sheetIds = [];
    var usedSheet = {};
    sheets.forEach(function (sh, si) {
      var sid = uniq(usedSheet, sh && sh.id != null ? String(sh.id) : '#s' + si);
      sheetIds.push(sid);

      var sshell = {};
      Object.keys(sh).forEach(function (k) { if (ALL_COLLS.indexOf(k) === -1) sshell[k] = sh[k]; });
      items.push({ key: 'sh|' + sid, kind: 'sheet', sid: sid, value: sshell });

      ARRAY_COLLS.forEach(function (coll) {
        var arr = Array.isArray(sh[coll]) ? sh[coll] : [];
        var ids = [], used = {};
        arr.forEach(function (el) {
          var id = uniq(used, el && el.id != null ? String(el.id) : '#' + hash(canon(el)));
          ids.push(id);
          items.push({ key: coll + '|' + sid + '|' + id, kind: coll, sid: sid, id: id, value: el });
        });
        orders.push({ key: 'o|' + sid + '|' + coll, sid: sid, coll: coll, ids: ids });
      });

      OPAQUE_COLLS.forEach(function (coll) {
        if (sh[coll] !== undefined) items.push({ key: 'a|' + sid + '|' + coll, kind: 'opaque', sid: sid, coll: coll, value: sh[coll] });
      });

      MAP_COLLS.forEach(function (coll) {
        var obj = sh[coll];
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          Object.keys(obj).forEach(function (k) {
            items.push({ key: 'm|' + sid + '|' + coll + '|' + k, kind: 'map', sid: sid, coll: coll, id: k, value: obj[k] });
          });
        }
      });
    });
    orders.push({ key: 'o|sheets', ids: sheetIds });
    return { items: items, orders: orders };
  }

  function uniq(used, id) {
    if (!used[id]) { used[id] = 1; return id; }
    var n = used[id]++;
    var cand = id + '~' + n;
    used[cand] = 1;
    return cand;
  }

  // ---------- carimbos ----------
  function stamp(story, o) {
    o = o || {};
    var now = o.now != null ? o.now : Date.now();
    var prev = story._sync && story._sync.items ? story._sync : null;
    var legacyTs = o.fallbackTs != null ? o.fallbackTs : now;
    var en = enumerate(story);
    var items = {}, del = {}, alive = {};

    if (prev && prev.del) Object.keys(prev.del).forEach(function (k) { del[k] = prev.del[k]; });

    function touch(key, h) {
      alive[key] = 1;
      var p = prev && prev.items[key];
      if (p && p.h === h) items[key] = { ts: p.ts, h: h };                 // não mudou: mantém o carimbo
      else if (p) items[key] = { ts: now, h: h };                           // mudou: carimbo novo
      else items[key] = { ts: prev ? now : legacyTs, h: h };                // item novo (ou história ainda sem carimbos)
      delete del[key];
    }
    en.items.forEach(function (it) { touch(it.key, hash(canon(it.value))); });
    en.orders.forEach(function (or) { touch(or.key, hash(or.ids.join(SEP))); });

    if (prev) {
      Object.keys(prev.items).forEach(function (k) {
        if (!alive[k] && k.charAt(0) !== 'o' && del[k] == null) del[k] = now;   // sumiu desde a última vez: lápide
      });
    }
    Object.keys(del).forEach(function (k) { if (now - del[k] > TOMBSTONE_TTL) delete del[k]; });

    story._sync = { v: 1, items: items, del: del };
    return story;
  }

  // ---------- mesclagem ----------
  function chooseOrder(la, lb, ta, tb, alive) {
    la = la || []; lb = lb || [];
    var preferA = ta !== tb ? ta > tb : la.join(SEP) >= lb.join(SEP);
    var base = preferA ? la : lb, other = preferA ? lb : la;
    var res = base.filter(function (id) { return alive[id]; });
    var seen = {}, inserted = 0;
    res.forEach(function (id) { seen[id] = 1; });

    other.forEach(function (id, i) {
      if (!alive[id] || seen[id]) return;
      var pos = 0;
      for (var j = i - 1; j >= 0; j--) {
        if (seen[other[j]]) { pos = res.indexOf(other[j]) + 1; break; }
      }
      res.splice(pos, 0, id);
      seen[id] = 1; inserted++;
    });
    Object.keys(alive).sort().forEach(function (id) { if (!seen[id]) { res.push(id); seen[id] = 1; inserted++; } });  // rede de segurança
    return { list: res, combined: inserted > 0, preferA: preferA };
  }

  function merge(a, b, o) {
    o = o || {};
    if (!a || !b || !Array.isArray(a.sheets) || !Array.isArray(b.sheets)) return null;   // formato antigo: quem chama decide
    var now = o.now != null ? o.now : Date.now();

    var A = clone(a), B = clone(b);
    stamp(A, { now: now, fallbackTs: o.localFallbackTs });
    stamp(B, { now: now, fallbackTs: o.remoteFallbackTs });
    var mA = A._sync, mB = B._sync;
    var eA = enumerate(A), eB = enumerate(B);

    var byA = {}, byB = {};
    eA.items.forEach(function (it) { byA[it.key] = it; });
    eB.items.forEach(function (it) { byB[it.key] = it; });
    var keys = Object.keys(Object.assign({}, byA, byB)).sort();

    var win = {}, outDel = {};
    keys.forEach(function (k) {
      var ia = byA[k], ib = byB[k];
      var ta = ia && mA.items[k], tb = ib && mB.items[k];
      if (ia && ib) {
        if (ta.h === tb.h) win[k] = { it: ia, meta: { ts: Math.max(ta.ts, tb.ts), h: ta.h } };
        else if (ta.ts !== tb.ts) win[k] = ta.ts > tb.ts ? { it: ia, meta: ta } : { it: ib, meta: tb };
        else win[k] = ta.h > tb.h ? { it: ia, meta: ta } : { it: ib, meta: tb };
      } else if (ia) {
        var d = mB.del[k];
        if (d != null && d >= ta.ts) outDel[k] = d; else win[k] = { it: ia, meta: ta };
      } else {
        var d2 = mA.del[k];
        if (d2 != null && d2 >= tb.ts) outDel[k] = d2; else win[k] = { it: ib, meta: tb };
      }
    });
    [mA.del, mB.del].forEach(function (dm) {
      Object.keys(dm).forEach(function (k) { if (!win[k]) outDel[k] = Math.max(outDel[k] || 0, dm[k]); });
    });

    function orderOf(en, key) {
      for (var i = 0; i < en.orders.length; i++) if (en.orders[i].key === key) return en.orders[i].ids;
      return [];
    }
    function orderTs(m, key) { return m.items[key] ? m.items[key].ts : -1; }
    var outItems = {}, outOrderMeta = {};

    function pickOrder(key, alive) {
      var ta = orderTs(mA, key), tb = orderTs(mB, key);
      var r = chooseOrder(orderOf(eA, key), orderOf(eB, key), ta, tb, alive);
      // Se a lista final combina as duas (entrou item que só um lado tinha), ela é "nova": carimbo maior que os dois,
      // para vencer nas mesclagens seguintes. Senão, herda o carimbo da lista que serviu de base.
      var ts = r.combined ? Math.max(ta, tb, 0) + 1 : Math.max(r.preferA ? ta : tb, 0);
      outOrderMeta[key] = { ts: ts, h: hash(r.list.join(SEP)) };
      return r.list;
    }

    // páginas vivas
    var aliveSheets = {};
    Object.keys(win).forEach(function (k) { if (win[k].it.kind === 'sheet') aliveSheets[win[k].it.sid] = 1; });

    // Itens que estavam dentro de uma página excluída: não saem na história, mas deixam lápide,
    // para que uma cópia antiga deles não "ressuscite" o item quando as versões forem mescladas de novo.
    Object.keys(win).forEach(function (k) {
      var it = win[k].it;
      if (it.sid !== undefined && it.kind !== 'sheet' && !aliveSheets[it.sid]) {
        outDel[k] = Math.max(outDel[k] || 0, win[k].meta.ts);
      }
    });

    var rawA = {}, rawB = {};
    enumerateSheets(A, rawA); enumerateSheets(B, rawB);

    var sheets = pickOrder('o|sheets', aliveSheets).map(function (sid) {
      var wk = win['sh|' + sid];
      outItems['sh|' + sid] = wk.meta;
      var sheet = clone(wk.it.value);

      ARRAY_COLLS.forEach(function (coll) {
        var alive = {};
        Object.keys(win).forEach(function (k) {
          var it = win[k].it;
          if (it.kind === coll && it.sid === sid) { alive[it.id] = it; outItems[k] = win[k].meta; }
        });
        var present = (rawA[sid] && rawA[sid][coll]) || (rawB[sid] && rawB[sid][coll]);
        var ids = pickOrder('o|' + sid + '|' + coll, aliveIds(alive));
        if (ids.length || present) sheet[coll] = ids.map(function (id) { return clone(win[coll + '|' + sid + '|' + id].it.value); });
      });

      OPAQUE_COLLS.forEach(function (coll) {
        var w = win['a|' + sid + '|' + coll];
        if (w) { sheet[coll] = clone(w.it.value); outItems['a|' + sid + '|' + coll] = w.meta; }
      });

      MAP_COLLS.forEach(function (coll) {
        var obj = {}, any = false;
        Object.keys(win).forEach(function (k) {
          var it = win[k].it;
          if (it.kind === 'map' && it.sid === sid && it.coll === coll) { obj[it.id] = clone(it.value); outItems[k] = win[k].meta; any = true; }
        });
        var present = (rawA[sid] && rawA[sid][coll]) || (rawB[sid] && rawB[sid][coll]);
        if (any || present) {
          var sorted = {};
          Object.keys(obj).sort().forEach(function (k) { sorted[k] = obj[k]; });
          sheet[coll] = sorted;
        }
      });
      return sheet;
    });

    var out = clone(win['S'].it.value);
    outItems['S'] = win['S'].meta;
    out.sheets = sheets;
    if (A.isFavorite !== undefined) out.isFavorite = A.isFavorite;
    var ids = sheets.map(function (s) { return s.id; });
    out.activeSheetId = ids.indexOf(A.activeSheetId) !== -1 ? A.activeSheetId : (ids[0] !== undefined ? ids[0] : A.activeSheetId);

    Object.keys(outOrderMeta).forEach(function (k) { outItems[k] = outOrderMeta[k]; });
    var del = {};
    Object.keys(outDel).forEach(function (k) { if (now - outDel[k] <= TOMBSTONE_TTL) del[k] = outDel[k]; });
    out._sync = { v: 1, items: outItems, del: del };
    return out;
  }

  function aliveIds(map) { var r = {}; Object.keys(map).forEach(function (k) { r[k] = 1; }); return r; }

  // quais coleções cada página tinha (para não inventar "relations: []" onde não existia)
  function enumerateSheets(story, out) {
    var used = {};
    (story.sheets || []).forEach(function (sh, si) {
      var sid = uniq(used, sh && sh.id != null ? String(sh.id) : '#s' + si);
      out[sid] = {};
      ALL_COLLS.forEach(function (c) { if (sh[c] !== undefined) out[sid][c] = true; });
    });
  }

  var api = { stamp: stamp, merge: merge, same: same, canon: canon, _enumerate: enumerate, TOMBSTONE_TTL: TOMBSTONE_TTL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SM_MERGE = api;
})(typeof window !== 'undefined' ? window : this);
