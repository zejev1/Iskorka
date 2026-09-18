"""Real Chromium acceptance of the built Iskorka app, including two-tab ownership."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('SMOKE_OUTPUT', 'smoke-results'))
OUT.mkdir(exist_ok=True)
URL = os.environ.get('SMOKE_URL', 'http://127.0.0.1:4173/')
errors = []

def summary(page):
    return page.evaluate('''() => {
      const f=window.__iskorkaLatestFrame,w=f.world;
      return {title:document.title,profile:w.profile,worldId:w.id,epoch:w.epoch,
        elapsed:w.calendar.elapsedWorldMinutes,people:Object.keys(w.agents).length,
        names:Object.values(w.agents).map(a=>a.name),towns:Object.values(w.settlements).map(s=>s.name),
        frameKeys:Object.keys(f),save:document.querySelector('#save-value').textContent};
    }''')

def ready(page):
    page.wait_for_function('window.__iskorkaLatestFrame?.world?.profile === "iskorka-human-lab-v1"', timeout=60000)
    page.locator('#resident-picker option').first.wait_for(state='attached', timeout=60000)
    page.wait_for_function('document.querySelector("#live-label")?.textContent !== "ВОССТАНОВЛЕНИЕ"', timeout=30000)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=1)
    context.add_init_script('''if (!localStorage.getItem('iskorka-v0.1.external-clock'))
      localStorage.setItem('iskorka-v0.1.external-clock',JSON.stringify({speedId:'real_time',multiplier:1}));''')
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    ready(page)
    first = summary(page)
    assert first['people'] == 10, first
    assert first['towns'] == ['Основание'], first
    assert first['title'].startswith('Искорка'), first
    assert not any(k in first['frameKeys'] for k in ['evaluation','cardinalActivity','evaluationCount']), first
    assert page.locator('#cardinal-console, #dungeon-count, #prayer-inbox-open').count() == 0
    assert page.locator('#resident-picker option').count() == 10
    page.screenshot(path=str(OUT/'mobile.png'), full_page=True)
    page.locator('#resident-picker').select_option(index=1)
    page.locator('#resident-details-open').click()
    page.locator('#world-inspector').wait_for(state='visible')
    assert len(page.locator('#world-inspector-content').inner_text()) > 20
    page.locator('#world-inspector-close').click()
    page.locator('#world-inspector').wait_for(state='hidden')
    page.locator('#map-zoom-in').click()
    page.locator('#map-zoom-out').click()
    page.locator('#map-city-focus').click()
    # Browser reload must resume the durable world, not silently make an epoch.
    before_reload = summary(page)
    page.reload(wait_until='networkidle'); ready(page)
    after_reload = summary(page)
    assert after_reload['worldId'] == before_reload['worldId']
    assert after_reload['epoch'] == before_reload['epoch']
    assert after_reload['names'] == before_reload['names']
    assert after_reload['elapsed'] >= before_reload['elapsed']
    # Another tab follows the same single writer, including reset notifications.
    second = context.new_page(); second.on('pageerror', lambda e: errors.append(str(e)))
    second.goto(URL, wait_until='networkidle'); ready(second)
    follower = summary(second)
    assert follower['worldId'] == after_reload['worldId']
    assert follower['epoch'] == after_reload['epoch']
    assert follower['names'] == after_reload['names']
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(OUT/'desktop.png'), full_page=True)
    second.close()
    page.on('dialog', lambda d: d.accept())
    old_epoch = after_reload['epoch']
    page.locator('#reset-world').click()
    page.wait_for_function('(old) => window.__iskorkaLatestFrame?.world?.epoch > old',arg=old_epoch,timeout=60000)
    reset = summary(page)
    assert reset['people'] == 10 and reset['towns'] == ['Основание'], reset
    assert not errors, errors
    report={'ok':True,'first':first,'resumed':after_reload,'follower':follower,'reset':reset,'javascriptErrors':errors}
    (OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))
    browser.close()
