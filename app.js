'use strict';

const $ = id => document.getElementById(id);
const mobile = () => window.matchMedia('(max-width:560px)').matches;
const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const sites = Array.isArray(window.SITES) ? window.SITES : [];
const world = window.WORLD && Array.isArray(window.WORLD.features) ? window.WORLD : null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1440;
const HEIGHT = 720;

let selected = null;
let photoRequest = 0;
let scale = 1;
let tx = 0;
let ty = 0;
let dragging = false;
let dragStart = null;

const mapEl = $('map');

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key,value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function project(lng, lat) {
  return [
    (Number(lng) + 180) * (WIDTH / 360),
    (90 - Number(lat)) * (HEIGHT / 180)
  ];
}

function ringPath(ring) {
  if (!Array.isArray(ring) || !ring.length) return '';
  return ring.map((p,i) => {
    const [x,y] = project(p[0],p[1]);
    return (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }).join(' ') + ' Z';
}

function geometryPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap(poly => poly.map(ringPath)).join(' ');
  }
  return '';
}

function buildMap() {
  mapEl.innerHTML = '';

  const svg = svgEl('svg', {
    class:'world-svg',
    viewBox:'0 0 ' + WIDTH + ' ' + HEIGHT,
    preserveAspectRatio:'xMidYMid meet',
    'aria-hidden':'true'
  });

  const defs = svgEl('defs');
  const shadow = svgEl('filter',{id:'marker-shadow',x:'-100%',y:'-100%',width:'300%',height:'300%'});
  shadow.appendChild(svgEl('feDropShadow',{dx:'0',dy:'2','stdDeviation':'2','flood-opacity':'.25'}));
  defs.appendChild(shadow);
  svg.appendChild(defs);

  svg.appendChild(svgEl('rect',{class:'ocean-fill',x:'0',y:'0',width:WIDTH,height:HEIGHT}));

  const viewport = svgEl('g',{id:'map-viewport'});
  const grid = svgEl('g',{class:'graticule'});

  for (let lat=-60; lat<=60; lat+=30) {
    const [,y] = project(0,lat);
    grid.appendChild(svgEl('line',{x1:'0',y1:y,x2:WIDTH,y2:y}));
  }
  for (let lng=-150; lng<=150; lng+=30) {
    const [x] = project(lng,0);
    grid.appendChild(svgEl('line',{x1:x,y1:'40',x2:x,y2:'680'}));
  }
  viewport.appendChild(grid);

  const land = svgEl('g',{class:'land-layer'});
  if (world) {
    for (const feature of world.features) {
      const d = geometryPath(feature.geometry);
      if (!d) continue;
      const path = svgEl('path',{
        d,
        class:'country-shape',
        'fill-rule':'evenodd'
      });
      const title = document.createElementNS(SVG_NS,'title');
      title.textContent = feature.properties && feature.properties.name ? feature.properties.name : '';
      path.appendChild(title);
      land.appendChild(path);
    }
  } else {
    const msg = svgEl('text',{x:WIDTH/2,y:HEIGHT/2,class:'map-error-text','text-anchor':'middle'});
    msg.textContent = 'Não foi possível carregar a camada geográfica.';
    land.appendChild(msg);
  }
  viewport.appendChild(land);

  const oceanLabels = svgEl('g',{class:'ocean-labels'});
  [
    ['Oceano Pacífico',250,350],
    ['Oceano Atlântico',650,390],
    ['Oceano Índico',1000,430]
  ].forEach(([name,x,y])=>{
    const t=svgEl('text',{x,y,'text-anchor':'middle'});
    t.textContent=name;
    oceanLabels.appendChild(t);
  });
  viewport.appendChild(oceanLabels);

  const markerLayer = svgEl('g',{class:'marker-layer',id:'marker-layer'});
  sites.forEach(site => {
    const [x,y]=project(site.lng,site.lat);
    const g=svgEl('g',{
      class:'site-point',
      transform:'translate('+x+' '+y+')',
      tabindex:'0',
      role:'button',
      'aria-label':site.name + ', ' + site.country,
      'data-site-id':site.id
    });
    const hit=svgEl('circle',{class:'marker-hit',cx:'0',cy:'0',r:'13'});
    const halo=svgEl('circle',{class:'marker-halo',cx:'0',cy:'0',r:'8'});
    const core=svgEl('circle',{class:'marker-core',cx:'0',cy:'0',r:'4.6'});
    const title=document.createElementNS(SVG_NS,'title');
    title.textContent=site.name+' · '+site.country;
    g.append(hit,halo,core,title);
    g.addEventListener('click',e=>{
      e.stopPropagation();
      openSite(site.id);
    });
    g.addEventListener('keydown',e=>{
      if(e.key==='Enter' || e.key===' ') {
        e.preventDefault();
        openSite(site.id);
      }
    });
    markerLayer.appendChild(g);
  });
  viewport.appendChild(markerLayer);

  svg.appendChild(viewport);
  mapEl.appendChild(svg);

  svg.addEventListener('wheel',e=>{
    e.preventDefault();
    const rect=svg.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(WIDTH/rect.width);
    const my=(e.clientY-rect.top)*(HEIGHT/rect.height);
    zoomAt(e.deltaY < 0 ? 1.22 : .82,mx,my);
  },{passive:false});

  svg.addEventListener('pointerdown',e=>{
    if(e.target.closest && e.target.closest('.site-point')) return;
    dragging=true;
    svg.setPointerCapture(e.pointerId);
    dragStart={x:e.clientX,y:e.clientY,tx,ty};
    mapEl.classList.add('is-dragging');
  });

  svg.addEventListener('pointermove',e=>{
    if(!dragging || !dragStart) return;
    const rect=svg.getBoundingClientRect();
    const dx=(e.clientX-dragStart.x)*(WIDTH/rect.width);
    const dy=(e.clientY-dragStart.y)*(HEIGHT/rect.height);
    tx=dragStart.tx+dx;
    ty=dragStart.ty+dy;
    constrainTransform();
    applyTransform();
  });

  const endDrag=()=>{
    dragging=false;
    dragStart=null;
    mapEl.classList.remove('is-dragging');
  };
  svg.addEventListener('pointerup',endDrag);
  svg.addEventListener('pointercancel',endDrag);

  applyTransform();
}

