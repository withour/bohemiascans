// Run: node tests/voice.test.cjs
// Uses Playwright from NODE_PATH or the desktop app's bundled dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
let playwright;
try { playwright=require('playwright'); }
catch {
  playwright=require(path.join(require('node:os').homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright'));
}

(async()=>{
  const browser=await playwright.chromium.launch({
    executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:true
  });
  const context=await browser.newContext({viewport:{width:1200,height:900}});
  // Tests exercise the actual recognition callbacks with controlled transcripts.
  // Microphone hardware and the external speech service are not mocked as tested.
  await context.addInitScript(()=>{
    window.SpeechRecognition=class {
      constructor(){ window.testRecognition=this; this.results=[]; }
      start(){ this.results=[]; this.onstart?.(); }
      stop(){ this.onend?.(); }
      emit(text,final=true){
        const index=this.results.length;
        const result=Object.assign([{transcript:text}],{isFinal:final});
        if(final) this.results.push(result);
        this.onresult({resultIndex:index,results:final?this.results:[...this.results,result]});
      }
    };
    window.print=()=>{};
    window.close=()=>{};
    navigator.geolocation.getCurrentPosition=(_,reject)=>reject?.({});
  });
  await context.route(/^https?:/,route=>route.fulfill({
    contentType:route.request().resourceType()==='script'?'application/javascript':'application/json',
    body:route.request().resourceType()==='script'?'':JSON.stringify({current:{temperature_2m:15,precipitation:0,cloudcover:0,windspeed_10m:0}})
  }));
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=pathToFileURL(path.resolve(__dirname,'..',process.env.CHECKLIST_HTML||'index.html')).href;
  const say=(text,final=true)=>page.evaluate(({text,final})=>window.testRecognition.emit(text,final),{text,final});
  const value=id=>page.locator('#'+id).inputValue();
  const eq=async(id,expected)=>assert.equal(await value(id),expected,id);
  let count=0;
  async function test(name,run,continuous=false){
    await page.goto(url);
    await page.evaluate(continuous=>{
      localStorage.clear();
      document.querySelectorAll('.sheet input').forEach(el=>{el.value='';el.checked=false;});
      document.getElementById('continuous-voice').checked=continuous;
    },continuous);
    await page.locator('#mic-btn').click();
    await run();
    assert.deepEqual(errors,[],'browser errors');
    console.log('PASS '+name); count++;
  }
  try {
    await test('V4 existing person is selected without making a duplicate',async()=>{
      await page.evaluate(()=>{document.getElementById('p-name-4').value='Jiří Novák';});
      await say('Osoba Jiri');
      await say('Novak začátek sedm');
      await eq('p-name-0',''); await eq('p-name-4','Jiří Novák'); await eq('p-zacatek-4','7:00');
    },true);
    await test('V4 provisional values do not enter saved or printed data',async()=>{
      await say('Osoba Jan Novák začátek sedm příjezd');
      await say('devět',false);
      await eq('p-prijezd-0','9:00');
      const saved=await page.evaluate(()=>gatherFormData());
      assert.equal(saved.people[0].prijezd,'');
      const print=await page.evaluate(()=>printableSheet('sheet-1'));
      assert(!print.includes('9:00'));
      await eq('p-prijezd-0','9:00');
      await say('osm');
      assert.equal((await page.evaluate(()=>gatherFormData())).people[0].prijezd,'8:00');
    },true);
    await test('V4 same table for every final word boundary',async()=>{
      const words='Osoba Jan Novák začátek sedm příjezd osm oběd od dvanácti do dvanácti třiceti konec šestnáct další osoba Petr Svoboda začátek osm'.split(' ');
      const partitions=[words,[words.join(' ')],...words.slice(1).map((_,i)=>[
        words.slice(0,i+1).join(' '),words.slice(i+1).join(' ')
      ])];
      for(const chunks of partitions) {
        await page.reload();
        await page.evaluate(()=>{
          localStorage.clear();
          document.querySelectorAll('.sheet input').forEach(el=>{el.value='';el.checked=false;});
        });
        await page.locator('#mic-btn').click();
        for(const chunk of chunks) await say(chunk);
        await eq('p-name-0','Jan Novák'); await eq('p-zacatek-0','7:00'); await eq('p-prijezd-0','8:00');
        await eq('p-obed-0','12:00–12:30'); await eq('p-konec-0','16:00');
        await eq('p-name-1','Petr Svoboda'); await eq('p-zacatek-1','8:00');
      }
    },true);
    await test('V4 note field names remain prose across all fragments',async()=>{
      await say('Poznámka');
      for(const text of ['vedoucí přijede','později práce','začátek a příjezd','se domluví zítra']) await say(text);
      await eq('note-1','vedoucí přijede později práce začátek a příjezd se domluví zítra');
      await eq('f-vedouci',''); await eq('c-nazev-0','');
      await say('další políčko Materiál zůstává na stavbě');
      await eq('note-2','Materiál zůstává na stavbě');
      await eq('m-nazev-0','');
    },true);
    await test('V4 foreign field keyword cannot hijack material description',async()=>{
      await say('Materiál díly pro');
      await say('vedoucí jednotka kusy množství dva');
      await eq('m-nazev-0','díly pro vedoucí'); await eq('f-vedouci','');
      await eq('m-jed-0','kusy'); await eq('m-mnoz-0','2');
    },true);
    await test('V4 completed cells are not replayed',async()=>{
      await say('Jméno Jan Novák začátek sedm příjezd osm');
      await page.evaluate(()=>{document.getElementById('p-name-0').value='Ručně opravené jméno';});
      await say('oběd dvanáct až dvanáct třicet');
      await eq('p-name-0','Ručně opravené jméno'); await eq('p-obed-0','12:00–12:30');
      await say('konec devět',false);
      await say('konec šestnáct',false);
      await eq('p-name-0','Ručně opravené jméno'); await eq('p-zacatek-0','7:00');
    },true);
    await test('V4 incomplete long command stays buffered',async()=>{
      await say('Vozidlo Ford příjezd');
      await eq('f-vozidlo','Ford'); await eq('p-prijezd-0','');
      await say('vozidla');
      await say('sedm odjezd šestnáct');
      await eq('f-prijezd-voz','7:00'); await eq('f-odjezd-voz','16:00');
    },true);
    await test('V4 invalid typed value does not navigate to another cell',async()=>{
      await say('Osoba Jan Novák začátek nesmysl příjezd osm');
      await eq('p-zacatek-0',''); await eq('p-prijezd-0','');
      assert((await page.locator('#vof-interim').innerText()).includes('platný'));
      await page.locator('#p-zacatek-0').click();
      await say('sedm příjezd osm');
      await eq('p-zacatek-0','7:00'); await eq('p-prijezd-0','8:00');
    },true);
    await test('V3 live interim updates current cell without waiting for next command',async()=>{
      await say('Vedoucí Jan',false); await eq('f-vedouci','Jan');
      await say('Vedoucí Jan Novotný',false); await eq('f-vedouci','Jan Novotný');
      await say('Vedoucí Jan Novák'); await eq('f-vedouci','Jan Novák');
      await eq('p-name-0','');
    },true);
    await test('V3 continuous speech survives arbitrary final segmentation',async()=>{
      for(const text of ['Jméno Jan','Novák začátek','sedm příjezd','osm oběd od jedenácti','třiceti do dvanácti konec','šestnáct kilometry dvacet','pět další osoba Petr','Svoboda začátek osm']) await say(text);
      await eq('p-name-0','Jan Novák'); await eq('p-zacatek-0','7:00');
      await eq('p-prijezd-0','8:00'); await eq('p-obed-0','11:30–12:00');
      await eq('p-konec-0','16:00'); await eq('p-km-0','25');
      await eq('p-name-1','Petr Svoboda'); await eq('p-zacatek-1','8:00');
      assert((await page.locator('#speech-history').inputValue()).includes('Novák začátek sedm'));
    },true);
    await test('V3 interim command correction restores wrong provisional destination',async()=>{
      await say('Jméno Jan Novák');
      await say('začátek sedm příjezd devět',false);
      await eq('p-prijezd-0','9:00');
      await say('začátek sedm konec šestnáct',false);
      await eq('p-prijezd-0',''); await eq('p-konec-0','16:00');
      await say('začátek sedm konec patnáct');
      await eq('p-konec-0','15:00'); await eq('p-name-0','Jan Novák');
    },true);
    await test('V3 multiword command split across events',async()=>{
      await say('Vozidlo Ford Transit příjezd');
      await say('vozidla sedm odjezd');
      await say('šestnáct');
      await eq('f-vozidlo','Ford Transit');
      await eq('f-prijezd-voz','7:00'); await eq('f-odjezd-voz','16:00');
      await eq('p-prijezd-0','');
    },true);
    await test('V3 clicked cell accumulates a sentence across results',async()=>{
      await page.locator('#note-3').click();
      await say('Dnes jsme'); await say('dokončili plot',false);
      await eq('note-3','Dnes jsme dokončili plot');
      await say('dokončili plot'); await say('další políčko Zítra přijedeme');
      await eq('note-3','Dnes jsme dokončili plot'); await eq('note-4','Zítra přijedeme');
    },true);
    await test('V3 manual edit and selection survive later replay',async()=>{
      await say('Vedoucí Jan Novák');
      await page.locator('#f-vedouci').fill('Petr Svoboda');
      await page.locator('#note-2').click();
      await say('Plot je hotový',false); await eq('note-2','Plot je hotový');
      await say('Plot je hotový');
      await eq('f-vedouci','Petr Svoboda');
      await page.locator('[data-key=spl0]').check();
      await say('další poznámka Brána je hotová');
      assert(await page.locator('[data-key=spl0]').isChecked());
    },true);
    await test('V3 material and work continuous commands',async()=>{
      await say('Materiál písek jednotka tuny množství dva další řádek štěrk jednotka kg množství dvacet');
      await eq('m-nazev-0','písek'); await eq('m-jed-0','tuny'); await eq('m-mnoz-0','2');
      await eq('m-nazev-1','štěrk'); await eq('m-mnoz-1','20');
      await say('práce výsadba výkon osm hodin jméno Jan Novák');
      await eq('c-nazev-0','výsadba'); await eq('c-jmeno-0','Jan Novák');
    },true);
    await test('V3 recognition restart keeps continuous sentence',async()=>{
      await say('Jméno Jan');
      await page.evaluate(()=>testRecognition.onend());
      await page.waitForTimeout(350);
      await say('Novák začátek sedm');
      await eq('p-name-0','Jan Novák'); await eq('p-zacatek-0','7:00');
    },true);
    await test('V3 stopping retains confirmed last field and discards provisional correction',async()=>{
      await say('Vedoucí Jan Novák');
      await say('začátek osm',false);
      await page.locator('#mic-btn').click({force:true});
      await eq('f-vedouci','Jan Novák'); await eq('p-zacatek-0','');
    },true);
    await test('V3 print and save contain the last field before moving away',async()=>{
      await say('Jméno Petr Svoboda začátek sedm příjezd osm');
      await page.evaluate(()=>saveToLocal());
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(LS_KEY))[0].data);
      assert.equal(saved.people[0].prijezd,'8:00');
      const print=await page.evaluate(()=>printableSheet('sheet-1'));
      assert(print.includes('Petr Svoboda') && print.includes('8:00'));
      await eq('p-prijezd-0','8:00');
    },true);
    await test('V3 restarting microphone does not duplicate old speech',async()=>{
      await say('Vedoucí Jan Novák');
      await page.locator('#mic-btn').click({force:true});
      await page.locator('#mic-btn').click();
      await say('Jméno Petr Svoboda');
      await eq('f-vedouci','Jan Novák'); await eq('p-name-0','Petr Svoboda');
      assert.equal(await page.locator('#speech-history').inputValue(),'Vedoucí Jan Novák Jméno Petr Svoboda');
    },true);
    await test('keyword then pause then value',async()=>{
      await say('Vedoucí.');
      await say('Jan Novák',false);
      await eq('f-vedouci','');
      await say('Jan Novák');
      await eq('f-vedouci','Jan Novák');
      await say('Petr Svoboda');
      await eq('p-name-0','Petr Svoboda');
      await eq('f-vedouci','Jan Novák');
    });
    await test('click cell then dictate without command',async()=>{
      await page.locator('#note-3').click();
      await say('Plot je dokončen.');
      await say('Bránu natřeme zítra.');
      await eq('note-3','Plot je dokončen');
      await eq('note-4','Bránu natřeme zítra');
    });
    await test('person and all columns in order',async()=>{
      for(const text of ['Jméno Jan Novák','sedm nula nula','osm třicet','od jedenácti třiceti do dvanácti','patnáct třicet','dvacet pět','pět']) await say(text);
      await eq('p-name-0','Jan Novák');
      await eq('p-zacatek-0','7:00');
      await eq('p-prijezd-0','8:30');
      await eq('p-obed-0','11:30–12:00');
      await eq('p-konec-0','15:30');
      await eq('p-km-0','25');
      await eq('p-prispevek-0','5');
    });
    await test('several named commands in a final segment',async()=>{
      await say('Jméno Jan Novák začátek 7:00 příjezd 8:00 oběd 11:30 až 12:00 konec 15:00 kilometry 25 příspěvek 5');
      await eq('p-name-0','Jan Novák');
      await eq('p-zacatek-0','7:00');
      await eq('p-prijezd-0','8:00');
      await eq('p-obed-0','11:30–12:00');
      await eq('p-konec-0','15:00');
      await eq('p-km-0','25');
      await eq('p-prispevek-0','5');
    });
    await test('time command then separate value',async()=>{
      await say('Jméno'); await say('Jan Novák');
      await say('Začátek.'); await say('7.30');
      await say('Příjezd'); await say('půl deváté');
      await eq('p-zacatek-0','7:30');
      await eq('p-prijezd-0','8:30');
    });
    await test('interim next command cannot pollute preceding cell',async()=>{
      await say('Vedoucí Jan Novák');
      await say('Začátek sedm',false);
      await eq('f-vedouci','Jan Novák');
      await say('Jméno Petr Svoboda');
      await eq('p-name-0','Petr Svoboda');
    });
    await test('manual selection changes person and target',async()=>{
      await page.getByRole('button',{name:'2. Lidé & vozidla'}).click();
      await page.locator('#p-prijezd-3').click();
      await say('osm patnáct');
      await eq('p-prijezd-3','8:15');
      await eq('p-prijezd-0','');
    });
    await test('material sequential cells and next row',async()=>{
      for(const text of ['Materiál','Písek','tuny','dvacet','Další řádek','Štěrk']) await say(text);
      await eq('m-nazev-0','Písek'); await eq('m-jed-0','tuny'); await eq('m-mnoz-0','20');
      await eq('m-nazev-1','Štěrk');
    });
    await test('work name belongs to work, not people',async()=>{
      for(const text of ['Práce Výsadba','Výkon 8 hodin','Jméno Jan Novák']) await say(text);
      await eq('c-nazev-0','Výsadba'); await eq('c-vykon-0','8 hodin'); await eq('c-jmeno-0','Jan Novák');
      await eq('p-name-0','');
    });
    await test('repeated final index ignored; new session may reuse it',async()=>{
      await say('První zakázka');
      await page.evaluate(()=>testRecognition.onresult({resultIndex:0,results:testRecognition.results}));
      await eq('f-zakazka','První zakázka'); await eq('f-vedouci','');
      // The listening button has a perpetual pulse animation.
      await page.locator('#mic-btn').click({force:true}); await page.locator('#mic-btn').click();
      await say('Jan Novák'); await eq('f-vedouci','Jan Novák');
    });
    await test('multiple final results in one event stay separate',async()=>{
      await say('Jméno Jan Novák');
      await page.evaluate(()=>{
        const results=[...testRecognition.results,...['sedm','osm'].map(transcript=>Object.assign([{transcript}],{isFinal:true}))];
        testRecognition.onresult({resultIndex:1,results});
        testRecognition.results=results;
      });
      await eq('p-zacatek-0','7:00'); await eq('p-prijezd-0','8:00');
    });
    await test('invalid times do not overwrite or advance',async()=>{
      await say('Jméno Jan Novák'); await say('Začátek 7:00');
      for(const text of ['Začátek 25:00','Začátek 7:99','Začátek sedm banánů','Začátek 11:30 až nesmysl']) await say(text);
      await eq('p-zacatek-0','7:00'); await eq('p-prijezd-0','');
      await say('osm'); await eq('p-zacatek-0','8:00');
    });
    await test('command boundaries and free text preserved',async()=>{
      await say('Poznámka práce hotová, vedoucí přijede zítra');
      await eq('note-1','práce hotová, vedoucí přijede zítra');
      await eq('f-vedouci','');
      // A plain sentence without command punctuation must be literal.
      await say('Poznámka práce na zahradě hotová');
      await eq('note-2','práce na zahradě hotová');
      await page.locator('#note-5').click();
      await say('Automat funguje');
      await eq('note-5','Automat funguje');
    });
    await test('existing accented person is found before empty row',async()=>{
      await page.evaluate(()=>{document.getElementById('p-name-4').value='Jiří Novák';});
      await say('Osoba Jiri Novak'); await say('7:00');
      await eq('p-zacatek-4','7:00'); await eq('p-name-0','');
      await say('Další osoba'); await say('Jiri Novak'); await say('8:00');
      await eq('p-prijezd-4','8:00'); await eq('p-name-0','');
    });
    await test('full people table never wraps to first person',async()=>{
      await page.evaluate(()=>{for(let i=0;i<16;i++)document.getElementById('p-name-'+i).value='Osoba '+i;});
      await say('Jméno Další člověk'); await eq('p-name-0','Osoba 0');
    });
    await test('named notes follow automatic next empty cell',async()=>{
      await say('Poznámka První zpráva'); await say('Další poznámka Druhá zpráva');
      await eq('note-1','První zpráva'); await eq('note-2','Druhá zpráva');
    });
    await test('vehicle standalone time and numeric km',async()=>{
      for(const text of ['Vozidlo Ford Transit','Příjezd vozidla','sedm','Odjezd','šestnáct třicet','Počet km','dvacet pět']) await say(text);
      await eq('f-vozidlo','Ford Transit'); await eq('f-prijezd-voz','7:00'); await eq('f-odjezd-voz','16:30'); await eq('f-km','25');
    });
    await test('time parser positive and negative cases',async()=>{
      const cases={
        '7:00':'7:00','7.30':'7:30','7 hodin 5 minut':'7:05','sedm třicet':'7:30',
        'sedm nula pět':'7:05','7 nula nula':'7:00','půl osmé':'7:30','půl jedné':'12:30',
        'čtvrt na osm':'7:15','tři čtvrtě na osm':'7:45','dvacet jedna třicet':'21:30',
        'sedm třicet pět':'7:35','23:59':'23:59','0:00':'0:00',
        '24:00':'','7:65':'','26 hodin':'','sedm stromů':'','11:30 až nic':''
      };
      for(const [input,expected] of Object.entries(cases)) assert.equal(await page.evaluate(x=>extractTime(x),input),expected,input);
    });
    await test('dictated data survives save and reload',async()=>{
      await say('Vedoucí Jan Novák'); await say('Jméno Petr Svoboda'); await say('7:00');
      await page.getByRole('button',{name:'💾 Uložit'}).click();
      await page.reload();
      await eq('f-vedouci','Jan Novák'); await eq('p-name-0','Petr Svoboda'); await eq('p-zacatek-0','7:00');
    });
    await test('Excel rows include unnamed but filled people',async()=>{
      await page.evaluate(()=>{
        document.getElementById('p-zacatek-3').value='7:30';
        window.testWorkbook={};
        window.XLSX={
          utils:{book_new:()=>({}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(_,sheet,name)=>{testWorkbook[name]=sheet.rows;}},
          writeFile:()=>{}
        };
        exportExcel();
      });
      const rows=await page.evaluate(()=>testWorkbook['Lidé a vozidla']);
      assert(rows.some(row=>row[0]==='' && row[1]==='7:30'));
    });
    await test('print includes live values and checkboxes on all sheets',async()=>{
      await say('Zakázka Zahrada <Novák & syn>'); await say('Vedoucí Jan Novák');
      await say('Jméno Petr Svoboda začátek 7:00 příjezd 8:00');
      await say('Materiál Písek'); await say('tuny'); await say('2');
      await say('Práce Výsadba'); await say('8 hodin'); await say('Jméno Jan Novák');
      await page.evaluate(()=>document.querySelector('[data-key=spl0]').checked=true);
      const popupPromise=page.waitForEvent('popup');
      await page.getByRole('button',{name:'🖨 Tisk'}).click();
      const popup=await popupPromise; await popup.waitForLoadState();
      const text=await popup.locator('body').innerText();
      for(const expected of ['Zahrada <Novák & syn>','Petr Svoboda','7:00','8:00','Písek','Výsadba','Jan Novák','✓','☐']) assert(text.includes(expected),expected);
      assert.equal(await popup.locator('input').count(),0);
      assert.equal(await popup.locator('.print-page').count(),2);
      fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});
      await popup.emulateMedia({media:'print'});
      await popup.pdf({path:path.join(__dirname,'output','checklist-test.pdf'),preferCSSPageSize:true,printBackground:true});
      const {PDFDocument}=require(path.join(require('node:os').homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','pdf-lib'));
      const pdf=await PDFDocument.load(fs.readFileSync(path.join(__dirname,'output','checklist-test.pdf')));
      assert.equal(pdf.getPageCount(),2,'printed A4 page count');
      await popup.screenshot({path:path.join(__dirname,'output','print-preview.png'),fullPage:true});
      await popup.close();
    });
    console.log(count+' browser scenarios passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
