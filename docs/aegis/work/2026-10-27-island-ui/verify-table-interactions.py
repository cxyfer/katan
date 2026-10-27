"""Isolated Chromium verification against the disk-served production UI.
Rebuild frontend externally, then:
 node docs/aegis/work/2026-10-27-island-ui/generate-table-interactions-fixtures.mjs
 python3 docs/aegis/work/2026-10-27-island-ui/verify-table-interactions.py [--quick]
All /api/** calls and WebSockets are mocked; no server/DB writes.
"""
import argparse
import copy
import json
import os
import sys
import traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / 'docs/screenshots/table-interactions'
OUT.mkdir(parents=True, exist_ok=True)
FIXTURE = json.loads((HERE / 'table-interactions-fixtures.json').read_text())
BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
REPORT = HERE / 'table-interactions-report.json'
SIZES = [(1366,768),(800,450),(844,390),(768,1024),(390,844),(360,640)]
checks, records, errors, requests, failures = [], [], [], [], []
runtime={'python':sys.version.split()[0],'chromiumExecutable':'/usr/bin/chromium'}

METRICS = '''() => {
 const rect = e => e ? e.getBoundingClientRect().toJSON() : null;
 const one = s => rect(document.querySelector(s));
 const visible = e => !!e && !!(e.offsetWidth || e.offsetHeight) && !e.closest('[hidden]');
 const scroll = s => {const e=document.querySelector(s);return e ? {clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,overflowX:getComputedStyle(e).overflowX,overflowY:getComputedStyle(e).overflowY,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:null};
 const hit = e => {if(!visible(e))return null;const r=e.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.y+r.height/2));const top=document.elementFromPoint(x,y);return {testid:e.dataset.testid,text:e.textContent.trim(),rect:rect(e),hit:top===e||e.contains(top),top:top?.className?.baseVal??top?.className};};
 return {assets:[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.src||e.href),viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
 board:one('[data-testid="board-svg"]'), map:one('.game__map'), players:one('[data-testid="players-panel"]'),
 hand:one('[data-testid="hand-panel"]'), prompt:one('[data-testid="required-action-prompt"]'),receipt:one('[data-testid="accepted-notice"]'),
 resourceRow:one('.resource-list'),developmentRow:one('.development-lists'),handContent:one('.hand__content'),
 resourceScroll:scroll('.resource-list'),developmentScroll:scroll('.development-lists'),handScroll:scroll('.hand__content'),playersScroll:scroll('.players'),
 seats:[...document.querySelectorAll('.seat')].map(e=>({testid:e.dataset.testid,rect:rect(e),title:e.title,score:e.querySelector('.seat__score')?.textContent,visible:visible(e)})),
 controls:[...document.querySelectorAll('[data-testid="hand-toggle"],[data-testid="hand-pin"],[data-testid="players-toggle"],[data-testid="monopoly-resource"],[data-testid="take-ore"]')].map(hit).filter(Boolean),
 freshButtons:document.querySelectorAll('[data-testid="new-devcards"] button').length,
 victoryButtons:document.querySelectorAll('.development-card--victoryPoint button').length,
 handExpanded:document.querySelector('[data-testid="hand-panel"]')?.dataset.expanded,
 playersExpanded:document.querySelector('[data-testid="players-panel"]')?.dataset.expanded,
 duplicateIds:[...new Set([...document.querySelectorAll('[id]')].map(e=>e.id).filter((x,i,a)=>a.indexOf(x)!==i))]};
}'''

def save():
    REPORT.write_text(json.dumps({'base':BASE,'runtime':runtime,'isolation':'Browser route fixtures for all /api/**; mocked WebSocket; production frontend assets unchanged', 'checks':checks,'matrix':records,'failures':failures,'pageerrors':errors,'requests':requests,'screenshots':[str(p.relative_to(ROOT)) for p in OUT.glob('*.png')]}, ensure_ascii=False, indent=2)+'\n')

