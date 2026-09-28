'use strict';

const $ = id => document.getElementById(id);
const mobile = () => window.matchMedia('(max-width:560px)').matches;
const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const sites = Array.isArray(window.SITES) ? window.SITES : [];
const world = window.WORLD && Array.isArray(window.WORLD.features) ? window.WORLD : null;

const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
  minZoom: 1,
  maxZoom: 8,
  zoomSnap: .25,
  worldCopyJump: false,
  preferCanvas: true,
  maxBounds: [[-80,-190],[85,190]],
  maxBoundsViscosity: .8
});

map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
map.attributionControl.addAttribution('<a href="https://github.com/johan/world.geo.json" target="_blank" rel="noopener">Mapa: Natural Earth</a>');

let countryLayer = null;
if (world) {
  countryLayer = L.geoJSON(world, {
    style: {
      color: '#9fb7c0',
      weight: .8,
      fillColor: '#fbfaf6',
      fillOpacity: 1
    },
    interactive: false
  }).addTo(map);
}

for (let lat=-60; lat<=60; lat+=30) {
  L.polyline([[lat,-180],[lat,180]], {
    color:'#bfd0d6', weight:.55, opacity:.55, interactive:false
  }).addTo(map);
}
for (let lng=-180; lng<=180; lng+=30) {
  L.polyline([[-75,lng],[82,lng]], {
    color:'#bfd0d6', weight:.55, opacity:.55, interactive:false
  }).addTo(map);
}

const markers = L.layerGroup().addTo(map);
const labels = L.layerGroup().addTo(map);
let selected = null;
let photoRequest = 0;

function worldView() {
  map.fitBounds([[-57,-145],[72,170]], {
    paddingTopLeft:[20, mobile() ? 165 : 110],
    paddingBottomRight:[20,45],
    animate:false
  });
}

function render() {
  markers.clearLayers();
  labels.clearLayers();
  const groups = [];

  for (const s of sites) {
    const point = map.latLngToLayerPoint([s.lat,s.lng]);
    const group = groups.find(g =>
      g.point.distanceTo(point) < 31 &&
      s.id !== selected &&
      !g.items.some(x => x.id === selected)
    );
    if (group) group.items.push(s);
    else groups.push({point,items:[s]});
  }

  for (const group of groups) {
    const count = group.items.length;
    const s = group.items[0];
    const coords = count === 1
      ? [s.lat,s.lng]
      : [
          group.items.reduce((a,x)=>a+x.lat,0)/count,
          group.items.reduce((a,x)=>a+x.lng,0)/count
        ];

    const marker = L.marker(coords, {
      icon: L.divIcon({
        className:'site-marker' + (s.id === selected ? ' selected' : ''),
        html: count === 1 ? '<span class="pin"></span>' : '<span class="cluster">'+count+'</span>',
        iconSize:[44,44],
        iconAnchor:[22,22]
      }),
      keyboard:true,
      title: count === 1 ? s.name : count + ' sítios: ' + group.items.map(x=>x.name).join(', '),
      alt: count === 1 ? s.name : 'Ampliar grupo de ' + count + ' sítios',
      riseOnHover:true
    }).addTo(markers);

    marker.on('click', () => {
      if (count > 1) {
        map.fitBounds(group.items.map(x=>[x.lat,x.lng]), {
          padding:[70,70],
          maxZoom:6,
          animate:!reduced
        });
      } else {
        openSite(s.id);
      }
    });

    if (count === 1) {
      marker.bindTooltip(s.name,{direction:'top',offset:[0,-13]});
    }
  }

  const oceans = [
    ['Oceano Pacífico',10,-133],
    ['Oceano Atlântico',5,-32],
    ['Oceano Índico',-24,79]
  ];

  if (map.getZoom() < 3.2) {
    for (const [name,lat,lng] of oceans) {
      L.marker([lat,lng], {
        interactive:false,
        keyboard:false,
        icon:L.divIcon({
          className:'ocean-label',
          html:name,
          iconSize:[180,20],
          iconAnchor:[90,10]
        })
      }).addTo(labels);
    }
  }

  if (map.getZoom() >= 3 && countryLayer) {
    const known = {
      'Brazil':'Brasil','France':'França','Spain':'Espanha','United Kingdom':'Reino Unido',
      'Egypt':'Egito','Greece':'Grécia','Italy':'Itália','Turkey':'Turquia','China':'China',
      'India':'Índia','Iraq':'Iraque','Iran':'Irã','Australia':'Austrália','Mexico':'México',
      'Peru':'Peru','Chile':'Chile','Argentina':'Argentina','Russia':'Rússia',
      'United States of America':'Estados Unidos','Canada':'Canadá','South Africa':'África do Sul',
      'Algeria':'Argélia','Saudi Arabia':'Arábia Saudita','Indonesia':'Indonésia',
      'Pakistan':'Paquistão','Kazakhstan':'Cazaquistão','Mongolia':'Mongólia',
      'Azerbaijan':'Azerbaijão','Botswana':'Botsuana','Namibia':'Namíbia','Tanzania':'Tanzânia',
      'Libya':'Líbia','Portugal':'Portugal','Sweden':'Suécia'
    };

    countryLayer.eachLayer(layer => {
      if (!layer.getBounds) return;
      const bounds = layer.getBounds();
      if (!map.getBounds().intersects(bounds)) return;
      const size = map.latLngToLayerPoint(bounds.getNorthEast())
        .distanceTo(map.latLngToLayerPoint(bounds.getSouthWest()));
      if (size < 65) return;
      const raw = layer.feature && layer.feature.properties ? layer.feature.properties.name : '';
      L.marker(bounds.getCenter(), {
        interactive:false,
        keyboard:false,
        icon:L.divIcon({
          className:'country-label',
          html:known[raw] || raw,
          iconSize:[150,15],
          iconAnchor:[75,7]
        })
      }).addTo(labels);
    });
  }
}

