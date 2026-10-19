/**
 * THEME CONTRAST AUDIT · every text run, both themes, measured against the
 * pixels actually behind it.
 *
 * WHY THIS EXISTS
 * ---------------
 * `design-scorecard.mjs` only ever measures the DEFAULT theme. That is how a
 * fully unusable light theme shipped and reported `0 contrast failures` for
 * months, and the README has carried a "check both themes by hand" note ever
 * since — an instruction nobody can execute reliably across ~40 route/theme
 * combinations. This is that instruction, automated.
 *
 * It caught 150 real failures on 2026-08-27: /hashrate and
 * /solo-mining-calculator paint their instrument panels fixed-dark, but the
 * TEXT tokens inside them still flipped with the page, so light-theme visitors
 * got #1a1916 prose on an #0b0b0e panel — including the rental price the
 * page exists to sell, at 1.08:1.
 *
 * METHOD, and the three instrument bugs it exists to avoid — each of which
 * produced a confidently wrong number on this site before being fixed:
 *
 *   1. NEVER parse CSS colours with a regex. Tailwind v4 serialises any
 *      colour carrying an opacity modifier as `oklab(0.97 0.001 0.011 / 0.4)`,
 *      which a /[\d.]+/ parser reads as rgb(0.97, 0.001, 0.011) — near black.
 *      That invented ~74 phantom failures on EVERY light page. Colours are
 *      resolved by painting them on a 1x1 canvas over black and over white and
 *      solving `a = 1 - (C_w - C_b)/255`, which is exact for every syntax the
 *      browser supports.
 *
 *   2. NEVER walk `backgroundColor` to find the background. It cannot see
 *      `background-image`, so /float's Supply Clock — a deliberately fixed-dark
 *      gradient scene — reported as white paper and produced 20 fake failures.
 *      The real background is read from the rendered pixels: hide every glyph,
 *      screenshot, and take the median pixel under each element's own box.
 *
 *   3. NEVER use a fullPage screenshot for this. It resizes the viewport, so
 *      coordinates collected beforehand no longer line up — footer links ended
 *      up sampling vendor artwork from higher up the page. Plates are captured
 *      one viewport at a time and sampled in viewport coordinates.
 *
 * Also deliberately skipped: elements inside `[disabled]` (WCAG 1.4.3 exempts
 * inactive components, and a `disabled:opacity-40` button otherwise buries the
 * real findings) and elements inside fixed/sticky chrome, whose background is
 * whatever happens to be scrolling under them at that instant.
 *
 * NOT in `npm run verify`: needs a running dev server and a browser, the same
 * exclusion rationale as check-treasury-mnav and design-scorecard.
 *
 * USAGE
 *   ./node_modules/.bin/next dev -p 3137
 *   node scripts/check-theme-contrast.mjs
 *   node scripts/check-theme-contrast.mjs --routes /hashrate,/float --width 390
 *   node scripts/check-theme-contrast.mjs --json out.json
 *
 * Exits non-zero when any real failure is found, so it can gate a design pass.
 */

import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = flag("url", process.env.BASE || "http://127.0.0.1:3137");
const ROUTES = (flag("routes", process.env.ROUTES) || "/,/stack,/treasuries,/float,/hashrate,/today,/arcade,/submit,/about,/fit,/glossary,/pulse,/status,/solo-mining-calculator,/online-stores-that-accept-bitcoin,/map,/privacy,/spend-bitcoin-in/brazil,/how-to-accept-bitcoin,/bitcoin-halving-countdown").split(",");
const W = +flag("width", process.env.W || 1440);
const H = +flag("height", process.env.H || 900);

