/* ===========================================================
   Book Reader – mobile-first, dark mode
   Structure: /<book>/chapter/<chapter>.md
   TOC: /<book>/toc.json or /<book>/toc.md
   Books list via /books.json (root)
   + Prev/Next buttons
   + Images & links with relative paths are fixed to absolute
   + Colored toasts
   + Optional password protection (global and/or per-book)
   =========================================================== */

const $ = s => document.querySelector(s);
const app = $('#app');
const pill = $('#currentBookPill');

const cache = new Map();

/* -------- Toasts -------- */
function toast(msg, type='info', timeout=3000){
  const stack = $('#toastStack');
  if (!stack) return console.log(`[toast:${type}]`, msg);
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type==='success' ? '✅' : type==='warn' ? '⚠️' : type==='error' ? '⛔' : 'ℹ️';
  el.innerHTML = `
    <div class="icon">${icon}</div>
    <div class="msg">${msg}</div>
    <button class="close" aria-label="Close">×</button>
  `;
  stack.appendChild(el);
  const rm = ()=> el.remove();
  el.querySelector('.close').addEventListener('click', rm);
  if (timeout > 0) setTimeout(rm, timeout);
}

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
function setBookPill(book){ if(book){ pill.hidden=false; pill.textContent=`Book: ${book}` } else pill.hidden=true; }

async function fetchText(path){
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(path, {cache:'no-store'});
  if(!res.ok) throw new Error(res.status + ' ' + res.statusText + ` @ ${path}`);
  const txt = await res.text();
  cache.set(path, txt);
  return txt;
}

/* -------- URL utilities (images/links) -------- */
function normalizePath(path){
  const parts = path.split('/').filter(Boolean);
  const stack = [];
  for (const p of parts){
    if (p === '.') continue;
    if (p === '..') { stack.pop(); continue; }
    stack.push(p);
  }
  return '/' + stack.join('/');
}
function toAbsoluteUrl(baseDir, url){
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('/')) return url;
  return normalizePath(baseDir + '/' + url);
}
function fixRelativeUrls(container, baseDir){
  container.querySelectorAll('img[src]').forEach(img=>{
    const orig = img.getAttribute('src') || '';
    img.setAttribute('src', toAbsoluteUrl(baseDir, orig));
    img.setAttribute('loading','lazy');
    img.setAttribute('decoding','async');
  });
  container.querySelectorAll('a[href]').forEach(a=>{
    const orig = a.getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(orig)) return;
    a.setAttribute('href', toAbsoluteUrl(baseDir, orig));
    a.setAttribute('rel','noopener');
  });
}

/* -------- Password protection (client-side) --------
   books.json can contain:
   {
     "appPassSha256": "<hex sha256 of the global pass>",   // optional
     "books": [
        { "id":"my-book", "title":"My Book", "passSha256":"<hex>" }, // optional per book
        "unlocked-book"
     ]
   }
   or simply an array (["my-book", {"id":"other","passSha256":"<hex>"}])
----------------------------------------------------- */
let booksConfigCache = null;