function constrainTransform() {
  if (scale <= 1.02) {
    tx=0; ty=0; return;
  }
  const maxX=(WIDTH*(scale-1))/2 + 220;
  const maxY=(HEIGHT*(scale-1))/2 + 140;
  tx=Math.max(-maxX,Math.min(maxX,tx));
  ty=Math.max(-maxY,Math.min(maxY,ty));
}

function applyTransform() {
  const viewport=document.getElementById('map-viewport');
  if (!viewport) return;
  viewport.setAttribute('transform','translate('+tx+' '+ty+') scale('+scale+')');

  document.querySelectorAll('.site-point').forEach(g=>{
    g.classList.toggle('selected',g.dataset.siteId===selected);
    const inv=1/scale;
    const hit=g.querySelector('.marker-hit');
    const halo=g.querySelector('.marker-halo');
    const core=g.querySelector('.marker-core');
    if(hit) hit.setAttribute('r',13*inv);
    if(halo) halo.setAttribute('r',8*inv);
    if(core) core.setAttribute('r',4.6*inv);
  });

  const labels=document.querySelector('.ocean-labels');
  if(labels) labels.style.opacity=scale>1.55?'0':'1';
}

function zoomAt(factor,cx=WIDTH/2,cy=HEIGHT/2) {
  const old=scale;
  const next=Math.max(1,Math.min(6,old*factor));
  if (Math.abs(next-old)<.001) return;
  tx = cx - ((cx-tx)/old)*next;
  ty = cy - ((cy-ty)/old)*next;
  scale=next;
  constrainTransform();
  applyTransform();
}

function resetMap() {
  scale=1;
  tx=0;
  ty=0;
  applyTransform();
}

function focusSite(site) {
  const [x,y]=project(site.lng,site.lat);
  scale=mobile()?2.55:2.8;
  tx=WIDTH/2-x*scale + (mobile()?0:-125);
  ty=HEIGHT/2-y*scale + (mobile()?-55:0);
  constrainTransform();
  applyTransform();
}

function commonsSearchUrl(s) {
  return 'https://commons.wikimedia.org/w/index.php?search=' +
    encodeURIComponent(s.commonsQuery || s.name) +
    '&title=Special:MediaSearch&type=image';
}

function stripHtml(value) {
  const div=document.createElement('div');
  div.innerHTML=value || '';
  return (div.textContent || '').replace(/\s+/g,' ').trim();
}