def check(name, condition, detail=None):
    item={'name':name,'ok':bool(condition)}
    if detail is not None: item['detail']=detail
    checks.append(item)
    print(('PASS ' if condition else 'FAIL ')+name, flush=True)
    if not condition:
        failures.append(item)
        save()

def settle(page):
    page.evaluate('document.fonts.ready')
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

def capture(page,name):
    settle(page)
    path=OUT/(name+'.png')
    page.screenshot(path=str(path),full_page=True,animations='disabled')
    print('SCREENSHOT '+str(path.relative_to(ROOT)),flush=True)
    return str(path.relative_to(ROOT))

class Scenario:
    def __init__(self,browser,width,height,locale='en',snapshot='snapshot',touch=False,reduced='no-preference'):
        self.snapshot=copy.deepcopy(FIXTURE[snapshot])
        self.mode='accepted'
        self.context=browser.new_context(viewport={'width':width,'height':height},locale='zh-TW' if locale=='zh-Hant' else 'en-US',has_touch=touch,reduced_motion=reduced)
        self.context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
        self.context.route('**/api/**',self.route)
        self.context.route_web_socket('**/ws',lambda socket: socket.on_message(lambda message: None))
        self.page=self.context.new_page()
        self.page.set_default_timeout(4500)
        self.page.on('pageerror',lambda err: errors.append(str(err)))
        self.page.goto(BASE)
        self.page.locator('#home-tab-resume').wait_for(state='visible')
        self.page.locator('#home-tab-resume').click()
        self.page.get_by_test_id('resume-g1').click()
        expect(self.page.get_by_test_id('board-svg')).to_be_visible()
        settle(self.page)
    def route(self,route):
        req=route.request
        path=urlparse(req.url).path
        method=req.method
        requests.append({'method':method,'path':path})
        data=None
        if path=='/api/config': data=FIXTURE['config']
        elif path=='/api/session':
            identity=copy.deepcopy(FIXTURE['identity'])
            if method=='PATCH': identity.update(req.post_data_json or {})
            data={'player':identity}
        elif path=='/api/profiles': data={'profiles':FIXTURE['profiles']}
        elif path=='/api/rooms': data={'rooms':[]}
        elif path=='/api/rooms/r1': data=FIXTURE['room']
        elif path=='/api/games': data={'games':FIXTURE['games']}
        elif path=='/api/games/g1': data=self.snapshot
        elif path=='/api/games/g1/events': data={'events':self.snapshot['view']['events'],'revision':self.snapshot['revision']}
        elif path=='/api/rooms/r1/chat': data={'messages':[],'nextSeq':0,'hasMore':False}
        elif path=='/api/games/g1/resume': data=FIXTURE['room']
        elif path=='/api/games/g1/commands':
            body=req.post_data_json
            if self.mode=='unknown':
                route.abort('failed');return
            if self.mode=='accepted':
                self.snapshot['revision']+=1
                if body['command']['type']=='turn.roll':
                    seq=self.snapshot['view']['seq']+1
                    self.snapshot['view']['seq']=seq
                    self.snapshot['view']['turn']['dice']=[2,5]
                    self.snapshot['view']['turn']['phase']='action'
                    self.snapshot['view']['events'].append({'seq':seq,'type':'turn.rolled','params':{'dice':[2,5],'playerId':'p1'}})
                data={'commandId':body['commandId'],'outcome':'accepted','revision':self.snapshot['revision'],'events':[]}
            else: data={'commandId':body['commandId'],'outcome':'rejected','revision':self.snapshot['revision'],'events':[], 'error':{'code':'E_INVALID_COMMAND','messageId':'error.E_INVALID_COMMAND'}}
        else:
            failures.append({'name':'Unmapped API request','path':path,'method':method})
            route.fulfill(status=501,json={'ok':False,'error':{'code':'E_INVALID_COMMAND','messageId':'error.E_INVALID_COMMAND'}});return
        route.fulfill(status=200,json={'ok':True,'data':data})
    def close(self): self.context.close()

