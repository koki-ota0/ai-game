import { chromium } from '@playwright/test';
import chromiumBin, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import path from 'node:path';
import fs from 'node:fs/promises';

const out = '/tmp/echo-promo/assets';
await fs.mkdir(out, { recursive: true });
await inflate(path.resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
setupLambdaEnvironment('/tmp/al2023/lib');
chromiumBin.setGraphicsMode = false;
const args = chromiumBin.args.filter(arg => arg !== '--single-process' && arg !== '--in-process-gpu');
const browser = await chromium.launch({ executablePath: await chromiumBin.executablePath(), args, headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.evaluate(() => window.__ECHO__?.destroy());

const css = `
  *{box-sizing:border-box} html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
  body{font-family:'Space Grotesk','Noto Sans JP Variable',sans-serif;color:#e9f5f3;background:transparent}
  .promo-page{position:relative;width:1080px;height:1920px;overflow:hidden}
  .art{position:absolute;inset:-35px;background:url('http://localhost:5173/images/echo-abyss-keyart.jpg') 62% center/cover no-repeat;filter:brightness(.32) saturate(.85)}
  .art.intro{inset:0;background-position:64% center;filter:brightness(.63) saturate(.95)}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,7,14,.72),rgba(3,7,14,.16) 37%,rgba(3,7,14,.76) 75%,#03070e 100%)}
  .grid{position:absolute;inset:0;opacity:.16;background-image:linear-gradient(rgba(98,246,231,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(98,246,231,.16) 1px,transparent 1px);background-size:90px 90px;mask-image:linear-gradient(180deg,black,transparent 70%)}
  .vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(1,4,10,.65) 100%)}
  .brand{position:absolute;left:64px;top:64px;display:flex;align-items:center;gap:16px;font-size:29px;font-weight:700;letter-spacing:-1px}
  .brand em{font-style:normal;color:#62f6e7;font-weight:400}.brand-mark{width:34px;height:34px;border:1px solid #62f6e7;border-radius:50%;display:inline-block;position:relative;transform:rotate(-25deg);box-shadow:0 0 18px #62f6e744}.brand-mark:after{content:'';position:absolute;width:9px;height:9px;background:#62f6e7;left:11px;top:11px;transform:rotate(45deg);box-shadow:0 0 15px #62f6e7}
  .chapter{position:absolute;right:64px;top:78px;color:#7fa6a5;font-size:17px;letter-spacing:3px}.chapter b{color:#62f6e7;font-weight:500}
  .eyebrow{position:absolute;left:64px;top:206px;color:#62f6e7;font-size:17px;letter-spacing:4px;font-weight:600}.eyebrow:before{content:'';display:inline-block;width:42px;height:1px;background:#62f6e7;vertical-align:middle;margin:0 14px 5px 0;box-shadow:0 0 10px #62f6e7}
  .window-frame{position:absolute;left:36px;top:330px;width:1008px;height:567px;border:1px solid #62f6e766;box-shadow:0 0 0 8px #62f6e708,0 22px 80px #0008}
  .window-frame:before,.window-frame:after{content:'';position:absolute;width:70px;height:8px;background:#62f6e7;box-shadow:0 0 16px #62f6e7}.window-frame:before{left:-1px;top:-5px}.window-frame:after{right:-1px;bottom:-5px}
  .caption{position:absolute;left:64px;right:64px;top:1000px}.caption h1{white-space:pre-line;margin:0;color:#f0fbf8;font-size:57px;line-height:1.27;letter-spacing:1px;font-weight:600;text-shadow:0 4px 28px #000}.caption h1 span{color:#62f6e7}.caption p{margin:28px 0 0;color:#a2bcb9;font-size:25px;line-height:1.8;letter-spacing:1px}
  .tags{position:absolute;left:64px;right:64px;top:1535px;display:flex;gap:12px;flex-wrap:wrap}.tag{border:1px solid #62f6e733;background:#07151dc9;color:#a8fff5;padding:13px 17px;font-size:15px;letter-spacing:2px}.tag.gold{border-color:#ffcf7044;color:#ffcf70}
  .footer{position:absolute;left:64px;right:64px;bottom:65px;border-top:1px solid #62f6e72b;padding-top:21px;display:flex;justify-content:space-between;align-items:center;color:#6d8c8a;font-size:15px;letter-spacing:2px}.footer b{color:#c1d8d4;font-weight:500}
  .center-brand{position:absolute;left:70px;right:70px;top:555px;text-align:left}.center-brand .mini{color:#62f6e7;font-size:18px;letter-spacing:5px;font-weight:600}.center-brand h1{margin:27px 0 22px;font-size:104px;line-height:.91;letter-spacing:-7px;font-weight:600;text-shadow:0 7px 40px #000}.center-brand h1 span{color:#62f6e7;font-weight:400}.center-brand .jp{font-size:30px;letter-spacing:4px;color:#e4f3ef}.center-brand .desc{margin-top:25px;color:#9bb8b5;font-size:20px;line-height:1.9;letter-spacing:2px}
  .intro-rule{width:110px;height:3px;background:#62f6e7;box-shadow:0 0 22px #62f6e7;margin:34px 0}.intro-bottom{position:absolute;left:70px;right:70px;bottom:90px;display:flex;justify-content:space-between;align-items:end;border-top:1px solid #a8fff544;padding-top:24px}.intro-bottom .mode{color:#a8fff5;font-size:21px;letter-spacing:4px}.intro-bottom small{display:block;color:#8aa6a5;font-size:14px;letter-spacing:3px;margin-top:12px}.intro-bottom .side{text-align:right;color:#b4cdca;font-size:16px;line-height:1.8;letter-spacing:2px}
  .outro .art{filter:brightness(.48) saturate(.9)}.outro .center-brand{top:500px}.outro .center-brand h1{font-size:96px}.cta{position:absolute;left:70px;right:70px;top:1110px;border-left:4px solid #62f6e7;padding:22px 28px;background:linear-gradient(90deg,#62f6e718,transparent);font-size:43px;letter-spacing:3px;color:#f3fffb}.cta small{display:block;margin-top:17px;color:#8fb5b0;font-size:18px;letter-spacing:3px}.outro-tags{position:absolute;left:70px;top:1370px;display:flex;gap:12px}.outro-tags span{padding:12px 15px;border:1px solid #62f6e744;color:#a8fff5;font-size:15px;letter-spacing:2px}
`;

const sceneData = {
  combat: { chapter: '01 / 05', eyebrow: 'ECHO LINK // PAST IS YOUR WEAPON', title: '過去の自分と、\n未来を切り拓け。', description: '数秒前の移動と射撃を再生する「残響」と共闘。\n斉射の方向は、現在の敵へ自動補正。', tags: ['WRAITH', 'ECHO LINK', 'MANUAL FIRE'] },
  rail: { chapter: '02 / 05', eyebrow: 'WEAPON SKILL // RAIL LANCE', title: '貫通レールで、\n戦線を突破。', description: '初撃の高威力に、1秒の継続ダメージ。\n射線上の敵をまとめて貫く、WRAITHの必殺技。', tags: ['RAIL LANCE', 'PIERCE', 'SUSTAINED DAMAGE'] },
  draft: { chapter: '03 / 05', eyebrow: 'EVOLUTION // BUILD YOUR TIMELINE', title: '進化を選び、\n自分だけのビルドへ。', description: '火力・残響・防御・特殊能力。\n29種類の進化で、戦い方を書き換えろ。', tags: ['29 UPGRADES', 'BUILD CRAFTING', 'ZERO FIELD'] },
  boss: { chapter: '04 / 05', eyebrow: 'WARDEN // READ THE PATTERN', title: '深淵の管理者を、\n撃破せよ。', description: '攻撃パターンを読み、残響で挟み撃ち。\nワーデンと残敵を全滅させ、先へ進め。', tags: ['AION // WARDEN', 'BOSS RUSH', 'RESONANCE'] },
  menu: { chapter: '05 / 05', eyebrow: 'YOUR TIMELINE // TWO WAYS TO DIVE', title: 'INFINITE / LEVEL', description: '無限の深海で限界へ挑むか。\n全100ステージを攻略するか。', tags: ['INFINITE', '100 STAGES', '3 FRAMES'] },
};

async function render(name, html, transparent = false) {
  await page.evaluate(({ html, css, transparent }) => {
    document.body.innerHTML = html;
    document.documentElement.style.background = transparent ? 'transparent' : '#03070e';
    document.body.style.background = transparent ? 'transparent' : '#03070e';
    let style = document.getElementById('promo-style');
    if (!style) { style = document.createElement('style'); style.id = 'promo-style'; document.head.appendChild(style); }
    style.textContent = css;
  }, { html, css, transparent });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: transparent });
}

await render('background', `<div class="promo-page"><div class="art"></div><div class="shade"></div><div class="grid"></div><div class="vignette"></div></div>`);

for (const [name, data] of Object.entries(sceneData)) {
  const title = data.title.replace('、\n', '、\n');
  await render(`overlay-${name}`, `<div class="promo-page">
    <div class="brand"><i class="brand-mark"></i><span>ECHO<em>//</em>ABYSS</span></div>
    <div class="chapter">${data.chapter.replace(' / ', ' <b>/</b> ')}</div>
    <div class="eyebrow">${data.eyebrow}</div>
    <div class="window-frame"></div>
    <div class="caption"><h1>${title}</h1><p>${data.description.replace(/\n/g, '<br>')}</p></div>
    <div class="tags">${data.tags.map((tag, i) => `<span class="tag ${i === 1 && name === 'boss' ? 'gold' : ''}">${tag}</span>`).join('')}</div>
    <div class="footer"><b>PAST IS YOUR WEAPON.</b><span>BROWSER ACTION ROGUELITE</span></div>
  </div>`, true);
}

await render('intro', `<div class="promo-page"><div class="art intro"></div><div class="shade"></div><div class="grid"></div><div class="vignette"></div>
  <div class="brand"><i class="brand-mark"></i><span>ECHO<em>//</em>ABYSS</span></div>
  <div class="center-brand"><div class="mini">A TIME-LOOP ACTION ROGUELITE</div><h1>ECHO<span>//</span><br>ABYSS</h1><div class="intro-rule"></div><div class="jp">過去の自分と、未来を切り拓け。</div><div class="desc">数秒前の自分「残響」と共闘する、<br>新感覚タイムループ・アクション。</div></div>
  <div class="intro-bottom"><div><div class="mode">INFINITE / LEVEL</div><small>CHOOSE YOUR TIMELINE</small></div><div class="side">3 FRAMES<br>ONE MORE RUN</div></div>
</div>`);

await render('outro', `<div class="promo-page outro"><div class="art intro"></div><div class="shade"></div><div class="grid"></div><div class="vignette"></div>
  <div class="brand"><i class="brand-mark"></i><span>ECHO<em>//</em>ABYSS</span></div>
  <div class="center-brand"><div class="mini">THE NEXT RUN IS YOURS</div><h1>ECHO<span>//</span><br>ABYSS</h1><div class="jp">過去の自分と、未来を切り拓け。</div></div>
  <div class="cta">今すぐ、深淵へ。<small>DIVE INTO THE ABYSS</small></div>
  <div class="outro-tags"><span>INFINITE</span><span>LEVEL</span><span>BROWSER GAME</span></div>
  <div class="intro-bottom"><div><div class="mode">PAST IS YOUR WEAPON.</div><small>PLAY YOUR OWN TIMELINE</small></div><div class="side">ECHO//ABYSS<br>TIME-LOOP ACTION</div></div>
</div>`);

console.log(`Rendered promo assets to ${out}`);
await browser.close();
