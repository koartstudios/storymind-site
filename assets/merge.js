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
    var out = o.out || null;          // opcional: { changed: [], deleted: [] } recebe as chaves que mudaram agora
    var en = enumerate(story);
    var items = {}, del = {}, alive = {};

    if (prev && prev.del) Object.keys(prev.del).forEach(function (k) { del[k] = prev.del[k]; });

    function touch(key, h) {
      alive[key] = 1;
      var p = prev && prev.items[key];
      if (p && p.h === h) items[key] = { ts: p.ts, h: h };                 // não mudou: mantém o carimbo
      else if (p) { items[key] = { ts: now, h: h }; if (out) out.changed.push(key); }          // mudou: carimbo novo
      else { items[key] = { ts: prev ? now : legacyTs, h: h }; if (out && prev) out.changed.push(key); }   // item novo (ou história ainda sem carimbos)
      delete del[key];
    }
    en.items.forEach(function (it) { touch(it.key, hash(canon(it.value))); });
    en.orders.forEach(function (or) { touch(or.key, hash(or.ids.join(SEP))); });

    if (prev) {
      Object.keys(prev.items).forEach(function (k) {
        if (!alive[k] && k.charAt(0) !== 'o' && del[k] == null) { del[k] = now; if (out) out.deleted.push(k); }   // sumiu desde a última vez: lápide
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

    // Sempre sobra pelo menos uma página: se dois aparelhos excluíram páginas diferentes ao mesmo tempo e a soma
    // das exclusões esvaziaria a história, volta a página mais recente que alguma das versões ainda tem.
    if (!Object.keys(aliveSheets).length) {
      var best = null;
      [[byA, mA], [byB, mB]].forEach(function (pair) {
        Object.keys(pair[0]).forEach(function (k) {
          var it = pair[0][k];
          if (it.kind !== 'sheet') return;
          var ts = pair[1].items[k].ts;
          if (!best || ts > best.ts || (ts === best.ts && it.sid < best.it.sid)) best = { it: it, ts: ts, meta: pair[1].items[k], key: k };
        });
      });
      if (best) { win[best.key] = { it: best.it, meta: best.meta }; aliveSheets[best.it.sid] = 1; delete outDel[best.key]; }
    }

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

  // ---------- DELTA: só o que mudou, para enviar em tempo real ----------
  function listIds(arr, isSheets) {
    var used = {};
    return (arr || []).map(function (el, i) {
      return uniq(used, el && el.id != null ? String(el.id) : (isSheets ? '#s' + i : '#' + hash(canon(el))));
    });
  }
  function findSheet(S, sid) {
    var ids = listIds(S.sheets, true);
    var i = ids.indexOf(sid);
    return i === -1 ? null : S.sheets[i];
  }
  function parseKey(key) {
    var p = key.split('|');
    if (key === 'S') return { kind: 'story' };
    if (p[0] === 'sh') return { kind: 'sheet', sid: p.slice(1).join('|') };
    if (ARRAY_COLLS.indexOf(p[0]) !== -1) return { kind: p[0], sid: p[1], id: p.slice(2).join('|') };
    if (p[0] === 'a') return { kind: 'opaque', sid: p[1], coll: p[2] };
    if (p[0] === 'm') return { kind: 'map', sid: p[1], coll: p[2], id: p.slice(3).join('|') };
    return null;
  }

  // Monta o delta a partir do que o stamp() acabou de carimbar (out = { changed, deleted }).
  function makeDelta(story, out) {
    var meta = story._sync, en = enumerate(story), byKey = {}, ord = {};
    en.items.forEach(function (it) { byKey[it.key] = it; });
    en.orders.forEach(function (o) { ord[o.key] = o; });
    var delta = { v: 1, items: [], del: {}, orders: [] };
    (out.changed || []).forEach(function (k) {
      if (k.charAt(0) === 'o') {
        if (ord[k] && meta.items[k]) delta.orders.push({ key: k, ids: ord[k].ids, ts: meta.items[k].ts });
      } else if (byKey[k] && meta.items[k]) {
        var it = byKey[k];
        var di = { key: k, kind: it.kind, sid: it.sid, coll: it.coll, id: it.id,
          value: it.value, ts: meta.items[k].ts, h: meta.items[k].h };
        if (it.kind === 'sheet') {                       // quais coleções (mesmo vazias) a página tem: o receptor as cria iguais
          var shObj = findSheet(story, it.sid);
          di.colls = shObj ? ALL_COLLS.filter(function (c) { return shObj[c] !== undefined; }) : [];
        }
        delta.items.push(di);
      }
    });
    (out.deleted || []).forEach(function (k) { if (meta.del[k] != null) delta.del[k] = meta.del[k]; });
    return delta;
  }

  function place(S, d) {
    var v = clone(d.value), sh, i;
    if (d.kind === 'story') {
      Object.keys(S).forEach(function (k) { if (!STORY_SKIP[k] && !(k in v)) delete S[k]; });
      Object.keys(v).forEach(function (k) { if (!STORY_SKIP[k]) S[k] = v[k]; });
      return true;
    }
    sh = findSheet(S, d.sid);
    if (d.kind === 'sheet') {
      if (!sh) { sh = {}; S.sheets.push(sh); }
      Object.keys(sh).forEach(function (k) { if (ALL_COLLS.indexOf(k) === -1 && !(k in v)) delete sh[k]; });
      Object.keys(v).forEach(function (k) { sh[k] = v[k]; });
      (d.colls || []).forEach(function (c) {
        if (ALL_COLLS.indexOf(c) !== -1 && sh[c] === undefined) sh[c] = MAP_COLLS.indexOf(c) !== -1 ? {} : [];
      });
      return true;
    }
    if (!sh) return false;                                   // página ainda desconhecida aqui: a nuvem traz depois
    if (ARRAY_COLLS.indexOf(d.kind) !== -1) {
      var arr = sh[d.kind];
      if (!Array.isArray(arr)) arr = sh[d.kind] = [];
      var ids = listIds(arr, false);
      i = ids.indexOf(d.id);
      if (i !== -1) arr[i] = v; else arr.push(v);
      return true;
    }
    if (d.kind === 'opaque') { sh[d.coll] = v; return true; }
    if (d.kind === 'map') {
      if (!sh[d.coll] || typeof sh[d.coll] !== 'object' || Array.isArray(sh[d.coll])) sh[d.coll] = {};
      sh[d.coll][d.id] = v;
      return true;
    }
    return false;
  }

  function removeItem(S, key) {
    var d = parseKey(key);
    if (!d || d.kind === 'story') return;
    if (d.kind === 'sheet') {
      var sids = listIds(S.sheets, true);
      S.sheets = S.sheets.filter(function (x, i) { return sids[i] !== d.sid; });
      return;
    }
    var sh = findSheet(S, d.sid);
    if (!sh) return;
    if (ARRAY_COLLS.indexOf(d.kind) !== -1) {
      if (!Array.isArray(sh[d.kind])) return;
      var ids = listIds(sh[d.kind], false);
      sh[d.kind] = sh[d.kind].filter(function (x, i) { return ids[i] !== d.id; });
    } else if (d.kind === 'opaque') { delete sh[d.coll]; }
    else if (d.kind === 'map') { if (sh[d.coll] && typeof sh[d.coll] === 'object') delete sh[d.coll][d.id]; }
  }

  function orderIds(S, key) {
    if (key === 'o|sheets') return listIds(S.sheets, true);
    var p = key.split('|');                                  // o|sid|coll
    var sh = findSheet(S, p[1]);
    if (!sh || ARRAY_COLLS.indexOf(p[2]) === -1) return null;
    return listIds(sh[p[2]] || [], false);
  }
  function setOrder(S, key, ids) {
    var arr, isSheets = key === 'o|sheets', sh, p = key.split('|');
    if (isSheets) arr = S.sheets; else { sh = findSheet(S, p[1]); arr = sh && sh[p[2]]; }
    if (!Array.isArray(arr)) return;
    var cur = listIds(arr, isSheets), map = {};
    cur.forEach(function (id, i) { map[id] = arr[i]; });
    var out = ids.filter(function (id) { return map[id] !== undefined; }).map(function (id) { return map[id]; });
    cur.forEach(function (id, i) { if (ids.indexOf(id) === -1) out.push(arr[i]); });   // o que o delta não conhece fica no fim
    if (isSheets) S.sheets = out; else sh[p[2]] = out;
  }

  // Aplica um delta recebido. Usa a MESMA regra da mesclagem completa: o item mais recente vence,
  // exclusão só vale se for mais nova que a edição. Receber o mesmo delta duas vezes, fora de ordem ou
  // perder deltas é seguro: a mesclagem completa (nuvem) sempre corrige o que faltar.
  // opts.skipIds = { idDoNó: true } -> não mexe em itens que o usuário está editando/arrastando agora.
  function applyDelta(story, delta, o) {
    o = o || {};
    if (!story || !Array.isArray(story.sheets) || !delta || delta.v !== 1) return null;
    var now = o.now != null ? o.now : Date.now();
    var skip = o.skipIds || {};
    var S = clone(story);
    if (o.noStamp) { if (!S._sync || !S._sync.items) return null; }       // leitora: não carimba o que ela rabiscou
    else stamp(S, { now: now, fallbackTs: o.fallbackTs });                // edições locais ainda sem carimbo recebem o carimbo agora
    var meta = S._sync, applied = 0, skipped = 0;

    (delta.items || []).forEach(function (d) {
      if (!d || typeof d.key !== 'string' || typeof d.ts !== 'number' || typeof d.h !== 'string') return;
      if (hash(canon(d.value)) !== d.h) { skipped++; return; }                 // conteúdo não confere com o carimbo: ignora
      if (d.id !== undefined && skip[d.id]) { skipped++; return; }
      var mine = meta.items[d.key], dead = meta.del[d.key];
      if (dead != null && dead >= d.ts) return;
      if (mine) {
        if (mine.h === d.h) { if (d.ts > mine.ts) mine.ts = d.ts; return; }
        if (mine.ts > d.ts || (mine.ts === d.ts && mine.h >= d.h)) return;
      }
      if (!place(S, d)) { skipped++; return; }
      meta.items[d.key] = { ts: d.ts, h: d.h };
      delete meta.del[d.key];
      applied++;
    });

    Object.keys(delta.del || {}).forEach(function (k) {
      var t = delta.del[k];
      if (typeof t !== 'number') return;
      var pk = parseKey(k);
      if (pk && pk.id !== undefined && skip[pk.id]) { skipped++; return; }
      var mine = meta.items[k];
      if (mine && mine.ts > t) return;                                         // tenho uma versão mais nova que a exclusão
      if (pk && pk.kind === 'sheet' && S.sheets.length <= 1) { skipped++; return; }   // nunca fica sem páginas
      if (mine) { removeItem(S, k); delete meta.items[k]; }
      meta.del[k] = Math.max(meta.del[k] || 0, t);
      applied++;
    });

    (delta.orders || []).forEach(function (d) {
      if (!d || typeof d.key !== 'string' || !Array.isArray(d.ids) || typeof d.ts !== 'number') return;
      var cur = orderIds(S, d.key);
      if (!cur) return;
      var alive = {};
      cur.forEach(function (id) { alive[id] = 1; });
      var ta = meta.items[d.key] ? meta.items[d.key].ts : -1;
      var r = chooseOrder(cur, d.ids, ta, d.ts, alive);
      if (r.list.join(SEP) !== cur.join(SEP)) { setOrder(S, d.key, r.list); applied++; }
      var ts = r.combined ? Math.max(ta, d.ts, 0) + 1 : Math.max(r.preferA ? ta : d.ts, 0);
      meta.items[d.key] = { ts: ts, h: hash(r.list.join(SEP)) };
    });

    // carimbos de ordem de páginas que não existem mais não ficam para trás (o emissor também os descarta)
    var sheetIds = listIds(S.sheets, true);
    Object.keys(meta.items).forEach(function (k) {
      if (k.charAt(0) === 'o' && k !== 'o|sheets') {
        var sid = k.split('|')[1];
        if (sheetIds.indexOf(sid) === -1) delete meta.items[k];
      }
    });

    return { story: S, applied: applied, skipped: skipped };
  }

  var api = { stamp: stamp, merge: merge, same: same, makeDelta: makeDelta, applyDelta: applyDelta, canon: canon, _enumerate: enumerate, TOMBSTONE_TTL: TOMBSTONE_TTL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SM_MERGE = api;
})(typeof window !== 'undefined' ? window : this);