def attempt(name,fn):
    try:fn()
    except Exception as exc:
        item={'name':name,'error':str(exc),'traceback':traceback.format_exc()}
        failures.append(item)
        print('ERROR '+name+' '+str(exc),flush=True)
        save()


def initial(browser):
    s=Scenario(browser,1366,768)
    p=s.page
    check('desktop hand defaults collapsed',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='false')
    capture(p,'01-desktop-default-en')
    p.get_by_test_id('hand-toggle').hover()
    expect(p.get_by_test_id('hand-panel')).to_have_attribute('data-expanded','true')
    p.get_by_test_id('hand-pin').click()
    capture(p,'02-desktop-expanded-en')
    save()
    s.close()


def matrix(browser):
    for width,height in SIZES:
      for locale in ['zh-Hant','en']:
        tag=f'{width}x{height}/{locale}'
        s=Scenario(browser,width,height,locale)
        p=s.page
        m=p.evaluate(METRICS)
        check(tag+' default no document overflow',m['document'][0]<=width+1 and m['document'][1]<=height+1,m['document'])
        check(tag+' board >=100px',m['board']['width']>=100 and m['board']['height']>=100,m['board'])
        check(tag+' six compact seats visible or locally scrollable',len(m['seats'])==6 and all(x['visible'] for x in m['seats']) and m['playersScroll']['overflowY'] in ['auto','scroll'],m['playersScroll'])
        check(tag+' no duplicate ids',not m['duplicateIds'])
        # Exercise actual scrollIntoView and center hit testing for every seat score.
        seat_hits=[]
        for seat in p.locator('.seat__score').all():
            seat.scroll_into_view_if_needed()
            seat_hits.append(seat.evaluate('''el=>{const r=el.getBoundingClientRect(),rail=el.closest('.players').getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {within:r.top>=rail.top&&r.bottom<=rail.bottom,hit:el===top||el.contains(top),rect:r.toJSON()}}'''))
        check(tag+' all six score centers reachable after local scroll',len(seat_hits)==6 and all(x['within'] and x['hit'] for x in seat_hits),seat_hits)
        p.get_by_test_id('players-toggle').click()
        expect(p.get_by_test_id('players-panel')).to_have_attribute('data-expanded','true')
        expanded=p.evaluate(METRICS)
        if width>1000:
            check(tag+' expanded rail reserves board space',expanded['board']['x']>m['board']['x']+100 and expanded['board']['x']>=expanded['players']['right']-1,{'collapsed':m['board'],'expanded':expanded['board'],'rail':expanded['players']})
        else:
            check(tag+' expanded rail overlays without resizing board',abs(expanded['board']['x']-m['board']['x'])<2,{'collapsed':m['board'],'expanded':expanded['board']})
        p.get_by_test_id('players-toggle').press('Escape')
        expect(p.get_by_test_id('players-panel')).to_have_attribute('data-expanded','false')
        p.get_by_test_id('hand-pin').click()
        expect(p.get_by_test_id('hand-panel')).to_have_attribute('data-expanded','true')
        h=p.evaluate(METRICS)
        check(tag+' hand rows do not overlap',h['resourceRow']['bottom']<=h['developmentRow']['top']+1,{'resource':h['resourceRow'],'development':h['developmentRow']})
        check(tag+' expanded hand clears collapsed score rail',h['hand']['x']>=h['players']['right']-1,{'hand':h['hand'],'rail':h['players']})
        check(tag+' hand local horizontal scrolling',h['resourceScroll']['overflowX'] in ['auto','scroll'] and h['developmentScroll']['overflowX'] in ['auto','scroll'],{'resources':h['resourceScroll'],'development':h['developmentScroll']})
        check(tag+' fresh and VP cards have no play controls',h['freshButtons']==0 and h['victoryButtons']==0)
        p.get_by_test_id('monopoly-resource').click(trial=True)
        p.get_by_test_id('monopoly-resource').select_option('ore')
        p.get_by_test_id('monopoly-resource').press('Escape')
        expect(p.get_by_test_id('hand-panel')).to_have_attribute('data-expanded','false')
        p.get_by_test_id('hand-pin').click()
        check(tag+' monopoly selection retained',p.get_by_test_id('monopoly-resource').input_value()=='ore')
        last=p.locator('.development-lists .development-card').last
        last.scroll_into_view_if_needed()
        scroll_m=p.evaluate(METRICS)
        check(tag+' final fresh card horizontally reachable',last.bounding_box()['x']>=scroll_m['developmentRow']['x']-1 and last.bounding_box()['x']+last.bounding_box()['width']<=scroll_m['developmentRow']['right']+1,scroll_m['developmentScroll'])
        check(tag+' expanded no document overflow',scroll_m['document'][0]<=width+1 and scroll_m['document'][1]<=height+1,scroll_m['document'])
        if (width,locale) in [(844,'zh-Hant'),(390,'zh-Hant'),(360,'en')]:
            # Restore row starts for representative image composition.
            p.locator('.development-lists').evaluate('(el)=>el.scrollLeft=0')
            p.locator('.hand__content').evaluate('(el)=>el.scrollTop=0')
            capture(p,f'03-expanded-{width}x{height}-{locale}')
        records.append({'viewport':[width,height],'locale':locale,'default':m,'railExpanded':expanded,'handExpanded':h,'afterScroll':scroll_m})
        save()
        s.close()


