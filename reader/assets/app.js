/* ===========================================================
   Boek Reader – mobiel-first, dark mode
   Structuur: /<boeknaam>/chapter/<hoofdstuk>.md
   TOC: /<boeknaam>/toc.json of /<boeknaam>/toc.md
   Boekenoverzicht via /books.json (root)
   + Next/Prev knoppen in de reader
   =========================================================== */

const $ = s => document.querySelector(s);
const app = $('#app');
const pill = $('#currentBookPill');

const cache = new Map();

/* -------- Helpers -------- */
function setHTML(el, html){ el.innerHTML = html; }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  })[m]);
}
function sanitizeSegment(seg){
  return String(seg || '')
    .replaceAll('\\','/')
    .replace(/\.\.+/g,'')
    .replace(/^\/+|\/+$/g,'')
    .trim();
}
function ensureMd(name){ return name?.toLowerCase().endsWith('.md') ? name : `${name}.md`; }
function chapterKey(name){ return ensureMd(sanitizeSegment(name||'')).toLowerCase(); }
function showStatus(msg, kind='info'){ setHTML(app, `<div class="card pad status ${kind==='error'?'error':''}">${msg}</div>`); }
function setBookPill(book){ if(book){ pill.hidden=false; pill.textContent=`Boek: ${book}` } else pill.hidden=true; }

async function fetchText(path){
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(path, {cache:'no-store'});
  if(!res.ok) throw new Error(res.status + ' ' + res.statusText + ` @ ${path}`);
  const txt = await res.text();
  cache.set(path, txt);
  return txt;
}

/* -------- TOC helpers (array) -------- */
async function loadTocArray(bookId){
  const safe = sanitizeSegment(bookId);

  // 1) Probeer JSON
  try{
    const jsonText = await fetchText(`/${safe}/toc.json`);
    const toc = JSON.parse(jsonText);
    if (!Array.isArray(toc)) throw new Error('toc.json is geen array');
    return toc
      .map(it => ({ title: it.title || it.chapter || 'Hoofdstuk', chapter: ensureMd(sanitizeSegment(it.chapter || '')) }))
      .filter(it => it.chapter);
  }catch(_){}

  // 2) Probeer Markdown TOC (very basic parser: [Titel](chapter.md))
  try{
    const md = await fetchText(`/${safe}/toc.md`);
    const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    if (!links.length) throw new Error('No links in toc.md');
    return links.map(m => ({
      title: m[1].trim(),
      chapter: ensureMd(sanitizeSegment(m[2].trim()))
    }));
  }catch(_){}

  // 3) Geen TOC
  return null;
}

/* -------- Markdown rendering (fallback) -------- */
function basicMarkdown(md){
  let html = (md||'').replace(/\r\n?/g, '\n');
  html = html.replace(/```([\s\S]*?)```/g, (_,code)=> `<pre><code>${escapeHtml(code)}</code></pre>`);
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
             .replace(/^## (.*)$/gm, '<h2>$1</h2>')
             .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
             .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(?:^|\n)- (.*)(?=\n|$)/g, (_,item)=> `\n<li>${item}</li>`)
             .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/(?:^|\n)([^<\n][^\n]+)(?=\n|$)/g, '<p>$1</p>');
  return html;
}
function renderMarkdown(md){
  if (window.marked && typeof marked.parse === 'function'){
    return marked.parse(md, {mangle:false, headerIds:true});
  }
  return basicMarkdown(md);
}

/* -------- Views -------- */
function viewHome(){
  setBookPill(null);
  setHTML(app, `
    <section class="card pad">
      <h1>Welkom 👋</h1>
      <p class="muted">Hey liefje, op deze app kan jij de door mij geschreven boeken lezen speciaal voor jou.</p>
      <div class="grid">
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:8px">
          <a class="btn" href="#/books">📚 Boeken</a>
          <a class="btn" href="#/goto">➜ Go-to</a>
        </div>
        <button class="btn" id="openLastBtn">Open laatst gelezen</button>
      </div>
    </section>
  `);
  $('#openLastBtn')?.addEventListener('click', ()=>{
    const lastBook = localStorage.getItem('lastBook');
    const lastChapter = localStorage.getItem('lastChapter');
    if (lastBook && lastChapter) location.hash = `#/${encodeURIComponent(lastBook)}/chapter/${encodeURIComponent(lastChapter)}`;
  });
}