const COLLECT = /* js */ `() => {
  const cv=document.createElement('canvas'); cv.width=cv.height=1;
  const ctx=cv.getContext('2d',{willReadFrequently:true}); const cache=new Map();
  function rgba(css){ if(cache.has(css)) return cache.get(css); let out=null;
    try{ const read=b=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=b;ctx.fillRect(0,0,1,1);
      ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data;};
      const b=read('#000'), w=read('#fff');
      const a=1-((w[0]-b[0])+(w[1]-b[1])+(w[2]-b[2]))/765;
      out=a<=0.002?{r:0,g:0,b:0,a:0}:{r:b[0]/a,g:b[1]/a,b:b[2]/a,a:Math.min(1,a)};
    }catch{} cache.set(css,out); return out; }
  const vis=el=>{ let n=el;
    while(n&&n!==document.documentElement){ const s=getComputedStyle(n);
      if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0) return false; n=n.parentElement; }
    const r=el.getBoundingClientRect();
    return r.width>2&&r.height>2&&r.bottom>-2000&&r.right>-2000; };
  // Bands owned by fixed/sticky chrome: an item under them is occluded and
  // its pixels are the chrome's, not its own.
  const fixedBands=[...document.querySelectorAll('body *')].filter(e=>{
    const s=getComputedStyle(e); return (s.position==='fixed'||s.position==='sticky')&&vis(e);
  }).map(e=>{const r=e.getBoundingClientRect();return [r.top,r.bottom,r.left,r.right];});
  const items=[];
  for(const el of document.querySelectorAll('body *')){
    if(!vis(el)) continue;
    const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
    if(own.length<=3) continue;
    // WCAG 1.4.3 exempts inactive components; a disabled:opacity-40 button
    // is not a contrast defect and reporting it buries the real ones.
    if(el.closest('[disabled],[aria-disabled="true"],fieldset[disabled]')) continue;
    // SVG text is painted with the fill property, not color. Reading color
    // on the PressureGauge's engraved nameplate reported the inherited theme
    // ink instead of its hardcoded rgba(185,190,200,.6) and invented failures.
    // (No backticks in here: this whole block is a template literal.)
    const s=getComputedStyle(el);
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    const paint = isSvg ? s.fill : s.color;
    if(isSvg && (!paint || paint==='none')) continue;
    const c=rgba(paint); if(!c||c.a===0) continue;
    const r=el.getBoundingClientRect();
    let fixed=false; let p=el;
    while(p&&p!==document.documentElement){const ps=getComputedStyle(p);
      if(ps.position==='fixed'||ps.position==='sticky'){fixed=true;break;} p=p.parentElement;}
    el.setAttribute('data-gm-probe', String(items.length));
    items.push({ x:r.left+scrollX, y:r.top+scrollY, w:r.width, h:r.height, fixed,
      fg:[c.r,c.g,c.b,c.a], px:+parseFloat(s.fontSize).toFixed(1), weight:+s.fontWeight,
      sel: el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):''),
      text: own.replace(/\\s+/g,' ').slice(0,44) });
  }
  window.__bands=fixedBands; window.__items=items; return items.length;
}`;

const SAMPLE = /* js */ `(dataUrl) => new Promise(res => {
  const img=new Image();
  img.onload=()=>{
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
    const sy=window.scrollY, sx=window.scrollX, vh=innerHeight, vw=innerWidth;
    // Recomputed for THIS plate: /hashrate pins a dark "YOUR PICK / RENT NOW"
    // bar over the footer once you scroll, and a bands list captured at
    // scroll 0 does not know it exists.
    const bands=[...document.querySelectorAll('body *')].filter(e=>{
      const st=getComputedStyle(e);
      if(st.position!=='fixed'&&st.position!=='sticky') return false;
      if(st.display==='none'||st.visibility==='hidden'||+st.opacity===0) return false;
      const q=e.getBoundingClientRect();
      return q.width>4&&q.height>4;
    }).map(e=>{const q=e.getBoundingClientRect();return [q.top,q.bottom,q.left,q.right];});
    const out=[];
    window.__items.forEach((it,i)=>{
      if(it.fixed) return;
      const live=document.querySelector('[data-gm-probe="'+i+'"]');
      if(!live) return;
      const lr=live.getBoundingClientRect();
      if(lr.width<1||lr.height<1) return;
      it={...it, w:lr.width, h:lr.height};
      const top=lr.top, left=lr.left;
      if(top<2||top+it.h>vh-2||left<0||left+it.w>vw) return;   // fully on this plate only
      // Occluded by fixed/sticky chrome: the pixels there belong to the
      // header glass, not to this element. A reader scrolls it clear.
      let inFixed=false; { let q=live;
        while(q&&q!==document.documentElement){const qs=getComputedStyle(q);
          if(qs.position==='fixed'||qs.position==='sticky'){inFixed=true;break;} q=q.parentElement;} }
      if(inFixed) return;
      for(const [bt,bb,bl,br] of bands)
        if(top < bb && top+it.h > bt && left < br && left+it.w > bl) return;
      const x0=Math.round(left), y0=Math.round(top);
      const w=Math.max(1,Math.round(it.w)), h=Math.max(1,Math.round(it.h));
      if(x0+w>c.width||y0+h>c.height) return;
      const d=g.getImageData(x0,y0,w,h).data;
      const R=[],G=[],B=[];
      const step=Math.max(1,Math.floor(d.length/4/2000))*4;
      for(let k=0;k<d.length;k+=step){R.push(d[k]);G.push(d[k+1]);B.push(d[k+2]);}
      const med=a=>{a.sort((p,q)=>p-q);return a[a.length>>1];};
      out.push([i,[med(R),med(G),med(B)]]);
    });
    res(out);
  };
  img.src=dataUrl;
})`;

const relLum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};

const browser=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox"]});
const report={};
/* A route that ERRORS is UNMEASURED, not clean. This summary used to count
   only the combos that made it into `report`, so four navigation timeouts
   printed "no contrast failures across 36 route/theme combinations" for a
   run of 40 and exited 0 — /today and /arcade went unmeasured in BOTH
   themes while the gate read green. That is the same failure this file was
   written to end, arriving through the error path instead of the light
   theme. Errors are retried once (a cold start should not cry wolf) and
   then reported as failures. */