def hover_keyboard_touch(browser):
    s=Scenario(browser,1366,768)
    p=s.page
    p.get_by_test_id('hand-toggle').hover()
    expect(p.get_by_test_id('hand-panel')).to_have_attribute('data-expanded','true')
    p.mouse.move(900,80)
    p.wait_for_timeout(170)
    check('hover close remains open before 320ms',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='true')
    p.wait_for_timeout(230)
    check('hover close occurs after 320ms',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='false')
    p.get_by_test_id('hand-toggle').hover()
    p.get_by_test_id('hand-pin').click()
    p.get_by_test_id('zoom-in').focus()
    p.mouse.move(900,80)
    p.wait_for_timeout(400)
    check('pinned hand stays expanded after pointer and focus leave',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='true')
    p.get_by_test_id('hand-pin').click()
    p.get_by_test_id('monopoly-resource').focus()
    p.mouse.move(900,80)
    p.wait_for_timeout(400)
    check('keyboard focus in hand holds expansion',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='true')
    p.get_by_test_id('monopoly-resource').press('Escape')
    check('Escape closes hand and restores toggle focus',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='false' and p.get_by_test_id('hand-toggle').evaluate('(el)=>el===document.activeElement'))
    s.close()
    s=Scenario(browser,390,844,touch=True)
    p=s.page
    check('touch starts collapsed',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='false')
    p.get_by_test_id('hand-toggle').tap()
    expect(p.get_by_test_id('hand-panel')).to_have_attribute('data-expanded','true')
    p.get_by_test_id('hand-toggle').tap()
    check('touch explicit toggle closes',p.get_by_test_id('hand-panel').get_attribute('data-expanded')=='false')
    s.close()