async function viewReader(book, chapterRaw){
  const bookSafe = sanitizeSegment(book);
  const chapter = ensureMd(sanitizeSegment(chapterRaw));
  setBookPill(bookSafe);

  const path = `/${bookSafe}/chapter/${chapter}`;
  setHTML(app, `
    <article class="card">
      <div class="pad" style="display:flex; gap:10px; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div class="muted">Lezen uit</div>
          <h2 style="margin:.2rem 0 0; word-break:break-all"><code>/${bookSafe}/chapter/${chapter}</code></h2>
        </div>
        <div style="display:flex; gap:8px">
          <a class="btn" href="#/toc/${encodeURIComponent(bookSafe)}" aria-label="Inhoudsopgave">TOC</a>
          <a class="btn" href="#/goto" aria-label="Ga naar">Go-to</a>
        </div>
      </div>
      <div class="reader" id="reader"><span class="loader"></span> Laden…</div>
      <div id="pager" class="pad pager" aria-live="polite"></div>
    </article>
  `);

  // 1) Laad content
  try{
    const md = await fetchText(path);
    $('#reader').innerHTML = renderMarkdown(md);
    localStorage.setItem('lastBook', bookSafe);
    localStorage.setItem('lastChapter', chapter);
  }catch(e){
    $('#reader').innerHTML = `
      <div class="status error">
        <strong>Kon het hoofdstuk niet laden.</strong><br>${escapeHtml(e.message)}<br><br>
        Controleer pad en bestandsnaam.
      </div>`;
  }

  // 2) Laad TOC en bouw pager
  try{
    const toc = await loadTocArray(bookSafe);
    const pagerEl = $('#pager');
    if (!toc || !toc.length){
      pagerEl.innerHTML = `<div class="status">Geen TOC gevonden voor pager.</div>`;
      return;
    }

    const idx = toc.findIndex(it => chapterKey(it.chapter) === chapterKey(chapter));
    const prev = idx > 0 ? toc[idx-1] : null;
    const next = (idx >= 0 && idx < toc.length - 1) ? toc[idx+1] : null;

    const prevHref = prev ? `#/${encodeURIComponent(bookSafe)}/chapter/${encodeURIComponent(prev.chapter)}` : null;
    const nextHref = next ? `#/${encodeURIComponent(bookSafe)}/chapter/${encodeURIComponent(next.chapter)}` : null;

    pagerEl.innerHTML = `
      <div class="side">
        <a class="btn" ${prevHref ? `href="${prevHref}"` : 'disabled'} aria-label="Vorig hoofdstuk">← Vorig</a>
      </div>
      <div class="muted" style="text-align:center; flex:1">
        ${idx >= 0 ? `Hoofdstuk ${idx+1} / ${toc.length}` : 'Onbekende positie'}
      </div>
      <div class="side">
        <a class="btn" ${nextHref ? `href="${nextHref}"` : 'disabled'} aria-label="Volgend hoofdstuk">Volgend →</a>
      </div>
    `;

    // Keyboard: p/n of pijltjes
    document.onkeydown = (e)=>{
      const key = e.key.toLowerCase();
      if (key === 'arrowright' || key === 'n'){
        if (nextHref){ location.hash = nextHref.replace(/^#/, ''); }
      }else if (key === 'arrowleft' || key === 'p'){
        if (prevHref){ location.hash = prevHref.replace(/^#/, ''); }
      }
    };
  }catch(_){
    // stil falen: geen pager
  }
}

async function viewToc(book){
  const bookSafe = sanitizeSegment(book);
  setBookPill(bookSafe);
  setHTML(app, `
    <section class="card pad">
      <h1>Inhoudsopgave</h1>
      <p class="muted">Zoekt automatisch <code>/${bookSafe}/toc.json</code> of <code>/${bookSafe}/toc.md</code>.</p>
      <div id="tocZone" class="grid" style="gap:12px">
        <div class="status"><span class="loader"></span> Inhoudsopgave laden…</div>
      </div>
    </section>
  `);

  const zone = $('#tocZone');

  try{
    const html = await loadBookTocHtml(bookSafe);
    zone.innerHTML = html;
  }catch(e){
    zone.innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
  }
}

/* ===== Boekenoverzicht ===== */
async function viewBooks(){
  setBookPill(null);
  setHTML(app, `
    <section class="card pad">
      <h1>Boeken</h1>
      <p class="muted">Gelezen uit <code>/books.json</code>. Tik op een boek om hoofdstukken te tonen.</p>
      <div id="booksZone" class="grid" style="gap:10px">
        <div class="status"><span class="loader"></span> Boeken laden…</div>
      </div>
    </section>
  `);

  const zone = $('#booksZone');

  let list;
  try{
    const txt = await fetchText(`/books.json`);
    const data = JSON.parse(txt);
    if (Array.isArray(data)){
      list = data.map(x => typeof x === 'string' ? { id: x, title: x } : { id: x.id, title: x.title || x.id }).filter(b => b.id);
    }else if (Array.isArray(data.books)){
      list = data.books.map(x => typeof x === 'string' ? { id: x, title: x } : { id: x.id, title: x.title || x.id }).filter(b => b.id);
    }else{
      throw new Error('Onjuist formaat: gebruik een array of een object met "books": [].');
    }
  }catch(e){
    zone.innerHTML = `
      <div class="status error">
        Kon <code>/books.json</code> niet laden.<br>${escapeHtml(e.message)}<br><br>
        Voorbeeld:<pre><code>[
  "mijn-boek",
  { "id": "ander-boek", "title": "Ander Boek" }
]</code></pre>
      </div>`;
    return;
  }

  if (!list.length){
    zone.innerHTML = `<div class="status">Geen boeken in <code>books.json</code> gevonden.</div>`;
    return;
  }

  zone.innerHTML = list.map(b=> bookRowHtml(b.id, b.title)).join('');

  zone.addEventListener('click', async (e)=>{
    const row = e.target.closest('[data-bookrow]');
    if (!row) return;

    const book = row.getAttribute('data-bookrow');
    const body = row.querySelector('.book-body');
    const caret = row.querySelector('.caret');

    const isOpen = row.getAttribute('aria-expanded') === 'true';
    if (isOpen){
      row.setAttribute('aria-expanded','false');
      body.innerHTML = '';
      caret.textContent = '▶';
      return;
    }

    row.setAttribute('aria-expanded','true');
    caret.textContent = '▼';
    body.innerHTML = `<div class="status"><span class="loader"></span> Hoofdstukken laden…</div>`;
    try{
      const html = await loadBookTocHtml(book);
      body.innerHTML = html;
    }catch(err){
      body.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function bookRowHtml(id, title){
  const safeId = escapeHtml(id);
  const safeTitle = escapeHtml(title || id);
  return `
  <div class="card" data-bookrow="${safeId}" aria-expanded="false" style="overflow:hidden">
    <div class="pad" style="display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--border); cursor:pointer">
      <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
        <span class="caret" aria-hidden="true">▶</span>
        <strong style="margin-left:.4rem">${safeTitle}</strong>
        <span class="muted" style="margin-left:.5rem">(${safeId})</span>
      </div>
      <a class="btn" href="#/toc/${encodeURIComponent(safeId)}" onclick="event.stopPropagation()">TOC</a>
    </div>
    <div class="pad book-body"></div>
  </div>`;
}

/* Maak klikbare hoofdstuklijst voor een boek */
async function loadBookTocHtml(bookId){
  const toc = await loadTocArray(bookId);
  const safe = sanitizeSegment(bookId);
  if (!toc) throw new Error(`Geen <code>${safe}/toc.json</code> of <code>${safe}/toc.md</code> gevonden. Voeg er één toe om hoofdstukken te tonen.`);

  const items = toc.map(item=>{
    const title = escapeHtml(item.title || item.chapter || 'Hoofdstuk');
    const ch = ensureMd(sanitizeSegment(item.chapter || ''));
    const href = `#/${encodeURIComponent(safe)}/chapter/${encodeURIComponent(ch)}`;
    return `<li style="padding:.55rem .7rem; border-top:1px solid var(--border)">
      <a href="${href}">${title}</a> <span class="muted">(${ch})</span>
    </li>`;
  }).join('');
  return `<ul style="list-style:none; margin:0; padding:0">${items || '<li class="muted" style="padding:.55rem .7rem">Leeg</li>'}</ul>`;
}

/* -------- Go-to -------- */
function viewGoto(){
  const last = localStorage.getItem('lastBook') || '';
  setBookPill(last || null);
  setHTML(app, `
    <section class="card pad">
      <h1>Ga naar</h1>
      <form id="gotoForm" class="grid" style="gap:12px">
        <div class="field">
          <label style="min-width:92px">Boek</label>
          <input id="bookInput" placeholder="bv. mijn-boek" value="${escapeHtml(last)}" required inputmode="latin-name" autocomplete="off">
        </div>
        <div class="field">
          <label style="min-width:92px">Hoofdstuk</label>
          <input id="chapterInput" placeholder="bv. intro.md of hoofdstuk-1" required inputmode="latin-name" autocomplete="off">
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:8px">
          <button class="btn" type="button" id="tocLinkBtn">Toon TOC</button>
          <button class="btn" type="submit">Openen</button>
        </div>
      </form>
    </section>
  `);

  $('#gotoForm').addEventListener('submit', e=>{
    e.preventDefault();
    const book = sanitizeSegment($('#bookInput').value);
    const chapter = ensureMd(sanitizeSegment($('#chapterInput').value));
    if (book && chapter) location.hash = `#/${encodeURIComponent(book)}/chapter/${encodeURIComponent(chapter)}`;
  });
  $('#tocLinkBtn').addEventListener('click', ()=>{
    const book = sanitizeSegment($('#bookInput').value);
    if (book) location.hash = `#/toc/${encodeURIComponent(book)}`;
  });
}

/* -------- Router -------- */
function parseHash(){
  const h = decodeURI(location.hash || '#/');
  const parts = h.replace(/^#\//,'').split('/');
  if (h === '#/' || h === '#') return {page:'home'};
  if (parts[0] === 'books') return {page:'books'};
  if (parts[0] === 'goto') return {page:'goto'};
  if (parts[0] === 'toc' && parts[1]) return {page:'toc', book:parts[1]};
  if (parts[0] && parts[1]==='chapter' && parts[2]) return {page:'reader', book:parts[0], chapter:parts.slice(2).join('/')};
  return {page:'home'};
}

async function render(){
  const r = parseHash();
  if (r.page === 'home') return viewHome();
  if (r.page === 'books') return viewBooks();
  if (r.page === 'goto') return viewGoto();
  if (r.page === 'toc') return viewToc(r.book);
  if (r.page === 'reader') return viewReader(r.book, r.chapter);
  viewHome();
}

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);

/* -------- Extra UX -------- */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-link]');
  if (btn){ location.hash = btn.getAttribute('data-link'); }
});
$('#tocBtn')?.addEventListener('click', ()=>{
  const last = localStorage.getItem('lastBook') || '';
  location.hash = last ? `#/toc/${encodeURIComponent(last)}` : '#/goto';
});
$('#copyLinkBtn')?.addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    const btn = $('#copyLinkBtn');
    const txt = btn.textContent;
    btn.textContent = 'Gekopieerd!';
    setTimeout(()=> btn.textContent = txt, 1200);
  }catch(_){}
});
document.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'g') location.hash = '#/goto';
});