async function sha256Hex(str){
  const bytes = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function getBooksConfig(){
  if (booksConfigCache) return booksConfigCache;
  let data;
  try{
    const txt = await fetchText('/books.json');
    data = JSON.parse(txt);
  }catch(_){
    // No books.json? Still allow reading if user hits a direct URL.
    data = [];
  }

  let list = [];
  let appPassSha256 = null;

  if (Array.isArray(data)){
    list = data.map(x => typeof x === 'string'
      ? { id:x, title:x, passSha256:null }
      : { id:x.id, title:x.title || x.id, passSha256:x.passSha256 || null }
    ).filter(b=>b.id);
  }else if (data && typeof data === 'object'){
    if (typeof data.appPassSha256 === 'string' && data.appPassSha256.length){
      appPassSha256 = data.appPassSha256.toLowerCase();
    }
    const src = Array.isArray(data.books) ? data.books : [];
    list = src.map(x => typeof x === 'string'
      ? { id:x, title:x, passSha256:null }
      : { id:x.id, title:x.title || x.id, passSha256:x.passSha256 || null }
    ).filter(b=>b.id);
  }

  const byId = Object.fromEntries(list.map(b => [b.id, b]));
  booksConfigCache = { list, byId, appPassSha256 };
  return booksConfigCache;
}

function sessionHasGlobalAuth(){ return sessionStorage.getItem('auth:global') === 'true'; }
function setGlobalAuth(){ sessionStorage.setItem('auth:global','true'); }
function sessionHasBookAuth(bookId){ return sessionStorage.getItem('auth:book:'+bookId) === 'true'; }
function setBookAuth(bookId){ sessionStorage.setItem('auth:book:'+bookId, 'true'); }

/* Show password modal and resolve with {ok:true, value} or {ok:false} */
function askPassword({title='Enter password', placeholder='Password', submitLabel='Unlock'} = {}){
  return new Promise(resolve=>{
    const root = $('#modalRoot');
    if (!root) return resolve({ok:false});

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h2>${escapeHtml(title)}</h2>
        <span class="muted">This content is protected. Please enter the password.</span>
        <div class="row">
          <input id="passField" type="password" placeholder="${escapeHtml(placeholder)}" autocomplete="current-password">
          <button class="eye" id="toggleEye" aria-label="Show/Hide">👁️</button>
        </div>
        <div class="btns">
          <button class="btn" id="cancelBtn">Cancel</button>
          <button class="btn primary" id="okBtn">${escapeHtml(submitLabel)}</button>
        </div>
      </div>
    `;
    root.appendChild(wrap);

    const field = wrap.querySelector('#passField');
    const toggle = wrap.querySelector('#toggleEye');
    const ok = wrap.querySelector('#okBtn');
    const cancel = wrap.querySelector('#cancelBtn');

    const close = (result)=>{ wrap.remove(); resolve(result); };

    toggle.addEventListener('click', ()=>{
      const t = field.getAttribute('type') === 'password' ? 'text' : 'password';
      field.setAttribute('type', t);
    });
    cancel.addEventListener('click', ()=> close({ok:false}));
    ok.addEventListener('click', ()=>{
      const val = field.value || '';
      close({ok:true, value:val});
    });
    field.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') cancel.click();
    });

    field.focus();
  });
}

/* Enforce auth:
   - If global pass exists and not yet unlocked -> prompt.
   - If per-book pass exists and not yet unlocked -> prompt.
   Returns true if authorized, else false. */
async function ensureAuthorized(route){
  const cfg = await getBooksConfig();

  // Global gate (protect Books, TOC, Reader; leave Home/Goto open)
  if (cfg.appPassSha256 && !sessionHasGlobalAuth()){
    const res = await askPassword({ title:'Enter app password' });
    if (!res.ok) { toast('Access cancelled.', 'warn'); return false; }
    const hash = await sha256Hex(res.value);
    if (hash !== cfg.appPassSha256){
      toast('Wrong password.', 'error');
      return false;
    }
    setGlobalAuth();
    toast('App unlocked.', 'success');
  }

  // Per-book gate (TOC/Reader only)
  const bookId = route.book;
  if (bookId && cfg.byId[bookId] && cfg.byId[bookId].passSha256){
    if (!sessionHasBookAuth(bookId)){
      const res = await askPassword({ title:`Enter password for “${bookId}”` });
      if (!res.ok) { toast('Access cancelled.', 'warn'); return false; }
      const hash = await sha256Hex(res.value);
      if (hash !== cfg.byId[bookId].passSha256.toLowerCase()){
        toast('Wrong password for this book.', 'error');
        return false;
      }
      setBookAuth(bookId);
      toast(`Unlocked ${bookId}.`, 'success');
    }
  }

  return true;
}

/* -------- TOC helpers -------- */
async function loadTocArray(bookId){
  const safe = sanitizeSegment(bookId);

  // JSON
  try{
    const jsonText = await fetchText(`/${safe}/toc.json`);
    const toc = JSON.parse(jsonText);
    if (!Array.isArray(toc)) throw new Error('toc.json is not an array');
    return toc
      .map(it => ({ title: it.title || it.chapter || 'Chapter', chapter: ensureMd(sanitizeSegment(it.chapter || '')) }))
      .filter(it => it.chapter);
  }catch(_){}

  // Markdown TOC: parse [Title](chapter.md)
  try{
    const md = await fetchText(`/${safe}/toc.md`);
    const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    if (!links.length) throw new Error('No links in toc.md');
    return links.map(m => ({
      title: m[1].trim(),
      chapter: ensureMd(sanitizeSegment(m[2].trim()))
    }));
  }catch(_){}

  return null;
}

/* -------- Markdown rendering (fallback) -------- */
function basicMarkdown(md){
  let html = (md||'').replace(/\r\n?/g, '\n');
  // code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_,code)=> `<pre><code>${escapeHtml(code)}</code></pre>`);
  // images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m,alt,src)=> `<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`);
  // headings
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
             .replace(/^## (.*)$/gm, '<h2>$1</h2>')
             .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // inline code
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
  // bold/italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
             .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // lists
  html = html.replace(/(?:^|\n)- (.*)(?=\n|$)/g, (_,item)=> `\n<li>${item}</li>`)
             .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  // paragraphs
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
      <h1>Welcome 👋</h1>
      <p class="muted">
        This app reads chapters from <code>/<em>book</em>/chapter/<em>chapter</em>.md</code> and displays them in dark mode.
      </p>
      <div class="grid">
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:8px">
          <a class="btn" href="#/books">📚 Books</a>
          <a class="btn" href="#/goto">➜ Go to</a>
        </div>
        <button class="btn" id="openLastBtn">Open last read</button>
      </div>
    </section>
  `);
  $('#openLastBtn')?.addEventListener('click', ()=>{
    const lastBook = localStorage.getItem('lastBook');
    const lastChapter = localStorage.getItem('lastChapter');
    if (lastBook && lastChapter) location.hash = `#/${encodeURIComponent(lastBook)}/chapter/${encodeURIComponent(lastChapter)}`;
    else toast('No last read page found.', 'info');
  });
}

async function viewReader(book, chapterRaw){
  const bookSafe = sanitizeSegment(book);
  const chapter = ensureMd(sanitizeSegment(chapterRaw));
  setBookPill(bookSafe);

  const chapterDir = `/${bookSafe}/` + (chapter.includes('/') ? `chapter/${chapter.split('/').slice(0, -1).join('/')}` : 'chapter');
  const path = `/${bookSafe}/chapter/${chapter}`;
  setHTML(app, `
    <article class="card">
      <div class="pad" style="display:flex; gap:10px; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div class="muted">Reading from</div>
          <h2 style="margin:.2rem 0 0; word-break:break-all"><code>${path}</code></h2>
        </div>
        <div style="display:flex; gap:8px">
          <a class="btn" href="#/toc/${encodeURIComponent(bookSafe)}" aria-label="Table of Contents">TOC</a>
          <a class="btn" href="#/goto" aria-label="Go to">Go to</a>
        </div>
      </div>
      <div class="reader" id="reader"><span class="loader"></span> Loading…</div>
      <div id="pager" class="pad pager" aria-live="polite"></div>
    </article>
  `);

  try{
    const md = await fetchText(path);
    const html = renderMarkdown(md);
    $('#reader').innerHTML = html;
    fixRelativeUrls($('#reader'), chapterDir);

    localStorage.setItem('lastBook', bookSafe);
    localStorage.setItem('lastChapter', chapter);
  }catch(e){
    $('#reader').innerHTML = `
      <div class="status error">
        <strong>Could not load the chapter.</strong><br>${escapeHtml(e.message)}<br><br>
        Check path and filename.
      </div>`;
    toast('Failed to load chapter.', 'error');
  }

  try{
    const toc = await loadTocArray(bookSafe);
    const pagerEl = $('#pager');
    if (!toc || !toc.length){
      pagerEl.innerHTML = `<div class="status">No TOC found for pager.</div>`;
      return;
    }

    const idx = toc.findIndex(it => chapterKey(it.chapter) === chapterKey(chapter));
    const prev = idx > 0 ? toc[idx-1] : null;
    const next = (idx >= 0 && idx < toc.length - 1) ? toc[idx+1] : null;

    const prevHref = prev ? `#/${encodeURIComponent(bookSafe)}/chapter/${encodeURIComponent(prev.chapter)}` : null;
    const nextHref = next ? `#/${encodeURIComponent(bookSafe)}/chapter/${encodeURIComponent(next.chapter)}` : null;

    pagerEl.innerHTML = `
      <div class="side">
        <a class="btn" ${prevHref ? `href="${prevHref}"` : 'disabled'} aria-label="Previous chapter">← Previous</a>
      </div>
      <div class="muted" style="text-align:center; flex:1">
        ${idx >= 0 ? `Page ${idx+1} / ${toc.length}` : 'Unknown position'}
      </div>
      <div class="side">
        <a class="btn" ${nextHref ? `href="${nextHref}"` : 'disabled'} aria-label="Next chapter">Next →</a>
      </div>
    `;

    // Keyboard shortcuts for reader
    function readerKeyHandler(e){
      const key = e.key.toLowerCase();
      if ((key === 'arrowright' || key === 'n') && nextHref){
        location.hash = nextHref.slice(1);
      }else if ((key === 'arrowleft' || key === 'p') && prevHref){
        location.hash = prevHref.slice(1);
      }
    }
    document.addEventListener('keydown', readerKeyHandler);
    window.addEventListener('hashchange', function once(){
      document.removeEventListener('keydown', readerKeyHandler);
      window.removeEventListener('hashchange', once);
    }, { once:true });
  }catch(_){
    // ignore
  }
}

async function viewToc(book){
  const bookSafe = sanitizeSegment(book);
  setBookPill(bookSafe);
  setHTML(app, `
    <section class="card pad">
      <h1>Table of Contents</h1>
      <p class="muted">Automatically looks for <code>/${bookSafe}/toc.json</code> or <code>/${bookSafe}/toc.md</code>.</p>
      <div id="tocZone" class="grid" style="gap:12px">
        <div class="status"><span class="loader"></span> Loading TOC…</div>
      </div>
    </section>
  `);

  const zone = $('#tocZone');

  try{
    const html = await loadBookTocHtml(bookSafe);
    zone.innerHTML = html;
  }catch(e){
    zone.innerHTML = `<div class="status error">${escapeHtml(e.message)}</div>`;
    toast('Failed to load TOC.', 'error');
  }
}

/* ===== Books view ===== */
async function viewBooks(){
  setBookPill(null);
  setHTML(app, `
    <section class="card pad">
      <h1>Books</h1>
      <p class="muted">Read from <code>/books.json</code>. Tap a book to reveal its chapters.</p>
      <div id="booksZone" class="grid" style="gap:10px">
        <div class="status"><span class="loader"></span> Loading books…</div>
      </div>
    </section>
  `);

  const zone = $('#booksZone');
  const cfg = await getBooksConfig();
  const list = cfg.list;

  if (!list.length){
    zone.innerHTML = `<div class="status">No books found in <code>books.json</code>.</div>`;
    return;
  }

  // Add a lock indicator for protected books
  zone.innerHTML = list.map(b=> bookRowHtml(b.id, b.title, !!b.passSha256)).join('');

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
    body.innerHTML = `<div class="status"><span class="loader"></span> Loading chapters…</div>`;
    try{
      const html = await loadBookTocHtml(book);
      body.innerHTML = html;
    }catch(err){
      body.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function bookRowHtml(id, title, locked=false){
  const safeId = escapeHtml(id);
  const safeTitle = escapeHtml(title || id);
  const lock = locked ? ' 🔒' : '';
  return `
  <div class="card" data-bookrow="${safeId}" aria-expanded="false" style="overflow:hidden">
    <div class="pad" style="display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--border); cursor:pointer">
      <div style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
        <span class="caret" aria-hidden="true">▶</span>
        <strong style="margin-left:.4rem">${safeTitle}${lock}</strong>
        <span class="muted" style="margin-left:.5rem">(${safeId})</span>
      </div>
      <a class="btn" href="#/toc/${encodeURIComponent(safeId)}" onclick="event.stopPropagation()">TOC</a>
    </div>
    <div class="pad book-body"></div>
  </div>`;
}

/* Build clickable chapter list for a book */
async function loadBookTocHtml(bookId){
  const toc = await loadTocArray(bookId);
  const safe = sanitizeSegment(bookId);
  if (!toc) throw new Error(`No <code>${safe}/toc.json</code> or <code>${safe}/toc.md</code> found. Add one to show chapters.`);

  const items = toc.map(item=>{
    const title = escapeHtml(item.title || item.chapter || 'Chapter');
    const ch = ensureMd(sanitizeSegment(item.chapter || ''));
    const href = `#/${encodeURIComponent(safe)}/chapter/${encodeURIComponent(ch)}`;
    return `<li style="padding:.55rem .7rem; border-top:1px solid var(--border)">
      <a href="${href}">${title}</a> <span class="muted">(${ch})</span>
    </li>`;
  }).join('');
  return `<ul style="list-style:none; margin:0; padding:0">${items || '<li class="muted" style="padding:.55rem .7rem">Empty</li>'}</ul>`;
}

/* -------- Go-to -------- */
function viewGoto(){
  const last = localStorage.getItem('lastBook') || '';
  setBookPill(last || null);
  setHTML(app, `
    <section class="card pad">
      <h1>Go to</h1>
      <form id="gotoForm" class="grid" style="gap:12px">
        <div class="field">
          <label style="min-width:92px">Book</label>
          <input id="bookInput" placeholder="e.g. my-book" value="${escapeHtml(last)}" required inputmode="latin-name" autocomplete="off">
        </div>
        <div class="field">
          <label style="min-width:92px">Chapter</label>
          <input id="chapterInput" placeholder="e.g. intro.md or chapter-1" required inputmode="latin-name" autocomplete="off">
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:8px">
          <button class="btn" type="button" id="tocLinkBtn">Show TOC</button>
          <button class="btn" type="submit">Open</button>
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

  // Require auth before entering protected routes
  if (r.page === 'books' || r.page === 'toc' || r.page === 'reader'){
    const ok = await ensureAuthorized(r);
    if (!ok){ viewHome(); return; }
  }

  if (r.page === 'home') return viewHome();
  if (r.page === 'books') return viewBooks();
  if (r.page === 'goto') return viewGoto();
  if (r.page === 'toc') return viewToc(r.book);
  if (r.page === 'reader') return viewReader(r.book, r.chapter);
  viewHome();
}

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);

/* -------- Extras -------- */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-link]');
  if (btn){ location.hash = btn.getAttribute('data-link'); }
});
const tocBtn = document.querySelector('#tocBtn');
if (tocBtn){
  tocBtn.addEventListener('click', ()=>{
    const last = localStorage.getItem('lastBook') || '';
    location.hash = last ? `#/toc/${encodeURIComponent(last)}` : '#/goto';
  });
}
// Single 'g' shortcut to open Go-to
document.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'g') location.hash = '#/goto';
});
