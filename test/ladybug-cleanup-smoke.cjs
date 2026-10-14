const { chromium }=require('C:/dev/cares-works/node_modules/playwright');
const fs=require('fs');
(async()=>{
 const base=process.argv[2]; const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const {execFileSync}=require('child_process');
 const raw=base.endsWith('.vercel.app')?execFileSync('powershell.exe',['-NoProfile','-Command',"vercel.cmd curl '/?x-vercel-set-bypass-cookie=true' --deployment "+base+" -- --include --silent"],{encoding:'utf8'}):'';
 const cookieLines=raw.split(/\r?\n/).filter(x=>/^set-cookie:/i.test(x));
 const cookie=cookieLines.map(x=>x.replace(/^set-cookie:\s*/i,'').split(';')[0]).join('; ');
 if(base.endsWith('.vercel.app')&&!cookie)throw Error('No protected-access cookie returned');
 const results=[];
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.context().addCookies(cookieLines.map(x=>{const pair=x.replace(/^set-cookie:\s*/i,'').split(';')[0];const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:base};}));
 await page.route('**/*',r=>['POST','PATCH','DELETE','PUT'].includes(r.request().method())?r.abort():r.continue({headers:{...r.request().headers(),...(new URL(r.request().url()).origin===new URL(base).origin ? {cookie}: {})}}));
 let res=await page.goto(base,{waitUntil:'networkidle'}); if(res.status()!==200)throw Error('Homepage '+res.status());
 await page.locator('h1').waitFor();
 const text=await page.locator('body').innerText();if(/October 10|8:30 AM|Free-will|Pre-order|Coming Soon/.test(text))throw Error('Stale copy');
 if(await page.locator('.gift-band').count()!==1)throw Error('Garden count; title='+await page.title()+'; cookies='+cookieLines.map(x=>x.split('=')[0]).join(','));
 if(await page.locator('h2',{hasText:'Show us your garden'}).count())throw Error('Duplicate Garden');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Homepage overflow '+width);
 await page.screenshot({path:`test/ladybug-${width}.png`});
 await page.locator('[data-open-buy]').click();await page.getByRole('link',{name:'Buy the Book',exact:false}).waitFor({state:'visible'});
 await page.goto(base+'/share-your-garden',{waitUntil:'networkidle'});await page.locator('#story').fill('Verification only; this is not submitted.');if(!(await page.locator('#count').innerText()).includes('40')){};await page.locator('#consent').check();
 await page.goto(base+'/plan-your-event',{waitUntil:'networkidle'});await page.locator('.act').first().waitFor();await page.locator('[data-hours="2"]').click();if(!(await page.locator('#total').innerText()).includes('Pricing to come'))throw Error('Pricing');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)){await page.screenshot({path:'test/host-overflow.png'});throw Error('Host overflow '+width+' '+JSON.stringify(await page.locator('body *').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})))))};
 await page.goto(base+'/register',{waitUntil:'domcontentloaded'});if(!page.url().includes('#gatherings'))throw Error('Register redirect '+page.url());
 if(errors.length)throw Error(errors.join(';'));
 results.push({width,homepage:true,storyForm:true,hosting:true,bookDialog:true,registrationRedirect:true,errors});await page.close();
 }
 await browser.close();console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1)});



