/* Choto You landing page — no analytics, no backend, no build tools required. */
const SHEET_FRAMES = { idle:{row:0,frames:[0,1,2,3,4,5,6,7],ms:330}, wave:{row:2,frames:[0,1,2,3,4,5,6,7],ms:210}, run:{row:1,frames:[0,1,2,3,4,5,6,7],ms:115}, cheer:{row:3,frames:[3,0,3,0],ms:260}, drink:{row:3,frames:[5],ms:600}, sleep:{row:3,frames:[7],ms:600} };
const spriteNodes = [...document.querySelectorAll('.sprite')];
function paintSprite(el,row,col){el.style.backgroundPosition = `${(col/7)*100}% ${(row/3)*100}%`;}
function spriteLoop(el){if(el.dataset.still){const [col,row]=el.dataset.still.split(',').map(Number);paintSprite(el,row,col);return;}
  const animation=el.dataset.animation||'idle';const setting=SHEET_FRAMES[animation]||SHEET_FRAMES.idle;
  const elapsed=performance.now()+(Number(el.dataset.phase||0));const frame=Math.floor(elapsed/setting.ms)%setting.frames.length;
  paintSprite(el,setting.row,setting.frames[frame]);}
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){function tick(){spriteNodes.forEach(spriteLoop);requestAnimationFrame(tick)}requestAnimationFrame(tick)}else spriteNodes.forEach(spriteLoop);
spriteNodes.forEach((node,idx)=>{node.dataset.phase=String(idx*187)});
// If the default sheet is unavailable, provide a bundled static mascot.
const sheetProbe=new Image();
sheetProbe.onerror=()=>{document.querySelectorAll('.sprite').forEach(el=>{el.style.backgroundImage="url('assets/mascot-fallback.svg')";el.style.backgroundSize='contain';el.style.backgroundPosition='center';});};
sheetProbe.src='assets/rafi-sprite-sheet.png';
const moodButtons=document.querySelectorAll('.mood');const demoChar=document.getElementById('demo-character');const demoSpeech=document.getElementById('demo-speech');const expressions={idle:'hiya, human! ♡',run:'got places to be!! ⚡',drink:'water break! 💧',sleep:'five more minutes... zzz',cheer:'YOU DID IT!! 🎉'};
const demoPerson = document.getElementById('demo-person');
const demoPeople = {
  rafi: { sheet: 'assets/rafi-sprite-sheet.png', name: 'Rafi', messages: expressions },
  ma: {
    sheet: 'assets/ma-sprite-sheet.png', name: 'Ma',
    messages: { idle: 'Kheye nao, baba! ♡', run: 'Ektu hete nao! ♡', drink: 'Pani kheye nao! 💧', sleep: 'Onek raat, ghumiye poro! ♡', cheer: 'Shabash, baba! ♡' },
  },
  baba: {
    sheet: 'assets/baba-sprite-sheet.png', name: 'Baba',
    messages: { idle: 'Ektu break nao, baba! ♡', run: 'Cholo, ektu hati! ♡', drink: 'Pani khete bhulo na! 💧', sleep: 'Raat hoyeche, ghumiye poro! ♡', cheer: 'Shabash! Tomake niye gorbito! ♡' },
  },
  'choto-bon': {
    sheet: 'assets/choto-bon-sprite-sheet.png', name: 'Siblings',
    messages: { idle: 'Bhaiya, ektu break nao! ♡', run: 'Cholo, kheli! ♡', drink: 'Bhaiya, pani kheye nao! 💧', sleep: 'Good night, bhaiya! ♡', cheer: 'Yay! Tumi perecho! ♡' },
  },
  gf: {
    sheet: 'assets/gf-sprite-sheet.png', name: 'GF',
    messages: { idle: 'Get ready for our date! ♡', run: 'Cholo, berate jai! ♡', drink: 'Pani kheye nao, please! 💧', sleep: 'Good night, sweet dreams! ♡', cheer: 'So proud of you! ♡' },
  },
};
function setMood(mood){demoChar.dataset.animation=mood;demoSpeech.textContent=demoPeople[demoPerson.value].messages[mood];moodButtons.forEach(btn=>{const active=btn.dataset.mood===mood;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active))});spriteLoop(demoChar);demoSpeech.style.transform=`rotate(${mood==='sleep'?-7:8}deg)`}
moodButtons.forEach(btn=>btn.addEventListener('click',()=>setMood(btn.dataset.mood)));
function selectDemoPerson() {
  const person = demoPeople[demoPerson.value];
  demoChar.style.backgroundImage = `url('${person.sheet}')`;
  demoChar.style.backgroundSize = '800% 400%';
  demoChar.setAttribute('aria-label', `${person.name}, interactive animated companion`);
  setMood(demoChar.dataset.animation || 'idle');
  spriteLoop(demoChar);
}
demoPerson.addEventListener('change', selectDemoPerson);
selectDemoPerson();
// Drag within the live playground; never drag the real desktop companion from the page.
const screen=document.getElementById('demo-screen');let drag=null;
demoChar.addEventListener('pointerdown',e=>{if(e.button!==0)return;const rect=demoChar.getBoundingClientRect();drag={pointer:e.pointerId,shiftX:e.clientX-rect.left,shiftY:e.clientY-rect.top};demoChar.setPointerCapture(e.pointerId);e.preventDefault()});
demoChar.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointer)return;const bound=screen.getBoundingClientRect();const w=demoChar.offsetWidth,h=demoChar.offsetHeight;const x=Math.min(bound.width-w,Math.max(0,e.clientX-bound.left-drag.shiftX));const y=Math.min(bound.height-h,Math.max(0,e.clientY-bound.top-drag.shiftY));demoChar.style.left=`${x}px`;demoChar.style.top=`${y}px`;demoChar.style.bottom='auto'});
demoChar.addEventListener('pointerup',()=>{drag=null;demoSpeech.textContent='weeeee!! ♡'});demoChar.addEventListener('pointercancel',()=>{drag=null});
// GitHub API dynamically selects the actual installer of the latest published release.
// If network/API access is unavailable, buttons safely lead to the official latest release page.
async function resolveDownloads(){try{const response=await fetch('https://api.github.com/repos/tanvirahmodrafi/Choto-You/releases/latest',{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error('release unavailable');const data=await response.json();const assets=data.assets||[];const mac=assets.find(a=>/\.dmg$/i.test(a.name)&&/universal/i.test(a.name))||assets.find(a=>/\.dmg$/i.test(a.name));const win=assets.find(a=>/-setup\.exe$/i.test(a.name))||assets.find(a=>/\.exe$/i.test(a.name));for(const link of document.querySelectorAll('[data-download="mac"]'))if(mac)link.href=mac.browser_download_url;for(const link of document.querySelectorAll('[data-download="windows"]'))if(win)link.href=win.browser_download_url;const note=document.getElementById('release-note');if(data.tag_name)note.textContent=`Latest official release ${data.tag_name} · macOS & Windows · No account required`; }catch(err){/* GitHub releases page remains usable */}}
resolveDownloads();
const menuButton=document.querySelector('.menu-toggle');const mobileMenu=document.querySelector('.mobile-menu');menuButton.addEventListener('click',()=>{const open=mobileMenu.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Close menu':'Open menu')});mobileMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobileMenu.classList.remove('open');menuButton.setAttribute('aria-expanded','false')}));
const backButton=document.querySelector('.back-to-top');window.addEventListener('scroll',()=>backButton.classList.toggle('visible',window.scrollY>800),{passive:true});backButton.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));document.getElementById('year').textContent=String(new Date().getFullYear());