function commonsSearchUrl(s) {
  return 'https://commons.wikimedia.org/w/index.php?search=' +
    encodeURIComponent(s.commonsQuery || s.name) +
    '&title=Special:MediaSearch&type=image';
}

function stripHtml(value) {
  const div = document.createElement('div');
  div.innerHTML = value || '';
  return (div.textContent || '').replace(/\s+/g,' ').trim();
}

async function loadSitePhoto(s) {
  const requestId = ++photoRequest;
  const img = $('site-photo');
  const error = $('photo-error');
  const fallback = $('photo-fallback');
  const imageLink = $('image-link');
  const credit = $('image-credit');
  const searchUrl = commonsSearchUrl(s);

  error.hidden = true;
  img.removeAttribute('src');
  img.alt = s.name + ' — arte rupestre';
  fallback.href = searchUrl;
  imageLink.href = searchUrl;
  credit.textContent = 'Buscando fotografia em Wikimedia Commons…';

  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.searchParams.set('action','query');
  api.searchParams.set('generator','search');
  api.searchParams.set('gsrsearch',s.commonsQuery || s.name);
  api.searchParams.set('gsrnamespace','6');
  api.searchParams.set('gsrlimit','10');
  api.searchParams.set('prop','imageinfo');
  api.searchParams.set('iiprop','url|extmetadata');
  api.searchParams.set('iiurlwidth','1200');
  api.searchParams.set('format','json');
  api.searchParams.set('origin','*');

  try {
    const response = await fetch(api.toString(), {mode:'cors'});
    if (!response.ok) throw new Error('Commons HTTP ' + response.status);
    const data = await response.json();
    if (requestId !== photoRequest || selected !== s.id) return;

    const pages = Object.values((data.query && data.query.pages) || {})
      .filter(p => p.imageinfo && p.imageinfo[0] && (p.imageinfo[0].thumburl || p.imageinfo[0].url))
      .sort((a,b)=>(a.index || 999)-(b.index || 999));

    if (!pages.length) throw new Error('Nenhuma imagem encontrada');

    const page = pages[0];
    const info = page.imageinfo[0];
    const meta = info.extmetadata || {};
    const commonsPage = 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g,'_'));

    img.onload = () => {
      if (requestId === photoRequest) error.hidden = true;
    };
    img.onerror = () => {
      if (requestId === photoRequest) error.hidden = false;
    };
    img.src = info.thumburl || info.url;
    imageLink.href = commonsPage;
    fallback.href = commonsPage;

    const artist = stripHtml(meta.Artist && meta.Artist.value);
    const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
    credit.textContent = [artist,license,'Wikimedia Commons'].filter(Boolean).join(' · ');
  } catch (err) {
    if (requestId !== photoRequest || selected !== s.id) return;
    error.hidden = false;
    credit.textContent = 'Fotografia não carregada. Use o link para consultar o Wikimedia Commons.';
  }
}

function openSite(id) {
  const s = sites.find(x=>x.id===id);
  if (!s) return;

  selected = id;
  $('site-select').value = id;
  $('card-title').textContent = s.name;
  $('card-description').textContent = s.description;
  $('card-region').textContent = s.region;
  $('card-index').textContent = String(sites.indexOf(s)+1).padStart(2,'0') + ' / ' + sites.length;
  $('card-age').textContent = s.age;
  $('card-country').textContent = s.country;
  $('card-period').textContent = s.period;
  $('card-note').textContent = s.note;
  $('source-link').href = s.source;
  $('site-card').hidden = false;
  $('site-card').scrollTop = 0;
  document.body.classList.add('card-open');

  loadSitePhoto(s);

  const zoom = Math.max(map.getZoom(), mobile() ? 3 : 3.25);
  const point = map.project([s.lat,s.lng],zoom);
  point.x += mobile() ? 0 : 190;
  point.y += mobile() ? map.getSize().y * .23 : 0;
  map.setView(map.unproject(point,zoom),zoom,{animate:!reduced});
  render();

  $('status').textContent = s.name + ', ' + s.country + ', ' + s.age;
  $('card-title').focus({preventScroll:true});
}

function closeCard() {
  selected = null;
  photoRequest++;
  $('site-card').hidden = true;
  document.body.classList.remove('card-open');
  $('site-select').value = '';
  render();
  $('site-select').focus({preventScroll:true});
}

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
$('close-card').onclick=closeCard;
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && selected) closeCard();
});
$('zoom-in').onclick=()=>map.zoomIn();
$('zoom-out').onclick=()=>map.zoomOut();
$('reset').onclick=()=>{
  if(selected) closeCard();
  worldView();
};

map.on('zoomend moveend',render);
window.addEventListener('resize',()=>{
  map.invalidateSize(true);
  if(!selected) worldView();
});

requestAnimationFrame(()=>{
  map.invalidateSize(true);
  worldView();
  render();
  if (!world) {
    $('status').textContent='A camada do mapa-múndi não foi carregada.';
  }
});