async function loadSitePhoto(s) {
  const requestId=++photoRequest;
  const img=$('site-photo');
  const error=$('photo-error');
  const fallback=$('photo-fallback');
  const imageLink=$('image-link');
  const credit=$('image-credit');
  const searchUrl=commonsSearchUrl(s);

  error.hidden=true;
  img.removeAttribute('src');
  img.alt=s.name+' — arte rupestre';
  fallback.href=searchUrl;
  imageLink.href=searchUrl;
  credit.textContent='Buscando fotografia em Wikimedia Commons…';

  const api=new URL('https://commons.wikimedia.org/w/api.php');
  api.searchParams.set('action','query');
  api.searchParams.set('generator','search');
  api.searchParams.set('gsrsearch',s.commonsQuery || s.name);
  api.searchParams.set('gsrnamespace','6');
  api.searchParams.set('gsrlimit','8');
  api.searchParams.set('prop','imageinfo');
  api.searchParams.set('iiprop','url|extmetadata');
  api.searchParams.set('iiurlwidth','1200');
  api.searchParams.set('format','json');
  api.searchParams.set('origin','*');

  try {
    const response=await fetch(api.toString(),{mode:'cors'});
    if(!response.ok) throw new Error('Commons HTTP '+response.status);
    const data=await response.json();
    if(requestId!==photoRequest || selected!==s.id) return;

    const pages=Object.values((data.query&&data.query.pages)||{})
      .filter(p=>p.imageinfo&&p.imageinfo[0]&&(p.imageinfo[0].thumburl||p.imageinfo[0].url))
      .sort((a,b)=>(a.index||999)-(b.index||999));
    if(!pages.length) throw new Error('Nenhuma imagem encontrada');

    const page=pages[0];
    const info=page.imageinfo[0];
    const meta=info.extmetadata||{};
    const commonsPage='https://commons.wikimedia.org/wiki/'+encodeURIComponent(page.title.replace(/ /g,'_'));

    img.onload=()=>{ if(requestId===photoRequest) error.hidden=true; };
    img.onerror=()=>{ if(requestId===photoRequest) error.hidden=false; };
    img.src=info.thumburl||info.url;
    imageLink.href=commonsPage;
    fallback.href=commonsPage;

    const artist=stripHtml(meta.Artist&&meta.Artist.value);
    const license=stripHtml(meta.LicenseShortName&&meta.LicenseShortName.value);
    credit.textContent=[artist,license,'Wikimedia Commons'].filter(Boolean).join(' · ');
  } catch(err) {
    if(requestId!==photoRequest || selected!==s.id) return;
    error.hidden=false;
    credit.textContent='Fotografia não carregada. Use o link para consultar o Wikimedia Commons.';
  }
}

function openSite(id) {
  const s=sites.find(x=>x.id===id);
  if(!s) return;

  selected=id;
  $('site-select').value=id;
  $('card-title').textContent=s.name;
  $('card-description').textContent=s.description;
  $('card-region').textContent=s.region;
  $('card-index').textContent=String(sites.indexOf(s)+1).padStart(2,'0')+' / '+sites.length;
  $('card-age').textContent=s.age;
  $('card-country').textContent=s.country;
  $('card-period').textContent=s.period;
  $('card-note').textContent=s.note;
  $('source-link').href=s.source;
  $('site-card').hidden=false;
  $('site-card').scrollTop=0;
  document.body.classList.add('card-open');

  loadSitePhoto(s);
  focusSite(s);
  $('status').textContent=s.name+', '+s.country+', '+s.age;
  $('card-title').focus({preventScroll:true});
}

function closeCard() {
  selected=null;
  photoRequest++;
  $('site-card').hidden=true;
  document.body.classList.remove('card-open');
  $('site-select').value='';
  applyTransform();
  $('site-select').focus({preventScroll:true});
}

function init() {
  buildMap();

  sites.slice()
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
    .forEach(s=>{
      const option=document.createElement('option');
      option.value=s.id;
      option.textContent=s.name+' · '+s.country;
      $('site-select').appendChild(option);
    });

  $('site-select').addEventListener('change',e=>{
    if(e.target.value) openSite(e.target.value);
  });
  $('close-card').addEventListener('click',closeCard);
  $('zoom-in').addEventListener('click',()=>zoomAt(1.32));
  $('zoom-out').addEventListener('click',()=>zoomAt(.76));
  $('reset').addEventListener('click',()=>{
    if(selected) closeCard();
    resetMap();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&selected) closeCard();
  });

  if(!world) $('status').textContent='A camada do mapa-múndi não foi carregada.';
}

try {
  init();
} catch(err) {
  console.error(err);
  mapEl.innerHTML='<div class="map-fatal">Não foi possível montar o mapa.<small>'+String(err.message||err)+'</small></div>';
}