def pending_empty(browser):
    for width,height in [(1366,768),(844,390),(360,640)]:
        s=Scenario(browser,width,height,snapshot='pending')
        p=s.page
        p.get_by_test_id('hand-pin').click()
        p.get_by_test_id('players-toggle').click()
        prompt=p.get_by_test_id('required-action-prompt')
        m=p.evaluate(METRICS)
        hit=p.get_by_test_id('take-ore').evaluate('''el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:el===top||el.contains(top),top:top?.className,rect:r.toJSON()}}''')
        check(f'{width}x{height} required prompt remains exposed above optional panels',hit['hit'] and m['prompt']['top']>=0 and m['prompt']['bottom']<=height,{'hit':hit,'prompt':m['prompt'],'hand':m['hand'],'rail':m['players']})
        # Trial click verifies real hit-testing without sending a command.
        p.get_by_test_id('take-ore').click(trial=True,timeout=1500)
        if width==360: capture(p,'06-mobile-required-prompt-with-rail-en')
        s.close()
    s=Scenario(browser,390,844,snapshot='empty')
    p=s.page
    p.get_by_test_id('hand-pin').click()
    check('empty hand message shown',p.locator('.hand__empty').is_visible())
    check('empty hand five zero resource cards visible',p.locator('.resource-card--empty').count()==5)
    s.close()


def commands_dice(browser):
    s=Scenario(browser,1366,768)
    p=s.page
    p.get_by_test_id('prompt-end-turn').click()
    expect(p.get_by_test_id('accepted-notice')).to_be_visible()
    p.wait_for_timeout(1900)
    check('accepted status persists without auto-dismiss',p.get_by_test_id('accepted-notice').is_visible())
    m=p.evaluate(METRICS)
    check('accepted status lower right outside center stack',m['receipt']['x']>1366*.6 and not p.locator('.game__messages [data-status="accepted"]').count(),m['receipt'])
    capture(p,'04-desktop-accepted-en')
    p.get_by_test_id('accepted-notice').get_by_role('button').click()
    check('accepted explicit dismiss works',p.get_by_test_id('accepted-notice').count()==0)
    for mode in ['rejected','unknown']:
        s.mode=mode
        p.get_by_test_id('prompt-end-turn').click()
        expect(p.locator(f'.game__messages [data-status="{mode}"]')).to_be_visible()
        check(mode+' status stays in prominent messages',p.locator(f'.game__messages [data-status="{mode}"]').is_visible())
        p.get_by_test_id('command-status').locator('.command-status__actions button').last.click()
    # Feed authoritative roll events through accepted command -> refreshed snapshot.
    s.mode='accepted'
    s.snapshot['view']['turn']['phase']='preroll'
    s.snapshot['view']['hints']['canRoll']=True
    s.snapshot['view']['hints']['canEndTurn']=False
    # Reopen fresh page to adopt the preroll snapshot without app state injection.
    s.context.close()
    s=Scenario(browser,1366,768)
    p=s.page
    # Every accepted command may carry a fixture update; UI event must be turn.rolled.
    original_route=s.route
    s.snapshot['view']['events']=[{'seq':13,'type':'turn.rolled','params':{'dice':[2,5],'playerId':'p1'}}]
    s.snapshot['view']['seq']=13
    p.evaluate('''() => {window.__diceStarts=[];document.addEventListener('animationstart',e=>{if(e.target.matches('.dice-focus__panel'))window.__diceStarts.push({name:e.animationName,time:performance.now()})},true)}''')
    p.get_by_test_id('prompt-end-turn').click()
    expect(p.get_by_test_id('dice-focus')).to_be_visible()
    p.wait_for_function('window.__diceStarts.length===1')
    values=p.locator('.dice-focus__die').all_text_contents()
    geometry=p.locator('.dice-focus__panel').bounding_box()
    check('central dice exact authoritative 2 + 5',values==['2','5'],values)
    check('central dice huge and centered',abs(geometry['x']+geometry['width']/2-683)<3 and abs(geometry['y']+geometry['height']/2-384)<3 and p.locator('.dice-focus__die').first.bounding_box()['width']>=70,geometry)
    p.wait_for_timeout(350)
    s.snapshot['view']['events'].append({'seq':14,'type':'turn.rolled','params':{'dice':[2,5],'playerId':'p2'}})
    p.get_by_test_id('prompt-end-turn').click()
    expect(p.get_by_test_id('dice-focus')).to_be_visible()
    p.wait_for_function('window.__diceStarts.length===2')
    starts=p.evaluate('window.__diceStarts')
    check('same-window second roll at 350ms restarts actual CSS animation',len(starts)==2 and 300<=starts[1]['time']-starts[0]['time']<1100,starts)
    check('new authoritative dice event restarts overlay',p.locator('.dice-focus__die').all_text_contents()==['2','5'])
    capture(p,'05-central-dice-en')
    p.wait_for_timeout(1700)
    check('dice overlay ends after bounded duration',p.get_by_test_id('dice-focus').count()==0)
    s.close()
    s=Scenario(browser,390,844,reduced='reduce')
    p=s.page
    s.snapshot['view']['events']=[{'seq':13,'type':'turn.rolled','params':{'dice':[2,5],'playerId':'p1'}}]
    p.get_by_test_id('prompt-end-turn').click()
    expect(p.get_by_test_id('dice-focus')).to_be_visible()
    check('reduced motion dice same exact values without movement',p.locator('.dice-focus__die').all_text_contents()==['2','5'] and p.locator('.dice-focus__panel').evaluate('(el)=>getComputedStyle(el).animationName')=='none')
    s.close()