const errors=[];
const EXPECTED=ROUTES.length*2;
for(const theme of ["dark","light"]){
  for(const route of ROUTES){
   let lastErr=null;
   for(let attempt=1;attempt<=2;attempt++){
    const page=await browser.newPage();
    await page.setViewport({width:W,height:H,deviceScaleFactor:1});
    await page.evaluateOnNewDocument((t)=>{try{localStorage.setItem("gm_theme",t)}catch{}},theme);
    try{
      await page.goto(BASE+route,{waitUntil:"networkidle2",timeout:60000});
      await new Promise(r=>setTimeout(r,700));
      // settle lazy content the same way a reader would
      await page.evaluate(async()=>{const H=innerHeight;
        for(let y=0;y<document.body.scrollHeight;y+=H){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,90));}
        window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400));});
      const n=await page.evaluate(`(${COLLECT})()`);
      await page.addStyleTag({content:`*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important;text-decoration-color:transparent!important}`});
      await new Promise(r=>setTimeout(r,300));
      const bgOf=new Map();
      const pageH=await page.evaluate(()=>document.body.scrollHeight);
      for(let y=0;y<pageH;y+=Math.floor(H*0.8)){
        await page.evaluate(v=>window.scrollTo(0,v),y);
        await new Promise(r=>setTimeout(r,180));
        const shot=await page.screenshot({encoding:"base64",type:"png"});
        const got=await page.evaluate(`(${SAMPLE})(${JSON.stringify("data:image/png;base64,")}+${JSON.stringify(shot)})`);
        for(const [i,bg] of got) if(!bgOf.has(i)) bgOf.set(i,bg);
      }
      const items=await page.evaluate(()=>window.__items);
      const fails=[];
      for(const [i,bg] of bgOf){
        const it=items[i]; const fg=it.fg;
        const fgc = fg[3]>=0.995?[fg[0],fg[1],fg[2]]
          :[fg[0]*fg[3]+bg[0]*(1-fg[3]),fg[1]*fg[3]+bg[1]*(1-fg[3]),fg[2]*fg[3]+bg[2]*(1-fg[3])];
        const lf=relLum(fgc), lb=relLum(bg);
        const ratio=(Math.max(lf,lb)+0.05)/(Math.min(lf,lb)+0.05);
        const large=it.px>=24||(it.px>=18.66&&it.weight>=700);
        const req=large?3:4.5;
        if(ratio<req) fails.push({ratio:+ratio.toFixed(2),req,px:it.px,
          fg:`rgb(${fgc.map(v=>Math.round(v)).join(',')})`,bg:`rgb(${bg.join(',')})`,
          sel:it.sel,text:it.text});
      }
      report[`${theme} ${route}`]={sampled:n,measured:bgOf.size,failCount:fails.length,
        fails:fails.sort((a,b)=>a.ratio-b.ratio).slice(0,30)};
      console.log(`${theme.padEnd(5)} ${route.padEnd(38)} measured=${String(bgOf.size).padStart(4)}/${String(n).padEnd(4)} fails=${fails.length}`);
      lastErr=null;
    }catch(e){ lastErr=e; }
    await page.close();
    if(!lastErr) break;
    if(attempt===2){
      console.log(`${theme.padEnd(5)} ${route.padEnd(38)} ERROR ${lastErr.message.slice(0,70)}`);
      errors.push({theme,route,msg:lastErr.message.split("\n")[0].slice(0,90)});
    }
   }
  }
}
await browser.close();
const out = flag("json", process.env.OUT);
if (out) {
  const fs = await import("node:fs");
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log("\nwrote", out);
}

const failed = Object.entries(report).filter(([, v]) => v.failCount > 0);
if (errors.length) {
  console.log(`\n\u2717 ${errors.length} of ${EXPECTED} route/theme combinations could not be measured:\n`);
  for (const e of errors) console.log(`  ${e.theme.padEnd(5)} ${e.route.padEnd(38)} ${e.msg}`);
  console.log("\nUnmeasured is not clean. Re-run; if it persists the route is");
  console.log("genuinely failing to settle and that is itself the finding.");
}
if (!failed.length && !errors.length) {
  console.log(`\n\u2713 no contrast failures across all ${EXPECTED} route/theme combinations`);
  process.exit(0);
}
if (!failed.length) process.exit(1);
console.log("\n\u2717 contrast failures:\n");
for (const [key, v] of failed) {
  console.log(`  ${key} (${v.failCount})`);
  for (const c of v.fails.slice(0, 8)) {
    console.log(`     ${String(c.ratio).padStart(5)}/${c.req}  ${String(c.px).padStart(5)}px  fg=${c.fg.padEnd(17)} bg=${c.bg.padEnd(17)} ${c.sel.slice(0, 42)}  "${c.text.slice(0, 30)}"`);
  }
}
console.log("\nA failure here is usually one of two things: a hard-coded colour");
console.log("literal with no theme twin, or theme-aware ink sitting on a");
console.log("deliberately theme-INDEPENDENT surface (see .instr in globals.css).");
process.exit(1);
