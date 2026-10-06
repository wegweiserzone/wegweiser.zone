// Takes every screenshot the site uses, in both themes, from a running
// `make demo` of the server repository. `make screenshots` starts the demo,
// runs this and stops it again; see the Makefile for what it needs.
//
// Playwright comes from the server repository's web/ directory, which has it
// already for its own browser tests, so this site needs no Node project of
// its own. Firefox writes the WebP: the screenshot is drawn onto a canvas and
// read back as image/webp, because nothing else on the machine has to be able
// to encode one.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import dgram from "node:dgram";
import path from "node:path";

const server = process.env.WEG_REPO ?? "../wegweiser";
const demo = process.env.WEG_DEMO_DIR ?? "/tmp/weg-demo";
const out = process.env.SHOTS_OUT ?? "assets/img";
const base = "http://127.0.0.1:8053";

const require = createRequire(path.resolve(server, "web/package.json"));
const { firefox } = require("@playwright/test");

const token = readFileSync(path.join(demo, "ns1/log"), "utf8").match(/weg_[A-Za-z0-9_-]+/)?.[0];
if (!token) throw new Error(`no token in ${demo}/ns1/log; is the demo running?`);

// --- traffic -------------------------------------------------------------------
// The overview and the stream are empty without queries, and the demo asks
// some only when dig is installed. These are sent straight over UDP.

const TYPES = { A: 1, NS: 2, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, ANY: 255 };
const ASKED = [
  ["www.example.com", "A"], ["example.com", "MX"], ["example.com", "TXT"],
  ["mail.example.com", "AAAA"], ["nas.internal.lan", "A"], ["anything.dev.example.com", "A"],
  ["example.com", "SOA"], ["25.0.168.192.in-addr.arpa", "PTR"], ["200.0.168.192.in-addr.arpa", "PTR"],
  ["nope.example.com", "A"], ["notmine.test", "A"], ["pbx.internal.lan", "A"], ["example.com", "NS"],
];

function query(name, type, id) {
  const labels = name.split(".").flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4); // one question
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(TYPES[type], 1);
  tail.writeUInt16BE(1, 3); // IN
  return Buffer.concat([header, ...labels, tail]);
}

const socket = dgram.createSocket("udp4");
let sent = 0;
function ask(n) {
  for (let i = 0; i < n; i++) {
    const [name, type] = ASKED[sent % ASKED.length];
    socket.send(query(name, type, sent & 0xffff), 5300 + (sent % 3), "127.0.0.1");
    sent++;
  }
}

// --- the screens ---------------------------------------------------------------
// Each scene leaves the page as the screenshot should show it.

const scenes = {
  async overview(page) {
    await page.goto(`${base}/`);
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    // The line is drawn from counter readings taken while the page is open.
    const traffic = setInterval(() => ask(4), 100);
    await page.waitForTimeout(8000);
    clearInterval(traffic);
  },
  async records(page) {
    await page.goto(`${base}/zones/0.168.192.in-addr.arpa.`);
    await page.getByRole("button", { name: "+ New record" }).first().waitFor();
    await page.waitForTimeout(500);
  },
  async editor(page) {
    await page.goto(`${base}/zones/example.com.`);
    await page.getByRole("button", { name: "+ New record" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("_sip._tcp");
    await dialog.getByLabel("Type").fill("SRV");
    await dialog.getByLabel("Type").press("Enter");
    await dialog.getByLabel("Priority").fill("10");
    await dialog.getByLabel("Weight").fill("5");
    await dialog.getByLabel("Port").fill("5060");
    await dialog.getByLabel("Target").fill("sip.example.com.");
    await dialog.getByText("Becomes").waitFor();
  },
  async check(page) {
    await page.goto(`${base}/zones/example.com./check`);
    await page.getByLabel("Include the reverse entries this zone is missing").check();
    await page.getByRole("button", { name: "Check this zone" }).click();
    await page.waitForTimeout(1000);
  },
  async stream(page) {
    await page.goto(`${base}/stream`);
    const traffic = setInterval(() => ask(3), 120);
    await page.waitForTimeout(4000);
    clearInterval(traffic);
  },
  async history(page) {
    await page.goto(`${base}/history`);
    await page.getByRole("button", { name: "Everything" }).click();
    await page.waitForTimeout(500);
    await page.getByText("it was not the vpn").first().click();
    await page.waitForTimeout(500);
  },
  async palette(page) {
    await page.goto(`${base}/`);
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
  },
  async secondaries(page) {
    await page.goto(`${base}/secondaries`);
    await page.waitForTimeout(1200);
  },
  async settings(page) {
    await page.goto(`${base}/settings`);
    await page.waitForTimeout(800);
  },
  async cluster(page) {
    await page.goto(`${base}/cluster`);
    await page.getByText("Current").first().waitFor();
    await page.waitForTimeout(500);
  },
};

async function webp(page, png) {
  const data = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", 0.9);
  }, png.toString("base64"));
  if (!data.startsWith("data:image/webp")) throw new Error("this browser does not encode WebP");
  return Buffer.from(data.split(",")[1], "base64");
}

const only = process.argv.slice(2);
const browser = await firefox.launch();
ask(400);
for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 660 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();

  const encoder = await context.newPage();
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    ask(40);
    await scene(page);
    const file = path.join(out, `${name}-${theme}.webp`);
    writeFileSync(file, await webp(encoder, await page.screenshot()));
    console.log(`wrote ${file}`);
    await page.keyboard.press("Escape");
  }
  await context.close();
}
await browser.close();
socket.close();
