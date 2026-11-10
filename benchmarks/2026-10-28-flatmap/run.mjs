// Run with the local Vite server already listening on 4173. Owns and closes its browser.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('console',message=>{if(message.text().startsWith('MATRIX')||message.type()==='error')console.log(message.text());});
 page.on('pageerror',error=>console.error(error));
 await page.goto('http://127.0.0.1:4173/tests/flatmap-performance.html');
 await page.waitForFunction(()=> 'flatmapBenchmark' in window);
 const result=await page.evaluate(()=>window.flatmapBenchmark());
 await writeFile(new URL('./performance.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log('WROTE performance.json');
} finally {await browser.close();}