def preview_with_pinned_hand(browser):
    for width,height in [(1366,768),(844,390),(360,640)]:
        s=Scenario(browser,width,height)
        p=s.page
        p.get_by_test_id('hand-pin').click()
        p.get_by_test_id('play-knight-0').click()
        target=p.locator('[data-testid^="target-hex-"]').first
        target.focus()
        target.press('Enter')
        if p.get_by_test_id('target-picker').count():
            p.get_by_test_id('target-picker').get_by_role('button').first.focus()
            p.get_by_test_id('target-picker').get_by_role('button').first.press('Enter')
        expect(p.get_by_test_id('selection-preview')).to_be_visible()
        result=p.get_by_test_id('confirm-selection').evaluate('''el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:top===el||el.contains(top),top:top?.className,rect:r.toJSON()}}''')
        check(f'{width}x{height} preview confirm exposed above pinned hand',result['hit'],result)
        p.get_by_test_id('confirm-selection').click()
        expect(p.get_by_test_id('selection-preview')).to_have_count(0)
        expect(p.get_by_test_id('accepted-notice')).to_be_visible()
        check(f'{width}x{height} preview actual confirm succeeds while hand pinned',p.get_by_test_id('hand-panel').get_attribute('data-pinned')=='true')
        receipt=p.get_by_test_id('accepted-notice').bounding_box()
        hand=p.get_by_test_id('hand-panel').bounding_box()
        check(f'{width}x{height} accepted notice clears expanded hand',receipt['x']>=hand['x']+hand['width']-1 or receipt['y']+receipt['height']<=hand['y']+1,{'receipt':receipt,'hand':hand})
        p.get_by_test_id('accepted-notice').get_by_role('button').click(trial=True)
        s.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--quick',action='store_true');args=parser.parse_args()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        runtime['chromiumVersion']=browser.version
        attempt('initial screenshots',lambda:initial(browser))
        if not args.quick:
            attempt('bilingual viewport matrix',lambda:matrix(browser))
            attempt('hover keyboard touch',lambda:hover_keyboard_touch(browser))
            attempt('required prompt and empty hand',lambda:pending_empty(browser))
            attempt('command statuses and dice',lambda:commands_dice(browser))
            attempt('preview with pinned hand',lambda:preview_with_pinned_hand(browser))
        check('no browser pageerror',not errors,errors)
        browser.close()
    save()
    print(json.dumps({'checks':len(checks),'passed':sum(c['ok'] for c in checks),'failedChecks':sum(not c['ok'] for c in checks),'failures':len(failures),'matrix':len(records),'report':str(REPORT)},ensure_ascii=False),flush=True)
    raise SystemExit(1 if failures else 0)
