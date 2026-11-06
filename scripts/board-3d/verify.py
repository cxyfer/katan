#!/usr/bin/env python3
"""Run fixed-build board-3d evidence against deterministic fixtures.

The #7 runner remains the implementation owner for process, routing and
fixture helpers. This runner adds renderer/quality/fault coverage and records
every unexecuted acceptance item explicitly.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import re
import statistics
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "packages/web/dist"
BROWSERS = ROOT / ".tmp/board-3d-browsers"
SIZES = ((1366, 768), (390, 844))
OUTPUT_ROOTS = (
    ROOT / ".tmp",
    ROOT / "test-results",
    ROOT / "docs/aegis/work/2026-10-29-board-3d",
)
SOURCE_PATHS = (
    ROOT / "packages/web/src",
    ROOT / "packages/web/index.html",
    ROOT / "packages/web/package.json",
    ROOT / "packages/web/tsconfig.json",
    ROOT / "packages/web/vite.config.ts",
    ROOT / "packages/web/test",
    ROOT / "packages/rules/src",
    ROOT / "packages/rules/package.json",
    ROOT / "packages/protocol/src",
    ROOT / "packages/protocol/package.json",
    ROOT / "packages/server/src",
    ROOT / "packages/server/package.json",
    ROOT / "scripts/board-visual/fixtures.mjs",
    ROOT / "scripts/board-visual/verify.py",
    ROOT / "scripts/board-3d",
    ROOT / "package.json",
    ROOT / "pnpm-lock.yaml",
    ROOT / "pnpm-workspace.yaml",
    ROOT / "tsconfig.base.json",
)

# 2026-10-29 的 fixture 早於 profile 改版；補上 ProfileView 現行必填欄位。
PROFILE_DEFAULTS = {
    "ruleVersion": "2025",
    "expansions": [],
    "variants": [],
    "requiredBoxes": ["base"],
    "botSeats": True,
}


def fixture_profiles(fixture: dict) -> list[dict]:
    return [{**PROFILE_DEFAULTS, **profile} for profile in fixture["profiles"]]


def load_legacy():
    path = ROOT / "scripts/board-visual/verify.py"
    spec = importlib.util.spec_from_file_location("board_visual_verify", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load reusable runner: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


legacy = load_legacy()
Blocked = legacy.Blocked
case = legacy.case
sha = legacy.sha
relative = legacy.relative
start_server = legacy.start_server
stop_server = legacy.stop_server
verify_assets = legacy.verify_assets


def git(args: list[str]) -> str:
    return legacy.command(["git", "-c", f"safe.directory={ROOT.as_posix()}", *args])


def output_path(value: str) -> Path:
    path = (ROOT / value).resolve()
    if not any(path.is_relative_to(root) and path != root for root in OUTPUT_ROOTS):
        allowed = ", ".join(relative(root) for root in OUTPUT_ROOTS)
        raise ValueError(f"--out must be a child of one of: {allowed}")
    if path.exists() and any(path.iterdir()):
        raise ValueError(f"refusing to overwrite nonempty evidence directory: {path}; choose a new --out")
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_hash(path: Path) -> str:
    return sha(path.read_bytes())


def tree_hash(paths: list[Path]) -> str:
    manifest = []
    for root in paths:
        candidates = [root] if root.is_file() else sorted(item for item in root.rglob("*") if item.is_file())
        for path in candidates:
            manifest.append(f"{path.relative_to(ROOT).as_posix()} {file_hash(path)}")
    return sha("\n".join(manifest).encode("utf-8"))


def build_manifest() -> tuple[str, dict[str, dict[str, int | str]]]:
    if not DIST.is_dir():
        raise Blocked("production web artifacts missing; run pnpm --filter @catan/web build")
    files = {}
    for path in sorted(item for item in DIST.rglob("*") if item.is_file()):
        files[path.relative_to(DIST).as_posix()] = {"sha256": file_hash(path), "bytes": path.stat().st_size}
    return sha(json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")), files


def asset_path(item: dict | str) -> str:
    return str(item.get("artifact") or item.get("screenshot") or item.get("report") or "")


BOARD_STATE = """() => {
 const board = document.querySelector('[data-testid="board"]');
 const canvas = document.querySelector('.board-three canvas');
 const rect = board?.getBoundingClientRect();
 return {
  requested: board?.dataset.requestedRenderer ?? null,
  effective: board?.dataset.effectiveRenderer ?? null,
  quality: board?.dataset.quality ?? null,
  status: board?.dataset.rendererStatus ?? null,
  fallbackReason: board?.dataset.fallbackReason ?? null,
  svg: !!document.querySelector('[data-testid="board-svg"]'),
  canvas: canvas ? {width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight} : null,
  targets: document.querySelectorAll('button[data-target-kind]').length,
  effects: document.querySelectorAll('[data-testid="board-effects"]').length,
  diceOverlay: document.querySelectorAll('[data-testid="dice-focus"]').length,
  hexes: document.querySelectorAll('[data-testid^="hex-"]').length,
  buildings: document.querySelectorAll('[data-testid^="building-"]').length,
  roads: document.querySelectorAll('[data-testid^="road-"]').length,
  board: rect ? rect.toJSON() : null,
  viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
  locale: document.querySelector('[data-testid="locale-switch-game"]')?.value ?? null,
  htmlLang: document.documentElement.lang,
  document: {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight},
  resources: performance.getEntriesByType('resource').map(entry => entry.name),
  contextDiagnostics: window.__boardContextDiagnostics ?? null,
 };
}"""


WEBGL_STATE = """() => {
 const canvas = document.querySelector('.board-three canvas');
 if (!canvas) return {available:false, reason:'canvas-missing'};
 const gl = canvas.getContext('webgl2');
 if (!gl) return {available:false, reason:'webgl2-context-missing'};
 const debug = gl.getExtension('WEBGL_debug_renderer_info');
 const pixel = new Uint8Array(4);
 gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
 return {
  available:true,
  lost:gl.isContextLost(),
  version:gl.getParameter(gl.VERSION),
  shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
  vendor:gl.getParameter(gl.VENDOR),
  renderer:gl.getParameter(gl.RENDERER),
  unmaskedVendor:debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
  unmaskedRenderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
  drawingBuffer:[gl.drawingBufferWidth, gl.drawingBufferHeight],
  readPixel:Array.from(pixel),
 };
}"""


GPU_INSTRUMENT = """(() => {
 const contextDiagnostics = window.__boardContextDiagnostics = {
  attempts:[], creationErrors:[], errorEvents:[]
 };
 const originalGetContext = HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext = function(type,...args) {
  let context=null, error=null;
  try { context=originalGetContext.call(this,type,...args); }
  catch(caught) { error=String(caught); throw caught; }
  finally {
   contextDiagnostics.attempts.push({type:String(type),ok:!!context,error,
    canvas:{width:this.width,height:this.height,connected:this.isConnected}});
  }
  if(context && String(type).startsWith('webgl')) {
   const gl=context;
   const debug=gl.getExtension?.('WEBGL_debug_renderer_info');
   contextDiagnostics.created ??= [];
   contextDiagnostics.created.push({type:String(type),lost:gl.isContextLost?.() ?? null,
    version:gl.getParameter?.(gl.VERSION) ?? null,vendor:gl.getParameter?.(gl.VENDOR) ?? null,
    renderer:gl.getParameter?.(gl.RENDERER) ?? null,
    unmaskedVendor:debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
    unmaskedRenderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null});
  }
  return context;
 };
 document.addEventListener('webglcontextcreationerror', event => {
  contextDiagnostics.errorEvents.push({statusMessage:event.statusMessage ?? null});
 }, true);
 const metrics = window.__boardGpuMetrics = {
  calls:0, triangles:0, lines:0, other:0, frameCalls:0, frameTriangles:0,
  peakFrameCalls:0, peakFrameTriangles:0, frames:[], rafCallbacks:0,
  created:{textures:0,buffers:0,programs:0,shaders:0,framebuffers:0,renderbuffers:0},
  deleted:{textures:0,buffers:0,programs:0,shaders:0,framebuffers:0,renderbuffers:0}
 };
 const originalRaf = window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame = callback => originalRaf(timestamp => {
  metrics.rafCallbacks++;
  metrics.frameCalls=0; metrics.frameTriangles=0;
  try { callback(timestamp); }
  finally {
   metrics.peakFrameCalls=Math.max(metrics.peakFrameCalls,metrics.frameCalls);
   metrics.peakFrameTriangles=Math.max(metrics.peakFrameTriangles,metrics.frameTriangles);
   metrics.frames.push({calls:metrics.frameCalls,triangles:metrics.frameTriangles,atMs:timestamp});
   if(metrics.frames.length>1000) metrics.frames.shift();
  }
 });
 const primitive = (gl,mode,count,instanceCount=1) => {
  let triangles=0, lines=0, other=0;
  if(mode===gl.TRIANGLES) triangles=(count/3)*instanceCount;
  else if(mode===gl.TRIANGLE_STRIP || mode===gl.TRIANGLE_FAN) triangles=Math.max(0,count-2)*instanceCount;
  else if(mode===gl.LINES) lines=(count/2)*instanceCount;
  else if(mode===gl.LINE_STRIP || mode===gl.LINE_LOOP) lines=Math.max(0,count-1)*instanceCount;
  else other=instanceCount;
  metrics.calls++; metrics.frameCalls++;
  metrics.triangles+=triangles; metrics.frameTriangles+=triangles;
  metrics.lines+=lines; metrics.other+=other;
 };
 const wrap = (proto,name,kind) => {
  if(!proto || typeof proto[name]!=='function') return;
  const original=proto[name];
  proto[name]=function(...args){
   if(kind==='elements') primitive(this,args[0],args[1],1);
   else if(kind==='elementsInstance') primitive(this,args[0],args[1],args[4]);
   else if(kind==='arrays') primitive(this,args[0],args[2],1);
   else if(kind==='arraysInstance') primitive(this,args[0],args[2],args[3]);
   return original.apply(this,args);
  };
 };
 for(const proto of [window.WebGL2RenderingContext?.prototype,window.WebGLRenderingContext?.prototype].filter(Boolean)) {
  wrap(proto,'drawElements','elements'); wrap(proto,'drawElementsInstanced','elementsInstance');
  wrap(proto,'drawArrays','arrays'); wrap(proto,'drawArraysInstanced','arraysInstance');
  for(const [created,deleted] of [['createTexture','deleteTexture'],['createBuffer','deleteBuffer'],['createProgram','deleteProgram'],['createShader','deleteShader'],['createFramebuffer','deleteFramebuffer'],['createRenderbuffer','deleteRenderbuffer']]) {
   const key=created.slice(6).toLowerCase()+'s';
   if(typeof proto[created]==='function'){const original=proto[created];proto[created]=function(...args){metrics.created[key]++;return original.apply(this,args)}};
   if(typeof proto[deleted]==='function'){const original=proto[deleted];proto[deleted]=function(...args){metrics.deleted[key]++;return original.apply(this,args)}};
  }
 }
 window.__boardGpuReset = () => {
  metrics.calls=0; metrics.triangles=0; metrics.lines=0; metrics.other=0;
  metrics.frameCalls=0; metrics.frameTriangles=0; metrics.peakFrameCalls=0;
  metrics.peakFrameTriangles=0; metrics.frames=[]; metrics.rafCallbacks=0;
 };
})();"""


GPU_STATE = """() => {
 const metrics=window.__boardGpuMetrics ?? null;
 const canvas=document.querySelector('.board-three canvas');
 let rootState=null;
 try {
  const store=canvas?.__r3f?.root;
  const state=store?.getState?.();
  if(state) rootState={cameraType:state.camera?.type ?? null, cameraPosition:state.camera?.position?.toArray?.() ?? null,
   projectionMatrix:state.camera?.projectionMatrix?.elements ? Array.from(state.camera.projectionMatrix.elements) : null,
   drawingBuffer:[state.gl?.drawingBufferWidth ?? null,state.gl?.drawingBufferHeight ?? null]};
 } catch(error) { rootState={unavailable:String(error)}; }
 return {
  metrics: metrics ? {calls:metrics.calls,triangles:metrics.triangles,lines:metrics.lines,other:metrics.other,
   peakFrameCalls:metrics.peakFrameCalls,peakFrameTriangles:metrics.peakFrameTriangles,rafCallbacks:metrics.rafCallbacks,
   created:metrics.created,deleted:metrics.deleted,net:{textures:metrics.created.textures-metrics.deleted.textures,
   buffers:metrics.created.buffers-metrics.deleted.buffers,programs:metrics.created.programs-metrics.deleted.programs,
   shaders:metrics.created.shaders-metrics.deleted.shaders,framebuffers:metrics.created.framebuffers-metrics.deleted.framebuffers,
   renderbuffers:metrics.created.renderbuffers-metrics.deleted.renderbuffers}} : null,
  r3fRoot:rootState, effectiveDpr:canvas ? {drawingBuffer:[canvas.width,canvas.height],css:[canvas.clientWidth,canvas.clientHeight],
   ratioX:canvas.clientWidth?canvas.width/canvas.clientWidth:null,ratioY:canvas.clientHeight?canvas.height/canvas.clientHeight:null} : null
 };
}"""


class Scenario:
    def __init__(self, browser, base, args, fixture, board, locale, size, out, *, initial="baseline",
                 motion="reduce", video=False, init_script=None, block_asset=None):
        self.args = args
        self.fixture = fixture
        self.board = board
        self.out = out
        self.snapshot = copy.deepcopy(board[initial])
        self.sockets = []
        self.errors = []
        self.console_errors = []
        self.unmapped = []
        self.api_calls = []
        self.failed_responses = []
        self.blocked_assets = []
        self.assets = {}
        self.debugger_exceptions = []
        options = {
            "viewport": {"width": size[0], "height": size[1]},
            "device_scale_factor": 1,
            "locale": "zh-TW" if locale == "zh-Hant" else "en-US",
            "reduced_motion": motion,
            "has_touch": size[0] < 900,
            "service_workers": "block",
        }
        if video:
            options.update(record_video_dir=str(out / "videos"), record_video_size=options["viewport"])
        self.closed = False
        self.video_started_at = time.monotonic() if video else None
        self.context = browser.new_context(**options)
        self.context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
        self.context.add_init_script(GPU_INSTRUMENT)
        if init_script:
            self.context.add_init_script(init_script)
        self.block_asset = block_asset
        self.context.route("**/*", self.route_asset)
        self.context.route("**/api/**", self.route_api)
        self.context.route_web_socket("**/ws", self.connect_socket)
        self.page = self.context.new_page()
        self.page.set_default_timeout(20000)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("response", self.record_response)
        self.page.on("console", self.record_console)
        if os.environ.get("BOARD3D_CAPTURE_EXCEPTIONS") == "1" and hasattr(browser.browser_type, "name") and browser.browser_type.name == "chromium":
            self.debugger = self.context.new_cdp_session(self.page)

            def pause(event) -> None:
                data = event.get("data") or {}
                exception = data.get("exception") or {}
                self.debugger_exceptions.append({
                    "reason": event.get("reason"),
                    "description": exception.get("description") or data.get("description"),
                    "text": data.get("text"),
                    "stackTrace": data.get("stackTrace"),
                    "callFrames": [
                        {"functionName": frame.get("functionName"), "url": frame.get("url"),
                         "lineNumber": frame.get("location", {}).get("lineNumber"),
                         "columnNumber": frame.get("location", {}).get("columnNumber")}
                        for frame in event.get("callFrames", [])
                    ],
                })
                self.debugger.send("Debugger.resume")

            self.debugger.on("Debugger.paused", pause)
            self.debugger.send("Debugger.enable")
            self.debugger.send("Debugger.setPauseOnExceptions", {"state": "all"})
        query = f"?renderer={args.renderer}&quality={args.quality}"
        try:
            self.page.goto(base + "/" + query, wait_until="networkidle")
            self.page.locator("#home-tab-resume").click()
            self.page.get_by_test_id("resume-g1").click()
            self.page.get_by_test_id("board").wait_for(state="visible")
            self.wait_expected_renderer()
            self.page.evaluate("document.fonts.ready")
            self.page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        except Exception:
            self.close()
            raise

    def wait_expected_renderer(self) -> None:
        expected = self.args.renderer
        if expected == "svg":
            self.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'svg'")
            return
        self.page.wait_for_function("""() => {
          const b=document.querySelector('[data-testid="board"]');
          return b?.dataset.rendererStatus === 'ready' || b?.dataset.rendererStatus === 'failed';
        }""", timeout=30000)

    def record_console(self, message) -> None:
        if message.type == "error":
            self.console_errors.append(message.text)

    def record_response(self, response) -> None:
        if response.status >= 400:
            self.failed_responses.append({"status": response.status, "url": response.url})
        parsed = urlparse(response.url)
        if parsed.path == "/" or parsed.path.endswith((".js", ".css", ".html")):
            local = DIST / ("index.html" if parsed.path == "/" else unquote(parsed.path).lstrip("/"))
            if local.is_file() and local.resolve().is_relative_to(DIST):
                actual = sha(response.body())
                self.assets[parsed.path] = actual
                if actual != file_hash(local):
                    self.errors.append(f"loaded asset hash mismatch: {parsed.path}")

    def route_asset(self, route) -> None:
        url = route.request.url
        if self.block_asset and self.block_asset(url):
            self.blocked_assets.append(url)
            route.abort("failed")
        else:
            route.fallback()

    def route_api(self, route) -> None:
        request = route.request
        path = urlparse(request.url).path
        self.api_calls.append({"method": request.method, "path": path})
        data = None
        if path == "/api/config":
            data = self.fixture["config"]
        elif path == "/api/session":
            data = {"player": self.fixture["identity"]}
        elif path == "/api/profiles":
            data = {"profiles": fixture_profiles(self.fixture)}
        elif path == "/api/rooms":
            data = {"rooms": []}
        elif path == "/api/games":
            data = {"games": self.board["games"]}
        elif path in ("/api/rooms/r1", "/api/games/g1/resume"):
            data = self.board["room"]
        elif path == "/api/games/g1":
            data = self.snapshot
        elif path == "/api/games/g1/events":
            data = {"events": self.snapshot["view"]["events"], "revision": self.snapshot["revision"]}
        elif path == "/api/rooms/r1/chat":
            data = {"messages": [], "nextSeq": 0, "hasMore": False}
        else:
            self.unmapped.append({"method": request.method, "path": path})
            route.fulfill(status=501, json={"ok": False, "error": {"code": "E_INVALID_COMMAND", "messageId": "error.E_INVALID_COMMAND"}})
            return
        route.fulfill(status=200, json={"ok": True, "data": data})

    def connect_socket(self, socket_route) -> None:
        self.sockets.append(socket_route)
        socket_route.on_message(lambda _message: None)

    def send(self, snapshot: dict) -> None:
        self.snapshot = copy.deepcopy(snapshot)
        if not self.sockets:
            raise RuntimeError("fixture WebSocket was not connected")
        for socket_route in self.sockets:
            socket_route.send(json.dumps({"type": "snapshot", "payload": self.snapshot}, separators=(",", ":")))

    def state(self) -> dict:
        return self.page.evaluate(BOARD_STATE)

    def webgl(self) -> dict:
        return self.page.evaluate(WEBGL_STATE)

    def gpu(self, reset: bool = False) -> dict:
        if reset:
            self.page.evaluate("window.__boardGpuReset?.()")
        return self.page.evaluate(GPU_STATE)

    def screenshot(self, name: str, *, viewport: tuple[int, int], locale: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", name)
        path = self.out / f"{safe}-{self.args.renderer}-{self.args.quality}-{viewport[0]}x{viewport[1]}-{locale}.png"
        self.page.screenshot(path=str(path), full_page=True, animations="disabled")
        return path

    def save_video(self, name: str) -> Path | None:
        video = self.page.video
        # Playwright finalizes recorded video when the page closes. save_as is
        # valid only afterwards, and close() remains safe from the caller's
        # outer finally block.
        self.close()
        if not video:
            return None
        path = self.out / f"{name}.webm"
        video.save_as(str(path))
        return path

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            if not self.page.is_closed():
                self.page.close()
        finally:
            self.context.close()


def evidence_base(report: dict, scenario: Scenario) -> dict:
    return {
        "renderer": {"requested": report["requestedRenderer"], "effective": report.get("effectiveRenderer"),
                     "quality": report["quality"], "status": report.get("rendererStatus")},
        "sourceSha": report["provenance"]["sourceSha"],
        "sourceHash": report["provenance"]["sourceHash"],
        "buildHash": report["provenance"]["buildHash"],
        "fixtureHash": report["fixture"]["sha256"],
        "errors": scenario.errors,
        "consoleErrors": scenario.console_errors,
        "caughtExceptions": scenario.debugger_exceptions,
        "unmapped": scenario.unmapped,
    }


def update_renderer_evidence(report: dict, state: dict) -> None:
    report["effectiveRenderer"] = state.get("effective")
    report["rendererStatus"] = state.get("status")


def visuals(browser, base, args, fixture, report, out) -> None:
    captures = 0
    for board, size, locale in (
        (fixture["boards"][0], (1366, 768), "en"),
        (fixture["boards"][0], (390, 844), "zh-Hant"),
        (fixture["boards"][1], (1366, 768), "zh-Hant"),
        (fixture["boards"][1], (390, 844), "en"),
    ):
        scenario = None
        tag = f"{board['id']}-{size[0]}x{size[1]}-{locale}"
        try:
            scenario = Scenario(browser, base, args, fixture, board, locale, size, out, motion="reduce")
            state = scenario.state()
            update_renderer_evidence(report, state)
            gl = scenario.webgl() if state["effective"] == "r3f" else None
            image = scenario.screenshot(f"board-{tag}", viewport=size, locale=locale)
            report["artifacts"].append(relative(image))
            topology_ok = state["hexes"] == board["topology"]["hexes"] if state["effective"] == "svg" else state["canvas"] is not None and gl and gl.get("available")
            okay = bool(state["board"] and state["board"]["width"] > 0 and state["board"]["height"] > 0 and topology_ok and
                        state["status"] in ("idle", "ready") and not scenario.errors and not scenario.unmapped)
            case(report, f"R04-capture-{tag}", "PASS" if okay else "FAIL", fixture=board["id"], topology=board["topologyId"],
                 locale=locale, viewport=list(size), dpr=1, requestedRenderer=args.renderer,
                 effectiveRenderer=state["effective"], quality=args.quality, screenshot=relative(image),
                 screenshotHash=file_hash(image), webgl=gl, actual=state, **evidence_base(report, scenario))
            captures += 1
        except Exception as error:
            case(report, f"R04-capture-{tag}", "FAIL", error=str(error), traceback=traceback.format_exc())
        finally:
            if scenario:
                scenario.close()
    case(report, "V01-V07-human-art-acceptance", "NOT RUN", detail="Captures are engineering candidates; true-volume and user visual acceptance require manual review. No V case is marked PASS.")
    case(report, "R04-capture-completeness", "PASS" if captures == 4 else "FAIL", captures=captures, expected=4)


def interactions(browser, base, args, fixture, report, out) -> None:
    scenario = None
    try:
        board = fixture["boards"][0]
        scenario = Scenario(browser, base, args, fixture, board, "en", (1366, 768), out, motion="no-preference")
        state = scenario.state()
        update_renderer_evidence(report, state)
        scenario.send(board["sequence"][0]["snapshot"])
        scenario.page.wait_for_timeout(900)
        action = scenario.page.get_by_test_id("action-build.road")
        enabled = action.is_enabled()
        targets = 0
        target_records = []
        selected = False
        cancelled = False
        if enabled:
            action.click()
            target_buttons = scenario.page.locator('button[data-testid^="target-edge-"]')
            target_buttons.first.wait_for(state="visible")
            if state["effective"] == "r3f":
                slider = scenario.page.get_by_test_id("camera-elevation")
                slider.click()
                slider.press("Home")
                scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.cameraElevation === '25'")
                scenario.page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                low = target_buttons.evaluate_all("nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return [r.x,r.y]; })")
                slider.press("End")
                scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.cameraElevation === '80'")
                scenario.page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                high = target_buttons.evaluate_all("nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return [r.x,r.y]; })")
                moved = len(low) == len(high) and any(math.dist(a, b) > 2 for a, b in zip(low, high))
                scenario.page.get_by_test_id("reset-view").click()
                scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.cameraElevation === '50'")
                case(report, "I08-camera-elevation", "PASS" if moved else "FAIL",
                     range=[25, 80], lowTargetPositions=low, highTargetPositions=high,
                     restoredElevation=50, detail="Real range input and keyboard limits change live target projections; fit restores the default angle.")
                anchor = target_buttons.first.bounding_box()
                x, y = anchor["x"] + anchor["width"] / 2, anchor["y"] + anchor["height"] / 2
                scenario.page.mouse.move(x, y)
                scenario.page.mouse.down()
                scenario.page.mouse.move(x + 48, y + 24, steps=8)
                scenario.page.mouse.up()
                scenario.page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                orbit = scenario.page.get_by_test_id("board").evaluate("""node => ({
                  azimuth:Number(node.dataset.cameraAzimuth), elevation:Number(node.dataset.cameraElevation)
                })""")
                no_selection = scenario.page.get_by_test_id("selection-preview").count() == 0
                case(report, "I09-orbit-from-target", "PASS" if orbit["azimuth"] != 20 and
                     orbit["elevation"] != 50 and no_selection else "FAIL", actual=orbit,
                     noAccidentalSelection=no_selection,
                     detail="Left drag starting on a legal target orbits both axes without selecting it.")
                scenario.page.get_by_test_id("reset-view").click()
                scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.cameraAzimuth === '20'")
                if args.browser == "chromium":
                    cdp = scenario.context.new_cdp_session(scenario.page)
                    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 2})
                    scenario.page.evaluate("""() => {
                      window.__orbitCaptureLoss = [];
                      document.querySelector('[data-testid="board-surface"]').addEventListener('lostpointercapture', event => {
                        window.__orbitCaptureLoss.push({target:event.target.dataset.testid,
                          currentTarget:event.currentTarget.dataset.testid, pointerId:event.pointerId});
                      }, true);
                    }""")
                    anchor = target_buttons.first.bounding_box()
                    x, y = anchor["x"] + anchor["width"] / 2, anchor["y"] + anchor["height"] / 2
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart",
                             "touchPoints": [{"id": 1, "x": x, "y": y}]})
                    for step in range(1, 7):
                        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                                 "touchPoints": [{"id": 1, "x": x + step * 8, "y": y + step * 4}]})
                    touch_active = scenario.page.get_by_test_id("board-surface").get_attribute("data-gesture-active")
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                    scenario.page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
                    touch = scenario.page.get_by_test_id("board").evaluate("""node => ({
                      azimuth:Number(node.dataset.cameraAzimuth), elevation:Number(node.dataset.cameraElevation)
                    })""")
                    no_selection = scenario.page.get_by_test_id("selection-preview").count() == 0
                    case(report, "I10-touch-capture-transfer", "PASS" if touch_active == "true" and
                         touch["azimuth"] != 20 and touch["elevation"] != 50 and no_selection else "FAIL",
                         actual=touch, activeUntilRelease=touch_active, noAccidentalSelection=no_selection,
                         captureLoss=scenario.page.evaluate("window.__orbitCaptureLoss"),
                         detail="Chromium synthetic touch starts on a target and transfers implicit capture to the orbit surface; not a physical-device check.")
                    cdp.detach()
                    scenario.page.get_by_test_id("reset-view").click()
                else:
                    case(report, "I10-touch-capture-transfer", "NOT RUN", detail="Requires Chromium CDP synthetic touch.")
            else:
                case(report, "I08-camera-elevation", "NOT RUN", detail="Elevation applies to the modeled renderer.")
                case(report, "I09-orbit-from-target", "NOT RUN", detail="Orbit applies to the modeled renderer.")
                case(report, "I10-touch-capture-transfer", "NOT RUN", detail="Orbit applies to the modeled renderer.")
            targets = target_buttons.count()
            target_records = target_buttons.evaluate_all("""nodes => nodes.map(node => {
              const box=node.getBoundingClientRect();
              return {testId:node.dataset.testid,kind:node.dataset.targetKind,index:node.dataset.targetIndex,
                width:box.width,height:box.height};
            })""")
            target = target_buttons.first
            target.focus()
            target.press("Enter")
            scenario.page.get_by_test_id("selection-preview").wait_for(state="visible")
            selected = True
            scenario.page.get_by_test_id("selection-preview").press("Escape")
            cancelled = scenario.page.get_by_test_id("selection-preview").count() == 0
        mutations = [call for call in scenario.api_calls if call["method"] not in ("GET", "HEAD", "OPTIONS")]
        target_ids_ok = bool(target_records) and all(item["kind"] == "edge" and item["index"] is not None for item in target_records)
        hit_area_ok = bool(target_records) and all(item["width"] >= 44 and item["height"] >= 44 for item in target_records)
        case(report, "I01-target-activation", "PASS" if enabled and target_ids_ok and not scenario.unmapped else "FAIL",
             fixture=board["id"], actionEnabled=enabled, targetCount=targets, targetRecords=target_records,
             evidence=evidence_base(report, scenario))
        case(report, "I03-target-hit-area", "PASS" if hit_area_ok else "FAIL", minimumCssPx=44,
             targetRecords=target_records, evidence=evidence_base(report, scenario))
        case(report, "I07-keyboard-select-cancel", "PASS" if selected and cancelled and not scenario.errors and not mutations else "FAIL",
             selectedByEnter=selected, cancelledByEscape=cancelled,
             mutationCalls=mutations, evidence=evidence_base(report, scenario))
        for identifier, detail in (
            ("I02-projection-pixel-tolerance", "No independent rendered target-vs-mesh pixel comparison with <=2 CSS px tolerance was run."),
            ("I04-live-pinch-wheel-capture-loss", "No native touch/pinch/wheel/pointer-capture-loss device session was run."),
            ("I05-ambiguity-picker-flow", "The fixture did not force an overlapping click cluster through the visible TargetPicker UI."),
            ("I06-fit-zoom-renderer-parity", "Cross-renderer fit/topology/renderer-switch parity is not asserted by this interaction pass."),
        ):
            case(report, identifier, "NOT RUN", detail=detail)
    except Exception as error:
        case(report, "I01-target-activation", "FAIL", error=str(error), traceback=traceback.format_exc())
        for identifier in ("I02-projection-pixel-tolerance", "I03-target-hit-area", "I04-live-pinch-wheel-capture-loss",
                           "I05-ambiguity-picker-flow", "I06-fit-zoom-renderer-parity", "I07-keyboard-select-cancel"):
            case(report, identifier, "NOT RUN", detail="Interaction scenario did not complete; see I01 failure.")
    finally:
        if scenario:
            scenario.close()


def privacy_events(browser, base, args, fixture, report, out) -> None:
    board = fixture["boards"][0]
    scenario = None
    event_checks = []
    try:
        scenario = Scenario(browser, base, args, fixture, board, "en", (1366, 768), out, motion="no-preference",
                            video=True, initial="baseline")
        update_renderer_evidence(report, scenario.state())
        before = scenario.page.locator('[data-testid="dice-focus"]').count()
        scenario.send(board["sequence"][0]["snapshot"])
        scenario.page.wait_for_timeout(150)
        dice = scenario.page.locator('[data-testid="dice-focus"]').count()
        event_checks.append({"step": "roll", "overlayBefore": before, "overlayAfter": dice})
        scenario.page.wait_for_timeout(800)
        settled = scenario.page.locator('[data-testid="dice-focus"]').count()
        event_checks.append({"step": "settled", "overlayAfter": settled})
        for step in board["sequence"][1:]:
            scenario.send(step["snapshot"])
            scenario.page.wait_for_timeout(100)
            event_checks.append({"step": step["command"]["type"], "effects": scenario.page.locator('[data-testid="board-effects"]').count()})
        video_target_ms = 11000
        video_minimum_ms = 10000
        video_maximum_ms = 15000
        recorded_ms = int((time.monotonic() - scenario.video_started_at) * 1000)
        if recorded_ms < video_target_ms:
            scenario.page.wait_for_timeout(video_target_ms - recorded_ms)
            recorded_ms = int((time.monotonic() - scenario.video_started_at) * 1000)
        evidence = evidence_base(report, scenario)
        video = scenario.save_video("events-sequence")
        if video:
            report["artifacts"].append(relative(video))
        video_duration_ok = video_minimum_ms <= recorded_ms <= video_maximum_ms
        okay = before == 0 and dice == 1 and settled == 0 and not scenario.errors and not scenario.unmapped and video_duration_ok
        case(report, "E01-roll-overlay-lifecycle", "PASS" if okay else "FAIL", fixture=board["id"],
             checkpoints=event_checks, video=relative(video) if video else None,
             recordingElapsedMs=recorded_ms, videoMinimumMs=video_minimum_ms, videoMaximumMs=video_maximum_ms,
             evidence=evidence)
    except Exception as error:
        case(report, "E01-roll-overlay-lifecycle", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        if scenario:
            scenario.close()
    for identifier, detail in (
        ("E02-authoritative-placement", "Receipt/confirmedPlacement equivalence and 240-290ms timing were not asserted by this browser pass."),
        ("E03-preview-ghost-depth", "Live ghost depthWrite/occlusion inspection was not run."),
        ("E04-production-aggregate-cap", "The 24-icon production/theft cap is source-tested; no captured high-count browser fixture was run here."),
        ("E06-event-recovery", "Setup/reroll/robber/discard/offline/reconnecting/unknown receipt recovery was not exercised end to end."),
    ):
        case(report, identifier, "NOT RUN", detail=detail)

    markup = []
    for item in board["privacy"]:
        scenario = None
        try:
            viewer_fixture = copy.deepcopy(fixture)
            viewer_fixture["identity"] = item["identity"]
            viewer_board = copy.deepcopy(board)
            viewer_board["baseline"] = item["baseline"]
            scenario = Scenario(browser, base, args, viewer_fixture, viewer_board, "en", (1366, 768), out,
                                motion="no-preference", initial="baseline")
            scenario.send(item["snapshot"])
            failure = scenario.page.get_by_test_id("board").locator("xpath=.").get_attribute("data-renderer-status")
            if failure == "failed":
                raise RuntimeError(f"renderer failed during privacy capture: {failure}")
            # Read the transient overlay atomically while it exists. A screenshot
            # may outlive its normal 800ms lifetime, especially on software GPUs.
            sample = scenario.page.wait_for_function("""() => {
              const overlay = document.querySelector('[data-testid="board-effects"]');
              if (!overlay?.querySelector('[data-testid="neutral-theft"]')) return false;
              return {markup: overlay.innerHTML, text: overlay.textContent};
            }""", timeout=10000).json_value()
            markup.append(sample["markup"])
            image = scenario.screenshot(f"privacy-{item['viewer']}", viewport=(1366, 768), locale="en")
            report["artifacts"].append(relative(image))
            case(report, f"E05-privacy-{item['viewer']}", "PASS" if sample["text"] == "" and not scenario.errors else "FAIL",
                 viewer=item["viewer"], activeOverlay=sample, screenshot=relative(image), evidence=evidence_base(report, scenario))
        except Exception as error:
            case(report, f"E05-privacy-{item['viewer']}", "FAIL", error=str(error), traceback=traceback.format_exc())
        finally:
            if scenario:
                scenario.close()
    case(report, "E05-neutral-markup-equality", "PASS" if len(set(markup)) == 1 and len(markup) == 4 else "FAIL",
         viewers=[item["viewer"] for item in board["privacy"]], distinctMarkup=len(set(markup)))

    reduced = None
    try:
        reduced = Scenario(browser, base, args, fixture, board, "en", (390, 844), out, motion="reduce", initial="baseline")
        reduced.send(board["sequence"][0]["snapshot"])
        reduced.page.wait_for_timeout(200)
        overlays = reduced.page.locator('[data-testid="board-effects"],[data-testid="dice-focus"]').count()
        dice_result = reduced.page.get_by_test_id("dice-roll-animation").inner_text()
        case(report, "E06-reduced-motion", "PASS" if overlays == 0 and dice_result and not reduced.errors else "FAIL",
             overlays=overlays, persistentDice=dice_result, evidence=evidence_base(report, reduced))
    except Exception as error:
        case(report, "E06-reduced-motion", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        if reduced:
            reduced.close()
    case(report, "E01-background-reconnect", "NOT RUN", detail="Background visibility and real reconnect require a controlled service lifecycle; jsdom lifecycle tests are supplementary and not promoted to browser PASS.")


NO_WEBGL = """(() => {
 const original=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){
  if(String(type).startsWith('webgl')) return null;
  return original.call(this,type,...args);
 };
})();"""


def faults(browser, base, args, fixture, report, out) -> None:
    board = fixture["boards"][0]

    scenario = None
    try:
        if args.renderer == "svg":
            case(report, "G01-webgl2-unavailable", "NOT RUN", explicitSvg=True, detail='Explicit SVG was requested; WebGL-unavailable, blocked GPU-chunk, and native context-loss failure preconditions are irrelevant.')
            raise StopIteration
        scenario = Scenario(browser, base, args, fixture, board, "en", (800, 450), out, init_script=NO_WEBGL)
        state = scenario.state()
        update_renderer_evidence(report, state)
        okay = state["effective"] == "svg" and state["status"] == "failed" and bool(state["fallbackReason"]) and state["svg"] and not scenario.unmapped
        case(report, "G01-webgl2-unavailable", "PASS" if okay else "FAIL", actual=state, evidence=evidence_base(report, scenario))
    except StopIteration:
        pass
    except Exception as error:
        case(report, "G01-webgl2-unavailable", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        if scenario:
            scenario.close()

    scenario = None
    try:
        if args.renderer == "svg":
            case(report, "G02-scene-chunk-blocked", "NOT RUN", explicitSvg=True, detail='Explicit SVG was requested; WebGL-unavailable, blocked GPU-chunk, and native context-loss failure preconditions are irrelevant.')
            raise StopIteration
        scenario = Scenario(browser, base, args, fixture, board, "en", (800, 450), out,
                            block_asset=lambda url: bool(re.search(r"(BoardScene3D|SceneContent|three[-_.])", url)))
        state = scenario.state()
        update_renderer_evidence(report, state)
        okay = bool(scenario.blocked_assets) and state["effective"] == "svg" and state["status"] == "failed"
        case(report, "G02-scene-chunk-blocked", "PASS" if okay else "FAIL", blockedAssets=scenario.blocked_assets,
             actual=state, evidence=evidence_base(report, scenario))
    except StopIteration:
        pass
    except Exception as error:
        case(report, "G02-scene-chunk-blocked", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        if scenario:
            scenario.close()

    scenario = None
    try:
        historical = copy.deepcopy(args)
        historical.renderer = "svg"
        scenario = Scenario(browser, base, historical, fixture, board, "en", (800, 450), out)
        state = scenario.state()
        gpu_assets = [url for url in state["resources"] if re.search(r"(BoardScene3D|SceneContent|three[-_.])", url)]
        case(report, "G02-explicit-svg-no-gpu-chunk", "PASS" if not gpu_assets else "FAIL", gpuAssets=gpu_assets,
             actual=state, evidence=evidence_base(report, scenario))
    except Exception as error:
        case(report, "G02-explicit-svg-no-gpu-chunk", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        if scenario:
            scenario.close()

    scenario = None
    try:
        if args.renderer == "svg":
            case(report, "G03-native-context-loss", "NOT RUN", explicitSvg=True, detail='Explicit SVG was requested; WebGL-unavailable, blocked GPU-chunk, and native context-loss failure preconditions are irrelevant.')
            raise StopIteration
        scenario = Scenario(browser, base, args, fixture, board, "en", (1366, 768), out)
        initial = scenario.state()
        if initial["effective"] != "r3f":
            case(report, "G03-native-context-loss", "BLOCKED", actual=initial,
                 detail="Native context-loss precondition failed because this browser did not reach effective r3f; mocked callbacks were not promoted to native evidence.",
                 evidence=evidence_base(report, scenario))
            raise StopIteration
        extension = scenario.page.evaluate("""() => {
          const canvas=document.querySelector('.board-three canvas');
          const gl=canvas?.getContext('webgl2');
          if(!gl) return {supported:false, reason:'webgl2-missing'};
          const ext=gl.getExtension('WEBGL_lose_context');
          if(!ext) return {supported:false, reason:'WEBGL_lose_context-missing'};
          ext.loseContext(); return {supported:true};
        }""")
        if extension["supported"]:
            scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.rendererStatus === 'failed'", timeout=15000)
            state = scenario.state()
            update_renderer_evidence(report, state)
            case(report, "G03-native-context-loss", "PASS" if state["effective"] == "svg" and state["fallbackReason"] == "webgl-context-lost" else "FAIL",
                 extension=extension, actual=state, evidence=evidence_base(report, scenario))
        else:
            case(report, "G03-native-context-loss", "BLOCKED", extension=extension, detail="Browser does not expose WEBGL_lose_context; callback injection is not native-loss evidence.")
    except Exception as error:
        if not isinstance(error, StopIteration):
            case(report, "G03-native-context-loss", "FAIL", error=str(error), traceback=traceback.format_exc(),
                 evidence=evidence_base(report, scenario) if scenario else None)
    finally:
        if scenario:
            scenario.close()

    scenario = None
    try:
        scenario = Scenario(browser, base, args, fixture, board, "en", (1366, 768), out)
        scenario.page.locator(".board__display-settings > summary").click()
        scenario.page.get_by_test_id("renderer-select").select_option("svg")
        scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'svg'")
        scenario.page.get_by_test_id("renderer-select").select_option("r3f")
        scenario.page.wait_for_function("document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === 'r3f'", timeout=30000)
        for _ in range(10):
            scenario.page.set_viewport_size({"width": 1366 + (_ % 2) * 40, "height": 768})
            scenario.page.wait_for_timeout(30)
        state = scenario.state()
        mutations = [call for call in scenario.api_calls if call["method"] not in ("GET", "HEAD", "OPTIONS")]
        case(report, "G06-renderer-switch-resize", "PASS" if state["effective"] == "r3f" and not mutations and not scenario.errors else "FAIL",
             actual=state, mutationCalls=mutations, evidence=evidence_base(report, scenario))
    except Exception as error:
        case(report, "G06-renderer-switch-resize", "FAIL", error=str(error), traceback=traceback.format_exc(),
             evidence=evidence_base(report, scenario) if scenario else None)
    finally:
        if scenario:
            scenario.close()

    case(report, "G04-enter-exit-20", "NOT RUN", detail="Current runner reloads one game but does not automate twenty authenticated enter/exit cycles; Canvas resources and heap are not promoted to PASS.")
    case(report, "G05-snapshot-during-fault", "NOT RUN", detail="Requires controlled concurrent service delivery while the scene fails; not replaced by callback mocks.")


FRAME_SAMPLE = """duration => new Promise(resolve => {
 const intervals=[]; let previous=null; const start=performance.now();
 function frame(now){ if(previous!==null) intervals.push(now-previous); previous=now;
  if(now-start<duration) requestAnimationFrame(frame); else resolve(intervals); }
 requestAnimationFrame(frame);
})"""


def performance(browser, base, args, fixture, report, out) -> None:
    scenario = None
    records = []
    try:
        board = fixture["boards"][1]
        scenario = Scenario(browser, base, args, fixture, board, "en", (1366, 768), out, motion="no-preference")
        state = scenario.state()
        update_renderer_evidence(report, state)
        gl = scenario.webgl() if state["effective"] == "r3f" else None
        gpu_ready = bool(
            state["effective"] == "r3f" and state["status"] == "ready" and
            gl and gl.get("available") and not gl.get("lost")
        )
        scenario.gpu(reset=True)
        for repetition in range(3):
            raw = scenario.page.evaluate(FRAME_SAMPLE, 30000)
            ordered = sorted(raw)
            p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)] if ordered else None
            record = {"repetition": repetition + 1, "windowMs": 30000, "sampleCount": len(raw), "p95Ms": p95,
                      "maxMs": max(raw) if raw else None, "meanMs": statistics.fmean(raw) if raw else None, "raw": raw}
            records.append(record)
            raw_path = out / f"P01-frame-intervals-{repetition + 1}.json"
            raw_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            report["artifacts"].append(relative(raw_path))
            case(report, f"P01-idle-scheduling-proxy-{repetition + 1}", "PASS" if p95 is not None and p95 <= 20 else "FAIL",
                 record={key: value for key, value in record.items() if key != "raw"}, webgl=gl,
                 detail="Idle page rAF scheduling floor under the current renderer; this is not active-workload GPU render time or physical device acceptance.")
        scenario.gpu(reset=True)
        scenario.page.wait_for_timeout(30000)
        idle = scenario.gpu()
        idle_metrics = idle.get("metrics")
        idle_draws = (idle_metrics or {}).get("calls")
        idle_rafs = (idle_metrics or {}).get("rafCallbacks")
        p02_ok = bool(idle_metrics and idle_draws == 0 and idle_rafs == 0)
        if gpu_ready:
            case(report, "P02-idle-demand-render", "PASS" if p02_ok else "FAIL",
                 windowMs=30000, gpuDrawCalls=idle_draws, rafCallbacks=idle_rafs, gpu=idle,
                 detail="Effective r3f scene with a live WebGL2 context; demand rendering is idle only when both board draw calls and page rAF callbacks remain zero.")
        else:
            case(report, "P02-idle-demand-render", "NOT RUN",
                 requestedRenderer=args.renderer, effectiveRenderer=state["effective"], webgl=gl,
                 detail="GPU idle evidence requires an effective r3f scene and a live WebGL2 context; zero draws under SVG are not GPU evidence.")
        scenario.gpu(reset=True)
        for step in board["sequence"]:
            scenario.send(step["snapshot"])
            scenario.page.wait_for_timeout(900)
        gpu = scenario.gpu()
        metrics = gpu.get("metrics") or {}
        max_calls = metrics.get("peakFrameCalls")
        max_triangles = metrics.get("peakFrameTriangles")
        call_limit = 250 if args.quality == "standard" else 150
        triangle_limit = 150000 if args.quality == "standard" else 100000
        p03_ok = bool(max_calls and max_triangles and max_calls <= call_limit and max_triangles <= triangle_limit)
        if gpu_ready:
            case(report, "P03-gpu-draw-budget", "PASS" if p03_ok else "FAIL", quality=args.quality,
                 peakFrameCalls=max_calls, peakFrameTriangles=max_triangles, callLimit=call_limit, triangleLimit=triangle_limit,
                 gpu=gpu, effectiveDpr=gpu.get("effectiveDpr"), r3fRoot=gpu.get("r3fRoot"),
                 detail="Effective r3f fixture sequence; non-zero per-frame calls/triangles include shadow and instanced passes measured at WebGL API boundaries.")
        else:
            case(report, "P03-gpu-draw-budget", "NOT RUN", quality=args.quality,
                 peakFrameCalls=max_calls, peakFrameTriangles=max_triangles, webgl=gl,
                 detail="GPU budget evidence requires an effective r3f scene and a live WebGL2 context; SVG frames or zero draws are not evidence.")
        case(report, "P01-reference-hardware", "BLOCKED", detail="No calibrated 60Hz physical desktop or mobile thermal/power run is available.")
        case(report, "P04-cold-cache-bytes", "NOT RUN", detail="Three cold-cache repetitions and transfer/parse timing are not part of this performance pass.")
        case(report, "P05-command-latency", "NOT RUN", detail="Six-client acknowledgement workload is outside the fixture runner.")
    except Exception as error:
        case(report, "P01-idle-scheduling-proxy", "FAIL", error=str(error), traceback=traceback.format_exc())
        case(report, "P02-idle-demand-render", "NOT RUN", detail="Performance scenario did not complete; see P01 failure.")
        case(report, "P03-gpu-draw-budget", "NOT RUN", detail="Performance scenario did not complete; see P01 failure.")
    finally:
        if scenario:
            scenario.close()
    report.setdefault("metrics", {})["frameIntervals"] = records


def real_flow(browser, base, args, fixture, report, out) -> None:
    case(report, "R02-real-create-play-save-resume", "BLOCKED",
         detail="The deterministic fixture runner does not own a real authenticated multi-seat service lifecycle; run this suite only in the approved real-flow harness.")
    case(report, "A01-screen-reader-walkthrough", "BLOCKED", detail="No screen reader session or assistive-technology evidence is available.")
    case(report, "R03-physical-devices", "BLOCKED", detail="No physical Android Chrome or iOS Safari device is attached.")


def manual_matrix(report: dict) -> None:
    r04_cases = [item for item in report["cases"] if item["id"].startswith("R04-capture-")]
    r04 = "PASS" if r04_cases and all(item["status"] == "PASS" for item in r04_cases) else "FAIL" if any(item["status"] == "FAIL" for item in r04_cases) else "NOT RUN"
    report["manualAcceptance"] = {
        "V": {item: "NOT RUN" for item in ("V01", "V02", "V03", "V04", "V05", "V06", "V07")},
        "A": {"A01-screen-reader": "BLOCKED", "A02-human-visual-zoom-gray": "NOT RUN", "A03-automated-projection-review": "NOT RUN"},
        "R": {"R02-real-flow": "BLOCKED", "R03-physical-devices": "BLOCKED", "R04-artifact-reproduction": r04},
    }


def aggregate_status(report: dict) -> str:
    statuses = [item["status"] for item in report["cases"]]
    if "FAIL" in statuses:
        return "FAIL"
    if "BLOCKED" in statuses:
        return "BLOCKED"
    return "PASS"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--renderer", choices=("svg", "r3f", "auto"), default="svg")
    parser.add_argument("--quality", choices=("standard", "low"), default="standard")
    parser.add_argument("--suite", choices=("visual", "interaction", "events", "faults", "performance", "real-flow", "all"), required=True)
    parser.add_argument("--browser", choices=("chromium", "firefox", "webkit"), default="chromium")
    parser.add_argument("--base-url")
    parser.add_argument("--executable-path")
    args = parser.parse_args()

    out = output_path(args.out)
    report = {
        "schemaVersion": 1,
        "runId": out.name,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "BLOCKED",
        "suite": args.suite,
        "requestedRenderer": args.renderer,
        "quality": args.quality,
        "browser": args.browser,
        "cases": [],
        "artifacts": [],
        "metrics": {},
        "limitations": [
            "API and WebSocket delivery use deterministic authorized fixture routes; this is not the R02 real-flow gate.",
            "Headless Chromium may use SwiftShader; WebGL2 success proves a context/render path, not physical GPU or mobile performance.",
            "Playwright browsers are worktree-local in .tmp/board-3d-browsers rather than .tmp/board-3d-venv/browsers; no global browser install was used.",
            "Mocked onUnavailable callbacks in jsdom are source tests and are never promoted to native context-loss PASS.",
            "No screen reader, user visual acceptance or physical mobile device was used.",
        ],
    }
    child = temporary = log = None
    try:
        source_status = git([
            "status", "--porcelain", "--untracked-files=all", "--",
            *(path.relative_to(ROOT).as_posix() for path in SOURCE_PATHS),
        ]).splitlines()
        report["provenance"] = {
            "sourceSha": git(["rev-parse", "HEAD"]),
            "workingTreeStatus": git(["status", "--porcelain"]).splitlines(),
            "sourceWorkingTreeStatus": source_status,
            "sourcePaths": [path.relative_to(ROOT).as_posix() for path in SOURCE_PATHS],
            "sourceHash": tree_hash(list(SOURCE_PATHS)),
        }
        report["provenance"]["worktreeDirty"] = bool(report["provenance"]["workingTreeStatus"])
        report["provenance"]["sourceDirty"] = bool(source_status)
        build_hash, build_files = build_manifest()
        report["provenance"]["buildHash"] = build_hash
        report["provenance"]["buildFiles"] = build_files
        report["environment"] = legacy.environment()
        report["environment"].update({
            "browserCache": str(BROWSERS),
            "targetBrowser": args.browser,
            "mode": "headless",
            "rendererNotes": "effective/WebGL values are recorded per capture; software GPU inference requires unmasked renderer evidence",
        })
        fixture_path = (ROOT / args.fixture).resolve()
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        report["fixture"] = {"path": relative(fixture_path), "sha256": file_hash(fixture_path), "seed": fixture["seed"], "sources": fixture["sources"]}
        if report["provenance"]["sourceDirty"]:
            case(report, "H3-source-frozen", "FAIL", detail="Source/test/runner paths contain uncommitted changes; captures are diagnostic, not H3 frozen-build evidence.",
                 sourceWorkingTreeStatus=source_status)
        else:
            case(report, "H3-source-frozen", "PASS", sourceSha=report["provenance"]["sourceSha"], buildHash=build_hash)

        if args.base_url:
            base = args.base_url.rstrip("/")
            report["server"] = {"ownership": "external, never stopped by runner", "baseUrl": base}
        else:
            base, child, temporary, log = start_server(out)
            report["server"] = {"ownership": "runner", "baseUrl": base, "pid": child.pid,
                                 "temporaryDirectory": temporary.name,
                                 "database": "independent temporary SQLite, deleted in finally"}
        verify_assets(base, report)

        try:
            from playwright.sync_api import sync_playwright
            import playwright
        except ImportError as error:
            raise Blocked(f"Playwright missing from this Python: {sys.executable}; install into .tmp/board-3d-venv") from error
        report["environment"]["python"] = sys.version
        report["environment"]["pythonExecutable"] = sys.executable
        report["environment"]["playwright"] = importlib.metadata.version("playwright")
        revisions = Path(playwright.__file__).parent / "driver/package/browsers.json"
        report["environment"]["browserRevisions"] = json.loads(revisions.read_text(encoding="utf-8"))["browsers"]
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(BROWSERS))

        with sync_playwright() as playwright_api:
            browser_type = getattr(playwright_api, args.browser)
            executable = args.executable_path or browser_type.executable_path
            report["environment"].update({"browserExecutable": executable,
                                          "executableSha256": file_hash(Path(executable)) if Path(executable).is_file() else None})
            try:
                launch_kwargs = {"headless": True}
                if args.executable_path:
                    launch_kwargs["executable_path"] = args.executable_path
                browser = browser_type.launch(**launch_kwargs)
            except Exception as error:
                raise Blocked(f"browser launch failed: {error}; install under {BROWSERS} or pass --executable-path") from error
            report["environment"]["browserVersion"] = browser.version
            try:
                suites = {
                    "visual": visuals,
                    "interaction": interactions,
                    "events": privacy_events,
                    "faults": faults,
                    "performance": performance,
                    "real-flow": real_flow,
                }
                selected = list(suites) if args.suite == "all" else [args.suite]
                for name in selected:
                    suites[name](browser, base, args, fixture, report, out)
                    legacy.write_report(report, out)
                if args.suite == "all":
                    case(report, "R03-all-browsers", "BLOCKED", selected=args.browser,
                         detail="One browser was executed; Chromium, Firefox and WebKit must each be recorded separately.")
                    case(report, "K3-human-art-acceptance", "BLOCKED", detail="Same-fixture user acceptance of V01-V07 is not available.")
            finally:
                browser.close()
    except KeyboardInterrupt:
        case(report, "runner", "BLOCKED", error="Interrupted; completed evidence retained.")
    except Blocked as error:
        case(report, "runner", "BLOCKED", error=str(error))
    except Exception as error:
        case(report, "runner", "FAIL", error=str(error), traceback=traceback.format_exc())
    finally:
        stop_server(child, temporary, log)
        if child is not None and "server" in report:
            report["server"]["cleanup"] = {"childExitCode": child.returncode,
                                           "temporaryDatabaseRemoved": not Path(temporary.name).exists()}
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        manual_matrix(report)
        report["status"] = aggregate_status(report)
        report["artifacts"] = sorted(set(report["artifacts"] + [relative(path) for path in out.rglob("*") if path.is_file()]))
        legacy.write_report(report, out)
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]),
                      "report": relative(out / "report.json")}, ensure_ascii=False), flush=True)
    return 0 if report["status"] == "PASS" else 2 if report["status"] == "BLOCKED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
