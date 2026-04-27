/**
 * Puppeteer + Three.js headless renderer.
 *
 * Approach A: import maps with base64-encoded data URLs.
 *
 * Each module (three/core, STLLoader, 3MFLoader, fflate) is read from
 * node_modules at startup, base64-encoded, and placed into an HTML import
 * map so the browser page can `import * as THREE from "three"` etc. without
 * needing a real file server.
 *
 * The 3MFLoader imports fflate via a relative path (`../libs/fflate.module.js`).
 * We patch that to a bare specifier `fflate` which is also in the import map.
 */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
// ---------------------------------------------------------------------------
// Module loading — resolve from thumb-worker's own node_modules (hoisted to
// repo root in practice, but createRequire handles both).
// ---------------------------------------------------------------------------
function readModule(specifier) {
    const resolved = require.resolve(specifier);
    return readFileSync(resolved, "utf8");
}
function toDataUrl(src) {
    const b64 = Buffer.from(src, "utf8").toString("base64");
    return `data:text/javascript;base64,${b64}`;
}
/** Build import-map HTML + inline module script, constructed once at startup. */
function buildPageHtml() {
    // three/build/three.core.js is NOT in three's exports map, so we can't use
    // require.resolve("three/build/three.core.js"). Instead, resolve three's
    // main entry point (which lands at <pkg-root>/build/three.cjs) and go up
    // two levels to get the package root, then derive the core build path.
    const THREE_PKG_PATH = require.resolve("three", { paths: [__dirname] });
    const THREE_PKG_ROOT = dirname(dirname(THREE_PKG_PATH));
    const THREE_CORE_PATH = resolve(THREE_PKG_ROOT, "build/three.core.js");
    const threeSrc = readFileSync(THREE_CORE_PATH, "utf8");
    const stlSrc = readModule("three/examples/jsm/loaders/STLLoader.js");
    // 3MFLoader uses a relative import '../libs/fflate.module.js'.
    // We patch it to the bare specifier 'fflate' which we map in the import map.
    const tmfSrcRaw = readModule("three/examples/jsm/loaders/3MFLoader.js");
    const tmfSrc = tmfSrcRaw.replace(/from\s+['"]\.\.\/libs\/fflate\.module\.js['"]/g, "from 'fflate'");
    const fflate = readModule("three/examples/jsm/libs/fflate.module.js");
    const importMap = JSON.stringify({
        imports: {
            three: toDataUrl(threeSrc),
            "three/examples/jsm/loaders/STLLoader.js": toDataUrl(stlSrc),
            "three/examples/jsm/loaders/3MFLoader.js": toDataUrl(tmfSrc),
            fflate: toDataUrl(fflate),
        },
    });
    return /* html */ `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<canvas id="c" width="256" height="256" style="display:none"></canvas>
<script type="importmap">${importMap}</script>
<script type="module">
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

function frameObject(camera, object, padding) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const distance = (maxDim * padding) / (2 * Math.tan(fov / 2));
  const dir = new THREE.Vector3(1, 1, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.lookAt(center);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
}

window.renderModel = async function(bytes, format) {
  const canvas = document.getElementById("c");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(256, 256, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 2, 1);
  scene.add(dirLight);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);

  let object;
  if (format === "stl") {
    const loader = new STLLoader();
    const geom = loader.parse(bytes.buffer);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7 });
    object = new THREE.Mesh(geom, mat);
  } else if (format === "3mf") {
    const loader = new ThreeMFLoader();
    object = loader.parse(bytes.buffer);
  } else {
    throw new Error("unsupported format: " + format);
  }

  scene.add(object);
  frameObject(camera, object, 1.3);

  renderer.render(scene, camera);

  const dataUrl = canvas.toDataURL("image/webp", 0.85);
  renderer.dispose();
  return dataUrl;
};

window.__threeReady = true;
</script>
</body>
</html>`;
}
// Build the HTML once at module load time (not per-request).
let _pageHtml = null;
function getPageHtml() {
    if (!_pageHtml)
        _pageHtml = buildPageHtml();
    return _pageHtml;
}
// ---------------------------------------------------------------------------
// Browser lifecycle — one shared Browser, new Page per render.
// ---------------------------------------------------------------------------
let browserPromise = null;
function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--use-gl=swiftshader",
                "--disable-gpu",
            ],
        });
    }
    return browserPromise;
}
export async function shutdownBrowser() {
    if (browserPromise) {
        const b = await browserPromise;
        await b.close();
        browserPromise = null;
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function renderThumbnail(data, format) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        // Set content and wait for the module script to finish running.
        await page.setContent(getPageHtml(), { waitUntil: "domcontentloaded" });
        // Poll for the ready flag set at the end of the module script.
        await page.waitForFunction("window.__threeReady === true", {
            timeout: 30_000,
        });
        const dataUrl = await page.evaluate(async (bytes, fmt) => {
            // page.evaluate runs in browser context; globalThis === window there.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return globalThis.renderModel(new Uint8Array(bytes), fmt);
        }, Array.from(data), format);
        const base64 = dataUrl.replace(/^data:image\/webp;base64,/, "");
        return Buffer.from(base64, "base64");
    }
    finally {
        await page.close();
    }
}
